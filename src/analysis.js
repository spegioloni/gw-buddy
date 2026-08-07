// Ableitungen aus dem State: Bedrohungen, Save-Fenster, freie Kapazität,
// gemeinsame Zeitachse (Flotten + Bau-/Forschungsabschlüsse).
import { state, serverNow } from './state.js';

/** Pro Zielplanet: Angriffe, Spionage, eigene Ankünfte, Save-Fenster. */
export function threatAnalysis() {
  const byPlanet = new Map();
  for (const e of state.fleets) {
    if (!byPlanet.has(e.ziel)) byPlanet.set(e.ziel, []);
    byPlanet.get(e.ziel).push(e);
  }
  const out = [];
  for (const [coord, evs] of byPlanet) {
    evs.sort((a, b) => a.at - b.at);
    const attacks = evs.filter((e) => e.hostile);
    const spies = evs.filter((e) => e.spy);
    const arrivals = evs.filter((e) => e.own);
    const windows = [];
    for (const a of arrivals) {
      const next = attacks.find((x) => x.at > a.at);
      const prev = [...attacks].reverse().find((x) => x.at <= a.at);
      windows.push({
        arrival: a, nextAttack: next || null, prevAttack: prev || null,
        gapSec: next ? (next.at - a.at) / 1000 : null, tooLate: !next && !!prev,
      });
    }
    windows.sort((x, y) => x.arrival.at - y.arrival.at);
    const planet = state.planets.get(coord) || null;
    out.push({
      coord, planet, mine: state.ownPlanets.has(coord),
      events: evs, attacks, spies, arrivals, windows,
      firstAttack: attacks[0] || null,
      lastAttack: attacks.length ? attacks[attacks.length - 1] : null,
      stationed: planet ? stationedSummary(planet) : null,
    });
  }
  out.sort((a, b) => {
    const av = a.attacks.length ? 0 : 1, bv = b.attacks.length ? 0 : 1;
    if (av !== bv) return av - bv;
    return (a.events[0]?.at || 0) - (b.events[0]?.at || 0);
  });
  return out;
}

/** Kurzliste stationierter Schiffe (nur > 0), sortiert nach Menge. */
export function stationedSummary(planet) {
  const ships = Object.entries(planet.ships || {}).filter(([, n]) => n > 0);
  ships.sort((a, b) => b[1] - a[1]);
  const defense = Object.entries(planet.defense || {}).filter(([, n]) => n > 0);
  const total = ships.reduce((s, [, n]) => s + n, 0);
  const defTotal = defense.reduce((s, [, n]) => s + n, 0);
  return { ships, defense, total, defTotal, hasAny: total + defTotal > 0 };
}

/** Planeten mit freier Bau-/Schiffsfabrik-Kapazität. */
export function freeCapacity() {
  const noBuild = [], idleYard = [];
  for (const [coord, p] of state.planets) {
    if (!p.mine) continue;
    if (!p.buildOrder) noBuild.push(coord);
    if (p.shipyardFreeSec == null && ('shipFactory' in p.buildings || state.gesamt)) idleYard.push(coord);
  }
  return { noBuild, idleYard };
}

const TL_TYPES = {
  attack: { label: 'Angriff', icon: '⚔', color: 'threat' },
  spy: { label: 'Spionage', icon: '◎', color: 'own' },
  arrival: { label: 'Ankunft', icon: '▾', color: 'own' },
  rueck: { label: 'Rückflug', icon: '↩', color: 'dim' },
  trade: { label: 'Handel', icon: '⇄', color: 'safe' },
  build: { label: 'Bau fertig', icon: '⬢', color: 'soon' },
  research: { label: 'Forschung fertig', icon: '✷', color: 'brand' },
};
export const timelineTypes = TL_TYPES;

/** Gemeinsame Zeitachse aus Flotten + Bauabschlüssen (+ Forschung, falls vorhanden). */
export function timelineEvents() {
  const out = [];
  for (const e of state.fleets) {
    let type = 'arrival';
    if (e.hostile) type = 'attack';
    else if (e.spy) type = 'spy';
    else if (e.mission === 'Handel') type = 'trade';
    else if (e.section === 'rueck') type = 'rueck';
    out.push({
      at: e.at, type, coord: e.ziel, from: e.start,
      label: e.mission, player: e.player, meta: e,
    });
  }
  for (const b of state.buildOrders) {
    out.push({
      at: b.at, type: 'build', coord: b.coord, from: null,
      label: `${b.name} → Stufe ${b.level}`, meta: b,
    });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** Nächster Feindeinschlag (für den Lage-Held). */
export function nextImpact() {
  const now = serverNow();
  return state.fleets
    .filter((e) => e.hostile && e.at >= now - 1000)
    .sort((a, b) => a.at - b.at)[0] || null;
}
