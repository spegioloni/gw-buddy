// Rohstoffverlauf je Planet: Produktion als Kurve, Fracht als Sprung.
import { state, serverNow, persist } from '../state.js';
import { resourceAt } from '../analysis.js';
import { RESOURCES, deLabel } from '../domain.js';
import { coordChip, esc, num } from '../util/time.js';
import { emptyState } from './components.js';

const HOURS = 24;
const COLORS = { iron: '#f6a940', lutinum: '#bf7cff', water: '#58c8ff', hydrogen: '#45e0b5' };
const W = 860, LEFT = 72, RIGHT = 16, TOP = 12, BOTTOM = 180;
const PLOT_W = W - LEFT - RIGHT, PLOT_H = BOTTOM - TOP;

function niceCeil(value) {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return Math.ceil(value / power / 2) * power * 2;
}
function yOf(value, max) { return BOTTOM - value / max * PLOT_H; }
function chartPath(points, max) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${(LEFT + x / HOURS * PLOT_W).toFixed(1)},${yOf(y, max).toFixed(1)}`).join(' ');
}
function targetTime(p, key, target, from) {
  if (target == null) return null;
  for (let min = 0; min <= HOURS * 60; min += 1) {
    const at = from + min * 60e3;
    if (resourceAt(p, key, at).stock >= target) return at;
  }
  return undefined;
}

function chart(p, key, from) {
  const points = [];
  for (let min = 0; min <= HOURS * 60; min += 15) points.push([min / 60, resourceAt(p, key, from + min * 60e3).stock]);
  const target = persist.getForecastTargets()[`${p.coord}|${key}`] ?? null;
  const max = niceCeil(Math.max(...points.map((x) => x[1]), target ?? 0, 1));
  const line = chartPath(points, max);
  const area = `${line} L${LEFT + PLOT_W},${BOTTOM} L${LEFT},${BOTTOM} Z`;
  const goalAt = targetTime(p, key, target, from);
  const ticks = [0, max / 2, max].map((n) => `<g><line class="forecast-gridline" x1="${LEFT}" x2="${LEFT + PLOT_W}" y1="${yOf(n, max)}" y2="${yOf(n, max)}"/><text class="forecast-y-label" x="${LEFT - 8}" y="${yOf(n, max) + 4}" text-anchor="end">${num(Math.round(n))}</text></g>`).join('');
  const arrivals = state.fleets.filter((e) => e.own && e.ziel === p.coord && e.at >= from && e.at <= from + HOURS * 3600e3 && (e.cargo?.[key] ?? 0) > 0);
  const events = arrivals.map((e) => {
    const x = LEFT + (e.at - from) / (HOURS * 3600e3) * PLOT_W;
    const time = new Date(e.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `<line class="forecast-event" x1="${x}" x2="${x}" y1="${TOP}" y2="${BOTTOM}"><title>${time}: +${num(e.cargo[key])} ${deLabel.resource(key)} (${e.mission})</title></line>`;
  }).join('');
  const targetLine = target != null && target <= max
    ? `<line class="forecast-target-line" x1="${LEFT}" x2="${LEFT + PLOT_W}" y1="${yOf(target, max)}" y2="${yOf(target, max)}"/><text class="forecast-target-label" x="${LEFT + PLOT_W - 4}" y="${yOf(target, max) - 5}" text-anchor="end">Ziel ${num(target)}</text>` : '';
  const goalLabel = target == null ? 'Kein Ziel gesetzt' : goalAt === undefined ? 'Ziel nicht in 24 h' : `Ziel: ${new Date(goalAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  return `<article class="forecast-card" style="--forecast:${COLORS[key]}">
    <div class="forecast-head"><b>${esc(deLabel.resource(key))}</b><span>${num(points[0][1])} → ${num(points.at(-1)[1])}</span></div>
    <div class="forecast-goal"><label>Ziel <input type="number" min="0" step="1" value="${target ?? ''}" data-forecast-target data-coord="${p.coord}" data-resource="${key}" placeholder="Menge"></label><span>${goalLabel}</span></div>
    <svg class="forecast-svg" viewBox="0 0 ${W} 210" preserveAspectRatio="none" role="img" aria-label="${esc(deLabel.resource(key))}, Verlauf über 24 Stunden">
      ${ticks}${targetLine}<path class="forecast-area" d="${area}"/><path class="forecast-line" d="${line}"/>${events}
      <rect class="forecast-hit" x="${LEFT}" y="${TOP}" width="${PLOT_W}" height="${PLOT_H}" fill="transparent" data-coord="${p.coord}" data-resource="${key}" data-from="${from}"/>
    </svg>
    <div class="forecast-tooltip" hidden></div>
    <div class="forecast-scale"><span>jetzt</span><span>+6 h</span><span>+12 h</span><span>+18 h</span><span>+24 h</span></div>
  </article>`;
}

export function renderPrognose(coord = null) {
  const planets = [...state.ownPlanets].map((c) => state.planets.get(c)).filter(Boolean);
  if (!planets.length) return emptyState('Für die Rohstoffprognose zuerst eine Gesamtübersicht einfügen.');
  const p = planets.find((x) => x.coord === coord) || planets[0];
  const from = serverNow();
  const arrivals = state.fleets.filter((e) => e.own && e.ziel === p.coord && e.at >= from && e.at <= from + HOURS * 3600e3 && Object.values(e.cargo || {}).some((n) => n > 0));
  return `<div class="section forecast">
    <div class="forecast-title"><div><h2>◒ Rohstoffprognose</h2><div class="desc">24 Stunden Eigenproduktion, Speicherdeckel und bekannte Flottenfracht. Über die Kurve fahren für exakte Werte; Marker erklären Frachtankünfte.</div></div>
      <label>Planet <select id="forecastPlanet">${planets.map((x) => `<option value="${x.coord}" ${x.coord === p.coord ? 'selected' : ''}>${x.coord}</option>`).join('')}</select></label></div>
    <div class="forecast-planet">${coordChip(p.coord, 'mine')} <span>Stand ${new Date(from).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span></div>
    <div class="forecast-grid">${RESOURCES.map((r) => chart(p, r.key, from)).join('')}</div>
    <div class="forecast-note">${arrivals.length ? `${arrivals.length} bekannte Frachtankunft${arrivals.length === 1 ? '' : 'en'} in diesem Zeitraum.` : 'Keine bekannte Frachtankunft in den nächsten 24 Stunden.'}</div>
  </div>`;
}
