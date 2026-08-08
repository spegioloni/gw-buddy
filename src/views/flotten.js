// Tab "Flotten": kompakte Tabellenübersicht (was steht wo, was ist im
// Transit) plus die ausführlichen Planet-Blöcke im Klapp-Bereich.
import { state, serverNow } from '../state.js';
import { stationedSummary } from '../analysis.js';
import { coordChip, num, esc } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';

const cd = (at) => `<span class="cd" data-at="${at}"></span>`;
const ckkNum = (n) => (n == null ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function fleetItem(e, dir) {
  const other = dir === 'in' ? e.start : e.ziel;
  const cls = e.hostile ? 'threat' : e.spy ? 'own' : e.section === 'rueck' ? '' : e.own ? 'own' : '';
  const arrow = dir === 'in' ? '←' : '→';
  return `<div class="item ${cls}" style="padding:8px 12px">
    ${cd(e.at)}
    <div class="grow">
      <div class="ttl" style="font-size:13px">${esc(e.icon || '')} ${esc(e.mission)} <span style="color:var(--dim)">${arrow} ${coordChip(other, state.ownPlanets.has(other) ? 'mine' : '')}</span></div>
      <div class="sub">${esc(e.owner)}${e.player ? ` · ${esc(e.player)}` : ''}</div>
    </div></div>`;
}

function stationed(p) {
  const st = stationedSummary(p);
  if (!st.hasAny) return '<div class="sub" style="color:var(--faint)">keine Schiffe oder Verteidigung stationiert</div>';
  const ships = st.ships.map(([k, n]) => `<span class="tag"><b>${num(n)}</b> ${esc(deLabel.ship(k))}</span>`).join('');
  const def = st.defense.map(([k, n]) => `<span class="tag def"><b>${num(n)}</b> ${esc(deLabel.defence(k))}</span>`).join('');
  return `<div class="stat-line">${ships}${def || ''}</div>`;
}

/** Kurzfassung ein-/ausgehender Flotten für eine Tabellenzelle. */
function transitCell(list, dir) {
  if (!list.length) return '<span style="color:var(--faint)">–</span>';
  const arrow = dir === 'in' ? '←' : '→';
  return list.map((e) => {
    const other = dir === 'in' ? e.start : e.ziel;
    const cls = e.hostile ? 'bad' : '';
    return `<div class="transit-row ${cls}">${cd(e.at)} ${esc(e.mission)} ${arrow} ${coordChip(other, state.ownPlanets.has(other) ? 'mine' : '')}</div>`;
  }).join('');
}

function overviewTable(rows) {
  const body = rows.map(({ coord, p, incoming, outgoing, threatened }) => `
    <tr class="${threatened ? 'unsafe' : ''}">
      <td>${coordChip(coord, 'mine')}${threatened ? ' <span class="badge">Beschuss</span>' : ''}</td>
      <td class="num">${p.points != null ? num(p.points) : '·'}</td>
      <td class="num">${ckkNum(p.ckkShips)}</td>
      <td class="num">${ckkNum(p.ckkDefense)}</td>
      <td class="transit">${transitCell(incoming, 'in')}</td>
      <td class="transit">${transitCell(outgoing, 'out')}</td>
    </tr>`).join('');
  const totalPts = rows.reduce((s, r) => s + (r.p.points || 0), 0);
  const totalShips = rows.reduce((s, r) => s + (r.p.ckkShips || 0), 0);
  const totalDef = rows.reduce((s, r) => s + (r.p.ckkDefense || 0), 0);
  const totalIn = rows.reduce((s, r) => s + r.incoming.length, 0);
  const totalOut = rows.reduce((s, r) => s + r.outgoing.length, 0);
  return `<div class="mx-table"><table>
    <thead><tr><th>Planet</th><th>Punkte</th><th>CKK Schiffe</th><th>CKK Verteidigung</th><th>Eingehend</th><th>Ausgehend</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="totals">
      <td>Gesamt</td><td class="num">${num(totalPts)}</td><td class="num">${ckkNum(totalShips)}</td><td class="num">${ckkNum(totalDef)}</td>
      <td class="num">${totalIn}</td><td class="num">${totalOut}</td>
    </tr></tfoot>
  </table></div>`;
}

function planetBlock({ coord, p, incoming, outgoing, threatened }) {
  return `
    <div class="pblock ${threatened ? 'threat' : ''}">
      <div class="pbh">${coordChip(coord, 'mine')} ${p.points != null ? `<span class="pts">${num(p.points)} P</span>` : ''}
        ${threatened ? '<span class="badge">unter Beschuss</span>' : ''}</div>
      <div style="margin-bottom:12px">${stationed(p)}</div>
      <div class="cols">
        <div>
          <div class="subhead">Eingehend<span class="ln"></span></div>
          ${incoming.length ? `<div class="list">${incoming.map((e) => fleetItem(e, 'in')).join('')}</div>` : '<div class="sub" style="color:var(--faint)">keine</div>'}
        </div>
        <div>
          <div class="subhead">Ausgehend<span class="ln"></span></div>
          ${outgoing.length ? `<div class="list">${outgoing.map((e) => fleetItem(e, 'out')).join('')}</div>` : '<div class="sub" style="color:var(--faint)">keine</div>'}
        </div>
      </div>
    </div>`;
}

export function renderFlotten() {
  if (!state.planets.size && !state.fleets.length) {
    return emptyState('Noch keine Daten. Füge deine Übersichtsseite oder Gesamtübersicht ein.');
  }
  const now = serverNow();
  const owns = [...state.ownPlanets];
  // Auch eigene Planeten ohne Gesamtübersicht-Datensatz berücksichtigen.
  for (const c of state.planets.keys()) if (state.planets.get(c).mine && !owns.includes(c)) owns.push(c);

  const rows = owns.map((coord) => {
    const p = state.planets.get(coord) || { coord, ships: {}, defense: {}, points: null };
    const incoming = state.fleets.filter((e) => e.ziel === coord && e.at >= now - 3600e3).sort((a, b) => a.at - b.at);
    const outgoing = state.fleets.filter((e) => e.start === coord && e.own && e.at >= now - 3600e3).sort((a, b) => a.at - b.at);
    const threatened = incoming.some((e) => e.hostile);
    return { coord, p, incoming, outgoing, threatened };
  });
  // Bedrohte zuerst, dann nach Punkten.
  rows.sort((a, b) => (b.threatened - a.threatened) || ((b.p.points || 0) - (a.p.points || 0)));

  return `
    <div class="section">
      <div class="desc">Pro Planet: was dort steht (CKK) und was gerade unterwegs ist. Bedrohte Planeten zuerst, Gesamtsummen unten.</div>
      ${overviewTable(rows)}
    </div>
    <details class="fold">
      <summary>Details je Planet (Bestand nach Typ, volle Flottenliste)</summary>
      <div class="fbody">${rows.map(planetBlock).join('')}</div>
    </details>`;
}
