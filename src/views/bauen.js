// Tab "Bauen & Forschen": Aktions-Panel (laufende Aufträge + freie Kapazität)
// und die aufklappbare vollständige Gebäude-Matrix.
import { state, serverNow } from '../state.js';
import { freeCapacity, storageSafety } from '../analysis.js';
import { coordChip, esc } from '../util/time.js';
import { BUILDINGS, deLabel } from '../domain.js';
import { matrix, emptyState } from './components.js';

const lvlOf = (v) => (v && typeof v === 'object' ? v.level : v);
const num = (n) => Math.round(n).toLocaleString('de-DE');
const coverage = (hours) => Number.isFinite(hours) ? `${hours.toFixed(1).replace('.', ',')} h` : '∞';

function safety24h() {
  const rows = storageSafety(24);
  if (!rows.length) return emptyState('Keine Gesamtübersicht eingefügt — Speicher & Produktion unbekannt.');
  const unsafeCount = rows.filter((r) => !r.safe).length;
  const summary = unsafeCount
    ? `<div class="desc">⚠ ${unsafeCount} von ${rows.length} Speicherwerten reichen <b>nicht</b> für 24 h plündersichere Produktion. Empfehlung siehe letzte Spalte.</div>`
    : `<div class="desc">✓ Alle Speicher halten mindestens 24 h Eigenproduktion plündersicher.</div>`;

  // Nach Planet gruppieren: die Koordinaten-Spalte erscheint nur einmal pro
  // Gruppe (rowspan), statt sich pro Rohstoff-Zeile zu wiederholen.
  const byPlanet = new Map();
  for (const r of rows) {
    if (!byPlanet.has(r.coord)) byPlanet.set(r.coord, []);
    byPlanet.get(r.coord).push(r);
  }
  const body = [...byPlanet.entries()].map(([coord, rs]) => {
    const groupStatus = rs.some((r) => r.status === 'danger')
      ? 'danger'
      : rs.some((r) => r.status === 'warning') ? 'warning' : 'safe';
    return rs.map((r, i) => `
    <tr class="${r.status}${i === 0 ? ' pgroup' : ''}">
      ${i === 0 ? `<td rowspan="${rs.length}" class="${groupStatus === 'danger' ? 'bad' : groupStatus === 'warning' ? 'warn' : ''}">${coordChip(coord, 'mine')}</td>` : ''}
      <td>${esc(deLabel.resource(r.resKey))}</td>
      <td class="num">${r.level}</td>
      <td class="num">${num(r.floor)}</td>
      <td class="num">${num(r.need)}</td>
      <td class="num">${coverage(r.coverageHours)}</td>
      <td class="num ${r.status === 'safe' ? 'hi' : r.status === 'warning' ? 'warn' : 'bad'}">${r.safe ? '✓ sicher' : r.status === 'warning' ? '⚠ knapp' : '✗ zu wenig'}</td>
      <td class="num">${r.safe ? '–' : `Stufe ${r.recLevel}`}</td>
    </tr>`).join('');
  }).join('');
  const table = `<div class="mx-table"><table class="grouped">
    <thead><tr><th>Planet</th><th>Rohstoff</th><th>Speicher-Stufe</th><th>Sockel (2%)</th>
    <th>Produktion/24h</th><th>Abdeckung</th><th>Status</th><th>Empfehlung</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
  return summary + table;
}

function orders() {
  // Abgeschlossene Aufträge (Fertigzeit liegt in der Vergangenheit) nicht mehr
  // anzeigen — sonst bleibt der Countdown bei 00:00:00 ewig stehen, weil die
  // Liste erst beim nächsten Einfügen neuer Daten aktualisiert wird.
  const list = state.buildOrders.filter((b) => b.at > serverNow());
  if (!list.length) return emptyState('Keine laufenden Bauaufträge.');
  return `<div class="list">${list.map((b) => `
    <div class="item soon">
      <div class="cd" data-at="${b.at}"></div>
      <div class="grow">
        <div class="ttl">${esc(b.name)} → Stufe ${b.level}</div>
        <div class="sub">${coordChip(b.coord, state.ownPlanets.has(b.coord) ? 'mine' : '')}</div>
      </div>
    </div>`).join('')}</div>`;
}

function capacity() {
  const fc = freeCapacity();
  if (!fc.noBuild.length && !fc.idleYard.length) return emptyState('Alle Planeten bauen — keine freie Kapazität.');
  const build = fc.noBuild.map((c) => `<span class="chip free">${coordChip(c, 'mine')} Bau frei</span>`).join(' ');
  const yard = fc.idleYard.map((c) => `<span class="chip free">${coordChip(c, 'mine')} Schiffsfabrik idle</span>`).join(' ');
  return `<div class="stat-line" style="gap:8px">${build}${yard}</div>`;
}

function fullMatrix() {
  const planets = state.gesamt?.planets || [...state.ownPlanets];
  if (!planets.length) return emptyState('Keine Gesamtübersicht eingefügt — Gebäudestufen unbekannt.');
  const pts = {};
  for (const c of planets) pts[c] = state.planets.get(c)?.points;
  const rows = BUILDINGS.map((b) => ({
    label: b.de,
    cell: (c) => {
      const v = lvlOf(state.planets.get(c)?.buildings?.[b.key]);
      return { text: v == null ? '·' : String(v), cls: !v ? 'zero' : '' };
    },
  }));
  return matrix(planets, rows, { pts, own: state.ownPlanets });
}

function research() {
  const planets = state.gesamt?.planets || [];
  const centers = planets.map((c) => {
    const lvl = lvlOf(state.planets.get(c)?.buildings?.researchCenter);
    return lvl ? `<span class="tag">${coordChip(c, 'mine')} <b>FZ ${lvl}</b></span>` : '';
  }).filter(Boolean).join(' ');
  return `<div class="desc">Die Pastes liefern keine laufenden Forschungen (Feld war leer). Vorhandene Forschungszentren:</div>
    <div class="stat-line">${centers || '<span style="color:var(--faint)">keine</span>'}</div>`;
}

export function renderBauen() {
  if (!state.planets.size) {
    return emptyState('Noch keine Daten. Füge deine Übersichtsseite oder Gesamtübersicht ein.');
  }
  return `
    <div class="section">
      <h2>🛡 Speichersicherheit (24 h)</h2>
      ${safety24h()}
    </div>
    <div class="section">
      <h2>⬢ Laufende Bauaufträge</h2>
      <div class="desc">Countdown bis zum Abschluss, live gegen die Serverzeit.</div>
      ${orders()}
    </div>
    <div class="section">
      <h2>◇ Freie Kapazität</h2>
      <div class="desc">Wo du sofort etwas starten kannst.</div>
      ${capacity()}
    </div>
    <div class="section">
      <h2>✷ Forschung</h2>
      ${research()}
    </div>
    <details class="fold">
      <summary>Vollständige Gebäude-Matrix (${BUILDINGS.length} Gebäude × ${(state.gesamt?.planets || []).length} Planeten)</summary>
      <div class="fbody">${fullMatrix()}</div>
    </details>`;
}
