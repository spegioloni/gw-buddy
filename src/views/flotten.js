// Tab "Flotten": pro Planet stationierte Schiffe/Verteidigung UND ein-/ausgehende
// Flotten zusammen. Bedrohte Planeten zuerst.
import { state, serverNow } from '../state.js';
import { stationedSummary } from '../analysis.js';
import { coordChip, num, esc } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';

const cd = (at) => `<span class="cd" data-at="${at}"></span>`;

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

export function renderFlotten() {
  if (!state.planets.size && !state.fleets.length) {
    return emptyState('Noch keine Daten. Füge deine Übersichtsseite oder Gesamtübersicht ein.');
  }
  const now = serverNow();
  const owns = [...state.ownPlanets];
  // Auch eigene Planeten ohne Gesamtübersicht-Datensatz berücksichtigen.
  for (const c of state.planets.keys()) if (state.planets.get(c).mine && !owns.includes(c)) owns.push(c);

  const blocks = owns.map((coord) => {
    const p = state.planets.get(coord) || { coord, ships: {}, defense: {}, points: null };
    const incoming = state.fleets.filter((e) => e.ziel === coord && e.at >= now - 3600e3).sort((a, b) => a.at - b.at);
    const outgoing = state.fleets.filter((e) => e.start === coord && e.own && e.at >= now - 3600e3).sort((a, b) => a.at - b.at);
    const threatened = incoming.some((e) => e.hostile);
    return { coord, p, incoming, outgoing, threatened };
  });
  // Bedrohte zuerst, dann nach Punkten.
  blocks.sort((a, b) => (b.threatened - a.threatened) || ((b.p.points || 0) - (a.p.points || 0)));

  const html = blocks.map(({ coord, p, incoming, outgoing, threatened }) => `
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
    </div>`).join('');

  return `<div class="section"><div class="desc">Pro Planet: was dort steht und was hin- bzw. wegfliegt. Bedrohte Planeten zuerst.</div>${html}</div>`;
}
