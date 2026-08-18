// Bootstrap: Tabs, Paste-Auswertung, Live-Tick, Alarme. Kein API-Zugriff.
import { state, serverNow, loadPersisted, ingest, ingestRequiredPair, hasRequiredData, clearAll, clearFarmReports, persist } from './state.js';
import { nextImpact, resourceAt } from './analysis.js';
import { clock, hhmmss, durLong, esc, coordChip, num } from './util/time.js';
import { deLabel } from './domain.js';
import { renderLage } from './views/lage.js';
import { renderBauen } from './views/bauen.js';
import { renderFlotten } from './views/flotten.js';
import { renderPrognose } from './views/prognose.js';
import { renderFarmen } from './views/farmen.js';
import { renderFarmradar, radarOrigins, currentRanked, exportRows } from './views/farmradar.js';
import { renderFarmliste, rosterOrigin, rosterView, slotsFor } from './views/farmliste.js';
import { createAuthGate } from './views/login.js';
import { flightOrder, rosterIndex } from './farmroster.js';
import { coordParts, farmExportPairs, farmExportName } from './radar.js';
import * as sb from './sync/supabase.js';
import { parsePlayerHighscore, parsePlanetHighscore } from './parse/highscore.js';
import { detectType } from './parse/detect.js';
import { setZoom } from './views/timeline.js';
import { DEMO_GESAMT, DEMO_UEBERSICHT } from './demo.js';

const $ = (s) => document.querySelector(s);
/** Tabs, die ohne die beiden Pflicht-Pastes auskommen. */
const STANDALONE = new Set(['farmen', 'farmradar', 'farmliste']);
const VIEWS = { lage: renderLage, bauen: renderBauen, flotten: renderFlotten, prognose: renderPrognose, farmen: renderFarmen, farmradar: renderFarmradar, farmliste: renderFarmliste };
let tab = persist.getTab();
let forecastPlanet = null;
if (!VIEWS[tab]) tab = 'lage';
const alarmed = new Set();
let authGate = null;

/* ---------- Fokusschutz beim Rendern ---------- */
/** Felder, bei denen ein Neubau die Tastatur schließen würde. */
const TEXTFIELD = 'input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea';
let renderQueued = false;
let flushT;

/** Steht der Cursor gerade in einem Textfeld des Inhaltsbereichs? */
function isTyping() {
  const el = document.activeElement;
  return !!el && typeof el.matches === 'function' && el.matches(TEXTFIELD) && $('#view').contains(el);
}

/**
 * Aufgeschobenes Rendern nachholen, sobald das Feld verlassen wurde.
 * Die kurze Verzögerung ist Absicht: Tippt man von einem Feld direkt auf
 * einen Knopf, kommt erst der Klick — sonst wäre der Knopf schon neu
 * gebaut und der Klick ginge ins Leere.
 */
function flushRender() {
  clearTimeout(flushT);
  flushT = setTimeout(() => { if (renderQueued) render(); }, 300);
}

/** Nach der Anmeldung: den gerade offenen Tab mit Serverdaten füllen. */
function autoLoadTab() {
  if (tab === 'farmradar') radarAutoLoad();
  else if (tab === 'farmliste') rosterAutoLoad();
  else if (tab === 'farmen') lootAutoLoad();
}

function render() {
  // Ein Render baut #view komplett neu auf — das nimmt einem gerade
  // bespielten Eingabefeld den Fokus, und auf dem Handy klappt damit
  // sofort die Tastatur zu. Läuft gerade eine Eingabe, wird das Rendern
  // deshalb aufgeschoben, bis das Feld verlassen wird.
  if (isTyping()) { renderQueued = true; return; }
  renderQueued = false;
  clearTimeout(flushT);
  // Nicht-Textfelder (Regler, Auswahllisten) dürfen den Fokus behalten:
  // sie überleben den Neubau über ihre id.
  const keepId = $('#view').contains(document.activeElement) ? document.activeElement.id : '';
  const fn = VIEWS[tab] || renderLage;
  $('#view').innerHTML = STANDALONE.has(tab)
    ? fn()
    : hasRequiredData()
    ? (tab === 'prognose' ? fn(forecastPlanet) : fn())
    : '<div class="empty">Füge zuerst die Übersichtsseite (HTML oder Text) und die Gesamtübersicht ein.</div>';
  if (keepId) document.getElementById(keepId)?.focus({ preventScroll: true });
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#importPanel').hidden = STANDALONE.has(tab) || (tab !== 'lage' && hasRequiredData());
  renderStatus();
  tick();
}

function renderStatus() {
  const parts = [];
  if (state.gesamt) parts.push(`<span class="pill">Gesamtübersicht · ${state.gesamt.planets.length} Planeten</span>`);
  if (state.uebersicht) {
    const age = state.snapshotAge != null ? ` · Snapshot vor ${durLong(state.snapshotAge)}` : '';
    parts.push(`<span class="pill">Übersichtsseite · ${state.fleets.length} Flotten${age}</span>`);
  }
  $('#status').innerHTML = parts.join(' ') || '<span class="pill">keine Daten geladen</span>';
  const stale = state.snapshotAge != null && state.snapshotAge > 3600;
  $('#staleBadge').hidden = !stale;
  const active = state.uebersicht?.activePlanet;
  $('#ctx').innerHTML = active ? `Aktiver Planet ${coordChip(active, 'mine')}` : '';
}

function switchTab(t) {
  tab = t; persist.setTab(t);
  closeDrawer();
  render();
  if (t === 'farmradar') radarAutoLoad();
  if (t === 'farmliste') rosterAutoLoad();
  if (t === 'farmen') lootAutoLoad();
}

/* ---------- Farmradar (Supabase) ---------- */

/** Läuft jede Radar-Aktion durch: Busy-Anzeige, Fehlermeldung, Re-Render. */
async function radarAction(busy, fn) {
  state.radar.busy = busy;
  state.radar.error = null;
  render();
  try {
    await fn();
  } catch (e) {
    state.radar.error = String(e?.message || e);
  } finally {
    state.radar.busy = null;
    render();
  }
}

async function radarRefreshUser() {
  state.radar.user = await sb.currentUser();
}

/** Serverseitige Vorfilterung: nur der Sektor um die eigenen Planeten. */
function radarQuery() {
  const s = state.radar.settings;
  const parts = radarOrigins().map(coordParts).filter(Boolean);
  const q = { idleHours: s.idleHours, maxPoints: s.maxPoints };
  if (!parts.length) return q;
  if (s.sameGalaxyOnly) q.galaxies = [...new Set(parts.map((p) => p.galaxy))];
  const systems = parts.map((p) => p.system);
  q.systemFrom = Math.min(...systems) - s.maxSystems;
  q.systemTo = Math.max(...systems) + s.maxSystems;
  return q;
}

async function radarLoad() {
  // Das Beute-Archiv kommt mit: nur damit weiß der Radar, welche Ziele
  // längst zur täglichen Runde gehören. Die Farmlisten aller Planeten
  // ebenso — sonst schlägt der Radar Ziele vor, die längst einen Platz haben.
  const [rows, snapshots, targets, roster] = await Promise.all([
    sb.fetchFarms(radarQuery()), sb.fetchSnapshots(), sb.fetchLootTargets(), sb.fetchRoster(),
  ]);
  state.radar.rows = rows;
  state.radar.snapshots = snapshots;
  state.loot.targets = targets;
  state.roster.rows = roster;
  state.radar.loadedAt = Date.now();
  state.radar.notice = rows.length ? null : 'Die Abfrage lieferte keine Zeilen — Schwelle „Inaktiv ab" senken (zum Testen bis auf 1 h) oder erst einen zweiten Import abwarten.';
}

/** Beim ersten Öffnen des Tabs automatisch laden. */
function radarAutoLoad() {
  if (!sb.isConfigured()) return;
  radarAction('load', async () => {
    if (!state.radar.user) await radarRefreshUser();
    if (state.radar.user && !state.radar.rows.length) await radarLoad();
  });
}

async function radarPush() {
  const text = state.radar.paste.trim();
  if (!text) throw new Error('Bitte zuerst eine Highscore-Liste einfügen.');
  const type = detectType(text);
  let res;
  if (type === 'highscore_spieler') {
    const parsed = parsePlayerHighscore(text);
    if (!parsed.rows.length) throw new Error('Keine Spielerzeilen erkannt.');
    res = await sb.pushPlayers(parsed.rows);
    toast(`✅ ${num(res.rows)} Spieler übertragen · ${num(res.changed)} verändert`, 'ok');
  } else if (type === 'highscore_planeten') {
    const parsed = parsePlanetHighscore(text);
    if (!parsed.rows.length) throw new Error('Keine Planetenzeilen erkannt.');
    res = await sb.pushPlanets(parsed.rows);
    toast(`✅ ${num(res.rows)} Planeten übertragen · ${num(res.changed)} verändert`, 'ok');
  } else {
    throw new Error('Das sieht nicht nach einer Highscore-Liste aus (Reiter „Spieler" oder „Planeten").');
  }
  state.radar.paste = '';
  await radarLoad();
}

function radarClick(e) {
  if (e.target.closest('#btnRadarResetCfg')) { authGate?.open('', { advanced: true }); return true; }
  if (e.target.closest('#btnRadarOpenLogin')) { authGate?.open(); return true; }
  if (e.target.closest('#btnRadarLogout')) {
    radarAction('login', async () => {
      await sb.signOut();
      state.radar.user = null; state.radar.rows = []; state.radar.snapshots = [];
      // Ohne Login ist das Archiv nicht mehr lesbar — sonst zeigte der
      // Farmatlas weiter Zahlen, die niemand mehr nachladen kann.
      state.loot.rows = []; state.loot.targets = []; state.loot.loadedAt = null;
      authGate?.open('Abgemeldet.');
    });
    return true;
  }
  if (e.target.closest('#btnRadarPush')) { radarAction('push', radarPush); return true; }
  if (e.target.closest('#btnRadarLoad')) { radarAction('load', radarLoad); return true; }
  if (e.target.closest('#btnRadarShowAll')) {
    state.radar.showAll = !state.radar.showAll; render(); return true;
  }
  const pickAll = e.target.closest('[data-radar-pickall]');
  if (pickAll) { radarPickAll(pickAll.dataset.radarPickall); return true; }
  return false;
}

/* ---------- Auswahl im Radar ---------- */

/** Datei im Browser erzeugen und herunterladen (ohne Server). */
function downloadFile(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst nach dem Klick freigeben, sonst bricht der Download in Firefox ab.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Zählerstand im Auswahl-Panel nachziehen, ohne die Liste neu zu bauen. */
function updateExportCount() {
  const ranked = currentRanked();
  const picked = exportRows(ranked).length;
  const btn = $('#btnRadarToRoster');
  if (btn) { btn.textContent = `→ ${num(picked)} Farmen übernehmen`; btn.disabled = !picked; }
  const pill = document.querySelector('.radar-export .pill');
  if (pill) {
    const center = state.radar.settings?.center;
    pill.textContent = `${num(picked)} von ${num(ranked.length)} ausgewählt${
      center ? ` · für ${center}` : ' · je nächstem eigenen Planeten'}`;
  }
}

/** Auswahlhilfen: alles, nichts, oder nur die noch nie angeflogenen Ziele. */
function radarPickAll(mode) {
  const ranked = currentRanked();
  const off = state.radar.unpicked;
  for (const row of ranked) {
    const keep = mode === 'all' ? true : mode === 'none' ? false : !row.attack?.reports;
    if (keep) off.delete(row.coord); else off.add(row.coord);
  }
  render();
}

/**
 * Der eingefügte Text lebt im State, nicht im DOM — sonst verliert ihn das
 * nächste Re-Render (Countdown, Busy-Anzeige, Fensterbreite). Neu gezeichnet
 * wird nur, wenn sich die erkannte Listenart ändert; die Erkennung läuft
 * entprellt, weil sie über den kompletten Paste geht.
 */
let pasteSig = 'leer';
let pasteTimer = null;
function radarInput(e) {
  if (e.target.id === 'inputFarmReports') { state.farmPaste = e.target.value; return true; }
  if (e.target.id !== 'inputHighscore') return false;
  state.radar.paste = e.target.value;
  clearTimeout(pasteTimer);
  // Kein Neubau der View: Knopf und Hinweis werden direkt am DOM nachgezogen,
  // damit Cursor und Tastatur im Feld bleiben.
  pasteTimer = setTimeout(() => {
    const text = state.radar.paste.trim();
    pasteSig = text ? detectType(text) : 'leer';
    const btn = $('#btnRadarPush');
    if (btn) btn.disabled = !text;
    const hint = $('#radarPasteHint');
    if (!hint) return;
    const label = pasteSig === 'highscore_spieler' ? '✔ Spieler-Highscore erkannt'
      : pasteSig === 'highscore_planeten' ? '✔ Planeten-Highscore erkannt'
      : text ? '⚠ keine Highscore-Liste erkannt' : '';
    hint.textContent = label;
    hint.hidden = !label;
  }, 200);
  return true;
}

function radarChange(e) {
  // Die Export-Haken sind reine Auswahl: kein Neuladen, nur die Zählung im
  // Panel muss mit. Ein Voll-Render würde hier die Scrollposition kosten.
  const pick = e.target.dataset.radarPick;
  if (pick) {
    if (e.target.checked) state.radar.unpicked.delete(pick);
    else state.radar.unpicked.add(pick);
    e.target.closest('.farm-row')?.classList.toggle('unpicked', !e.target.checked);
    updateExportCount();
    return true;
  }
  const field = e.target.dataset.radar;
  if (!field) return false;
  let value;
  if (e.target.type === 'checkbox') value = e.target.checked;
  else if (field === 'maxPoints') value = e.target.value === '' ? null : Number(e.target.value);
  else if (field === 'center') value = e.target.value.trim();
  else value = Number(e.target.value);
  persist.setRadar({ [field]: value });
  // Umkreis und Galaxiefilter schränken schon die Abfrage ein -> neu laden.
  // Die Archiv-Schalter filtern nur lokal, dafür genügt ein Re-Render.
  if (['maxSystems', 'idleHours', 'maxPoints', 'sameGalaxyOnly', 'center'].includes(field) && state.radar.user) {
    radarAction('load', radarLoad);
  } else render();
  return true;
}

/* ---------- Farmliste (Supabase) ---------- */

async function rosterAction(busy, fn) {
  state.roster.busy = busy;
  state.roster.error = null;
  render();
  try {
    await fn();
  } catch (e) {
    state.roster.error = String(e?.message || e);
  } finally {
    state.roster.busy = null;
    render();
  }
}

async function rosterLoad() {
  const [rows, slots, targets] = await Promise.all([
    sb.fetchRoster(), sb.fetchSlots(), sb.fetchLootTargets(),
  ]);
  state.roster.rows = rows;
  state.roster.slots = slots;
  state.loot.targets = targets;
  state.roster.loadedAt = Date.now();
}

/**
 * Beim Öffnen laden. Die Radarzeilen kommen mit, weil die Nachrücker-Spalte
 * ohne sie leer bliebe — wer die Farmliste öffnet, war nicht zwingend
 * vorher im Radar.
 */
function rosterAutoLoad() {
  if (!sb.isConfigured()) return;
  rosterAction('load', async () => {
    if (!state.radar.user) await radarRefreshUser();
    if (!state.radar.user) return;
    if (!state.roster.loadedAt) await rosterLoad();
    if (!state.radar.rows.length) state.radar.rows = await sb.fetchFarms(radarQuery());
  });
}

/** Nach jeder Änderung neu laden: die View rechnet mit Serverzahlen. */
const rosterSave = (fn, done) => rosterAction('save', async () => {
  const res = await fn();
  await rosterLoad();
  if (done) toast(done(res), 'ok');
});

function rosterClick(e) {
  const add = e.target.closest('[data-roster-add], [data-roster-readd]');
  if (add) {
    // Aus dem Radar kommt der Startplanet an der Karte mit (Bezugspunkt oder
    // nächster eigener Planet); in der Farmliste zählt der gewählte Planet.
    const origin = add.dataset.rosterOrigin || rosterOrigin();
    const target = add.dataset.rosterAdd || add.dataset.rosterReadd;
    if (!coordParts(origin)) { toast('Kein Startplanet zuzuordnen.', 'bad'); return true; }
    rosterSave(() => sb.rosterAdd([{ origin, target, player: add.dataset.player || null }]),
      () => `✅ ${target} aufgenommen (ab ${origin})`);
    return true;
  }
  const drop = e.target.closest('[data-roster-drop]');
  if (drop) {
    const target = drop.dataset.rosterDrop;
    rosterSave(() => sb.rosterRemove([{ origin: rosterOrigin(), target, reason: drop.dataset.reason || null }]),
      () => `${target} von der Liste genommen`);
    return true;
  }
  const origin = rosterOrigin();
  if (e.target.closest('#btnRosterDropWeak')) {
    const weak = rosterView(origin).weak;
    if (!weak.length) return true;
    rosterSave(() => sb.rosterRemove(weak.map((r) => ({ origin, target: r.target, reason: r.health.reason }))),
      (res) => `${num(res.changed)} schwache Ziele entfernt`);
    return true;
  }
  if (e.target.closest('#btnRosterReload')) { rosterAction('load', rosterLoad); return true; }
  if (e.target.closest('#btnRosterDropped')) {
    state.roster.showDropped = !state.roster.showDropped; render(); return true;
  }
  if (e.target.closest('#btnRosterExport')) { rosterExport(origin); return true; }
  if (e.target.closest('#btnRadarToRoster')) { radarToRoster(); return true; }
  return false;
}

function rosterChange(e) {
  const field = e.target.dataset.roster;
  if (!field) return false;
  if (field === 'origin') { state.roster.origin = e.target.value; render(); return true; }
  if (field === 'slots') {
    const origin = rosterOrigin();
    const slots = Math.max(0, Math.min(200, Number(e.target.value) || 0));
    rosterSave(() => sb.rosterSetSlots(origin, slots), () => `Kapazität: ${slots} Plätze`);
    return true;
  }
  return false;
}

/** Die aktive Runde eines Planeten als JSON — Reihenfolge nach Ertrag. */
function rosterExport(origin) {
  const list = flightOrder(rosterView(origin).active, origin);
  if (!list.length) { toast('Die Liste dieses Planeten ist leer.', 'bad'); return; }
  const pairs = farmExportPairs(list.map((r) => ({ coord: r.target, owner_name: r.player })));
  const name = farmExportName(origin);
  downloadFile(name, JSON.stringify(pairs));
  toast(`✅ ${num(pairs.length)} Farmen exportiert · ${name}`, 'ok');
}

/**
 * Brücke vom Radar in die Verwaltung: die dort angehakten Ziele wandern auf
 * die Liste des gewählten Bezugspunkts. Ohne einzelnen Bezugspunkt wäre
 * unklar, von welchem Planeten geflogen wird — dann zählt der jeweils
 * nächstgelegene eigene Planet.
 *
 * Ziele, die schon irgendwo einen Platz belegen, bleiben außen vor: sonst
 * flögen zwei Planeten dieselbe Farm an und beide Statistiken wären falsch.
 */
function radarToRoster() {
  const rows = exportRows(currentRanked());
  if (!rows.length) { toast('Keine Farm ausgewählt.', 'bad'); return; }
  const listed = rosterIndex(state.roster.rows);
  const free = rows.filter((r) => !listed.get(r.coord)?.active.length);
  const skipped = rows.length - free.length;
  if (!free.length) { toast('Alle ausgewählten Ziele stehen bereits auf einer Farmliste.', 'bad'); return; }
  const center = state.radar.settings?.center || '';
  const payload = free
    .map((r) => ({ origin: center || r.nearestOwn, target: r.coord, player: r.owner_name || null }))
    .filter((r) => coordParts(r.origin));
  if (!payload.length) { toast('Kein Startplanet zuzuordnen.', 'bad'); return; }
  rosterSave(() => sb.rosterAdd(payload),
    (res) => `✅ ${num(res.changed)} neu auf der Farmliste (${num(payload.length)} übertragen${
      skipped ? `, ${num(skipped)} stehen schon drauf` : ''})`);
}

/* ---------- Beute-Archiv (Supabase) ---------- */

async function lootAction(busy, fn) {
  state.loot.busy = busy;
  state.loot.error = null;
  render();
  try {
    await fn();
  } catch (e) {
    state.loot.error = String(e?.message || e);
  } finally {
    state.loot.busy = null;
    render();
  }
}

async function lootLoad() {
  const [rows, targets] = await Promise.all([
    sb.fetchLootDaily(state.loot.days), sb.fetchLootTargets(),
  ]);
  state.loot.rows = rows;
  state.loot.targets = targets;
  state.loot.loadedAt = Date.now();
}

async function lootPush() {
  if (!state.farmReports.length) throw new Error('Zuerst Angriffsberichte einfügen und auswerten.');
  const res = await sb.pushFarmReports(state.farmReports);
  const parts = [`${num(res.changed)} neue Berichte archiviert`];
  const known = res.rows - res.changed;
  if (known > 0) parts.push(`${num(known)} schon bekannt`);
  if (res.skipped) parts.push(`${num(res.skipped)} ohne Zeitstempel übersprungen`);
  state.loot.notice = parts.join(' · ');
  toast(`✅ ${parts.join(' · ')}`, 'ok');
  await lootLoad();
}

/** Beim Öffnen des Farmen-Tabs das Archiv einmal holen. */
function lootAutoLoad() {
  if (!sb.isConfigured() || state.loot.loadedAt) return;
  lootAction('load', async () => {
    if (!state.radar.user) await radarRefreshUser();
    if (state.radar.user) await lootLoad();
  });
}

function lootClick(e) {
  if (e.target.closest('#btnLootPush')) { lootAction('push', lootPush); return true; }
  if (e.target.closest('#btnLootLoad')) { lootAction('load', lootLoad); return true; }
  return false;
}

function lootChange(e) {
  const field = e.target.dataset.loot;
  if (!field) return false;
  if (field === 'days') {
    state.loot.days = Number(e.target.value);
    lootAction('load', lootLoad);
  } else {
    state.loot[field] = e.target.value;
    render();
  }
  return true;
}

function analyze() {
  const overview = $('#inputOverview').value.trim();
  const gesamt = $('#inputGesamt').value.trim();
  if (!overview || !gesamt) { toast('Bitte beide Ansichten einfügen.', 'bad'); return; }
  const res = ingestRequiredPair(overview, gesamt);
  if (!res.ok) { toast('❌ ' + esc(res.message), 'bad'); return; }
  $('#inputOverview').value = '';
  $('#inputGesamt').value = '';
  toast(`✅ Ansichten übernommen — ${esc(res.message)}`, 'ok');
  alarmed.clear();
  render();
}

function loadDemo() {
  const res = ingestRequiredPair(DEMO_UEBERSICHT, DEMO_GESAMT);
  if (!res.ok) { toast('❌ ' + esc(res.message), 'bad'); return; }
  toast('Beispieldaten geladen.', 'ok');
  alarmed.clear(); render();
}

/* ---------- Tick: Uhr, Countdowns, Now-Linie, Alarme ---------- */
function tick() {
  const now = serverNow();
  const clk = $('#clock');
  if (clk) clk.textContent = hhmmss(now);

  let justExpired = false;
  document.querySelectorAll('.cd[data-at]').forEach((el) => {
    const at = +el.dataset.at;
    if (!at) return;
    const wasPast = el.classList.contains('past');
    el.textContent = clock((at - now) / 1000);
    const isPast = at < now;
    el.classList.toggle('past', isPast);
    if (isPast && !wasPast) justExpired = true;
  });
  // Sobald ein Countdown auf 0 läuft, den aktuellen Tab neu rendern — sonst
  // bleiben abgelaufene Bauaufträge/Ankünfte bis zum nächsten Datenimport
  // in der Liste stehen, weil render() diese sonst nur beim Einfügen neuer
  // Daten oder Tab-Wechsel herausfiltert.
  if (justExpired) { render(); return; }

  document.querySelectorAll('.gantt[data-from]').forEach((g) => {
    const from = +g.dataset.from, span = +g.dataset.span;
    const nowLine = g.querySelector('.now');
    // Der "jetzt"-Strich zeigt die reale Client-Uhrzeit, nicht die
    // (ggf. per Snapshot-Offset korrigierte) Serverzeit.
    if (nowLine && span) nowLine.style.left = ((Date.now() - from) / span * 100).toFixed(2) + '%';
  });

  checkAlarms(now);
}

function checkAlarms(now) {
  if (!$('#alarmOn')?.checked) return;
  const imp = nextImpact();
  if (!imp) return;
  const sec = (imp.at - now) / 1000;
  for (const th of [600, 300, 60, 10]) {
    const key = imp.at + ':' + th;
    if (sec <= th && sec > th - 1 && !alarmed.has(key)) {
      alarmed.add(key);
      const msg = `Einschlag auf ${imp.ziel} in ${durLong(sec)}`;
      toast('⚠ ' + msg, 'bad');
      notify('GigraWars — Einschlag', msg);
    }
  }
}

function notify(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification(title, { body });
    else if (Notification.permission !== 'denied') Notification.requestPermission();
  } catch { /* ignore */ }
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = kind; el.innerHTML = msg;
  $('#toast').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------- Drawer ---------- */
function openDrawer() { $('#drawer').classList.add('open'); $('#scrim').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }

/* ---------- Init ---------- */
function init() {
  loadPersisted();
  $('#alarmOn').checked = persist.getAlarm();

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#burger').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);

  $('#btnAnalyze').addEventListener('click', analyze);
  $('#btnDemo').addEventListener('click', loadDemo);
  $('#btnClear').addEventListener('click', () => { clearAll(); toast('Daten geleert.'); render(); });
  $('#btnFold').addEventListener('click', () => {
    const b = $('#importBody'); b.hidden = !b.hidden;
    $('#btnFold').textContent = b.hidden ? 'Einfügen ▸' : 'Einfügen ▾';
  });
  $('#alarmOn').addEventListener('change', (e) => persist.setAlarm(e.target.checked));
  for (const input of [$('#inputOverview'), $('#inputGesamt')]) {
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); analyze(); }
    });
  }

  // Zoom-Stufen der Gantt-Zeitachse (im Lage-Tab).
  $('#view').addEventListener('click', (e) => {
    if (radarClick(e)) return;
    if (rosterClick(e)) return;
    if (lootClick(e)) return;
    const farmMore = e.target.closest('[data-farm-list]');
    if (farmMore) {
      const list = farmMore.dataset.farmList;
      state.farmShowAll[list] = !state.farmShowAll[list];
      render(); return;
    }
    if (e.target.closest('#btnAnalyzeFarms')) {
      const text = state.farmPaste.trim();
      if (!text) { toast('Bitte Angriffsberichte einfügen.', 'bad'); return; }
      const result = ingest(text);
      if (!result.ok || result.type !== 'farmberichte') { toast('Konnte keine Angriffsberichte erkennen.', 'bad'); return; }
      state.farmPaste = '';
      toast(`✅ ${result.message}`, 'ok'); render(); return;
    }
    if (e.target.closest('#btnClearFarms')) {
      clearFarmReports();
      render(); return;
    }
    const zoom = e.target.closest('[data-tlzoom]');
    if (zoom) { setZoom(zoom.dataset.tlzoom); render(); }
  });
  $('#view').addEventListener('input', radarInput);
  $('#view').addEventListener('change', (e) => {
    if (radarChange(e)) return;
    if (rosterChange(e)) return;
    if (lootChange(e)) return;
    if (e.target.id === 'forecastPlanet') { forecastPlanet = e.target.value; render(); }
    if (e.target.matches('[data-forecast-target]')) {
      const value = e.target.value === '' ? null : Number(e.target.value);
      persist.setForecastTarget(e.target.dataset.coord, e.target.dataset.resource, value);
      render();
    }
  });
  $('#view').addEventListener('mousemove', (e) => {
    const airHit = e.target.closest('.air-chart-hit');
    if (airHit) {
      const chart = airHit.closest('.air-chart');
      const tip = chart.querySelector('.air-chart-tooltip');
      const rect = chart.getBoundingClientRect();
      const ratio = Math.max(5, Math.min(95, (e.clientX - rect.left) / rect.width * 100));
      tip.textContent = airHit.dataset.airDetail;
      tip.style.left = `${ratio}%`;
      tip.hidden = false;
      return;
    }
    const airLine = e.target.closest('.air-chart-line-hit');
    if (airLine) {
      const chart = airLine.closest('.air-chart');
      const tip = chart.querySelector('.air-chart-tooltip');
      const rect = chart.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const at = +airLine.dataset.airFrom + ratio * +airLine.dataset.airSpan;
      const ships = {};
      for (const flight of JSON.parse(airLine.dataset.airFlights)) {
        if (flight.at <= at) continue;
        for (const [key, amount] of Object.entries(flight.ships)) ships[key] = (ships[key] || 0) + amount;
      }
      const manifest = Object.entries(ships)
        .filter(([, amount]) => amount > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([key, amount]) => `${amount.toLocaleString('de-DE')} × ${deLabel.ship(key)}`)
        .join('\n');
      const time = new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      tip.textContent = manifest ? `${time}\n${manifest}` : `${time}\n–`;
      tip.style.left = `${Math.max(5, Math.min(95, ratio * 100))}%`;
      tip.hidden = false;
      return;
    }
    const hit = e.target.closest('.forecast-hit');
    if (!hit) return;
    const card = hit.closest('.forecast-card');
    const rect = hit.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const at = +hit.dataset.from + ratio * 24 * 3600e3;
    const planet = state.planets.get(hit.dataset.coord);
    if (!planet) return;
    const stock = resourceAt(planet, hit.dataset.resource, at).stock;
    const tip = card.querySelector('.forecast-tooltip');
    tip.textContent = `${new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · ${stock.toLocaleString('de-DE')} ${hit.dataset.resource === 'hydrogen' ? 'Wasserstoff' : hit.dataset.resource}`;
    tip.style.left = `${Math.max(6, Math.min(94, ratio * 100))}%`;
    tip.hidden = false;
  });
  $('#view').addEventListener('mouseout', (e) => {
    const airHit = e.target.closest('.air-chart-hit');
    if (airHit && !airHit.contains(e.relatedTarget)) {
      airHit.closest('.air-chart').querySelector('.air-chart-tooltip').hidden = true;
      return;
    }
    const airLine = e.target.closest('.air-chart-line-hit');
    if (airLine && !airLine.contains(e.relatedTarget)) {
      airLine.closest('.air-chart').querySelector('.air-chart-tooltip').hidden = true;
      return;
    }
    const forecastCard = e.target.closest('.forecast-card');
    if (forecastCard && !forecastCard.contains(e.relatedTarget)) {
      forecastCard.querySelector('.forecast-tooltip').hidden = true;
    }
  });

  // Gantt-Zeitachse hängt an der Fensterbreite (Marker mit/ohne Uhrzeit) -> neu rendern.
  // Nur bei echter Breitenänderung: auf dem Handy löst schon das Aufklappen
  // der Tastatur (oder die ein-/ausblendende Adressleiste) ein resize aus.
  let resizeT;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 150);
  });

  // Verlässt der Nutzer ein Feld, wird ein aufgeschobenes Render nachgeholt.
  $('#view').addEventListener('focusout', flushRender);

  setInterval(tick, 250);
  render();
  authGate = createAuthGate(document.getElementById('authGate'), {
    onSignedIn: (user) => { state.radar.user = user; render(); autoLoadTab(); },
    onSkip: render,
  });
  authGate.start();
  // Hook für die Playwright-Rauchtests (test/*.mjs) — sonst ungenutzt.
  window.__gw = { state, render };
}
document.addEventListener('DOMContentLoaded', init);
