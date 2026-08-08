// Gemeinsamer Zeitachsen-Renderer für "Lage" und "Zeitachse".
// Ziel: auf einen Blick lesbar — Stundenraster, beschriftete Marker,
// überlappungsfreie Stapelung je Planet und Save-Fenster als Bänder.
import { state, serverNow } from '../state.js';
import { timelineTypes, saveWindows, planetStatus } from '../analysis.js';
import { coordChip, hhmm, esc, durLong, num } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';

const LANE_H = 21;          // Höhe einer Marker-Spur (beschriftet)
const LANE_H_DOTS = 16;     // Höhe einer Marker-Spur (nur Punkte)
const MAX_LANES = 4;        // darüber wird zu "+n" gebündelt
const LABEL_W = 60;         // Platzbedarf eines beschrifteten Markers in px
const ICON_W = 26;          // Platzbedarf eines Markers ohne Uhrzeit in px
const DOT_W = 17;           // Platzbedarf eines reinen Punktmarkers in px
const LABEL_W_MIN = 430;    // schmalere Spuren zeigen nur Punkte
const CAP_W = 76;           // Platzbedarf einer Fenster-Beschriftung "10:24–10:46"
const CAP_W_SHORT = 30;     // Platzbedarf einer verkürzten Beschriftung "10:24"

/* ---------- Zeitfenster (Zoom) ----------
   Ohne Begrenzung dehnt ein einzelnes spätes Ereignis die Achse über den
   halben Tag — dann drängt sich alles Aktuelle in den linken Rand. Der Zoom
   hält den sichtbaren Bereich klein; was rechts herausfällt, wird gezählt. */
const ZOOMS = [
  { key: '3', hours: 3, label: '3 h' },
  { key: '6', hours: 6, label: '6 h' },
  { key: '12', hours: 12, label: '12 h' },
  { key: 'all', hours: null, label: 'alles' },
];
let zoomKey = '6';

/** Zoomstufe setzen (Klick auf die Leiste über der Achse). */
export function setZoom(key) {
  if (ZOOMS.some((z) => z.key === key)) zoomKey = key;
}

/** Verfügbare Spurbreite abschätzen — bestimmt, ob Zeitlabels hineinpassen. */
function trackWidth() {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const labW = vw <= 820 ? 168 : 244;
  return Math.max(180, Math.min(vw, 1400) - 44 - labW);
}

/* ---------- Status-Indikatoren je Planet ---------- */

/** Kompakte Stückzahl: 1240 -> "1.2k". */
function compact(n) {
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + 'k';
  return String(n);
}

const relTime = (at) => (at == null ? '' : ` (frei ${hhmm(at)})`);

/** Restdauer sehr grob: "2h", "45m", "<1m" — passt in ein 40-px-Chip. */
function untilShort(at) {
  if (at == null) return '?';
  const sec = (at - serverNow()) / 1000;
  if (sec <= 60) return '<1m';
  if (sec < 3600) return Math.round(sec / 60) + 'm';
  if (sec < 36000) return (sec / 3600).toFixed(1).replace('.', ',') + 'h';
  if (sec < 86400) return Math.round(sec / 3600) + 'h';
  return Math.round(sec / 86400) + 'T';
}

/**
 * Drei Ampeln pro Planetenzeile: Flotte · Bauplatz · Werft.
 * Jede Ampel zeigt ihren eigenen Zustand explizit an — grün "frei",
 * orange mit Restdauer "belegt". Rot = Flotte steht in einem Einschlag.
 * @param coord   Planetenkoordinate
 * @param atRisk  true, wenn auf diesem Planeten ein Einschlag ansteht
 */
function indicators(coord, atRisk) {
  const s = planetStatus(coord);
  if (!s.mine) {
    return '<span class="ind foreign" title="Fremder Planet — keine eigenen Daten">···</span>';
  }

  const st = s.stationed;
  const shipTxt = st.ships.length
    ? st.ships.slice(0, 3).map(([k, n]) => `${num(n)} ${deLabel.ship(k)}`).join(', ')
    : 'keine Schiffe';
  const fleetCls = !st.hasAny ? 'empty' : atRisk ? 'risk' : 'on';
  const fleetTitle = st.hasAny
    ? `Flotte stationiert: ${shipTxt}${st.defTotal ? ` · ${num(st.defTotal)} Verteidigung` : ''}${atRisk ? ' — steht beim Einschlag im Feuer!' : ''}`
    : 'Nichts stationiert — hier ist nichts zu verlieren';
  const fleetNum = st.total ? compact(st.total) : st.defTotal ? '◇' : '–';

  const b = s.build;
  const bTitle = b.free
    ? 'Bauplatz FREI — kein Gebäudeauftrag läuft'
    : `Bauplatz BELEGT: ${b.name} → Stufe ${b.level}${relTime(b.at)}`;

  const y = s.yard;
  const yTitle = y.none
    ? 'Keine Schiffsfabrik auf diesem Planeten'
    : y.free
      ? `Werft FREI — Schiffsfabrik Stufe ${y.level} baut nichts`
      : `Werft BELEGT${relTime(y.at)}`;

  return `<span class="ind">
    <i class="ix fleet ${fleetCls}" title="${esc(fleetTitle)}">⬟<b>${fleetNum}</b></i>
    <i class="ix build ${b.free ? 'free' : 'busy'}" title="${esc(bTitle)}">⌂<b>${b.free ? 'frei' : untilShort(b.at)}</b></i>
    <i class="ix yard ${y.none ? 'none' : y.free ? 'free' : 'busy'}" title="${esc(yTitle)}">⚒<b>${y.none ? '—' : y.free ? 'frei' : untilShort(y.at)}</b></i>
  </span>`;
}

/**
 * Marker auf Spuren verteilen, sodass sich nichts überlappt.
 * @param widthPct  Breite eines Markers in Prozent der Spur (typabhängig)
 */
function packLanes(events, pct, widthPct) {
  const lanes = [];   // je Spur: rechte Kante des letzten Markers in %
  const placed = [];
  const overflow = [];
  for (const e of events.slice().sort((a, b) => a.at - b.at)) {
    const x = pct(e.at);
    let lane = lanes.findIndex((right) => x >= right);
    if (lane === -1) {
      if (lanes.length >= MAX_LANES) { overflow.push({ e, x }); continue; }
      lanes.push(0); lane = lanes.length - 1;
    }
    lanes[lane] = x + widthPct(e);
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
 * @param opts    {hours?:number, windows?:Array, allOwn?:boolean}
 */
export function gantt(events, opts = {}) {
  const windows = opts.windows ?? saveWindows();
  const now = serverNow();

  // Alles, was länger als 10 min vorbei ist, interessiert nicht mehr.
  const visible = events.filter((e) => e.at >= now - 10 * 60e3);
  if (!visible.length) return emptyState('Keine Ereignisse im gewählten Filter.');

  const zoom = ZOOMS.find((z) => z.key === zoomKey) ?? ZOOMS[1];
  const last = visible.reduce((m, e) => Math.max(m, e.at), now);
  const lastWin = windows.reduce((m, w) => Math.max(m, w.to), now);
  const from = now - 8 * 60e3;
  // Nie weiter als die Zoomstufe, aber auch nie weiter als nötig — sonst
  // bleibt rechts eine leere Fläche und quetscht die Ereignisse zusammen.
  const needed = Math.max(now + 30 * 60e3, last + 8 * 60e3, lastWin + 8 * 60e3);
  const to = zoom.hours ? Math.min(now + zoom.hours * 3600e3, needed) : needed;
  const span = to - from;
  const pct = (t) => ((t - from) / span * 100);
  const inView = (v) => v >= 0 && v <= 100;

  // Bei schmalen Spuren passen keine Uhrzeiten neben die Marker -> nur Punkte.
  const trackPx = trackWidth();
  const dots = trackPx < LABEL_W_MIN;
  const laneH = dots ? LANE_H_DOTS : LANE_H;
  // Die Uhrzeit steht schon auf der Achse — als Text lohnt sie nur dort, wo
  // jede Minute zählt: bei Einschlägen. Alles andere bleibt Icon + Punkt.
  const timed = (e) => !dots && e.type === 'attack';
  const widthPct = (e) => ((dots ? DOT_W : timed(e) ? LABEL_W : ICON_W) / trackPx) * 100;

  const steps = gridSteps(from, to).filter((t) => inView(pct(t)));
  const nowPct = pct(now);
  // Ticks weglassen, die unter dem "jetzt"-Label liegen oder rechts abgeschnitten würden.
  const ticks = steps.filter((t) => Math.abs(pct(t) - nowPct) > 3.5 && pct(t) <= 96)
    .map((t) => `<div class="tick" style="left:${pct(t).toFixed(2)}%">${hhmm(t)}</div>`).join('');
  const grid = steps.map((t) => `<div class="gl" style="left:${pct(t).toFixed(2)}%"></div>`).join('');

  // Das Fenster, das gerade zählt: das laufende, sonst das nächste sichtbare.
  const focus = windows.find((w) => w.active) ?? windows.find((w) => w.to >= now);

  // Fenster als eigene Leiste unter der Achse statt als Bänder über die volle
  // Höhe — sonst ist bei vielen Einschlägen der halbe Chart rot und das
  // Warnsignal verpufft. Nur das aktuelle Fenster tönt zusätzlich die Fläche.
  const shownWins = windows.filter((w) => pct(w.to) >= 0 && pct(w.from) <= 100);
  const winbar = shownWins.map((w) => {
    const l = Math.max(0, pct(w.from)), r = Math.min(100, pct(w.to));
    const wPx = (r - l) / 100 * trackPx;
    const title = `Online-Fenster ${hhmm(w.from)}–${hhmm(w.to)} · ${w.impacts.length} ${w.impacts.length > 1 ? 'Einschläge' : 'Einschlag'} auf ${w.coords.join(', ')}`;
    const cap = wPx >= CAP_W ? `${hhmm(w.from)}–${hhmm(w.to)}`
      : wPx >= CAP_W_SHORT ? hhmm(w.from) : '';
    return `<div class="tl-win ${w.level}${w.active ? ' live' : ''}${w === focus ? ' focus' : ''}" style="left:${l.toFixed(2)}%;width:${Math.max(r - l, 0.6).toFixed(2)}%" title="${esc(title)}">${cap ? `<span class="cap">${cap}</span>` : ''}</div>`;
  }).join('');

  const bands = focus && pct(focus.to) >= 0 && pct(focus.from) <= 100
    ? (() => {
      const l = Math.max(0, pct(focus.from)), r = Math.min(100, pct(focus.to));
      return `<div class="tl-band ${focus.level}${focus.active ? ' live' : ''}" style="left:${l.toFixed(2)}%;width:${Math.max(r - l, 0.6).toFixed(2)}%"></div>`;
    })()
    : '';

  // Zeilen je Planet: angegriffene zuerst, dann nach frühestem Ereignis.
  const byPlanet = new Map();
  for (const e of visible) {
    if (!byPlanet.has(e.coord)) byPlanet.set(e.coord, []);
    byPlanet.get(e.coord).push(e);
  }
  // Eigene Planeten ohne Ereignisse trotzdem zeigen — die Indikatoren sind
  // genau dort interessant (freier Bauplatz, leere Werft, ungeschützte Flotte).
  if (opts.allOwn !== false) {
    for (const c of state.ownPlanets) if (!byPlanet.has(c)) byPlanet.set(c, []);
  }
  const hitCoords = new Set(windows.flatMap((w) => w.coords));
  // Zeilenfolge = Spaltenfolge der Gesamtübersicht (dort kennst du deine
  // Planeten auswendig). Fremde Planeten hängen danach, nach Zeit sortiert.
  const order = new Map([...state.ownPlanets].map((c, i) => [c, i]));
  const rank = (c) => (order.has(c) ? order.get(c) : Infinity);
  const sorted = [...byPlanet.entries()].sort((a, b) => {
    const ra = rank(a[0]), rb = rank(b[0]);
    if (ra !== rb) return ra - rb;
    const ae = a[1].length ? Math.min(...a[1].map((e) => e.at)) : Infinity;
    const be = b[1].length ? Math.min(...b[1].map((e) => e.at)) : Infinity;
    if (ae !== be) return ae - be;
    return a[0].localeCompare(b[0]);
  });

  // Planeten ohne jedes Ereignis bekommen keine eigene Zeile mehr — leere
  // Spuren kosten nur Höhe. Ihre Statuschips wandern in eine Sammelzeile.
  const busy = sorted.filter(([, evs]) => evs.length);
  const quiet = sorted.filter(([, evs]) => !evs.length).map(([c]) => c);

  let hiddenTotal = 0;
  const rows = busy.map(([coord, evs], rowIndex) => {
    const inWin = evs.filter((e) => e.at <= to);
    const later = evs.filter((e) => e.at > to);
    hiddenTotal += later.length;

    const { placed, overflow, laneCount } = packLanes(inWin, pct, widthPct);
    const marks = placed.map(({ e, x, lane }) => {
      const def = timelineTypes[e.type];
      const withTime = timed(e);
      const flip = !dots && x > (withTime ? 84 : 93);
      const pos = flip ? `right:${(100 - x).toFixed(2)}%` : `left:${x.toFixed(2)}%`;
      const title = `${hhmm(e.at)} · ${def.label} · ${e.label}${e.from ? ` (von ${e.from})` : ''}`;
      const cls = `tl-mark ${e.type}${flip ? ' flip' : ''}${e.type === 'attack' ? ' crit' : ''}${withTime ? '' : ' mini'}`;
      return `<span class="${cls}" style="${pos};top:${lane * laneH}px" title="${esc(title)}"><b class="dot"></b><i>${def.icon}</i>${withTime ? `<em>${hhmm(e.at)}</em>` : ''}</span>`;
    }).join('');
    const more = overflow.length
      ? `<span class="tl-more" style="left:${overflow[0].x.toFixed(2)}%;top:${laneCount * laneH}px" title="${esc(overflow.map((o) => `${hhmm(o.e.at)} ${o.e.label}`).join(' · '))}">+${overflow.length}</span>`
      : '';
    // Was rechts aus dem Zoom fällt, verschwindet nicht wortlos.
    const rest = later.length
      ? `<span class="tl-later" title="${esc(later.slice(0, 6).map((o) => `${hhmm(o.at)} ${o.label}`).join(' · '))}">+${later.length}&#9656;</span>`
      : '';

    const height = (laneCount + (overflow.length ? 1 : 0)) * laneH;
    const attacks = evs.filter((e) => e.type === 'attack').length;
    const st = planetStatus(coord);
    const risk = hitCoords.has(coord) && !!st.stationed?.hasAny;
    const flags = [
      risk ? 'risk' : '',
      st.mine && st.build.free ? 'bfree' : '',
      st.mine && st.yard.free ? 'yfree' : '',
    ].filter(Boolean).join(' ');
    const count = attacks ? `<i class="n crit">${attacks}⚔</i>` : `<i class="n">${evs.length}</i>`;
    return `<div class="tl-row${rowIndex % 2 ? ' alt' : ''}${hitCoords.has(coord) ? ' hit' : ''}${flags ? ' ' + flags : ''}" style="height:${height}px">
      <span class="lab">${coordChip(coord, state.ownPlanets.has(coord) ? 'mine' : '')}${count}${indicators(coord, risk)}</span>
      <span class="track">${marks}${more}${rest}</span></div>`;
  }).join('');

  const quietBlock = quiet.length
    ? `<div class="tl-quiet"><span class="qh" title="Keine Ereignisse im Zeitfenster — die Statuschips zeigen freie Kapazität">✓ ruhig (${quiet.length})</span>${
      quiet.map((c) => `<span class="qi">${coordChip(c, state.ownPlanets.has(c) ? 'mine' : '')}${indicators(c, false)}</span>`).join('')
    }</div>`
    : '';

  const zoomBar = `<div class="tl-zoom">
    <span class="zl">Zeitfenster</span>
    ${ZOOMS.map((z) => `<button type="button" data-tlzoom="${z.key}" class="${z.key === zoomKey ? 'on' : ''}">${z.label}</button>`).join('')}
    ${hiddenTotal ? `<span class="rest">+${hiddenTotal} Ereignis${hiddenTotal > 1 ? 'se' : ''} danach</span>` : ''}
  </div>`;

  return `<div class="gantt${dots ? ' dots' : ''}" data-from="${from}" data-span="${span}">
    ${zoomBar}
    <div class="axis">${ticks}<div class="now" style="left:${pct(now).toFixed(2)}%"><b>jetzt</b></div></div>
    <div class="tl-winbar">${winbar || '<span class="none">keine Online-Fenster in diesem Zeitraum</span>'}</div>
    <div class="tl-body">
      <div class="tl-grid">${grid}</div>
      <div class="tl-bands">${bands}</div>
      ${rows}
    </div>
    ${quietBlock}</div>`;
}

/** Legende — Fenster nur erklären, wenn es welche gibt. */
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
  items.push(`<span class="sep"></span>
    <span><i class="ix fleet on mini">⬟<b>n</b></i> Flotte da <i class="ix fleet risk mini">⬟<b>n</b></i> im Feuer</span>
    <span><i class="ix build free mini">⌂<b>frei</b></i> Bauplatz frei <i class="ix build busy mini">⌂<b>2h</b></i> belegt (Restzeit)</span>
    <span><i class="ix yard free mini">⚒<b>frei</b></i> Werft frei <i class="ix yard busy mini">⚒<b>45m</b></i> belegt</span>`);
  return `<div class="tl-legend">${items.join('')}</div>`;
}

/** Kompakte Textzeile: „Nächstes Online-Fenster in …". */
export function windowSummary(windows) {
  const w = windows.find((x) => x.active) || windows[0];
  if (!w) return 'Keine Einschläge — kein Online-Zwang.';
  if (w.active) return `Fenster läuft — noch ${durLong(w.endsInSec)} bis zum letzten Einschlag.`;
  return `Nächstes Fenster in ${durLong(w.startsInSec)} · Dauer ${durLong(w.durationSec)}.`;
}
