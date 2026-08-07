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

/* ---------- Online-/Save-Fenster ---------- */

// Vorlaufzeit: so lange vor einem Einschlag musst du online sein, um zu saven.
export const SAVE_LEAD_SEC = 600;
// Zwei Fenster, die enger als das beieinander liegen, werden zu einer Session.
const MERGE_GAP_SEC = 900;
// Eigene Landung so kurz vor einem Einschlag = die Flotte steht im Feuer.
const LANDING_RISK_SEC = 900;

/** Feindliche Einschläge auf eigenen Planeten, chronologisch, ab jetzt. */
function futureImpacts(now) {
  return state.fleets
    .filter((e) => e.hostile && e.at >= now - 1000 && state.ownPlanets.has(e.ziel))
    .sort((a, b) => a.at - b.at);
}

/**
 * Zusammenhängende Zeitbereiche, in denen du online sein musst, um zu saven.
 * Einschläge, die dicht beieinander liegen, werden zu einer Session gebündelt.
 * @returns {Array<{from,to,impacts,coords,level,durationSec,startsInSec,
 *   stationedCoords,landings,builds,gapBeforeSec}>}
 */
export function saveWindows({ leadSec = SAVE_LEAD_SEC } = {}) {
  const now = serverNow();
  const impacts = futureImpacts(now);
  if (!impacts.length) return [];

  const blocks = [];
  for (const imp of impacts) {
    const from = imp.at - leadSec * 1000;
    const last = blocks[blocks.length - 1];
    if (last && from <= last.to + MERGE_GAP_SEC * 1000) {
      last.to = Math.max(last.to, imp.at);
      last.impacts.push(imp);
    } else {
      blocks.push({ from, to: imp.at, impacts: [imp] });
    }
  }

  let prevEnd = null;
  return blocks.map((b) => {
    const coords = [...new Set(b.impacts.map((e) => e.ziel))];
    // Planeten in diesem Fenster, auf denen tatsächlich etwas zu verlieren ist.
    const stationedCoords = coords.filter((c) => {
      const p = state.planets.get(c);
      return p ? stationedSummary(p).hasAny : false;
    });
    // Eigene Flotten, die mitten im Fenster landen — die stehen dann im Feuer.
    const landings = state.fleets.filter(
      (e) => e.own && e.at >= b.from && e.at <= b.to && coords.includes(e.ziel));
    // Bauaufträge, die im Fenster auf einem angegriffenen Planeten fertig werden.
    const builds = state.buildOrders.filter(
      (o) => o.at >= b.from && o.at <= b.to && coords.includes(o.coord));

    const level = stationedCoords.length ? 'critical' : 'warn';
    const gapBeforeSec = prevEnd != null ? (b.from - prevEnd) / 1000 : null;
    prevEnd = b.to;

    return {
      ...b, coords, stationedCoords, landings, builds, level,
      durationSec: (b.to - b.from) / 1000,
      startsInSec: (b.from - now) / 1000,
      endsInSec: (b.to - now) / 1000,
      active: now >= b.from && now <= b.to,
      gapBeforeSec,
    };
  });
}

/**
 * Kritische Stellen als flache, priorisierte Liste — das, was schiefgehen kann.
 * @returns {Array<{kind,at,coord,text,level}>}
 */
export function criticalPoints() {
  const now = serverNow();
  const impacts = futureImpacts(now);
  const out = [];

  for (const imp of impacts) {
    const p = state.planets.get(imp.ziel);
    const st = p ? stationedSummary(p) : null;
    if (st?.hasAny) {
      out.push({
        kind: 'loss', at: imp.at, coord: imp.ziel, level: 'critical',
        text: `${st.total ? `${st.total} Schiffe` : ''}${st.total && st.defTotal ? ' + ' : ''}${st.defTotal ? `${st.defTotal} Verteidigung` : ''} stehen beim Einschlag ungeschützt`,
      });
    }
    // Eigene Flotte landet kurz vor dem Einschlag auf demselben Planeten.
    for (const a of state.fleets) {
      if (!a.own || a.ziel !== imp.ziel) continue;
      const lead = (imp.at - a.at) / 1000;
      if (lead >= 0 && lead <= LANDING_RISK_SEC) {
        out.push({
          kind: 'landing', at: a.at, coord: a.ziel, level: 'critical',
          text: `Eigene Flotte (${a.mission}) landet nur ${Math.round(lead / 60)} min vor dem Einschlag`,
        });
      }
    }
  }

  // Rückflüge, die erst nach dem letzten Angriff ankommen.
  for (const t of threatAnalysis()) {
    if (!t.mine) continue;
    for (const w of t.windows) {
      if (w.tooLate && w.arrival.at >= now - 1000) {
        out.push({
          kind: 'late', at: w.arrival.at, coord: t.coord, level: 'warn',
          text: `Ankunft von ${w.arrival.start} erst nach dem letzten Angriff`,
        });
      }
    }
  }

  // Gleichzeitige Einschläge auf mehreren Planeten (< 2 min auseinander).
  for (let i = 0; i < impacts.length; i++) {
    const clash = impacts.filter(
      (x) => x !== impacts[i] && Math.abs(x.at - impacts[i].at) <= 120e3 && x.ziel !== impacts[i].ziel);
    if (clash.length && impacts[i].at <= (clash[0].at)) {
      out.push({
        kind: 'clash', at: impacts[i].at, coord: impacts[i].ziel, level: 'warn',
        text: `Zeitgleicher Einschlag auf ${clash.length + 1} Planeten — knappe Reihenfolge beim Saven`,
      });
    }
  }

  const seen = new Set();
  const rank = { critical: 0, warn: 1 };
  return out
    .filter((c) => { const k = `${c.kind}|${c.at}|${c.coord}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (rank[a.level] - rank[b.level]) || (a.at - b.at));
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
