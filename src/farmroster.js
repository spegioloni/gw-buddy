// Farmliste: bewerten, was die belegten Plätze wirklich bringen, und
// vorschlagen, was ausgetauscht gehört. Rein funktional (kein State, kein
// DOM) — damit in Node testbar.
import { coordParts, distance } from './radar.js';

/** Schwellen der Bewertung. Bewusst großzügig: lieber spät aussortieren. */
export const ROSTER_DEFAULTS = {
  graceDays: 3,      // so lange bleibt ein frisches Ziel unbewertet
  weakShare: 0.4,    // unter 40 % des Median-Ertrags gilt als schwach
  wakeHours: 24,     // darunter gilt der Besitzer als wieder aktiv
  coldHours: 96,     // so lange nicht mehr angeflogen = vergessen
};

const numOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Was ein einzelner Anflug bringt — die Zahl, nach der die Liste sortiert
 * ist. Ohne eigene Flüge seit der Aufnahme zählt der Schnitt aus dem
 * Beute-Archiv: ein gerade aufgenommenes Ziel soll nicht bloß deshalb ganz
 * unten stehen, weil noch kein eigener Bericht vorliegt.
 */
export function avgPerFlight(row) {
  return row.reports ? row.avg : (row.lifeReports ? row.lifeAvg : 0);
}

/** Zeilen aus `farm_roster_stats` in eine handliche Form bringen. */
export function normalizeRoster(rows) {
  return (rows || []).map((r) => ({
    origin: String(r.origin || ''),
    target: String(r.target || ''),
    player: r.target_player || '',
    note: r.slot_note || '',
    active: r.active !== false,
    addedAt: r.added_at ? Date.parse(r.added_at) : null,
    removedAt: r.removed_at ? Date.parse(r.removed_at) : null,
    dropReason: r.drop_reason || '',
    reports: numOr(r.reports),
    total: numOr(r.total),
    avg: numOr(r.avg_total),
    best: numOr(r.best_total),
    last: numOr(r.last_total),
    perDay: numOr(r.per_day),
    daysListed: numOr(r.days_listed),
    hoursSinceLast: r.hours_since_last == null ? null : numOr(r.hours_since_last),
    lastAt: r.last_at ? Date.parse(r.last_at) : null,
    firstAt: r.first_at ? Date.parse(r.first_at) : null,
    res: {
      iron: numOr(r.iron), lutinum: numOr(r.lutinum),
      water: numOr(r.water), hydrogen: numOr(r.hydrogen),
    },
    lifeReports: numOr(r.life_reports),
    lifeTotal: numOr(r.life_total),
    lifeAvg: numOr(r.life_avg),
    lifeBest: numOr(r.life_best),
    lifeLast: numOr(r.life_last),
    lifeLastAt: r.life_last_at ? Date.parse(r.life_last_at) : null,
    planetPoints: numOr(r.planet_points),
    playerIdleHours: r.player_idle_hours == null ? null : numOr(r.player_idle_hours),
    // Ältere Schemastände kennen die Spalte nicht — dann gilt die Uhr als
    // belegt, damit sich das Verhalten nicht stillschweigend ändert.
    idleConfirmed: r.idle_confirmed !== false,
    planetIdleHours: r.planet_idle_hours == null ? null : numOr(r.planet_idle_hours),
    totalPoints: numOr(r.total_points),
    planetCount: r.planet_count == null ? null : numOr(r.planet_count),
    alliance: r.alliance || null,
  }));
}

/**
 * Aufteilung der Beute auf die vier Rohstoffe — als Anteil, damit man sieht,
 * ob eine Farm vor allem Wasserstoff liefert (Flottenbau) oder Eisen (Bau).
 */
export const RESOURCES = [
  { key: 'iron', label: 'Ei' },
  { key: 'lutinum', label: 'Lu' },
  { key: 'water', label: 'Wa' },
  { key: 'hydrogen', label: 'H' },
];

export function resShare(res) {
  const sum = RESOURCES.reduce((n, r) => n + (res?.[r.key] || 0), 0);
  return RESOURCES.map((r) => ({
    ...r,
    value: res?.[r.key] || 0,
    share: sum ? (res[r.key] || 0) / sum : 0,
  }));
}

/**
 * Läuft die Farm leer? Der letzte Flug im Verhältnis zum eigenen Schnitt.
 * Unter 60 % heißt: die Lager sind abgeerntet, das Ziel gibt gerade weniger
 * her als gewohnt — der klassische Grund, eine Farm zu tauschen.
 */
export function trendOf(row) {
  if (!row.reports || !row.avg || !row.last) return null;
  const ratio = row.last / row.avg;
  const pct = Math.round(ratio * 100);
  if (ratio >= 1.25) return { dir: 'up', pct, label: `letzter Flug ${pct} % vom Schnitt` };
  if (ratio <= 0.6) return { dir: 'down', pct, label: `letzter Flug nur ${pct} % vom Schnitt` };
  return { dir: 'flat', pct, label: `letzter Flug ${pct} % vom Schnitt` };
}

/** Median des Tagesertrags — der Maßstab, an dem sich der Rest messen muss. */
export function medianPerDay(list) {
  const vals = list.map((r) => r.perDay).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
}

/**
 * Zustand eines Listenplatzes.
 *
 * `wach`   — der Besitzer spielt wieder: sofort raus, das kostet nur Schiffe.
 * `leer`   — seit Tagen im Plan, aber nie angeflogen.
 * `schwach`— bringt deutlich weniger als der Rest der Liste.
 * `kalt`   — lange nicht mehr besucht; entweder nachholen oder streichen.
 * `neu`    — noch in der Schonfrist, dafür gibt es keine Zahlen.
 * `stark`  — trägt die Runde.
 *
 * „wach" setzt eine *belegte* Punkteänderung voraus. Nach dem ersten Import
 * steht die Inaktivitätsuhr jedes Spielers auf null, weil vorher niemand
 * hingesehen hat — das ist kein Aufwachen, sondern schlicht Unwissen.
 */
export function rosterHealth(row, median, opts = {}) {
  const o = { ...ROSTER_DEFAULTS, ...opts };
  if (row.idleConfirmed !== false && row.playerIdleHours != null && row.playerIdleHours < o.wakeHours) {
    return {
      state: 'wach',
      reason: `Punkte vor ${row.playerIdleHours} h bewegt (Schwelle ${o.wakeHours} h)`,
      drop: true,
    };
  }
  if (row.daysListed < o.graceDays) {
    return { state: 'neu', reason: `erst ${row.daysListed} T in der Liste`, drop: false };
  }
  if (!row.reports) {
    return { state: 'leer', reason: `${row.daysListed} T dabei, nie angeflogen`, drop: true };
  }
  if (median > 0 && row.perDay < median * o.weakShare) {
    return { state: 'schwach', reason: `nur ${Math.round((row.perDay / median) * 100)} % des Medians`, drop: true };
  }
  if (row.hoursSinceLast != null && row.hoursSinceLast > o.coldHours) {
    return { state: 'kalt', reason: `seit ${Math.floor(row.hoursSinceLast / 24)} T nicht angeflogen`, drop: false };
  }
  return {
    state: 'stark',
    reason: median > 0 ? `${Math.round((row.perDay / median) * 100)} % des Medians` : 'trägt die Runde',
    drop: false,
  };
}

/**
 * Die Farmliste eines Planeten, sortiert nach Ertrag je Flug, samt Bewertung
 * und Belegung. `over` ist die Zahl der Plätze, die über der Kapazität
 * liegen — dann muss zwingend etwas weichen.
 */
export function rosterFor(rows, origin, slots = 0, opts = {}) {
  const all = normalizeRoster(rows).filter((r) => !origin || r.origin === origin);
  const active = all.filter((r) => r.active)
    .sort((a, b) => avgPerFlight(b) - avgPerFlight(a) || b.perDay - a.perDay || b.total - a.total);
  const dropped = all.filter((r) => !r.active).sort((a, b) => (b.removedAt || 0) - (a.removedAt || 0));
  const median = medianPerDay(active.filter((r) => r.reports));
  for (const row of active) row.health = rosterHealth(row, median, opts);
  return {
    active, dropped, median,
    slots,
    free: Math.max(0, slots - active.length),
    over: Math.max(0, active.length - slots),
    weak: active.filter((r) => r.health.drop),
    total: active.reduce((sum, r) => sum + r.total, 0),
    perDay: active.reduce((sum, r) => sum + r.perDay, 0),
  };
}

/**
 * Wo steht ein Ziel schon? Koordinate -> Belegung über ALLE Planeten hinweg.
 * Der Radar braucht das, um nicht dasselbe Ziel ein zweites Mal
 * vorzuschlagen — eine Farm, die von 12:101:5 aus bedient wird, ist auch
 * von 12:99:1 aus keine freie Beute mehr.
 */
export function rosterIndex(rows) {
  const map = new Map();
  for (const r of normalizeRoster(rows)) {
    if (!r.target) continue;
    const e = map.get(r.target) || { active: [], dropped: [] };
    (r.active ? e.active : e.dropped).push(r.origin);
    map.set(r.target, e);
  }
  return map;
}

/**
 * Austauschvorschlag: so viele Radar-Kandidaten, wie freie Plätze da sind —
 * plus einen Ersatz für jeden schwachen Platz. Schon gelistete Ziele
 * (auch früher abgelegte) fallen raus, sonst dreht man sich im Kreis.
 */
export function suggestSwaps(view, candidates, opts = {}) {
  const known = new Set([...view.active, ...view.dropped].map((r) => r.target));
  const room = view.free + view.weak.length + view.over;
  const fresh = (candidates || [])
    .filter((c) => c.coord && !known.has(c.coord))
    .slice(0, Math.max(0, room));
  return { room, add: fresh, drop: [...view.weak].sort((a, b) => a.perDay - b.perDay) };
}

/**
 * Reihenfolge fürs Anfliegen: nach Ertrag je Flug, bei Gleichstand nach
 * Tagesertrag und dann näher zuerst. Das ist die Sortierung, in der die
 * Liste angezeigt und exportiert wird.
 */
export function flightOrder(list, origin) {
  const from = coordParts(origin);
  return [...list].sort((a, b) => avgPerFlight(b) - avgPerFlight(a)
    || (b.perDay || 0) - (a.perDay || 0)
    || (from ? distance(a.target, from) - distance(b.target, from) : 0)
    || a.target.localeCompare(b.target));
}
