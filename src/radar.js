// Farmradar: Entfernungen im Universum und Bewertung inaktiver Ziele.
// Rein funktional (kein State, kein DOM) — damit testbar in Node.

/** Universumsmaße aus den Highscore-Daten (Galaxie:System:Position). */
export const UNIVERSE = { galaxies: 20, systems: 150, positions: 12 };

/** Ein Galaxiesprung wiegt so viel wie das Durchqueren aller Systeme. */
const GALAXY_WEIGHT = UNIVERSE.systems;

/** "12:101:5" -> {galaxy, system, position} | null. */
export function coordParts(coord) {
  const m = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/.exec(String(coord || '').trim());
  return m ? { galaxy: +m[1], system: +m[2], position: +m[3] } : null;
}

/**
 * Entfernung zweier Koordinaten als eine Zahl. Innerhalb einer Galaxie ist
 * das schlicht der Systemabstand; die Position zählt nur als Tiebreaker.
 */
export function distance(a, b) {
  const x = typeof a === 'string' ? coordParts(a) : a;
  const y = typeof b === 'string' ? coordParts(b) : b;
  if (!x || !y) return Infinity;
  return Math.abs(x.galaxy - y.galaxy) * GALAXY_WEIGHT
    + Math.abs(x.system - y.system)
    + Math.abs(x.position - y.position) / 100;
}

/** Nächstgelegener eigener Planet zu einem Ziel. */
export function nearestOwn(target, ownCoords) {
  let best = null;
  for (const own of ownCoords || []) {
    const d = distance(target, own);
    if (best == null || d < best.distance) best = { coord: own, distance: d };
  }
  return best;
}

/**
 * Kandidaten filtern und bewerten.
 *
 * @param rows  Zeilen aus der Supabase-View `inactive_farms`
 * @param opts  {own:string[], idleDays:number, maxSystems:number,
 *               sameGalaxyOnly:boolean, maxPoints:number|null,
 *               excludeOwners:string[]}
 */
export function rankFarms(rows, opts = {}) {
  const {
    own = [], idleDays = 3, maxSystems = 20, sameGalaxyOnly = true,
    maxPoints = null, excludeOwners = [],
  } = opts;
  const ownParts = own.map(coordParts).filter(Boolean);
  const skip = new Set(excludeOwners.map((n) => String(n).toLowerCase()));
  const out = [];

  for (const row of rows || []) {
    if (!row || row.galaxy == null) continue;
    if (skip.has(String(row.owner_name || '').toLowerCase())) continue;
    const idle = row.player_idle_days ?? 0;
    if (idle < idleDays) continue;
    if (maxPoints != null && (row.total_points ?? 0) > maxPoints) continue;

    const target = { galaxy: row.galaxy, system: row.system, position: row.position };
    const candidates = sameGalaxyOnly
      ? ownParts.filter((o) => o.galaxy === target.galaxy)
      : ownParts;
    if (!candidates.length) continue;

    const near = nearestOwn(target, candidates);
    const systemGap = Math.min(...candidates
      .filter((o) => o.galaxy === target.galaxy)
      .map((o) => Math.abs(o.system - target.system)), Infinity);
    if (sameGalaxyOnly && systemGap > maxSystems) continue;
    if (!sameGalaxyOnly && near.distance > maxSystems) continue;

    // Wert = Planetenpunkte (Größe der Farm), gedämpft durch die Entfernung,
    // verstärkt durch die Dauer der Inaktivität.
    const proximity = 1 / (1 + near.distance / 10);
    const idleBoost = Math.min(2, idle / Math.max(1, idleDays));
    out.push({
      ...row,
      coord: `${target.galaxy}:${target.system}:${target.position}`,
      nearestOwn: near.coord ? `${near.coord.galaxy}:${near.coord.system}:${near.coord.position}` : null,
      distance: near.distance,
      systemGap: Number.isFinite(systemGap) ? systemGap : null,
      idleDays: idle,
      score: Math.round((row.points ?? 0) * proximity * idleBoost),
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
