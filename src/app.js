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
import { renderFarmradar, radarOrigins } from './views/farmradar.js';
import { coordParts } from './radar.js';
import * as sb from './sync/supabase.js';
import { parsePlayerHighscore, parsePlanetHighscore } from './parse/highscore.js';
import { detectType } from './parse/detect.js';
import { setZoom } from './views/timeline.js';
import { DEMO_GESAMT, DEMO_UEBERSICHT } from './demo.js';

const $ = (s) => document.querySelector(s);
/** Tabs, die ohne die beiden Pflicht-Pastes auskommen. */
const STANDALONE = new Set(['farmen', 'farmradar']);
const VIEWS = { lage: renderLage, bauen: renderBauen, flotten: renderFlotten, prognose: renderPrognose, farmen: renderFarmen, farmradar: renderFarmradar };
let tab = persist.getTab();
let forecastPlanet = null;
if (!VIEWS[tab]) tab = 'lage';
const alarmed = new Set();

function render() {
  const fn = VIEWS[tab] || renderLage;
  $('#view').innerHTML = STANDALONE.has(tab)
    ? fn()
    : hasRequiredData()
    ? (tab === 'prognose' ? fn(forecastPlanet) : fn())
    : '<div class="empty">Füge zuerst die Übersichtsseite (HTML oder Text) und die Gesamtübersicht ein.</div>';
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
  const q = { idleDays: s.idleDays, maxPoints: s.maxPoints };
  if (!parts.length) return q;
  if (s.sameGalaxyOnly) q.galaxies = [...new Set(parts.map((p) => p.galaxy))];
  const systems = parts.map((p) => p.system);
  q.systemFrom = Math.min(...systems) - s.maxSystems;
  q.systemTo = Math.max(...systems) + s.maxSystems;
  return q;
}

async function radarLoad() {
  const [rows, snapshots] = await Promise.all([sb.fetchFarms(radarQuery()), sb.fetchSnapshots()]);
  state.radar.rows = rows;
  state.radar.snapshots = snapshots;
  state.radar.loadedAt = Date.now();
  state.radar.notice = rows.length ? null : 'Die Abfrage lieferte keine Zeilen — sind schon zwei Importe an verschiedenen Tagen drin?';
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
  if (e.target.closest('#btnRadarSaveCfg')) {
    const url = $('#radarUrl').value, key = $('#radarKey').value;
    if (!url || !key) { toast('Bitte URL und anon-Key eintragen.', 'bad'); return true; }
    sb.setConfig(url, key);
    state.radar.editCfg = false;
    radarAction('login', radarRefreshUser);
    return true;
  }
  if (e.target.closest('#btnRadarResetCfg')) { state.radar.editCfg = true; render(); return true; }
  if (e.target.closest('#btnRadarLogin')) {
    const email = $('#radarEmail').value.trim(), pass = $('#radarPass').value;
    persist.setRadar({ email });
    radarAction('login', async () => {
      await sb.signIn(email, pass);
      await radarRefreshUser();
      await radarLoad();
    });
    return true;
  }
  if (e.target.closest('#btnRadarLogout')) {
    radarAction('login', async () => {
      await sb.signOut();
      state.radar.user = null; state.radar.rows = []; state.radar.snapshots = [];
      // Ohne Login ist das Archiv nicht mehr lesbar — sonst zeigte der
      // Farmatlas weiter Zahlen, die niemand mehr nachladen kann.
      state.loot.rows = []; state.loot.targets = []; state.loot.loadedAt = null;
    });
    return true;
  }
  if (e.target.closest('#btnRadarPush')) { radarAction('push', radarPush); return true; }
  if (e.target.closest('#btnRadarLoad')) { radarAction('load', radarLoad); return true; }
  return false;
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
  pasteTimer = setTimeout(() => {
    const sig = state.radar.paste.trim() ? detectType(state.radar.paste) : 'leer';
    if (sig !== pasteSig) { pasteSig = sig; render(); }
  }, 200);
  return true;
}

function radarChange(e) {
  const field = e.target.dataset.radar;
  if (!field) return false;
  let value;
  if (field === 'sameGalaxyOnly') value = e.target.checked;
  else if (field === 'maxPoints') value = e.target.value === '' ? null : Number(e.target.value);
  else if (field === 'center') value = e.target.value.trim();
  else value = Number(e.target.value);
  persist.setRadar({ [field]: value });
  // Umkreis und Galaxiefilter schränken schon die Abfrage ein -> neu laden.
  if (['maxSystems', 'idleDays', 'maxPoints', 'sameGalaxyOnly', 'center'].includes(field) && state.radar.user) {
    radarAction('load', radarLoad);
  } else render();
  return true;
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
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(render, 150);
  });

  setInterval(tick, 250);
  render();
  if (tab === 'farmradar') radarAutoLoad();
  if (tab === 'farmen') lootAutoLoad();
  // Hook für die Playwright-Rauchtests (test/*.mjs) — sonst ungenutzt.
  window.__gw = { state, render };
}
document.addEventListener('DOMContentLoaded', init);
