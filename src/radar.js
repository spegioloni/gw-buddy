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
 * Index der bereits gefarmten Ziele: Koordinate -> Angriffszahlen.
 * Quelle sind die Zeilen der View `farm_loot_targets` (Beute-Archiv).
 * Ältere Schemastände kennen `avg_total` noch nicht — dann wird der Schnitt
 * aus Summe und Anzahl gerechnet.
 */
export function attackIndex(targets) {
  const map = new Map();
  for (const t of targets || []) {
    const coord = String(t?.target || '').trim();
    if (!coordParts(coord)) continue;
    const reports = Number(t.reports || 0);
    const total = Number(t.total || 0);
    const avg = t.avg_total != null ? Number(t.avg_total)
      : reports ? Math.round(total / reports) : 0;
    map.set(coord, {
      reports, total, avg,
      best: Number(t.best_total || 0),
      last: Number(t.last_total || 0),
      firstAt: t.first_at ? Date.parse(t.first_at) : null,
      lastAt: t.last_at ? Date.parse(t.last_at) : null,
    });
  }
  return map;
}

/** Beginn des laufenden Tages (lokal) — dieselbe Grenze wie im Farmatlas. */
export const dayStart = (reference = new Date()) =>
  new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();

/**
 * Kandidaten filtern und bewerten.
 *
 * @param rows  Zeilen aus der Supabase-View `inactive_farms`
 * @param opts  {own:string[], mine:string[], idleHours:number, maxSystems:number,
 *               sameGalaxyOnly:boolean, maxPoints:number|null,
 *               excludeOwners:string[], attacks:Map, onlyUntouched:boolean,
 *               notToday:boolean, now:Date}
 */
export function rankFarms(rows, opts = {}) {
  const {
    own = [], mine = own, idleHours = 72, maxSystems = 20, sameGalaxyOnly = true,
    maxPoints = null, excludeOwners = [],
    attacks = null, onlyUntouched = false, notToday = false, now = new Date(),
  } = opts;
  const ownParts = own.map(coordParts).filter(Boolean);
  // Eigene Planeten sind keine Farmen. Neben den bekannten Koordinaten fliegt
  // auch alles raus, was demselben Spieler gehört — sonst tauchen die eigenen
  // Kolonien auf, sobald eine davon noch nicht in der Übersicht stand.
  const ownCoords = new Set(mine.map((c) => String(c).trim()).filter(Boolean));
  const skip = new Set(excludeOwners.map((n) => String(n).toLowerCase()));
  for (const row of rows || []) {
    if (!row || row.galaxy == null) continue;
    if (ownCoords.has(`${row.galaxy}:${row.system}:${row.position}`) && row.owner_name) {
      skip.add(String(row.owner_name).toLowerCase());
    }
  }
  const today = dayStart(now);
  const out = [];

  for (const row of rows || []) {
    if (!row || row.galaxy == null) continue;
    if (ownCoords.has(`${row.galaxy}:${row.system}:${row.position}`)) continue;
    if (skip.has(String(row.owner_name || '').toLowerCase())) continue;
    // Stunden sind die feinere Wahrheit; ältere Zeilen (oder eine noch nicht
    // aktualisierte View) liefern nur ganze Tage.
    const idle = row.player_idle_hours ?? (row.player_idle_days ?? 0) * 24;
    if (idle < idleHours) continue;
    if (maxPoints != null && (row.total_points ?? 0) > maxPoints) continue;

    const target = { galaxy: row.galaxy, system: row.system, position: row.position };
    const coord = `${target.galaxy}:${target.system}:${target.position}`;

    // Schon bekannte Farmen: ausblenden, sobald der jeweilige Schalter steht.
    const attack = attacks?.get(coord) || null;
    if (onlyUntouched && attack && attack.reports > 0) continue;
    if (notToday && attack?.lastAt != null && attack.lastAt >= today) continue;

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
    const idleBoost = Math.min(2, idle / Math.max(1, idleHours));
    out.push({
      ...row,
      coord,
      nearestOwn: near.coord ? `${near.coord.galaxy}:${near.coord.system}:${near.coord.position}` : null,
      distance: near.distance,
      systemGap: Number.isFinite(systemGap) ? systemGap : null,
      idleHours: idle,
      idleDays: Math.floor(idle / 24),
      attack,
      attackedToday: attack?.lastAt != null && attack.lastAt >= today,
      score: Math.round((row.points ?? 0) * proximity * idleBoost),
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Ziele aus Kampfberichten, die in der Highscore-Liste gar nicht auftauchen
 * — allen voran NPC-Dörfer/-Stützpunkte: sie gehören keinem Spieler und
 * bleiben deshalb im `inactive_farms`-Radar unsichtbar, obwohl das
 * Beute-Archiv sie längst als lohnendes Ziel kennt.
 *
 * @param targets  Zeilen aus dem Beute-Archiv (View `farm_loot_targets`
 *                 oder die gleichwertige Form aus den eingefügten Berichten)
 * @param opts     {radarRows, own:string[], mine:string[], maxSystems,
 *                  sameGalaxyOnly}
 */
export function npcCandidates(targets, opts = {}) {
  const {
    radarRows = [], own = [], mine = own,
    maxSystems = 20, sameGalaxyOnly = true,
  } = opts;
  // Alles, was die Highscore-Liste schon als Koordinate kennt, ist per
  // Definition kein „unbekanntes" Ziel mehr — egal ob aktiv, inaktiv oder
  // eigen.
  const known = new Set((radarRows || [])
    .filter((r) => r && r.galaxy != null)
    .map((r) => `${r.galaxy}:${r.system}:${r.position}`));
  const ownParts = own.map(coordParts).filter(Boolean);
  const ownCoords = new Set(mine.map((c) => String(c).trim()).filter(Boolean));
  const out = [];

  for (const t of targets || []) {
    const coord = String(t?.target || '').trim();
    const parts = coordParts(coord);
    if (!parts) continue;
    if (known.has(coord) || ownCoords.has(coord)) continue;

    const candidates = sameGalaxyOnly
      ? ownParts.filter((o) => o.galaxy === parts.galaxy)
      : ownParts;
    if (!candidates.length) continue;

    const near = nearestOwn(parts, candidates);
    const systemGap = Math.min(...candidates
      .filter((o) => o.galaxy === parts.galaxy)
      .map((o) => Math.abs(o.system - parts.system)), Infinity);
    if (sameGalaxyOnly && systemGap > maxSystems) continue;
    if (!sameGalaxyOnly && near.distance > maxSystems) continue;

    const reports = Number(t.reports || 0);
    const total = Number(t.total || 0);
    const avg = t.avg_total != null ? Number(t.avg_total) : (reports ? Math.round(total / reports) : 0);
    out.push({
      coord,
      owner_name: t.target_player || 'NPC',
      points: 0,
      nearestOwn: near.coord ? `${near.coord.galaxy}:${near.coord.system}:${near.coord.position}` : null,
      distance: near.distance,
      systemGap: Number.isFinite(systemGap) ? systemGap : null,
      npc: true,
      attack: {
        reports, total, avg,
        best: Number(t.best_total || 0),
        last: Number(t.last_total || 0),
        lastAt: t.last_at ? Date.parse(t.last_at) : null,
      },
      attackedToday: false,
      score: avg,
    });
  }

  out.sort((a, b) => b.attack.avg - a.attack.avg || b.attack.total - a.attack.total);
  return out;
}

/**
 * Farmenliste fürs JSON: [["12:68:5","Manor"], …] in Universumsreihenfolge
 * (Galaxie, System, Position, Name). Doppelte Paare fallen raus, Zeilen ohne
 * brauchbare Koordinate ebenfalls. Namen bleiben so stehen, wie sie im
 * Highscore standen — auch leer, denn die Koordinate ist das Ziel.
 */
export function farmExportPairs(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const coord = row?.coord
      || (row?.galaxy != null ? `${row.galaxy}:${row.system}:${row.position}` : row?.target || row);
    const parts = coordParts(coord);
    if (!parts) continue;
    const name = String(row?.owner_name ?? row?.target_player ?? row?.name ?? '').trim();
    const key = `${coord}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ parts, pair: [String(coord), name] });
  }
  out.sort((a, b) => a.parts.galaxy - b.parts.galaxy
    || a.parts.system - b.parts.system
    || a.parts.position - b.parts.position
    || a.pair[1].localeCompare(b.pair[1], 'de'));
  return out.map((o) => o.pair);
}

/**
 * Dateiname des Exports: "Farmen-18-08-2026.json". Ist ein einzelner eigener
 * Planet der Bezugspunkt, steht er mit drin — üblicherweise wird je Planet
 * exportiert, und im Downloadordner sollen die Listen unterscheidbar sein.
 */
export function farmExportName(origin = '', date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${p(date.getDate())}-${p(date.getMonth() + 1)}-${date.getFullYear()}`;
  const parts = coordParts(origin);
  const planet = parts ? `-${parts.galaxy}_${parts.system}_${parts.position}` : '';
  return `Farmen${planet}-${stamp}.json`;
}

/** Stunden lesbar machen: "6 h", "1 T 3 h", "9 T". */
export function formatIdle(hours) {
  const h = Math.max(0, Math.round(hours || 0));
  if (h < 48) return `${h} h`;
  const days = Math.floor(h / 24);
  const rest = h % 24;
  return rest ? `${days} T ${rest} h` : `${days} T`;
}
