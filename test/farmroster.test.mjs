// Bewertung und Austausch der Farmliste. Start: node test/farmroster.test.mjs
import { normalizeRoster, medianPerDay, rosterHealth, rosterFor, suggestSwaps, flightOrder, resShare, trendOf } from '../src/farmroster.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400e3).toISOString();

// Zeilen, wie sie die View farm_roster_stats liefert (bigint kommt als Text).
const rows = [
  { origin: '12:101:5', target: '12:104:3', target_player: 'Traeger', active: true, added_at: iso(10),
    reports: 10, total: '900000', avg_total: '90000', per_day: '90000', days_listed: 10,
    hours_since_last: 5, player_idle_hours: 500, planet_points: '4000' },
  { origin: '12:101:5', target: '12:105:1', target_player: 'Schwach', active: true, added_at: iso(10),
    reports: 4, total: '80000', avg_total: '20000', per_day: '8000', days_listed: 10,
    hours_since_last: 30, player_idle_hours: 400, planet_points: '900' },
  { origin: '12:101:5', target: '12:106:2', target_player: 'Nie', active: true, added_at: iso(8),
    reports: 0, total: '0', avg_total: '0', per_day: '0', days_listed: 8,
    hours_since_last: null, player_idle_hours: 300, planet_points: '700' },
  { origin: '12:101:5', target: '12:107:4', target_player: 'Frisch', active: true, added_at: iso(1),
    reports: 0, total: '0', avg_total: '0', per_day: '0', days_listed: 1,
    hours_since_last: null, player_idle_hours: 200, planet_points: '2000' },
  { origin: '12:101:5', target: '12:108:9', target_player: 'Wachauf', active: true, added_at: iso(9),
    reports: 6, total: '600000', avg_total: '100000', per_day: '66667', days_listed: 9,
    hours_since_last: 12, player_idle_hours: 2, planet_points: '5000' },
  { origin: '12:101:5', target: '12:44:1', target_player: 'Weg', active: false, added_at: iso(30),
    removed_at: iso(2), drop_reason: 'kein Ertrag', reports: 1, total: '1000', avg_total: '1000',
    per_day: '30', days_listed: 30, hours_since_last: 400, player_idle_hours: 900, planet_points: '100' },
  { origin: '12:99:1', target: '12:98:2', target_player: 'AndererPlanet', active: true, added_at: iso(5),
    reports: 3, total: '30000', avg_total: '10000', per_day: '6000', days_listed: 5,
    hours_since_last: 10, player_idle_hours: 700, planet_points: '800' },
];

// ---------- Normalisierung ----------
const norm = normalizeRoster(rows);
ok(norm.length === 7, 'alle Zeilen übernommen, got ' + norm.length);
ok(norm[0].total === 900000 && norm[0].perDay === 90000, 'bigint-Text wird zur Zahl');
ok(norm[3].hoursSinceLast === null, 'nie angeflogen bleibt null, got ' + norm[3].hoursSinceLast);
ok(normalizeRoster(null).length === 0, 'ohne Zeilen leeres Ergebnis');

// ---------- Kennzahlen der Karte ----------
const statRow = normalizeRoster([{
  origin: '12:101:5', target: '12:104:3', active: true, added_at: iso(4),
  reports: 4, total: '400000', avg_total: '100000', best_total: '250000', last_total: '40000',
  iron: '200000', lutinum: '100000', water: '60000', hydrogen: '40000',
  life_reports: 9, life_total: '900000', life_avg: '100000', life_last_at: iso(1),
  planet_idle_hours: 90, planet_count: 6, per_day: '100000', days_listed: 4,
}])[0];
ok(statRow.best === 250000 && statRow.last === 40000, 'bester und letzter Flug übernommen');
ok(statRow.res.iron === 200000 && statRow.res.hydrogen === 40000, 'Rohstoffsummen übernommen');
ok(statRow.lifeReports === 9 && statRow.lifeAvg === 100000, 'Lifetime-Zahlen übernommen');
ok(statRow.planetIdleHours === 90 && statRow.planetCount === 6, 'Planetenkontext übernommen');

const share = resShare(statRow.res);
ok(share.length === 4 && share[0].key === 'iron' && share[0].label === 'Ei', 'Rohstoffe in fester Reihenfolge');
ok(Math.abs(share[0].share - 0.5) < 1e-9, 'Anteil aus der Summe gerechnet, got ' + share[0].share);
ok(resShare(null).every((r) => r.share === 0), 'ohne Beute keine Anteile');
ok(Math.abs(resShare({ iron: 0, lutinum: 0, water: 0, hydrogen: 0 })
  .reduce((n, r) => n + r.share, 0)) < 1e-9, 'Nullbeute teilt nicht durch null');

// Der letzte Flug gegen den eigenen Schnitt: das Signal fürs Austauschen.
ok(trendOf(statRow).dir === 'down', 'abgeernteter Speicher fällt auf, got ' + trendOf(statRow).dir);
ok(trendOf({ reports: 3, avg: 100, last: 100 }).dir === 'flat', 'Schnitt gehalten');
ok(trendOf({ reports: 3, avg: 100, last: 200 }).dir === 'up', 'starker letzter Flug');
ok(trendOf({ reports: 0, avg: 0, last: 0 }) === null, 'ohne Flüge kein Trend');

// ---------- Median ----------
ok(medianPerDay([{ perDay: 10 }, { perDay: 30 }, { perDay: 20 }]) === 20, 'Median ungerade');
ok(medianPerDay([{ perDay: 10 }, { perDay: 30 }]) === 20, 'Median gerade');
ok(medianPerDay([]) === 0, 'Median ohne Zeilen');

// ---------- Bewertung eines Platzes ----------
const view = rosterFor(rows, '12:101:5', 6);
ok(view.active.length === 5, 'nur aktive Ziele dieses Planeten, got ' + view.active.length);
ok(view.dropped.length === 1, 'abgelegte getrennt, got ' + view.dropped.length);
ok(view.active[0].target === '12:108:9', 'bester Ertrag je Flug oben, got ' + view.active[0].target);

const by = Object.fromEntries(view.active.map((r) => [r.target, r.health.state]));
ok(by['12:104:3'] === 'stark', 'Träger ist stark, got ' + by['12:104:3']);
ok(by['12:105:1'] === 'schwach', 'unter 40 % des Medians ist schwach, got ' + by['12:105:1']);
ok(by['12:106:2'] === 'leer', 'nie angeflogen nach der Schonfrist, got ' + by['12:106:2']);
ok(by['12:107:4'] === 'neu', 'in der Schonfrist bleibt es „neu", got ' + by['12:107:4']);
ok(by['12:108:9'] === 'wach', 'wieder aktiver Besitzer schlägt alles andere, got ' + by['12:108:9']);
ok(view.weak.map((r) => r.target).sort().join(',') === '12:105:1,12:106:2,12:108:9',
  'genau diese drei Plätze gehören getauscht, got ' + view.weak.map((r) => r.target));

// Ein lange nicht besuchtes, aber ordentliches Ziel ist „kalt", kein Fall fürs Aussortieren.
const kalt = rosterHealth({ playerIdleHours: 300, daysListed: 10, reports: 5, perDay: 50000, hoursSinceLast: 200 }, 50000);
ok(kalt.state === 'kalt' && kalt.drop === false, 'kalt wird gemeldet, aber nicht gestrichen: ' + JSON.stringify(kalt));

// Nach dem allerersten Import steht die Inaktivitätsuhr jedes Spielers auf
// null — das ist Unwissen, kein Aufwachen. Sonst hieße jede Farm „wieder aktiv".
const frischImportiert = { playerIdleHours: 21, idleConfirmed: false, daysListed: 10, reports: 5, perDay: 50000, hoursSinceLast: 5 };
ok(rosterHealth(frischImportiert, 50000).state !== 'wach',
  'unbelegte Uhr macht niemanden wach, got ' + rosterHealth(frischImportiert, 50000).state);
ok(rosterHealth({ ...frischImportiert, idleConfirmed: true }, 50000).state === 'wach',
  'belegte Punkteänderung bleibt ein Warnsignal');
ok(normalizeRoster([{ origin: '12:1:1', target: '12:2:2' }])[0].idleConfirmed === true,
  'ohne Spalte (alter Schemastand) bleibt es beim bisherigen Verhalten');
ok(normalizeRoster([{ origin: '12:1:1', target: '12:2:2', idle_confirmed: false }])[0].idleConfirmed === false,
  'idle_confirmed wird übernommen');

// Die Schwelle kommt aus dem Radarfilter: Wer nach eigener Einstellung als
// inaktiv gilt, darf in der Farmliste nicht als „wieder aktiv" dastehen.
ok(rosterFor(rows, '12:101:5', 6, { wakeHours: 1 }).active
  .find((r) => r.target === '12:108:9').health.state !== 'wach',
  'niedrige Schwelle lässt 2 h Inaktivität durchgehen');
ok(rosterFor(rows, '12:101:5', 6).active
  .find((r) => r.target === '12:108:9').health.state === 'wach',
  'ohne Angabe bleibt es bei den 24 Stunden');

// Ohne Vergleichswerte (erste Farm überhaupt) darf nichts als schwach gelten.
const einzel = rosterFor([rows[1]], '12:101:5', 3);
ok(einzel.active[0].health.state === 'stark', 'ohne Vergleich kein Abwerten, got ' + einzel.active[0].health.state);

// ---------- Kapazität ----------
ok(view.slots === 6 && view.free === 1 && view.over === 0, 'ein Platz frei: ' + JSON.stringify([view.free, view.over]));
const eng = rosterFor(rows, '12:101:5', 3);
ok(eng.over === 2 && eng.free === 0, 'Überbelegung erkannt, got ' + eng.over);

// ---------- Nachrücker ----------
const candidates = [
  { coord: '12:104:3', score: 999 },   // steht schon auf der Liste
  { coord: '12:44:1', score: 888 },    // war schon mal drauf und flog raus
  { coord: '12:103:7', score: 500 },
  { coord: '12:102:2', score: 400 },
  { coord: '12:100:9', score: 300 },
  { coord: '12:97:3', score: 200 },
  { coord: '12:96:1', score: 100 },
];
const swap = suggestSwaps(view, candidates);
ok(swap.room === 4, '1 frei + 3 schwach = 4 Plätze, got ' + swap.room);
ok(swap.add.length === 4, 'vier Nachrücker, got ' + swap.add.length);
ok(!swap.add.some((c) => c.coord === '12:104:3' || c.coord === '12:44:1'),
  'gelistete und abgelegte Ziele werden nicht erneut vorgeschlagen');
ok(swap.add[0].coord === '12:103:7', 'bester freier Kandidat zuerst, got ' + swap.add[0].coord);
ok(swap.drop[0].target === '12:106:2', 'schwächster Platz zuerst zum Tausch, got ' + swap.drop[0].target);
ok(suggestSwaps(rosterFor(rows, '12:101:5', 5), []).add.length === 0, 'ohne Kandidaten keine Vorschläge');

// ---------- Flugreihenfolge ----------
const order = flightOrder([
  { target: '12:120:1', reports: 2, avg: 100, perDay: 100 },
  { target: '12:102:1', reports: 2, avg: 100, perDay: 100 },
  { target: '12:150:1', reports: 2, avg: 900, perDay: 900 },
], '12:101:5');
ok(order[0].target === '12:150:1', 'Ertrag je Flug schlägt Entfernung, got ' + order[0].target);
ok(order[1].target === '12:102:1', 'bei Gleichstand das nähere Ziel, got ' + order[1].target);

// Ohne eigene Flüge zählt der Archivschnitt — sonst rutscht ein frisch
// aufgenommenes Topziel grundlos ans Ende.
const archOrder = flightOrder([
  { target: '12:120:1', reports: 3, avg: 50000, perDay: 50000 },
  { target: '12:121:1', reports: 0, avg: 0, perDay: 0, lifeReports: 20, lifeAvg: 80000 },
], '12:101:5');
ok(archOrder[0].target === '12:121:1', 'Archivschnitt zählt mit, got ' + archOrder[0].target);

console.log(`\n${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
