// Tab "Bauen & Forschen": Aktions-Panel (laufende Aufträge + freie Kapazität)
// und die aufklappbare vollständige Gebäude-Matrix.
import { state, serverNow } from '../state.js';
import { freeCapacity } from '../analysis.js';
import { coordChip, esc } from '../util/time.js';
import { BUILDINGS, deLabel } from '../domain.js';
import { matrix, emptyState } from './components.js';

const lvlOf = (v) => (v && typeof v === 'object' ? v.level : v);

function orders() {
  const list = state.buildOrders;
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
