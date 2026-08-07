// Tab "Zeitachse": gemeinsame Achse aller Event-Typen (Flotten + Bau/Forschung)
// mit Marker je Typ, Typ-Filtern und chronologischer Liste.
import { state, serverNow } from '../state.js';
import { timelineEvents, timelineTypes } from '../analysis.js';
import { coordChip, hhmm, esc } from '../util/time.js';
import { emptyState } from './components.js';

export const activeTypes = new Set(Object.keys(timelineTypes));
export function toggleType(t) {
  if (activeTypes.has(t)) activeTypes.delete(t); else activeTypes.add(t);
}

const cd = (at) => `<span class="cd" data-at="${at}"></span>`;

function controls(counts) {
  return `<div class="tl-controls">${Object.entries(timelineTypes).map(([t, def]) => {
    const n = counts[t] || 0;
    const on = activeTypes.has(t);
    return `<button data-tl="${t}" class="${on ? 'on ' + t : 'off'}">${def.icon} ${esc(def.label)} ${n}</button>`;
  }).join('')}</div>`;
}

function gantt(events) {
  const now = serverNow();
  const last = events.reduce((m, e) => Math.max(m, e.at), now);
  const from = now - 5 * 60e3;
  const to = Math.max(now + 3 * 3600e3, last + 5 * 60e3);
  const span = to - from;
  const pct = (t) => ((t - from) / span * 100);

  // Zeit-Ticks (volle Stunden).
  const ticks = [];
  const firstH = new Date(Math.ceil(from / 3600e3) * 3600e3).getTime();
  for (let t = firstH; t <= to; t += 3600e3) ticks.push(`<div class="tick" style="left:${pct(t).toFixed(2)}%">${hhmm(t)}</div>`);

  // Zeilen je Planet.
  const byPlanet = new Map();
  for (const e of events) {
    if (!byPlanet.has(e.coord)) byPlanet.set(e.coord, []);
    byPlanet.get(e.coord).push(e);
  }
  const rows = [...byPlanet.entries()].map(([coord, evs]) => {
    const marks = evs.map((e) => {
      const def = timelineTypes[e.type];
      return `<span class="tl-mark ${e.type}" style="left:${pct(e.at).toFixed(2)}%" title="${hhmm(e.at)} · ${esc(def.label)} · ${esc(e.label)}">${def.icon}</span>`;
    }).join('');
    return `<div class="tl-row"><span class="lab">${coordChip(coord, state.ownPlanets.has(coord) ? 'mine' : '')}</span>
      <span style="position:absolute;left:96px;right:0;top:0;bottom:0">${marks}</span></div>`;
  }).join('');

  return `<div class="gantt" data-from="${from}" data-span="${span}">
    <div class="axis">${ticks}<div class="now" style="left:${pct(now).toFixed(2)}%"><b>jetzt</b></div></div>
    ${rows || emptyState('Keine Ereignisse im gewählten Filter.')}</div>`;
}

function list(events) {
  if (!events.length) return emptyState('Keine Ereignisse im gewählten Filter.');
  return `<div class="list" style="margin-top:14px">${events.map((e) => {
    const def = timelineTypes[e.type];
    const clsMap = { attack: 'threat', build: 'soon', trade: 'safe', arrival: 'own', spy: 'own' };
    return `<div class="item ${clsMap[e.type] || ''}" style="padding:8px 12px">
      ${cd(e.at)}
      <div class="grow"><div class="ttl" style="font-size:13px">${def.icon} ${esc(e.label)} ${coordChip(e.coord, state.ownPlanets.has(e.coord) ? 'mine' : '')}</div>
      <div class="sub">${esc(def.label)}${e.from ? ` · von ${coordChip(e.from)}` : ''}${e.player ? ` · ${esc(e.player)}` : ''}</div></div></div>`;
  }).join('')}</div>`;
}

export function renderZeitachse() {
  const all = timelineEvents();
  if (!all.length) return emptyState('Noch keine Ereignisse. Füge deine Übersichtsseite ein.');
  const counts = {};
  for (const e of all) counts[e.type] = (counts[e.type] || 0) + 1;
  const shown = all.filter((e) => activeTypes.has(e.type));
  return `<div class="section">
    <div class="desc">Alle Ereignisse auf einer Achse — Feindeinschläge, eigene Flüge und Bau-/Forschungsabschlüsse. Marker je Typ, oben filterbar.</div>
    ${controls(counts)}
    ${gantt(shown)}
    ${list(shown)}
  </div>`;
}
