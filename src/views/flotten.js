// Tab "Flotten": kompakte Tabellenübersicht (was steht wo, was ist im
// Transit) plus die ausführlichen Planet-Blöcke im Klapp-Bereich.
import { state, serverNow } from '../state.js';
import { stationedAt } from '../analysis.js';
import { coordChip, num, esc } from '../util/time.js';
import { deLabel } from '../domain.js';
import { emptyState } from './components.js';

const cd = (at) => `<span class="cd" data-at="${at}"></span>`;
const shipNum = (n) => (n == null ? '–' : num(n));

function fleetItem(e, dir) {
  const other = dir === 'in' ? e.start : e.ziel;
  const cls = e.hostile ? 'threat' : e.spy ? 'own' : e.section === 'rueck' ? '' : e.own ? 'own' : '';
  const arrow = dir === 'in' ? '←' : '→';
  return `<div class="item ${cls}" style="padding:8px 12px">
    ${cd(e.at)}
    <div class="grow">
      <div class="ttl" style="font-size:13px">${esc(e.icon || '')} ${esc(e.mission)} <span style="color:var(--dim)">${arrow} ${coordChip(other, state.ownPlanets.has(other) ? 'mine' : '')}</span></div>
      <div class="sub">${esc(e.owner)}${e.player ? ` · ${esc(e.player)}` : ''}
        ${Object.keys(e.ships || {}).length ? ` · ${Object.entries(e.ships).map(([k, n]) => `${num(n)} ${esc(deLabel.ship(k))}`).join(', ')}` : ''}
        ${Object.keys(e.cargo || {}).length ? ` · Fracht: ${Object.entries(e.cargo).map(([k, n]) => `${num(n)} ${esc(deLabel.resource(k))}`).join(', ')}` : ''}</div>
    </div></div>`;
}

function stationed(p, coord, now) {
  const st = stationedAt(p, coord, now);
  if (!st.hasAny) return '<div class="sub" style="color:var(--faint)">keine Schiffe oder Verteidigung stationiert</div>';
  const ships = st.ships.map(([k, n]) => `<span class="tag"><b>${num(n)}</b> ${esc(deLabel.ship(k))}</span>`).join('');
  const def = st.defense.map(([k, n]) => `<span class="tag def"><b>${num(n)}</b> ${esc(deLabel.defence(k))}</span>`).join('');
  return `<div class="stat-line">${ships}${def || ''}</div>`;
}

function arrivalLabel(at) {
  return new Date(at).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Kleine Landekurve: Jeder Punkt reduziert den noch fliegenden Bestand. */
function airChart(list, now) {
  if (!list.length) return '<span style="color:var(--faint)">–</span>';

  const flights = list.map((e) => ({
    ...e,
    shipCount: Object.values(e.ships || {}).reduce((sum, amount) => sum + amount, 0),
  }));
  const total = flights.reduce((sum, e) => sum + e.shipCount, 0);
  const latest = Math.max(...flights.map((e) => e.at));
  const span = Math.max(latest - now, 15 * 60e3);
  const width = 1000, height = 72, left = 10, right = 990, top = 6, bottom = 55;
  const y = (amount) => bottom - (total ? amount / total : 0) * (bottom - top);
  const x = (at) => Math.min(right, left + Math.max(0, at - now) / span * (right - left));

  let remaining = total;
  let path = `M ${left} ${y(remaining)}`;
  const points = flights.map((e) => {
    const atX = x(e.at);
    path += ` H ${atX}`;
    remaining -= e.shipCount;
    path += ` V ${y(remaining)}`;
    const ships = Object.entries(e.ships || {})
      .filter(([, amount]) => amount > 0)
      .map(([key, amount]) => `${num(amount)} ${deLabel.ship(key)}`)
      .join(', ') || 'Schiffstyp unbekannt';
    const detail = `${arrivalLabel(e.at)} · ${e.mission}\n${ships}\n${e.start} → ${e.ziel}`;
    return `<circle class="air-chart-hit" cx="${atX}" cy="${y(remaining)}" r="4" data-air-detail="${esc(detail)}"></circle>`;
  }).join('');
  const summary = total ? `${num(total)} Schiffe unterwegs` : 'Schiffsmengen unbekannt';
  const arrival = arrivalLabel(latest);

  return `<div class="air-chart" aria-label="${esc(`${summary}, letzte Landung ${arrival}`)}">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${summary}, Landekurve bis ${arrival}`)}">
      <path class="air-chart-base" d="M ${left} ${bottom} H ${right}"></path>
      <line class="air-chart-now-line" x1="${left}" x2="${left}" y1="${top}" y2="${bottom}"></line>
      <path class="air-chart-line" d="${path}"></path>
      ${points}
      <text class="air-chart-now" x="${left}" y="68">jetzt</text>
      <text class="air-chart-arrival" x="${right}" y="68" text-anchor="end">${esc(arrival)}</text>
    </svg>
    <div class="air-chart-tooltip" hidden></div>
  </div>`;
}

function flightShipCount(flight) {
  const ships = Object.values(flight.ships || {}).filter((amount) => amount > 0);
  return ships.length ? ships.reduce((sum, amount) => sum + amount, 0) : null;
}

function airShipCount(flights) {
  const counts = flights.map(flightShipCount);
  return counts.some((count) => count == null) ? null : counts.reduce((sum, count) => sum + count, 0);
}

function overviewTable(rows, now) {
  const body = rows.map(({ coord, p, stationed, air, airShips, threatened }) => `
    <tr class="${threatened ? 'unsafe' : ''}">
      <td>${coordChip(coord, 'mine')}${threatened ? ' <span class="badge">Beschuss</span>' : ''}</td>
      <td class="num">${p.points != null ? num(p.points) : '·'}</td>
      <td class="num">${shipNum(stationed.total)}</td>
      <td class="num">${shipNum(airShips)}</td>
      <td class="air">${airChart(air, now)}</td>
    </tr>`).join('');
  const totalPts = rows.reduce((s, r) => s + (r.p.points || 0), 0);
  const totalStationed = rows.reduce((sum, r) => sum + r.stationed.total, 0);
  const totalAirShips = airShipCount(rows.flatMap((r) => r.air));
  const totalAir = rows.reduce((s, r) => s + r.air.length, 0);
  return `<div class="mx-table"><table>
    <thead><tr><th>Planet</th><th>Punkte</th><th>Schiffe stationiert</th><th>Schiffe in der Luft</th><th>In der Luft</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="totals">
      <td>Gesamt</td><td class="num">${num(totalPts)}</td><td class="num">${num(totalStationed)}</td><td class="num">${shipNum(totalAirShips)}</td><td class="num">${totalAir}</td>
    </tr></tfoot>
  </table></div>`;
}

function fleetDistribution(rows) {
  const stationed = {}, flying = {};
  for (const row of rows) {
    for (const [key, amount] of row.stationed.ships) stationed[key] = (stationed[key] || 0) + amount;
    for (const e of row.air) for (const [key, amount] of Object.entries(e.ships || {})) flying[key] = (flying[key] || 0) + amount;
  }
  const keys = [...new Set([...Object.keys(stationed), ...Object.keys(flying)])];
  if (!keys.length) return '';
  return `<div class="section"><h2>◈ Flottenverteilung</h2>
    <div class="desc">Gesamt je Schiffstyp: bestätigt stationiert gegenüber aktuell in der Luft. Erwartete Stationierungen und Rückflüge wechseln nach Ankunft in den stationierten Bestand.</div>
    <div class="mx-table"><table><thead><tr><th>Schiff</th><th>Stationiert</th><th>In der Luft</th><th>Gesamt</th></tr></thead><tbody>
      ${keys.map((key) => {
        const total = (stationed[key] || 0) + (flying[key] || 0);
        return `<tr><td>${esc(deLabel.ship(key))}</td><td class="num">${num(stationed[key] || 0)}</td><td class="num">${num(flying[key] || 0)}</td><td class="num">${num(total)}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>`;
}

function planetBlock({ coord, p, air, threatened }, now) {
  return `
    <div class="pblock ${threatened ? 'threat' : ''}">
      <div class="pbh">${coordChip(coord, 'mine')} ${p.points != null ? `<span class="pts">${num(p.points)} P</span>` : ''}
        ${threatened ? '<span class="badge">unter Beschuss</span>' : ''}</div>
      <div style="margin-bottom:12px">${stationed(p, coord, now)}</div>
      <div class="cols">
        <div>
          <div class="subhead">In der Luft<span class="ln"></span></div>
          ${air.length ? `<div class="list">${air.map((e) => fleetItem(e, e.ziel === coord ? 'in' : 'out')).join('')}</div>` : '<div class="sub" style="color:var(--faint)">keine</div>'}
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

  const isVisibleAt = (e, coord) => {
    if (e.section === 'rueck' && e.mission === 'Stationierung') return false;
    if (e.hostile) return e.ziel === coord;
    if (e.section === 'rueck' || e.mission === 'Stationierung') return e.ziel === coord;
    return e.start === coord;
  };
  const rows = owns.map((coord) => {
    const p = state.planets.get(coord) || { coord, ships: {}, defense: {}, points: null };
    const air = state.fleets.filter((e) => isVisibleAt(e, coord) && e.at >= now).sort((a, b) => a.at - b.at);
    const threatened = air.some((e) => e.hostile);
    return { coord, p, stationed: stationedAt(p, coord, now), air, airShips: airShipCount(air), threatened };
  });
  // Bedrohte zuerst, dann nach Punkten.
  rows.sort((a, b) => (b.threatened - a.threatened) || ((b.p.points || 0) - (a.p.points || 0)));

  return `
    ${fleetDistribution(rows)}
    <div class="section">
      <div class="desc">Pro Planet: stationierter Bestand und Flotten in der Luft. Stationierungen erscheinen nur am Ziel, Rückflüge nur am Rückkehrplanet.</div>
      ${overviewTable(rows, now)}
    </div>
    <details class="fold">
      <summary>Details je Planet (Bestand nach Typ, volle Flottenliste)</summary>
      <div class="fbody">${rows.map((row) => planetBlock(row, now)).join('')}</div>
    </details>`;
}
