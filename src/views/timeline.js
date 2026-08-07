// Gemeinsamer Zeitachsen-Renderer für "Lage" und "Zeitachse".
// Ziel: auf einen Blick lesbar — Stundenraster, beschriftete Marker,
// überlappungsfreie Stapelung je Planet und Save-Fenster als Bänder.
import { state, serverNow } from '../state.js';
import { timelineTypes, saveWindows } from '../analysis.js';
import { coordChip, hhmm, esc, durLong } from '../util/time.js';
import { emptyState } from './components.js';

const LANE_H = 21;          // Höhe einer Marker-Spur (beschriftet)
const LANE_H_DOTS = 16;     // Höhe einer Marker-Spur (nur Punkte)
const MAX_LANES = 4;        // darüber wird zu "+n" gebündelt
const LABEL_W = 60;         // Platzbedarf eines beschrifteten Markers in px
const DOT_W = 17;           // Platzbedarf eines unbeschrifteten Markers in px
const LABEL_W_MIN = 430;    // schmalere Spuren zeigen nur Punkte

/** Verfügbare Spurbreite abschätzen — bestimmt, ob Zeitlabels hineinpassen. */
function trackWidth() {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const labW = vw <= 820 ? 104 : 132;
  return Math.max(180, Math.min(vw, 1400) - 44 - labW);
}

/** Marker so auf Spuren verteilen, dass sich die Beschriftungen nicht überlappen. */
function packLanes(events, pct, minPct) {
  const lanes = [];
  const placed = [];
  const overflow = [];
  for (const e of events.slice().sort((a, b) => a.at - b.at)) {
    const x = pct(e.at);
    let lane = lanes.findIndex((right) => x - right >= minPct);
    if (lane === -1) {
      if (lanes.length >= MAX_LANES) { overflow.push({ e, x }); continue; }
      lanes.push(x); lane = lanes.length - 1;
    } else {
      lanes[lane] = x;
    }
    placed.push({ e, x, lane });
  }
  return { placed, overflow, laneCount: Math.max(1, lanes.length) };
}

/** Stundenraster mit an die Spanne angepasster Schrittweite. */
function gridSteps(from, to) {
  const hours = (to - from) / 3600e3;
  const stepH = hours > 14 ? 4 : hours > 8 ? 3 : hours > 5 ? 2 : 1;
  const step = stepH * 3600e3;
  const out = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
  return out;
}

/**
 * @param events  Ereignisse aus timelineEvents() (bereits gefiltert)
 * @param opts    {hours?:number, windows?:Array}
 */
export function gantt(events, opts = {}) {
  const { hours = 4 } = opts;
  const windows = opts.windows ?? saveWindows();
  const now = serverNow();

  // Alles, was länger als 10 min vorbei ist, interessiert nicht mehr.
  const visible = events.filter((e) => e.at >= now - 10 * 60e3);
  if (!visible.length) return emptyState('Keine Ereignisse im gewählten Filter.');

  const last = visible.reduce((m, e) => Math.max(m, e.at), now);
  const lastWin = windows.reduce((m, w) => Math.max(m, w.to), now);
  const from = now - 8 * 60e3;
  const to = Math.max(now + hours * 3600e3, last + 8 * 60e3, lastWin + 8 * 60e3);
  const span = to - from;
  const pct = (t) => ((t - from) / span * 100);
  const inView = (v) => v >= 0 && v <= 100;

  // Bei schmalen Spuren passen keine Uhrzeiten neben die Marker -> nur Punkte.
  const trackPx = trackWidth();
  const dots = trackPx < LABEL_W_MIN;
  const minPct = ((dots ? DOT_W : LABEL_W) / trackPx) * 100;
  const laneH = dots ? LANE_H_DOTS : LANE_H;

  const steps = gridSteps(from, to).filter((t) => inView(pct(t)));
  const nowPct = pct(now);
  // Ticks, die unter dem "jetzt"-Label liegen würden, weglassen.
  const ticks = steps.filter((t) => Math.abs(pct(t) - nowPct) > 3.5)
    .map((t) => `<div class="tick" style="left:${pct(t).toFixed(2)}%">${hhmm(t)}</div>`).join('');
  const grid = steps.map((t) => `<div class="gl" style="left:${pct(t).toFixed(2)}%"></div>`).join('');

  const bands = windows.filter((w) => pct(w.to) >= 0).map((w) => {
    const l = Math.max(0, pct(w.from)), r = Math.min(100, pct(w.to));
    const title = `Online-Fenster ${hhmm(w.from)}–${hhmm(w.to)} · ${w.impacts.length} ${w.impacts.length > 1 ? 'Einschläge' : 'Einschlag'} auf ${w.coords.join(', ')}`;
    return `<div class="tl-band ${w.level}${w.active ? ' live' : ''}" style="left:${l.toFixed(2)}%;width:${Math.max(r - l, 0.5).toFixed(2)}%" title="${esc(title)}">
      <span class="cap">${hhmm(w.from)}–${hhmm(w.to)}</span></div>`;
  }).join('');

  // Zeilen je Planet: angegriffene zuerst, dann nach frühestem Ereignis.
  const byPlanet = new Map();
  for (const e of visible) {
    if (!byPlanet.has(e.coord)) byPlanet.set(e.coord, []);
    byPlanet.get(e.coord).push(e);
  }
  const hitCoords = new Set(windows.flatMap((w) => w.coords));
  const rows = [...byPlanet.entries()]
    .sort((a, b) => {
      const ah = hitCoords.has(a[0]) ? 0 : 1, bh = hitCoords.has(b[0]) ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return Math.min(...a[1].map((e) => e.at)) - Math.min(...b[1].map((e) => e.at));
    })
    .map(([coord, evs], rowIndex) => {
      const { placed, overflow, laneCount } = packLanes(evs, pct, minPct);
      const marks = placed.map(({ e, x, lane }) => {
        const def = timelineTypes[e.type];
        const flip = !dots && x > 84;
        const pos = flip ? `right:${(100 - x).toFixed(2)}%` : `left:${x.toFixed(2)}%`;
        const title = `${hhmm(e.at)} · ${def.label} · ${e.label}${e.from ? ` (von ${e.from})` : ''}`;
        return `<span class="tl-mark ${e.type}${flip ? ' flip' : ''}${e.type === 'attack' ? ' crit' : ''}" style="${pos};top:${lane * laneH}px" title="${esc(title)}"><b class="dot"></b><i>${def.icon}</i><em>${hhmm(e.at)}</em></span>`;
      }).join('');
      const more = overflow.length
        ? `<span class="tl-more" style="left:${overflow[0].x.toFixed(2)}%;top:${laneCount * laneH}px" title="${esc(overflow.map((o) => `${hhmm(o.e.at)} ${o.e.label}`).join(' · '))}">+${overflow.length}</span>`
        : '';
      const height = (laneCount + (overflow.length ? 1 : 0)) * laneH;
      const attacks = evs.filter((e) => e.type === 'attack').length;
      return `<div class="tl-row${rowIndex % 2 ? ' alt' : ''}${hitCoords.has(coord) ? ' hit' : ''}" style="height:${height}px">
        <span class="lab">${coordChip(coord, state.ownPlanets.has(coord) ? 'mine' : '')}${attacks ? `<i class="n crit">${attacks}⚔</i>` : `<i class="n">${evs.length}</i>`}</span>
        <span class="track">${marks}${more}</span></div>`;
    }).join('');

  return `<div class="gantt${dots ? ' dots' : ''}" data-from="${from}" data-span="${span}">
    <div class="axis">${ticks}<div class="now" style="left:${pct(now).toFixed(2)}%"><b>jetzt</b></div></div>
    <div class="tl-body">
      <div class="tl-grid">${grid}</div>
      <div class="tl-bands">${bands}</div>
      ${rows}
    </div></div>`;
}

/** Legende — Bänder nur erklären, wenn es welche gibt. */
export function bandLegend(windows) {
  const wins = windows ?? saveWindows();
  const items = [];
  if (wins.some((w) => w.level === 'critical')) {
    items.push('<span><i class="sw critical"></i> Online nötig — Flotte steht im Feuer</span>');
  }
  if (wins.some((w) => w.level === 'warn')) {
    items.push('<span><i class="sw warn"></i> Einschlag ohne stationierte Flotte</span>');
  }
  items.push('<span><i class="sw now"></i> jetzt</span>');
  items.push('<span><i class="sw dot attack"></i> Angriff</span>');
  items.push('<span><i class="sw dot arrival"></i> eigene Flotte</span>');
  items.push('<span><i class="sw dot build"></i> Bau fertig</span>');
  return `<div class="tl-legend">${items.join('')}</div>`;
}

/** Kompakte Textzeile: „Nächstes Online-Fenster in …". */
export function windowSummary(windows) {
  const w = windows.find((x) => x.active) || windows[0];
  if (!w) return 'Keine Einschläge — kein Online-Zwang.';
  if (w.active) return `Fenster läuft — noch ${durLong(w.endsInSec)} bis zum letzten Einschlag.`;
  return `Nächstes Fenster in ${durLong(w.startsInSec)} · Dauer ${durLong(w.durationSec)}.`;
}
