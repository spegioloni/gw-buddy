// Gemeinsame Render-Bausteine für die Views.
import { coordChip, esc } from '../util/time.js';

/**
 * Responsive Matrix: Desktop-Tabelle (Planeten in Spalten) UND Mobil-Karten
 * (eine pro Planet). CSS blendet je nach Breite eines aus.
 * @param planets  Array von Koordinaten (Spalten)
 * @param rows     Array<{label, cell:(coord)=>{text, cls?}}>
 * @param opts     {pts?:coord->number}
 */
export function matrix(planets, rows, opts = {}) {
  const head = planets.map((c) => `<th>${coordChip(c, mineCls(c, opts))}</th>`).join('');
  const body = rows.map((r) => {
    const cells = planets.map((c) => {
      const { text, cls = '' } = r.cell(c) || {};
      return `<td class="num ${cls}">${text ?? '·'}</td>`;
    }).join('');
    return `<tr><td>${esc(r.label)}</td>${cells}</tr>`;
  }).join('');

  const table = `<div class="mx-table"><table>
    <thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

  const cards = `<div class="mx-cards">${planets.map((c) => {
    const pts = opts.pts?.[c];
    const kvs = rows.map((r) => {
      const { text, cls = '' } = r.cell(c) || {};
      const zero = cls.includes('zero');
      return `<div class="kv ${zero ? 'zero' : ''}"><span>${esc(r.label)}</span><span class="mono">${text ?? '·'}</span></div>`;
    }).join('');
    return `<div class="pcard"><div class="ph">${coordChip(c, mineCls(c, opts))}${pts != null ? `<span class="pts">${pts} P</span>` : ''}</div>${kvs}</div>`;
  }).join('')}</div>`;

  return table + cards;
}

const mineCls = (coord, opts) => (opts.own?.has?.(coord) ? 'mine' : '');

export function emptyState(msg) {
  return `<div class="empty">${esc(msg)}</div>`;
}
