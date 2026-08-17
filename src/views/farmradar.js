// Farmradar: inaktive Spieler aus dem Supabase-Verlauf, sortiert nach Nähe
// zu den eigenen Planeten. Die View rendert nur — geladen und hochgeladen
// wird in app.js.
import { state } from '../state.js';
import { rankFarms, coordParts } from '../radar.js';
import { coordChip, esc, num, short } from '../util/time.js';
import { emptyState } from './components.js';
import { isConfigured, getConfig } from '../sync/supabase.js';
import { detectType } from '../parse/detect.js';

const when = (iso) => iso ? new Date(iso).toLocaleString('de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}) : '–';

/** Bezugspunkte: eigene Planeten, ersatzweise die manuelle Koordinate. */
export function radarOrigins() {
  const own = [...state.ownPlanets].filter((c) => coordParts(c));
  if (own.length) return own;
  const center = String(state.radar.settings?.center || '').trim();
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
      <div class="head"><h3>Anmelden</h3><span class="hint">${esc(cfg.url)}</span></div>
      <div class="body">
        <div class="row radar-cfg">
          <input id="radarEmail" class="inp" type="email" placeholder="E-Mail" value="${esc(state.radar.settings?.email || '')}">
          <input id="radarPass" class="inp" type="password" placeholder="Passwort">
          <button class="btn primary" id="btnRadarLogin">${state.radar.busy === 'login' ? 'Anmelden …' : 'Anmelden'}</button>
          <button class="btn sm ghost" id="btnRadarResetCfg">Projekt wechseln</button>
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

function controls(s) {
  return `<section class="panel radar-controls">
    <div class="head"><h3>Filter</h3><span class="hint">Inaktiv heißt: Gesamtpunkte haben sich seit X Tagen nicht bewegt.</span></div>
    <div class="body">
      <div class="radar-grid">
        <label>Inaktiv ab
          <input type="range" min="1" max="30" step="1" value="${s.idleDays}" data-radar="idleDays">
          <b class="mono">${s.idleDays} Tage</b></label>
        <label>Umkreis
          <input type="range" min="1" max="150" step="1" value="${s.maxSystems}" data-radar="maxSystems">
          <b class="mono">± ${s.maxSystems} Systeme</b></label>
        <label>Max. Punkte
          <input class="inp" type="number" min="0" step="100" placeholder="egal" value="${s.maxPoints ?? ''}" data-radar="maxPoints">
          <b class="mono">Spielergröße</b></label>
        <label class="switch">
          <input type="checkbox" ${s.sameGalaxyOnly ? 'checked' : ''} data-radar="sameGalaxyOnly"> nur eigene Galaxien</label>
        <label>Bezugspunkt
          <input class="inp" type="text" placeholder="z. B. 12:101:5" value="${esc(s.center || '')}" data-radar="center">
          <b class="mono">${state.ownPlanets.size ? `${state.ownPlanets.size} eigene Planeten` : 'keine Gesamtübersicht'}</b></label>
      </div>
    </div>
  </section>`;
}

function targetRows(list) {
  return `<div class="farm-list">${list.map((row, i) => `<article class="farm-row">
    <div class="farm-rank mono">#${i + 1}</div>
    <div class="farm-target">${coordChip(row.coord)}<b>${esc(row.owner_name || '?')}</b>
      <small>${row.alliance ? `[${esc(row.alliance)}] · ` : ''}${num(row.total_points || 0)} P gesamt · ${row.planet_count ?? '?'} Planeten</small></div>
    <div class="farm-loot mono"><b>${num(row.points || 0)}</b><small>Planetenpunkte</small></div>
    <div class="farm-res mono">
      <span>${row.idleDays} T inaktiv</span>
      <span>${row.systemGap != null ? `${row.systemGap} Sys` : short(row.distance)}</span>
      <span>ab ${row.nearestOwn || '–'}</span>
      <span>Score ${num(row.score)}</span>
    </div>
  </article>`).join('')}</div>`;
}

function playerRows(list) {
  const byOwner = new Map();
  for (const row of list) {
    const key = row.owner_name || '?';
    const entry = byOwner.get(key) || {
      name: key, alliance: row.alliance, idleDays: row.idleDays,
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
    <div class="farm-loot mono"><b>${p.idleDays} T</b><small>ohne Punktebewegung</small></div>
    <div class="farm-res mono">
      <span>${p.inRange} in Reichweite</span>
      <span>${num(p.points)} P</span>
      <span>${Number.isFinite(p.nearest) ? `${p.nearest} Sys` : '–'}</span>
    </div>
  </article>`).join('')}</div>`;
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

  const ranked = rankFarms(state.radar.rows, {
    own: origins,
    idleDays: s.idleDays,
    maxSystems: s.maxSystems,
    sameGalaxyOnly: s.sameGalaxyOnly,
    maxPoints: s.maxPoints,
  });

  const body = !origins.length
    ? emptyState('Kein Bezugspunkt: füge im Lage-Tab die Gesamtübersicht ein oder trage oben eine Koordinate ein.')
    : !state.radar.rows.length
    ? emptyState('Noch keine Daten geladen — Highscore übertragen und „Ziele neu laden" klicken.')
    : !ranked.length
    ? emptyState('Keine inaktiven Ziele im gewählten Umkreis. Umkreis vergrößern oder Inaktivitätsschwelle senken.')
    : `<div class="signals farm-signals">
        <div class="sig f"><div class="k">Ziele in Reichweite</div><div class="v">${ranked.length}</div><div class="sub">± ${s.maxSystems} Systeme</div></div>
        <div class="sig o"><div class="k">Inaktive Spieler</div><div class="v">${new Set(ranked.map((r) => r.owner_name)).size}</div><div class="sub">seit ≥ ${s.idleDays} Tagen unverändert</div></div>
        <div class="sig s"><div class="k">Bestes Ziel</div><div class="v">${num(ranked[0].points)}</div><div class="sub">${esc(ranked[0].coord)} · ${esc(ranked[0].owner_name || '?')}</div></div>
        <div class="sig t"><div class="k">Stand</div><div class="v">${state.radar.loadedAt ? when(new Date(state.radar.loadedAt).toISOString()).slice(-5) : '–'}</div><div class="sub">${state.radar.loadedAt ? when(new Date(state.radar.loadedAt).toISOString()) : 'nicht geladen'}</div></div>
      </div>
      <div class="farm-columns">
        <section class="section"><h2>◆ Beste Ziele</h2><div class="desc">Planetenpunkte, gedämpft durch die Entfernung, verstärkt durch die Dauer der Inaktivität.</div>${targetRows(ranked.slice(0, 40))}</section>
        <section class="section"><h2>○ Inaktive Spieler</h2><div class="desc">Dieselben Ziele nach Besitzer gebündelt — so siehst du, wo ganze Konten schlafen.</div>${playerRows(ranked)}</section>
      </div>`;

  return head + msg + configPanel() + importPanel() + controls(s) + body;
}
