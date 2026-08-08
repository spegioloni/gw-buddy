// Gemeinsamer Zeitachsen-Renderer für "Lage" und "Zeitachse".
// Ziel: auf einen Blick lesbar — Stundenraster, beschriftete Marker,
// überlappungsfreie Stapelung je Planet und Save-Fenster als Bänder.
import { state, serverNow } from '../state.js';
import { timelineTypes, saveWindows, planetStatus, impactVerdict, threatAnalysis, PLUNDER_RESOURCES } from '../analysis.js';
import { coordChip, hhmm, esc, durLong, num } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';

const LANE_H = 21;          // Höhe einer Marker-Spur (beschriftet)
const LANE_H_DOTS = 16;     // Höhe einer Marker-Spur (nur Punkte)
const MAX_LANES = 4;        // darüber wird zu "+n" gebündelt
const LABEL_W = 84;         // Platzbedarf eines Einschlag-Markers (Zeit + Urteil)
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
  // Muss zu --lab-w in styles.css passen (Breakpoints 560/820 px).
  const labW = vw <= 560 ? 164 : vw <= 820 ? 232 : 300;
  return Math.max(180, Math.min(vw, 1400) - 44 - labW);
}

/* ---------- Status-Indikatoren je Planet ---------- */

/** Kompakte Stückzahl: 1240 -> "1.2k". */
function compact(n) {
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + 'k';
  return String(n);
}

/** Rohstoffmengen werden groß — hier zählt die Größenordnung, nicht die Ziffer. */
function compactRes(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + 'k';
  return String(Math.round(n));
}

const de = (n) => Math.round(n).toLocaleString('de-DE');

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
 * Vier Ampeln pro Planetenzeile: Flotte · Beute · Bauplatz · Werft.
 * Die ersten beiden beantworten die Angriffsfrage — sind die Schiffe save,
 * sind die Rohstoffe save? Die Beute ist auf den nächsten Einschlag
 * hochgerechnet, denn genau dann entscheidet sich, was zu holen ist.
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
  const defTxt = st.defTotal ? ` · ${num(st.defTotal)} Verteidigung (fest verbaut, nicht savebar)` : '';
  const fleetCls = !st.hasAny ? 'empty' : atRisk ? 'risk' : 'on';
  const fleetTitle = st.hasShips
    ? `Flotte stationiert: ${shipTxt}${defTxt}${atRisk ? ' — steht beim Einschlag im Feuer!' : ''}`
    : st.hasAny
      ? `Keine Schiffe stationiert${defTxt} — nichts zu saven`
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
    ${lootChip(s.loot, atRisk)}
    <i class="ix build ${b.free ? 'free' : 'busy'}" title="${esc(bTitle)}">⌂<b>${b.free ? 'frei' : untilShort(b.at)}</b></i>
    <i class="ix yard ${y.none ? 'none' : y.free ? 'free' : 'busy'}" title="${esc(yTitle)}">⚒<b>${y.none ? '—' : y.free ? 'frei' : untilShort(y.at)}</b></i>
  </span>`;
}

/**
 * Beute-Chip: was ein Angreifer mitnehmen könnte. Grün "save" heißt, alles
 * liegt unter dem nicht plünderbaren Sockel von 2 % der Speicherkapazität.
 */
function lootChip(loot, atRisk, mini = false) {
  if (!loot?.known) {
    return `<i class="ix loot none${mini ? ' mini' : ''}" title="Rohstoffe unbekannt — dafür fehlt die Gesamtübersicht (Bestände, Förderung, Speicherstufen)">◈<b>?</b></i>`;
  }
  const when = loot.forImpact
    ? `zum Einschlag um ${hhmm(loot.at)}`
    : 'zum jetzigen Stand';
  const detail = loot.byRes
    .map((r) => `${deLabel.resource(r.key)}: ${de(r.stock)} / Sockel ${de(r.floor)} (Speicher ${r.level})${r.loot > 0 ? ` → ${de(r.loot)} plünderbar` : ' → save'}${r.full ? ' · VOLL' : ''}`)
    .join('\n');
  const upgrade = loot.byRes.find((r) => r.upgrade);
  const upTxt = upgrade
    ? `\nAusbau ${deLabel.building(upgrade.upgrade.key)} → Stufe ${upgrade.upgrade.level} um ${hhmm(upgrade.upgrade.at)} (${upgrade.upgrade.delta > 0 ? '+' : ''}${de(upgrade.upgrade.delta)}/h) ist eingerechnet.`
    : '';
  const head = loot.safe
    ? `Rohstoffe SAVE ${when} — alles unter dem nicht plünderbaren Sockel.`
    : `${de(loot.loot)} Rohstoffe plünderbar ${when}.`;
  const soon = loot.safe && loot.nextUnsafeAt
    ? `\nAb ${hhmm(loot.nextUnsafeAt)} gibt es wieder etwas zu holen.`
    : '';
  const title = `${head}\n\n${detail}${upTxt}${soon}\n\nWasser zählt nicht mit.`;
  const cls = loot.safe ? 'safe' : atRisk ? 'risk' : 'warn';
  return `<i class="ix loot ${cls}${mini ? ' mini' : ''}" title="${esc(title)}">◈<b>${loot.safe ? 'save' : compactRes(loot.loot)}</b></i>`;
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
 * Urteil direkt am Einschlags-Marker: Sind die Schiffe save? Sind die
 * Rohstoffe save? Grün = da ist nichts zu holen, rot = Verlust droht.
 * Beides zum Zeitpunkt des Einschlags, nicht zum jetzigen Stand.
 * @returns {{safe:boolean, html:string, reason:string}} reason = mehrzeilige
 *   Begründung fürs Haupt-Tooltip (Prognose je Rohstoff + Flotte).
 */
function attackVerdict(e) {
  if (e.type !== 'attack' || !state.ownPlanets.has(e.coord)) return { safe: null, html: '', reason: '' };
  // Exakt dieselbe Bewertung wie beim Online-Fenster (impactVerdict in
  // analysis.js) — Markerfarbe und Bandfarbe können so nicht auseinanderlaufen.
  const { st, risk, shipsSafe, safe } = impactVerdict(e.coord, e.at);

  const landing = st?.arrivals?.[st.arrivals.length - 1] ?? null;
  const shipTitle = shipsSafe
    ? `Schiffe SAVE — keine Schiffe stationiert${st?.defTotal ? ` (nur ${num(st.defTotal)} Verteidigung, die ist fest verbaut)` : ''}`
    : st.total
      ? `${num(st.total)} Schiffe${st.defTotal ? ` + ${num(st.defTotal)} Verteidigung` : ''} stehen beim Einschlag im Feuer`
      : `Eigene Flotte landet ${hhmm(landing.at)} (${esc(landing.mission)}) und steht beim Einschlag im Feuer`;

  const resCls = !risk.known ? 'unknown' : risk.safe ? 'ok' : 'bad';
  const resTitle = !risk.known
    ? 'Rohstoffe unbekannt — dafür fehlt die Gesamtübersicht'
    : risk.safe
      ? 'Rohstoffe SAVE — alles unter dem nicht plünderbaren Sockel'
      : `${de(risk.loot)} Rohstoffe plünderbar (${risk.byRes.filter((r) => r.loot > 0).map((r) => `${compactRes(r.loot)} ${deLabel.resource(r.key)}`).join(', ')})`;

  // "safe" = beides bekannt und ungefährdet (siehe impactVerdict) — bei
  // unbekannten Rohstoffen bleibt der Marker vorsichtshalber alarmiert.
  const html = `<u class="v"><b class="${shipsSafe ? 'ok' : 'bad'}" title="${esc(shipTitle)}">⬟</b><b class="${resCls}" title="${esc(resTitle)}">◈</b></u>`;

  // Ausführliche, aber lesbare Begründung fürs Haupt-Tooltip: je Rohstoff die
  // Prognose (Bestand zum Einschlag / Sockel), damit das Urteil nachvollziehbar
  // ist. Ressourcennamen rechtsbündig auf gleiche Breite, damit die Zahlen
  // trotz Standard-Tooltip-Schrift halbwegs sauber untereinanderstehen.
  const nameW = Math.max(...PLUNDER_RESOURCES.map((k) => deLabel.resource(k).length));
  const resLines = risk.known
    ? risk.byRes.map((r) => {
        const mark = r.loot > 0 ? '✗' : '✓';
        const name = deLabel.resource(r.key).padEnd(nameW, ' ');
        const verdictTxt = r.loot > 0 ? `→ ${de(r.loot)} plünderbar` : '→ save';
        return `  ${mark} ${name}  ${de(r.stock).padStart(9, ' ')} / ${de(r.floor)}  ${verdictTxt}${r.full ? ' · VOLL' : ''}`;
      }).join('\n')
    : '  ? unbekannt — dafür fehlt die Gesamtübersicht';
  const shipMark = shipsSafe ? '✓' : '✗';
  const header = safe ? '✓ ALLES SAVE — nichts zu holen' : '✗ RISIKO — Verlust droht';
  const reason = [
    header,
    '─'.repeat(Math.max(header.length, 24)),
    `  ${shipMark} Flotte   ${shipTitle}`,
    `  Rohstoffe zum Einschlag (${hhmm(e.at)}):`,
    resLines,
  ].join('\n');

  return { safe, html, reason };
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

  // Der eigentlich kritische Moment ist nicht der ganze Lead-Time-Block,
  // sondern die Lücke zwischen der letzten eigenen Flottenankunft und dem
  // nächsten Einschlag auf demselben Planeten — die Flotte steht ab der
  // Landung im Feuer, bis der Angriff einschlägt (oder sie vorher wegfliegt).
  const threatByCoord = new Map(threatAnalysis().map((t) => [t.coord, t]));

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

  // Alle Planeten bekommen eine eigene Zeile — auch die ruhigen. Ihre Zeile
  // ist minimal hoch (keine Marker-Spuren nötig) und zeigt nur Coord-Chip
  // und Statusindikatoren, statt in einer Sammelzeile zu verschwinden.
  let hiddenTotal = 0;
  const rows = sorted.map(([coord, evs], rowIndex) => {
    const st = planetStatus(coord);
    const risk = hitCoords.has(coord) && !!st.stationed?.hasShips;
    const flags = [
      risk ? 'risk' : '',
      st.mine && st.build.free ? 'bfree' : '',
      st.mine && st.yard.free ? 'yfree' : '',
    ].filter(Boolean).join(' ');
    const labChip = `${coordChip(coord, state.ownPlanets.has(coord) ? 'mine' : '')}`;

    if (!evs.length) {
      return `<div class="tl-row quiet${rowIndex % 2 ? ' alt' : ''}${flags ? ' ' + flags : ''}" style="height:${LANE_H}px">
        <span class="lab">${labChip}${indicators(coord, false)}</span>
        <span class="track"></span></div>`;
    }

    const inWin = evs.filter((e) => e.at <= to);
    const later = evs.filter((e) => e.at > to);
    hiddenTotal += later.length;

    // Kritischer Zwischenraum je Zeile: von der letzten eigenen Ankunft bis
    // zum nächsten Einschlag danach — genau die Zeit, in der die gerade
    // gelandete Flotte im Feuer steht (siehe threatAnalysis().windows).
    const fireSpans = (threatByCoord.get(coord)?.windows ?? [])
      .filter((w) => w.nextAttack)
      .map((w) => ({ from: w.arrival.at, to: w.nextAttack.at, gapSec: w.gapSec }))
      .filter((s) => pct(s.to) >= 0 && pct(s.from) <= 100);
    const fireBands = fireSpans.map((s) => {
      const l = Math.max(0, pct(s.from)), r = Math.min(100, pct(s.to));
      const title = `Flotte im Feuer: gelandet ${hhmm(s.from)}, nächster Einschlag ${hhmm(s.to)} (${durLong(s.gapSec)} dazwischen) — bis dahin online sein und wegschicken`;
      return `<span class="tl-fire" style="left:${l.toFixed(2)}%;width:${Math.max(r - l, 0.4).toFixed(2)}%" title="${esc(title)}"></span>`;
    }).join('');

    const { placed, overflow, laneCount } = packLanes(inWin, pct, widthPct);
    const marks = placed.map(({ e, x, lane }) => {
      const def = timelineTypes[e.type];
      const withTime = timed(e);
      const flip = !dots && x > (withTime ? 80 : 93);
      // Im Punktmodus würde ein Marker ganz rechts über die Spur hinausragen.
      const edge = dots && x > 97;
      const pos = flip ? `right:${(100 - x).toFixed(2)}%` : `left:${x.toFixed(2)}%`;
      const title = `${hhmm(e.at)} · ${def.label} · ${e.label}${e.from ? ` (von ${e.from})` : ''}`;
      // Nur Angriffe mit echtem Verlustrisiko bekommen die rote Alarmfarbe —
      // ist alles save, reicht ein ruhigeres Gelb.
      const av = e.type === 'attack' ? attackVerdict(e) : { safe: null, html: '', reason: '' };
      const atkCls = av.safe === true ? ' safe' : av.safe === false ? ' crit' : '';
      const fullTitle = av.reason ? `${title}\n\n${av.reason}` : title;
      const cls = `tl-mark ${e.type}${flip ? ' flip' : ''}${edge ? ' edge' : ''}${atkCls}${withTime ? '' : ' mini'}`;
      return `<span class="${cls}" style="${pos};top:${lane * laneH}px" title="${esc(fullTitle)}"><b class="dot"></b><i>${def.icon}</i>${withTime ? `<em>${hhmm(e.at)}</em>${av.html}` : ''}</span>`;
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
    const count = attacks ? `<i class="n crit">${attacks}⚔</i>` : `<i class="n">${evs.length}</i>`;
    return `<div class="tl-row${rowIndex % 2 ? ' alt' : ''}${hitCoords.has(coord) ? ' hit' : ''}${flags ? ' ' + flags : ''}" style="height:${height}px">
      <span class="lab">${labChip}${count}${indicators(coord, risk)}</span>
      <span class="track">${fireBands}${marks}${more}${rest}</span></div>`;
  }).join('');

  const zoomBar = `<div class="tl-zoom">
    <span class="zl">Zeitfenster</span>
    ${ZOOMS.map((z) => `<button type="button" data-tlzoom="${z.key}" class="${z.key === zoomKey ? 'on' : ''}">${z.label}</button>`).join('')}
    ${hiddenTotal ? `<span class="rest">+${hiddenTotal} Ereignis${hiddenTotal > 1 ? 'se' : ''} danach</span>` : ''}
  </div>`;

  return `<div class="gantt${dots ? ' dots' : ''}" data-from="${from}" data-span="${span}">
    ${zoomBar}
    <div class="axis">${ticks}<div class="now" style="left:${pct(Date.now()).toFixed(2)}%"><b>jetzt</b></div></div>
    <div class="tl-winbar">${winbar || '<span class="none">keine Online-Fenster in diesem Zeitraum</span>'}</div>
    <div class="tl-body">
      <div class="tl-grid">${grid}</div>
      <div class="tl-bands">${bands}</div>
      ${rows}
    </div>
  </div>`;
}

/** Legende — Fenster nur erklären, wenn es welche gibt. */
export function bandLegend(windows) {
  const wins = windows ?? saveWindows();
  const items = [];
  if (wins.some((w) => w.level === 'critical')) {
    items.push('<span><i class="sw critical"></i> Online nötig — Flotte steht im Feuer</span>');
  }
  if (wins.some((w) => w.level === 'warn')) {
    items.push('<span><i class="sw warn"></i> keine Flotte im Feuer, aber Beute möglich (oder Rohstofflage unbekannt)</span>');
  }
  if (wins.some((w) => w.level === 'safe')) {
    items.push('<span><i class="sw safe"></i> alles save — Online-Zeit optional</span>');
  }
  items.push('<span><i class="sw fire"></i> Flotte gelandet → nächster Einschlag: kritischer Zwischenraum in der Zeile</span>');
  items.push('<span><i class="sw now"></i> jetzt</span>');
  items.push('<span><i class="sw dot attack"></i> Angriff</span>');
  items.push('<span><i class="sw dot arrival"></i> eigene Flotte</span>');
  items.push('<span><i class="sw dot build"></i> Bau fertig</span>');
  items.push(`<span class="sep"></span>
    <span>Am Einschlag: <u class="v"><b class="ok">⬟</b><b class="ok">◈</b></u> alles save ·
      <u class="v"><b class="bad">⬟</b><b class="bad">◈</b></u> Schiffe und Rohstoffe in Gefahr</span>`);
  items.push(`<span class="sep"></span>
    <span><i class="ix fleet on mini">⬟<b>n</b></i> Flotte da <i class="ix fleet risk mini">⬟<b>n</b></i> im Feuer</span>
    <span><i class="ix loot safe mini">◈<b>save</b></i> nichts zu holen <i class="ix loot risk mini">◈<b>1,2M</b></i> plünderbar beim Einschlag</span>
    <span><i class="ix build free mini">⌂<b>frei</b></i> Bauplatz frei <i class="ix build busy mini">⌂<b>2h</b></i> belegt (Restzeit)</span>
    <span><i class="ix yard free mini">⚒<b>frei</b></i> Werft frei <i class="ix yard busy mini">⚒<b>45m</b></i> belegt</span>`);
  return `<div class="tl-legend">${items.join('')}</div>`;
}

/** Kompakte Textzeile: „Nächstes Online-Fenster in …". */
export function windowSummary(windows) {
  const w = windows.find((x) => x.active) || windows[0];
  if (!w) return 'Keine Einschläge — kein Online-Zwang.';
  const tag = w.level === 'safe' ? ' (optional — nichts zu verlieren)' : '';
  if (w.active) return `Fenster läuft — noch ${durLong(w.endsInSec)} bis zum letzten Einschlag.${tag}`;
  return `Nächstes Fenster in ${durLong(w.startsInSec)} · Dauer ${durLong(w.durationSec)}.${tag}`;
}
