// Gemeinsame Render-Bausteine für die Views.
import { coordChip, esc, num, short } from '../util/time.js';
import { formatIdle } from '../radar.js';

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

/* ---------- Farmkarte (Radar und Farmliste teilen sich dieselbe) ---------- */

/** "vor 3 h" / "vor 2 T" — knapp genug für eine Zelle. */
const agoLabel = (ms) => (ms == null ? 'nie'
  : `vor ${formatIdle(Math.max(0, Math.floor((Date.now() - ms) / 3600e3)))}`);

/** Sechs Kennzahlen an immer derselben Stelle — sonst vergleicht man nichts. */
export function statCells(cells) {
  return `<div class="roster-stats mono">${cells.map(([k, v, hint]) =>
    `<div class="rstat" title="${esc(hint || k)}"><span class="k">${k}</span><b>${v}</b></div>`).join('')}</div>`;
}

/**
 * Ein Ziel als Karte — dieselbe Anordnung wie in der Farmliste, damit ein
 * Kandidat im Radar und ein belegter Platz direkt vergleichbar sind.
 *
 * Oben steht groß der Schnitt je Flug: das ist die Zahl, an der sich
 * entscheidet, ob ein Ziel den Schiffsraum wert ist. Ziele ohne Archiv
 * zeigen dort einen Strich — „unbekannt" ist ehrlicher als eine Null.
 *
 * @param row   Zeile aus rankFarms (coord, owner_name, points, attack …)
 * @param opts  {listed?:{active:string[],dropped:string[]}, picked?:boolean,
 *               origin?:string, addLabel?:string}
 */
export function farmTargetCard(row, opts = {}) {
  const a = row.attack || {};
  const flown = Number(a.reports) > 0;
  const listed = opts.listed;
  const onList = listed?.active?.length ? listed.active : null;
  const wasList = !onList && listed?.dropped?.length ? listed.dropped : null;
  const dash = (v) => (v ? short(v) : '–');
  const cls = ['farm-card', 'cand'];
  if (row.attackedToday) cls.push('stale');
  if (opts.picked === false) cls.push('unpicked');
  if (onList) cls.push('listed');

  const pick = opts.picked == null ? ''
    : `<label class="farm-pick" title="in die Sammelübernahme"><input type="checkbox" data-radar-pick="${esc(row.coord)}"${opts.picked ? ' checked' : ''}></label>`;

  const badges = [
    flown
      ? `<span class="farm-badge${row.attackedToday ? ' today' : ''}">${row.attackedToday ? '● heute · ' : ''}${num(a.reports)}× angeflogen · Ø ${short(a.avg)} je Flug</span>`
      : '<span class="farm-badge new">neu — noch nie angeflogen</span>',
    onList
      ? `<span class="farm-badge listed" title="Diese Farm belegt bereits einen Platz">◆ auf der Farmliste · ${esc(onList.join(', '))}</span>`
      : wasList
      ? `<span class="farm-badge kalt" title="Früher schon einmal auf einer Liste und wieder abgelegt">↺ früher abgelegt · ${esc(wasList.join(', '))}</span>`
      : '',
  ].filter(Boolean).join('');

  const context = [
    `${num(row.points || 0)} P Planet`,
    row.total_points ? `${num(row.total_points)} P Spieler${row.planet_count ? ` · ${row.planet_count} Planeten` : ''}` : null,
    row.idleHours != null ? `${formatIdle(row.idleHours)} ${row.idle_confirmed === false ? 'beobachtet' : 'inaktiv'}` : null,
    row.nearestOwn ? `ab ${row.nearestOwn}` : null,
    row.score != null ? `Score ${num(row.score)}` : null,
  ].filter(Boolean).join(' · ');

  const cells = [
    ['bester Flug', dash(a.best), flown ? 'höchste je gemeldete Beute' : 'noch kein Bericht'],
    ['letzter Flug', dash(a.last), flown ? 'jüngster Flug im Beute-Archiv' : 'noch kein Bericht'],
    ['Beute gesamt', dash(a.total), 'alles, was dieses Ziel je gebracht hat'],
    ['Flüge', flown ? num(a.reports) : '–', 'Berichte im Archiv, auch von anderen Planeten'],
    ['zuletzt', flown ? agoLabel(a.lastAt) : 'nie', 'letzter Angriff auf dieses Ziel'],
    ['Entfernung', row.systemGap != null ? `${row.systemGap} Sys` : short(row.distance || 0), 'Flugweg vom nächsten eigenen Planeten'],
  ];

  const origin = opts.origin ? ` data-roster-origin="${esc(opts.origin)}"` : '';
  const action = onList
    ? `<button class="btn sm ghost" disabled title="steht bereits auf ${esc(onList.join(', '))}">bereits auf der Liste</button>`
    : `<button class="btn sm" data-roster-add="${esc(row.coord)}" data-player="${esc(row.owner_name || '')}"${origin}>→ ${esc(opts.addLabel || 'zur Farmliste')}</button>`;

  return `<article class="${cls.join(' ')}">
    <div class="rc-head">
      <div class="rc-name">${pick}${coordChip(row.coord)}<b>${esc(row.owner_name || '?')}</b>
        ${row.alliance ? `<span class="rc-tag">[${esc(row.alliance)}]</span>` : ''}</div>
      <div class="rc-day mono"><b>${dash(a.avg)}</b><small>Ø je Flug</small></div>
    </div>
    ${badges}
    <small class="roster-context">${esc(context)}</small>
    ${statCells(cells)}
    <div class="roster-actions">${action}</div>
  </article>`;
}
