// Tab "Zeitachse": gemeinsame Achse aller Event-Typen (Flotten + Bau/Forschung)
// mit Marker je Typ, Typ-Filtern und chronologischer Liste.
import { state, serverNow } from '../state.js';
import { timelineEvents, timelineTypes, saveWindows } from '../analysis.js';
import { coordChip, hhmm, esc } from '../util/time.js';
import { emptyState } from './components.js';
import { gantt, bandLegend } from './timeline.js';

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
  const wins = saveWindows();
  return `<div class="section">
    <div class="desc">Alle Ereignisse auf einer Achse — Feindeinschläge, eigene Flüge und Bau-/Forschungsabschlüsse. Marker je Typ, oben filterbar. Die Bänder sind die Online-Fenster aus der Lage.</div>
    ${controls(counts)}
    ${bandLegend()}
    ${gantt(shown, { windows: wins, hours: 6 })}
    ${list(shown)}
  </div>`;
}
