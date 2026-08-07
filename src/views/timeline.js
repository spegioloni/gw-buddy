// Gemeinsamer Zeitachsen-Renderer für "Lage" und "Zeitachse".
// Zeichnet Save-Fenster als farbige Bänder und Ereignisse als Marker je Planet.
import { state, serverNow } from '../state.js';
import { timelineTypes, saveWindows } from '../analysis.js';
import { coordChip, hhmm, esc, durLong } from '../util/time.js';
import { emptyState } from './components.js';

/**
 * @param events  Ereignisse aus timelineEvents() (bereits gefiltert)
 * @param opts    {hours?:number, windows?:Array, compact?:boolean}
 */
export function gantt(events, opts = {}) {
  const { hours = 3, compact = false } = opts;
  const windows = opts.windows ?? saveWindows();
  const now = serverNow();

  const last = events.reduce((m, e) => Math.max(m, e.at), now);
  const lastWin = windows.reduce((m, w) => Math.max(m, w.to), now);
  const from = now - 5 * 60e3;
  const to = Math.max(now + hours * 3600e3, last + 5 * 60e3, lastWin + 5 * 60e3);
  const span = to - from;
  const pct = (t) => ((t - from) / span * 100);
  const clamp = (v) => Math.max(0, Math.min(100, v));

  const ticks = [];
  const firstH = new Date(Math.ceil(from / 3600e3) * 3600e3).getTime();
  for (let t = firstH; t <= to; t += 3600e3) {
    ticks.push(`<div class="tick" style="left:${pct(t).toFixed(2)}%">${hhmm(t)}</div>`);
  }

  // Save-Fenster als durchgehende Bänder hinter allen Zeilen.
  const bands = windows.map((w) => {
    const l = clamp(pct(w.from)), r = clamp(pct(w.to));
    const title = `Online-Fenster ${hhmm(w.from)}–${hhmm(w.to)} · ${w.impacts.length} ${w.impacts.length > 1 ? 'Einschläge' : 'Einschlag'} auf ${w.coords.join(', ')}`;
    return `<div class="tl-band ${w.level}${w.active ? ' live' : ''}" style="left:${l.toFixed(2)}%;width:${Math.max(r - l, 0.6).toFixed(2)}%" title="${esc(title)}">
      <span class="cap">${hhmm(w.from)}–${hhmm(w.to)}</span></div>`;
  }).join('');

  const byPlanet = new Map();
  for (const e of events) {
    if (!byPlanet.has(e.coord)) byPlanet.set(e.coord, []);
    byPlanet.get(e.coord).push(e);
  }
  // Angegriffene eigene Planeten zuerst — die sind das Wichtige.
  const hitCoords = new Set(windows.flatMap((w) => w.coords));
  const rows = [...byPlanet.entries()]
    .sort((a, b) => (hitCoords.has(b[0]) ? 1 : 0) - (hitCoords.has(a[0]) ? 1 : 0))
    .map(([coord, evs]) => {
      const marks = evs.map((e) => {
        const def = timelineTypes[e.type];
        const crit = e.type === 'attack' ? ' crit' : '';
        return `<span class="tl-mark ${e.type}${crit}" style="left:${clamp(pct(e.at)).toFixed(2)}%" title="${hhmm(e.at)} · ${esc(def.label)} · ${esc(e.label)}">${def.icon}</span>`;
      }).join('');
      return `<div class="tl-row${hitCoords.has(coord) ? ' hit' : ''}">
        <span class="lab">${coordChip(coord, state.ownPlanets.has(coord) ? 'mine' : '')}</span>
        <span class="track">${marks}</span></div>`;
    }).join('');

  return `<div class="gantt${compact ? ' compact' : ''}" data-from="${from}" data-span="${span}">
    <div class="axis">${ticks}<div class="now" style="left:${pct(now).toFixed(2)}%"><b>jetzt</b></div></div>
    <div class="tl-body"><div class="tl-bands">${bands}</div>
    ${rows || emptyState('Keine Ereignisse im gewählten Filter.')}</div></div>`;
}

/** Legende für die Bänder. */
export function bandLegend() {
  return `<div class="tl-legend">
    <span><i class="sw critical"></i> Online nötig — Schiffe/Verteidigung stehen im Feuer</span>
    <span><i class="sw warn"></i> Einschlag ohne stationierte Flotte</span>
    <span><i class="sw now"></i> jetzt</span>
  </div>`;
}

/** Kompakte Textzeile: „Nächstes Online-Fenster in …". */
export function windowSummary(windows) {
  const w = windows.find((x) => x.active) || windows[0];
  if (!w) return 'Keine Einschläge — kein Online-Zwang.';
  if (w.active) return `Fenster läuft — noch ${durLong(w.endsInSec)} bis zum letzten Einschlag.`;
  return `Nächstes Fenster in ${durLong(w.startsInSec)} · Dauer ${durLong(w.durationSec)}.`;
}
