// Auswertung des Beute-Archivs. Reine Rechenlogik ohne DOM und ohne
// Netzzugriff — Eingabe sind die Zeilen der View `farm_loot_daily`
// ({day:'YYYY-MM-DD', origin, iron, lutinum, water, hydrogen, total, reports}).

export const RESOURCES = [
  ['iron', 'Eisen', '#f0a35e'],
  ['lutinum', 'Lutinum', '#8ecbff'],
  ['water', 'Wasser', '#5ee0c0'],
  ['hydrogen', 'Wasserstoff', '#c39bff'],
];

/** Farbrad für Planeten-Stapel — reicht für weit mehr Kolonien als möglich. */
const PLANET_COLORS = ['#8ecbff', '#f0a35e', '#5ee0c0', '#c39bff', '#ff8fa3',
  '#ffe082', '#7ee787', '#79c0ff', '#d2a8ff', '#ffab70'];

const DAY = 86400e3;
const dayToMs = (day) => Date.parse(`${day}T00:00:00Z`);
const msToDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Alle Tage von der ersten bis zur letzten Beute — auch die leeren.
 * Ohne Lücken sagt das Diagramm die Wahrheit über Pausen.
 */
export function dayAxis(rows, today = null) {
  const days = rows.map((r) => r.day).filter(Boolean).sort();
  if (!days.length) return [];
  const from = dayToMs(days[0]);
  const to = Math.max(dayToMs(days.at(-1)), today ? dayToMs(today) : -Infinity);
  const out = [];
  for (let ms = from; ms <= to && out.length < 400; ms += DAY) out.push(msToDay(ms));
  return out;
}

/** Gemeinsame Form für das Diagramm: Legendenschlüssel + Balken je Tag. */
function stack(rows, days, keys, valueOf) {
  const byDay = new Map(days.map((day) => [day, Object.create(null)]));
  for (const row of rows) {
    const bucket = byDay.get(row.day);
    if (!bucket) continue;
    for (const { key } of keys) bucket[key] = (bucket[key] || 0) + (valueOf(row, key) || 0);
  }
  return {
    keys,
    bars: days.map((day) => {
      const values = byDay.get(day) || {};
      const total = keys.reduce((sum, k) => sum + (values[k.key] || 0), 0);
      return { label: day, values, total };
    }),
  };
}

/** Tagesbeute, gestapelt nach Rohstoff. */
export function stackByResource(rows, today = null) {
  const days = dayAxis(rows, today);
  const keys = RESOURCES.map(([key, label, color]) => ({ key, label, color }));
  return stack(rows, days, keys, (row, key) => row[key]);
}

/**
 * Tagesbeute, gestapelt nach eigenem Planeten. Nur die ertragreichsten
 * Planeten bekommen eine eigene Farbe, der Rest wandert in "Weitere".
 */
export function stackByOrigin(rows, today = null, max = 8) {
  const days = dayAxis(rows, today);
  const sums = new Map();
  for (const row of rows) sums.set(row.origin, (sums.get(row.origin) || 0) + (row.total || 0));
  const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]).map(([origin]) => origin);
  const top = new Set(ranked.slice(0, max));
  const rest = ranked.length > max;
  const keys = ranked.slice(0, max).map((origin, i) => ({
    key: origin, label: origin, color: PLANET_COLORS[i % PLANET_COLORS.length],
  }));
  if (rest) keys.push({ key: '__rest', label: `Weitere (${ranked.length - max})`, color: '#6b7a90' });
  const bucketOf = (origin) => (top.has(origin) ? origin : '__rest');
  return stack(rows, days, keys, (row, key) => (bucketOf(row.origin) === key ? row.total : 0));
}

/**
 * Farmatlas aus dem Archiv statt aus dem letzten Paste. Liefert bewusst
 * dieselbe Form wie farmSummary(), damit die Ansicht nicht zweigleisig
 * fahren muss — nur eben über *alle* je gefarmten Ziele, auch die, die im
 * aktuellen Berichtsblatt gar nicht mehr auftauchen.
 */
export function archiveFarms(targets, reference = new Date()) {
  const todayStart = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  const n = (v) => Number(v || 0);
  const farms = targets.map((t) => {
    const at = t.last_at ? Date.parse(t.last_at) : null;
    return {
      target: t.target,
      player: t.target_player || 'Unbekannt',
      at,
      // "total" ist die Beute des jüngsten Angriffs — dieselbe Bedeutung
      // wie beim Paste-Atlas, damit die Zeilen vergleichbar bleiben.
      total: n(t.last_total),
      resources: {
        iron: n(t.last_iron), lutinum: n(t.last_lutinum),
        water: n(t.last_water), hydrogen: n(t.last_hydrogen),
      },
      avg: n(t.avg_total),
      best: n(t.best_total),
      sum: n(t.total),
      reports: n(t.reports),
      origin: t.last_origin || null,
      // Über die Sommerzeit-Umstellung ist ein Tag mal 23 oder 25 Stunden
      // lang — deshalb runden statt abschneiden.
      idleDays: at == null ? null : Math.round((todayStart - new Date(at).setHours(0, 0, 0, 0)) / DAY),
    };
  });
  // Über mehrere Angriffe hinweg sagt der Schnitt mehr als der letzte Zufall.
  const ranked = [...farms].sort((a, b) => b.avg - a.avg || b.total - a.total);
  return {
    source: 'archiv',
    reports: farms.reduce((sum, f) => sum + f.reports, 0),
    farms: ranked,
    attackedToday: ranked.filter((f) => f.at != null && f.at >= todayStart),
    notAttackedToday: ranked.filter((f) => f.at == null || f.at < todayStart),
  };
}

/** Missionen, die eine Farm tatsächlich abernten (Spionage zählt nicht). */
const ATTACK_MISSIONS = new Set(['Angriff', 'Zerstören']);

/**
 * Welche Farmen gerade angeflogen werden — aus den Flotten der
 * Übersichtsseite. Ein laufender Anflug bedeutet: nicht nochmal losschicken.
 * Ein Rückflug von einer Farm bedeutet: der Angriff ist längst gelaufen, der
 * Bericht dazu wurde nur noch nicht eingefügt.
 * @returns Map coord -> {kind:'hin'|'rueck', at, mission}
 */
export function farmFlights(fleets = [], ownPlanets = new Set()) {
  const map = new Map();
  for (const f of fleets) {
    if (!f.own) continue;
    let coord = null, kind = null;
    if (f.section === 'rueck') { coord = f.start; kind = 'rueck'; }
    else if (ATTACK_MISSIONS.has(f.mission)) { coord = f.ziel; kind = 'hin'; }
    if (!coord || ownPlanets.has(coord)) continue;
    const prev = map.get(coord);
    // Der laufende Anflug ist die wichtigere Nachricht als ein Rückflug;
    // bei gleicher Art gewinnt die früher eintreffende Flotte.
    const better = !prev
      || (kind === 'hin' && prev.kind === 'rueck')
      || (kind === prev.kind && (f.at ?? Infinity) < (prev.at ?? Infinity));
    if (better) map.set(coord, { kind, at: f.at ?? null, mission: f.mission });
  }
  return map;
}

/** Kopfzahlen über dem Diagramm. */
export function lootStats(rows, today = msToDay(Date.now())) {  const perDay = new Map();
  const byResource = { iron: 0, lutinum: 0, water: 0, hydrogen: 0 };
  let total = 0, reports = 0;
  const origins = new Set();
  for (const row of rows) {
    perDay.set(row.day, (perDay.get(row.day) || 0) + (row.total || 0));
    for (const [key] of RESOURCES) byResource[key] += row[key] || 0;
    total += row.total || 0;
    reports += row.reports || 0;
    if (row.origin) origins.add(row.origin);
  }
  const from7 = msToDay(dayToMs(today) - 6 * DAY);
  let last7 = 0;
  for (const [day, value] of perDay) if (day >= from7) last7 += value;
  const best = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const activeDays = [...perDay.values()].filter((v) => v > 0).length;
  return {
    total, reports, byResource, origins: origins.size,
    days: perDay.size, activeDays,
    last7, todayLoot: perDay.get(today) || 0,
    perDayAvg: activeDays ? Math.round(total / activeDays) : 0,
    bestDay: best ? { day: best[0], total: best[1] } : null,
  };
}
