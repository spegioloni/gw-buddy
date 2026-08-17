// Gestapeltes Balkendiagramm als reines SVG — kein Build, keine Bibliothek.
// Erwartet die Form aus src/farmstats.js: {keys:[{key,label,color}], bars:[{label,values,total}]}.
import { esc, num, short } from '../util/time.js';

const W = 960, H = 260, LEFT = 62, RIGHT = 12, TOP = 14, BOTTOM = 34;
const PLOT_W = W - LEFT - RIGHT;
const PLOT_H = H - TOP - BOTTOM;

/** Runde, gut lesbare Obergrenze für die Achse (1/2/5 × 10^n). */
function niceMax(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * base) return step * base;
  }
  return 10 * base;
}

const dayLabel = (label) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  return m ? `${m[3]}.${m[2]}.` : label;
};

export function stackedBars(series, opts = {}) {
  const { bars, keys } = series;
  if (!bars.length) return '<div class="chart-empty">Noch keine Beute im Archiv.</div>';
  const max = niceMax(Math.max(...bars.map((b) => b.total)));
  const slot = PLOT_W / bars.length;
  const width = Math.max(2, Math.min(46, slot * 0.72));
  const yOf = (v) => TOP + PLOT_H - (v / max) * PLOT_H;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const y = TOP + PLOT_H - f * PLOT_H;
    return `<line class="chart-grid" x1="${LEFT}" x2="${W - RIGHT}" y1="${y}" y2="${y}"/>
      <text class="chart-axis" x="${LEFT - 8}" y="${y + 4}" text-anchor="end">${f === 0 ? '0' : short(max * f)}</text>`;
  }).join('');

  // Beschriftet werden höchstens ~12 Tage, sonst überlappt die Achse.
  const every = Math.ceil(bars.length / 12);

  const columns = bars.map((bar, i) => {
    const x = LEFT + slot * i + (slot - width) / 2;
    let y = TOP + PLOT_H;
    const parts = keys.map(({ key, label, color }) => {
      const value = bar.values[key] || 0;
      if (value <= 0) return '';
      const h = Math.max(1, (value / max) * PLOT_H);
      y -= h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}"><title>${esc(dayLabel(bar.label))} · ${esc(label)}: ${num(value)}</title></rect>`;
    }).join('');
    const tick = i % every === 0
      ? `<text class="chart-axis" x="${(x + width / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle">${esc(dayLabel(bar.label))}</text>` : '';
    const hover = `<rect x="${(LEFT + slot * i).toFixed(1)}" y="${TOP}" width="${slot.toFixed(1)}" height="${PLOT_H}" fill="transparent"><title>${esc(dayLabel(bar.label))}: ${num(bar.total)} Rohstoffe</title></rect>`;
    return hover + parts + tick;
  }).join('');

  const legend = keys.map(({ label, color }) =>
    `<span class="chart-key"><i style="background:${color}"></i>${esc(label)}</span>`).join('');

  return `<figure class="chart">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.title || 'Beute je Tag')}">
      ${grid}${columns}
    </svg>
    <figcaption class="chart-legend">${legend}</figcaption>
  </figure>`;
}

/** Waagerechte Rangliste, z. B. Gesamtertrag je Farm. */
export function barList(items, opts = {}) {
  if (!items.length) return '<div class="chart-empty">Noch keine Beute im Archiv.</div>';
  const max = Math.max(...items.map((i) => i.value)) || 1;
  return `<div class="barlist">${items.map((item, i) => `<div class="barlist-row">
    <div class="barlist-label">${item.html || esc(item.label)}</div>
    <div class="barlist-track"><div class="barlist-fill" style="width:${(item.value / max * 100).toFixed(1)}%;background:${item.color || 'var(--acc, #8ecbff)'}"></div></div>
    <div class="barlist-value mono">${num(item.value)}${item.sub ? `<small>${esc(item.sub)}</small>` : ''}</div>
  </div>`).join('')}</div>${opts.foot ? `<div class="desc">${esc(opts.foot)}</div>` : ''}`;
}
