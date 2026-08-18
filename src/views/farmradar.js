// Farmradar: inaktive Spieler aus dem Supabase-Verlauf, sortiert nach Nähe
// zu den eigenen Planeten. Die View rendert nur — geladen und hochgeladen
// wird in app.js.
import { state } from '../state.js';
import { rankFarms, coordParts, formatIdle, attackIndex } from '../radar.js';
import { rosterIndex } from '../farmroster.js';
import { esc, num } from '../util/time.js';
import { emptyState, farmTargetCard } from './components.js';
import { isConfigured, getConfig } from '../sync/supabase.js';
import { detectType } from '../parse/detect.js';

const when = (iso) => iso ? new Date(iso).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '–';

/** Eigene Planeten in Universumsreihenfolge (Galaxie, System, Position). */
export function ownPlanetList() {
  return [...state.ownPlanets]
    .filter((c) => coordParts(c))
    .sort((a, b) => {
      const x = coordParts(a), y = coordParts(b);
      return x.galaxy - y.galaxy || x.system - y.system || x.position - y.position;
    });
}

/**
 * Bezugspunkte des Radars.
 *
 * Standard sind ALLE eigenen Planeten. Ist im Dropdown ein einzelner eigener
 * Planet gewählt, zählt nur dessen Umgebung — so lässt sich der Radar auf
 * eine Front eingrenzen. Ohne Gesamtübersicht bleibt die von Hand
 * eingetragene Koordinate als Rückfallebene.
 */
export function radarOrigins() {
  const own = ownPlanetList();
  const center = String(state.radar.settings?.center || '').trim();
  if (center && own.includes(center)) return [center];
  if (own.length) return own;
  return coordParts(center) ? [center] : [];
}

function configPanel() {
  const cfg = getConfig();
  const user = state.radar.user;
  if (!isConfigured() || state.radar.editCfg) {
    return `<section class="panel">
      <div class="head"><h3>Supabase verbinden</h3><span class="hint">Projekt-URL und anon-Key aus Supabase → Settings → API. Beides bleibt nur in diesem Browser.</span></div>
      <div class="body">
        <div class="row radar-cfg">
          <input id="radarUrl" class="inp" type="url" placeholder="https://xxxx.supabase.co" value="${esc(cfg.url)}">
          <input id="radarKey" class="inp" type="password" placeholder="anon public key" value="${esc(cfg.anonKey)}">
          <button class="btn primary" id="btnRadarSaveCfg">Speichern</button>
        </div>
      </div>
    </section>`;
  }
  if (!user) {
    return `<section class="panel">
      <div class="head"><h3>Nicht angemeldet</h3><span class="hint">${esc(cfg.url)}</span></div>
      <div class="body">
        <div class="row">
          <button class="btn primary" id="btnRadarOpenLogin">${state.radar.busy === 'login' ? 'Anmelden …' : '🔑 Anmelden'}</button>
          <button class="btn sm ghost" id="btnRadarResetCfg">Projekt wechseln</button>
          <span class="hint">Ohne Anmeldung bleiben Farmradar, Farmliste und Beute-Archiv leer.</span>
        </div>
      </div>
    </section>`;
  }
  const snaps = state.radar.snapshots.slice(0, 4).map((s) =>
    `<span class="pill">${esc(s.kind)} · ${when(s.taken_at)} · ${num(s.row_count)} Zeilen${s.changed_count ? ` · ${num(s.changed_count)} geändert` : ''}</span>`).join(' ');
  return `<section class="panel">
    <div class="head"><h3>Verbunden</h3><span class="hint">${esc(user.email || '')}</span>
      <div class="spacer" style="flex:1"></div>
      <button class="btn sm ghost" id="btnRadarLogout">Abmelden</button>
    </div>
    <div class="body"><div class="row" style="gap:6px;flex-wrap:wrap">${snaps || '<span class="pill">noch keine Importe</span>'}</div></div>
  </section>`;
}

function importPanel() {
  if (!state.radar.user) return '';
  // Der Text steht im State, nicht nur im DOM: jedes Re-Render (Countdown,
  // Fensterbreite, Busy-Anzeige) baut das Feld neu auf.
  const pasted = state.radar.paste;
  const type = pasted ? detectType(pasted) : null;
  const hint = type === 'highscore_spieler' ? '✔ Spieler-Highscore erkannt'
    : type === 'highscore_planeten' ? '✔ Planeten-Highscore erkannt'
    : pasted ? '⚠ keine Highscore-Liste erkannt' : '';
  return `<section class="panel">
    <div class="head"><h3>Highscore einfügen</h3>
      <span class="hint">Community → Highscore, Reiter „Spieler" oder „Planeten". Mehrere Seiten dürfen hintereinander in dasselbe Feld.</span></div>
    <div class="body">
      <textarea id="inputHighscore" spellcheck="false" placeholder="Highscore-Liste hier einfügen (Spieler oder Planeten) …">${esc(pasted)}</textarea>
      <div class="row">
        <button class="btn primary" id="btnRadarPush"${pasted ? '' : ' disabled'}>${state.radar.busy === 'push' ? 'Übertrage …' : '↑ Nach Supabase übertragen'}</button>
        <button class="btn sm ghost" id="btnRadarLoad">${state.radar.busy === 'load' ? 'Lade …' : '⟳ Ziele neu laden'}</button>
        ${hint ? `<span class="pill">${hint}</span>` : ''}
      </div>
    </div>
  </section>`;
}

/** Bezugspunkt: Dropdown der eigenen Planeten, sonst Eingabefeld. */
function centerField(s) {
  const own = ownPlanetList();
  if (!own.length) {
    return `<label>Bezugspunkt
      <input class="inp" type="text" placeholder="z. B. 12:101:5" value="${esc(s.center || '')}" data-radar="center">
      <b class="mono">keine Gesamtübersicht — Koordinate eintragen</b></label>`;
  }
  // Ein früher eingetragener Wert, der kein eigener Planet (mehr) ist, darf
  // nicht stillschweigend verschwinden: er steht als eigener Eintrag drin.
  const extra = s.center && !own.includes(s.center) ? [s.center] : [];
  const options = [
    `<option value=""${s.center ? '' : ' selected'}>Alle eigenen Planeten (${own.length})</option>`,
    ...own.map((c) => `<option value="${esc(c)}"${c === s.center ? ' selected' : ''}>${esc(c)}</option>`),
    ...extra.map((c) => `<option value="${esc(c)}" selected>${esc(c)} (nicht mehr eigener Planet)</option>`),
  ].join('');
  return `<label>Bezugspunkt
    <select class="inp" data-radar="center">${options}</select>
    <b class="mono">${s.center ? 'nur um diesen Planeten' : `${own.length} eigene Planeten`}</b></label>`;
}

function controls(s) {
  return `<section class="panel radar-controls">
    <div class="head"><h3>Filter</h3><span class="hint">Inaktiv heißt: Gesamtpunkte haben sich seit dieser Zeitspanne nicht bewegt. Kleine Werte sind zum Testen frischer Importe gedacht.</span></div>
    <div class="body">
      <div class="radar-grid">
        <label>Inaktiv ab
          <input type="range" min="1" max="720" step="1" value="${s.idleHours}" data-radar="idleHours">
          <b class="mono">${formatIdle(s.idleHours)}</b></label>
        <label>Umkreis
          <input type="range" min="1" max="150" step="1" value="${s.maxSystems}" data-radar="maxSystems">
          <b class="mono">± ${s.maxSystems} Systeme</b></label>
        <label>Max. Punkte
          <input class="inp" type="number" min="0" step="100" placeholder="egal" value="${s.maxPoints ?? ''}" data-radar="maxPoints">
          <b class="mono">Spielergröße</b></label>
        <label class="switch">
          <input type="checkbox" ${s.sameGalaxyOnly ? 'checked' : ''} data-radar="sameGalaxyOnly"> nur eigene Galaxien</label>
        <label class="switch">
          <input type="checkbox" ${s.onlyUntouched ? 'checked' : ''} data-radar="onlyUntouched"> nur nie angegriffene</label>
        <label class="switch">
          <input type="checkbox" ${s.notToday ? 'checked' : ''} data-radar="notToday"> heute noch nicht angeflogen</label>
        ${centerField(s)}
      </div>
    </div>
  </section>`;
}

/**
 * Die Zielliste als Karten — inhaltlich dieselben Felder wie in der
 * Farmliste, damit ein Kandidat und ein belegter Platz vergleichbar sind.
 * Der Haken steuert die Sammelübernahme, der Knopf nimmt einzeln auf.
 */
function targetRows(list, picked, listedBy) {
  const center = String(state.radar.settings?.center || '').trim();
  return `<div class="farm-list cards">${list.map((row) => farmTargetCard(row, {
    picked: picked ? picked.has(row.coord) : null,
    listed: listedBy.get(row.coord),
    origin: center || row.nearestOwn || '',
  })).join('')}</div>`;
}

function playerRows(list) {
  const byOwner = new Map();
  for (const row of list) {
    const key = row.owner_name || '?';
    const entry = byOwner.get(key) || {
      name: key, alliance: row.alliance, idleHours: row.idleHours,
      total: row.total_points, planetCount: row.planet_count,
      inRange: 0, points: 0, nearest: row.systemGap ?? Infinity,
    };
    entry.inRange++;
    entry.points += row.points || 0;
    entry.nearest = Math.min(entry.nearest, row.systemGap ?? Infinity);
    byOwner.set(key, entry);
  }
  const players = [...byOwner.values()].sort((a, b) => b.points - a.points);
  return `<div class="farm-list">${players.map((p, i) => `<article class="farm-row">
    <div class="farm-rank mono">#${i + 1}</div>
    <div class="farm-target"><b>${esc(p.name)}</b>
      <small>${p.alliance ? `[${esc(p.alliance)}] · ` : ''}${num(p.total || 0)} P · ${p.planetCount ?? '?'} Planeten insgesamt</small></div>
    <div class="farm-loot mono"><b>${formatIdle(p.idleHours)}</b><small>ohne Punktebewegung</small></div>
    <div class="farm-res mono">
      <span>${p.inRange} in Reichweite</span>
      <span>${num(p.points)} P</span>
      <span>${Number.isFinite(p.nearest) ? `${p.nearest} Sys` : '–'}</span>
    </div>
  </article>`).join('')}</div>`;
}

/**
 * Die aktuell bewertete Zielliste. Steht als eigene Funktion da, weil außer
 * der View auch der Export (app.js) genau dieselbe Liste braucht.
 */
export function currentRanked() {
  const s = state.radar.settings || {};
  return rankFarms(state.radar.rows, {
    own: radarOrigins(),
    mine: ownPlanetList(),
    idleHours: s.idleHours,
    maxSystems: s.maxSystems,
    sameGalaxyOnly: s.sameGalaxyOnly,
    maxPoints: s.maxPoints,
    attacks: attackIndex(state.loot.targets),
    onlyUntouched: s.onlyUntouched,
    notToday: s.notToday,
  });
}

/**
 * Ausgewählte Ziele: alles, was nicht ausdrücklich abgewählt wurde. So sind
 * neue Treffer nach einer Filteränderung automatisch dabei — abwählen ist
 * die Ausnahme, nicht die Regel.
 */
export function pickedCoords(ranked) {
  const off = state.radar.unpicked;
  return new Set(ranked.filter((r) => !off.has(r.coord)).map((r) => r.coord));
}

/** Die tatsächlich exportierten Zeilen — Reihenfolge macht farmExportPairs. */
export function exportRows(ranked) {
  const picked = pickedCoords(ranked);
  return ranked.filter((r) => picked.has(r.coord));
}

function exportPanel(ranked, picked) {
  return `<section class="panel radar-export">
    <div class="head"><h3>Auswahl in die Farmliste</h3>
      <span class="hint">Der Haken oben an jeder Karte bestimmt, was übernommen wird — einzeln geht es mit dem Knopf „→ zur Farmliste" direkt an der Karte. Ziele, die schon einen Platz belegen, sind gekennzeichnet und lassen sich nicht doppelt aufnehmen. Verwaltet, bewertet und exportiert wird die Runde danach im Tab <b>Farmliste</b>.</span></div>
    <div class="body">
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn primary" id="btnRadarToRoster"${picked.size ? '' : ' disabled'}>→ ${num(picked.size)} Farmen übernehmen</button>
        <button class="btn sm ghost" data-radar-pickall="all">Alle auswählen</button>
        <button class="btn sm ghost" data-radar-pickall="none">Keine</button>
        <button class="btn sm ghost" data-radar-pickall="new">nur neue</button>
        <span class="pill mono">${num(picked.size)} von ${num(ranked.length)} ausgewählt${
          state.radar.settings?.center ? ` · für ${esc(state.radar.settings.center)}` : ' · je nächstem eigenen Planeten'}</span>
      </div>
    </div>
  </section>`;
}

export function renderFarmradar() {
  const s = state.radar.settings || {};
  const origins = radarOrigins();
  const head = `<section class="farm-intro">
      <div><div class="eyebrow">Supabase-Verlauf</div><h1>Farmradar</h1>
      <p>Wer seit Tagen dieselben Punkte hat, spielt nicht mehr. Der Radar schneidet diese Spieler mit dem Planeten-Highscore und deinen eigenen Koordinaten — heraus kommen erreichbare, wehrlose Farmen.</p></div>
      <div class="farm-count mono"><b>${num(state.radar.rows.length)}</b><span>Zeilen geladen</span></div>
    </section>`;

  const msg = state.radar.error
    ? `<div class="empty bad">${esc(state.radar.error)}</div>`
    : state.radar.notice ? `<div class="empty">${esc(state.radar.notice)}</div>` : '';

  if (!state.radar.user) return head + msg + configPanel();

  const attacks = attackIndex(state.loot.targets);
  const rankOpts = {
    own: origins,
    mine: ownPlanetList(),
    idleHours: s.idleHours,
    maxSystems: s.maxSystems,
    sameGalaxyOnly: s.sameGalaxyOnly,
    maxPoints: s.maxPoints,
    attacks,
  };
  const ranked = currentRanked();
  // Ohne die beiden Archiv-Schalter: zeigt, wie viel sie gerade wegfiltern.
  const unfiltered = s.onlyUntouched || s.notToday
    ? rankFarms(state.radar.rows, rankOpts).length : ranked.length;
  const fresh = ranked.filter((r) => !r.attack?.reports).length;
  const hiddenNote = unfiltered > ranked.length
    ? ` · ${unfiltered - ranked.length} bekannte ausgeblendet` : '';
  // Nach dem ersten Import startet die Inaktivitätsuhr bei allen bei null.
  // Dann misst der Radar nicht Inaktivität, sondern die eigene Beobachtungszeit.
  const unconfirmed = ranked.filter((r) => r.idle_confirmed === false).length;
  const watchNote = ranked.length && unconfirmed > ranked.length / 2
    ? `<div class="empty">Bei ${num(unconfirmed)} von ${num(ranked.length)} Zielen ist die Inaktivität noch nicht belegt: die Uhr läuft erst seit dem ersten Import. Aussagekräftig wird sie, sobald ein zweiter Highscore-Import zeigt, wessen Punkte sich bewegt haben.</div>`
    : '';

  const picked = pickedCoords(ranked);
  const listedBy = rosterIndex(state.roster.rows);
  const onList = ranked.filter((r) => listedBy.get(r.coord)?.active.length).length;
  const LIMIT = 40;
  const shown = state.radar.showAll ? ranked : ranked.slice(0, LIMIT);
  const moreBtn = ranked.length > LIMIT
    ? `<div class="row farm-more"><button class="btn sm ghost" id="btnRadarShowAll">${
        state.radar.showAll ? `▴ nur die besten ${LIMIT} zeigen` : `▾ alle ${ranked.length} Ziele zeigen`}</button></div>`
    : '';

  const body = !origins.length
    ? emptyState('Kein Bezugspunkt: füge im Lage-Tab die Gesamtübersicht ein — dann stehen deine Planeten oben im Dropdown. Ersatzweise eine Koordinate eintragen.')
    : !state.radar.rows.length
    ? emptyState('Noch keine Daten geladen — Highscore übertragen und „Ziele neu laden" klicken.')
    : !ranked.length
    ? emptyState(unfiltered
      ? `Alle ${unfiltered} Ziele im Umkreis stehen schon im Beute-Archiv. Schalter „nur nie angegriffene" bzw. „heute noch nicht angeflogen" lösen, oder den Umkreis vergrößern.`
      : 'Keine inaktiven Ziele im gewählten Umkreis. Umkreis vergrößern oder Inaktivitätsschwelle senken.')
    : `${watchNote}<div class="signals farm-signals">
        <div class="sig f"><div class="k">Ziele in Reichweite</div><div class="v">${ranked.length}</div><div class="sub">${s.center ? `um ${esc(s.center)}` : `± ${s.maxSystems} Systeme`}${hiddenNote}</div></div>
        <div class="sig o"><div class="k">Noch nie angegriffen</div><div class="v">${fresh}</div><div class="sub">${ranked.length - fresh} bereits im Beute-Archiv</div></div>
        <div class="sig ${onList ? 't' : 's'}"><div class="k">Schon auf einer Liste</div><div class="v">${onList}</div><div class="sub">${ranked.length - onList} noch frei verfügbar</div></div>
        <div class="sig t"><div class="k">Stand</div><div class="v">${state.radar.loadedAt ? when(new Date(state.radar.loadedAt).toISOString()).slice(-5) : '–'}</div><div class="sub">${state.radar.loadedAt ? when(new Date(state.radar.loadedAt).toISOString()) : 'nicht geladen'}</div></div>
      </div>
      <div class="farm-columns">
        <section class="section"><h2>◆ Beste Ziele</h2><div class="desc">Planetenpunkte, gedämpft durch die Entfernung, verstärkt durch die Dauer der Inaktivität. Groß steht, was das Ziel im Schnitt je Flug abwirft — der Knopf nimmt es einzeln auf, der Haken sammelt für die Übernahme oben.</div>${targetRows(shown, picked, listedBy)}${moreBtn}</section>
        <section class="section"><h2>○ Inaktive Spieler</h2><div class="desc">Dieselben Ziele nach Besitzer gebündelt — so siehst du, wo ganze Konten schlafen.</div>${playerRows(ranked)}</section>
      </div>`;

  const exp = ranked.length ? exportPanel(ranked, picked) : '';
  return head + msg + configPanel() + importPanel() + controls(s) + exp + body;
}
