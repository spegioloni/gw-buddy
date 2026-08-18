// Prüft supabase/schema.sql gegen ein echtes Postgres (PGlite, WASM).
// Braucht das optionale Paket @electric-sql/pglite:
//   npm install --no-save @electric-sql/pglite && node test/schema.test.mjs
// Ohne das Paket überspringt der Test sich selbst.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.log('⏭  @electric-sql/pglite nicht installiert — Schema-Test übersprungen.');
  process.exit(0);
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(path.join(ROOT, '..', 'supabase', 'schema.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

const db = new PGlite();
// Supabase bringt diese Rollen mit; lokal müssen sie angelegt werden.
await db.exec('create role anon; create role authenticated;');
await db.exec(schema);
console.log('Schema eingespielt.');

const rpc = async (fn, rows) => {
  const res = await db.query(`select ${fn}($1::jsonb) as out`, [JSON.stringify(rows)]);
  return res.rows[0].out;
};

const players = (rows) => rows.map((r, i) => ({
  name: r[0], alliance: r[1] ?? null, rank: i + 1,
  total: r[2], planet: r[2] - 100, research: 100, planets: 2,
}));

// ---------- Erstimport ----------
let out = await rpc('ingest_players', players([['capy', 'Fox-Wing', 1000], ['Doese', null, 500]]));
ok(out.rows === 2 && out.changed === 2, 'Erstimport: 2 Zeilen, 2 Änderungen — ' + JSON.stringify(out));

// ---------- Gleicher Stand: keine History, Inaktivität läuft weiter ----------
await db.exec("update players set points_unchanged_since = now() - interval '5 days'");
out = await rpc('ingest_players', players([['capy', 'Fox-Wing', 1000], ['Doese', null, 500]]));
ok(out.changed === 0, 'unveränderter Import erzeugt keine History, got ' + out.changed);
let r = await db.query("select name, extract(day from now() - points_unchanged_since)::int as idle from players order by name");
ok(r.rows.every((x) => x.idle === 5), 'points_unchanged_since bleibt stehen: ' + JSON.stringify(r.rows));

// ---------- Punkte ändern: History + Uhr zurück ----------
out = await rpc('ingest_players', players([['capy', 'Fox-Wing', 1200], ['Doese', null, 500]]));
ok(out.changed === 1, 'nur der veränderte Spieler landet in der History, got ' + out.changed);
r = await db.query("select name, extract(day from now() - points_unchanged_since)::int as idle from players order by name");
ok(r.rows.find((x) => x.name === 'capy').idle === 0, 'capy zurückgesetzt');
ok(r.rows.find((x) => x.name === 'Doese').idle === 5, 'Doese bleibt inaktiv');
r = await db.query('select count(*)::int as n from player_history');
ok(r.rows[0].n === 3, 'History: 2 Erstzeilen + 1 Änderung, got ' + r.rows[0].n);

// ---------- Doppelte Namen in einem Import ----------
out = await rpc('ingest_players', [
  { name: 'Doppelt', alliance: null, rank: 9, total: 10, planet: 5, research: 5, planets: 1 },
  { name: 'Doppelt', alliance: null, rank: 9, total: 10, planet: 5, research: 5, planets: 1 },
]);
ok(out.rows === 2 && out.changed === 1, 'doppelte Zeilen kippen den Import nicht — ' + JSON.stringify(out));

// ---------- Planeten ----------
const planets = (rows) => rows.map((p, i) => ({
  galaxy: p[0], system: p[1], position: p[2], owner: p[3], points: p[4], rank: i + 1,
}));
out = await rpc('ingest_planets', planets([[12, 104, 3, 'Doese', 800], [12, 97, 8, 'capy', 900]]));
ok(out.rows === 2 && out.changed === 2, 'Planeten-Erstimport — ' + JSON.stringify(out));

out = await rpc('ingest_planets', planets([[12, 104, 3, 'Doese', 800], [12, 97, 8, 'capy', 900]]));
ok(out.changed === 0, 'unveränderte Planeten erzeugen keine History, got ' + out.changed);

out = await rpc('ingest_planets', planets([[12, 104, 3, 'Neuer', 800]]));
ok(out.changed === 1, 'Besitzerwechsel zählt als Änderung, got ' + out.changed);
r = await db.query("select owner_name from planets where galaxy=12 and system=104 and \"position\"=3");
ok(r.rows[0].owner_name === 'Neuer', 'Besitzer übernommen');

// ---------- View ----------
await db.exec("update planets set points_unchanged_since = now() - interval '6 days'");
await db.exec("update players set points_unchanged_since = now() - interval '5 days' where name = 'Doese'");
r = await db.query("select * from inactive_farms where owner_name = 'capy'");
ok(r.rows.length === 1, 'View liefert den Planeten von capy');
ok(r.rows[0].planet_idle_days === 6, 'planet_idle_days 6, got ' + r.rows[0].planet_idle_days);
ok(r.rows[0].player_idle_days === 0, 'player_idle_days von capy 0, got ' + r.rows[0].player_idle_days);
ok(r.rows[0].planet_idle_hours === 144, 'planet_idle_hours 144, got ' + r.rows[0].planet_idle_hours);
ok(r.rows[0].total_points === 1200n || Number(r.rows[0].total_points) === 1200, 'total_points aus players verknüpft');

// Der Grund für die Stundenspalte: unter 24 h stehen die Tage noch auf 0,
// die Stunden zeigen die Inaktivität aber bereits an.
await db.exec("update players set points_unchanged_since = now() - interval '21 hours' where name = 'capy'");
r = await db.query("select player_idle_days, player_idle_hours from inactive_farms where owner_name = 'capy'");
ok(r.rows[0].player_idle_days === 0, 'nach 21 h sind es 0 Tage, got ' + r.rows[0].player_idle_days);
ok(r.rows[0].player_idle_hours === 21, 'nach 21 h sind es 21 Stunden, got ' + r.rows[0].player_idle_hours);
r = await db.query('select count(*)::int as n from inactive_farms where player_idle_hours >= 6');
ok(r.rows[0].n >= 1, 'Filter auf Stunden findet den frischen Fall, got ' + r.rows[0].n);
await db.exec("update players set points_unchanged_since = now() where name = 'capy'");

r = await db.query("select * from inactive_farms where owner_name = 'Neuer'");
ok(r.rows.length === 1 && r.rows[0].total_points === null, 'Planet ohne Spielereintrag bleibt sichtbar');

// Beim ersten Import steht die Inaktivitätsuhr auf „jetzt", weil vorher
// niemand hingesehen hat. Das darf nicht wie frische Aktivität aussehen.
await db.exec("update players set first_seen_at = points_unchanged_since where name = 'capy'");
r = await db.query("select idle_confirmed from inactive_farms where owner_name = 'capy'");
ok(r.rows[0].idle_confirmed === false, 'ohne beobachtete Punkteänderung ist die Uhr unbelegt, got ' + r.rows[0].idle_confirmed);
await db.exec("update players set first_seen_at = now() - interval '9 days' where name = 'capy'");
r = await db.query("select idle_confirmed from inactive_farms where owner_name = 'capy'");
ok(r.rows[0].idle_confirmed === true, 'nach einer gesehenen Änderung zählt die Uhr, got ' + r.rows[0].idle_confirmed);

// ---------- Snapshots ----------
r = await db.query('select count(*)::int as n from snapshots');
ok(r.rows[0].n === 0, 'Importe protokollieren sich nicht selbst, got ' + r.rows[0].n);
await db.query("select log_snapshot('spieler', 3907, 12)");
await db.query("select log_snapshot('planeten', 3907, 40)");
r = await db.query("select kind, row_count from snapshots order by kind");
ok(r.rows.length === 2 && r.rows[0].row_count === 3907, 'log_snapshot schreibt die Gesamtzahlen');
let threw = false;
try { await db.query("select log_snapshot('quatsch', 1, 1)"); } catch { threw = true; }
ok(threw, 'unbekannte Listenart wird abgelehnt');

// ---------- Angriffsberichte: Archiv und Dublettenschutz ----------
const { parseFarmReports } = await import('../src/parse/farmberichte.js');
const { farmReportPayload } = await import('../src/sync/supabase.js');
const reportPaste = `Angriffsberichte
12:101:5\t12:43:9
Bericht
spegioloni [KWLNZ]\t10\t0
_**Anakin**_\t0\t0
118.863 Eisen, 70.364 Lutinum, 16.406 Wasser, 22.734 Wasserstoff
heute 11:34:31
12:99:4\t12:104:1
Bericht
spegioloni [KWLNZ]\t10\t0
Heebads\t0\t0
106.352 Eisen, 66.517 Lutinum, 16.272 Wasser, 29.386 Wasserstoff
gestern 10:26:04
12:99:4\t12:43:9
Bericht
spegioloni [KWLNZ]\t10\t0
_**Anakin**_\t0\t0
80.000 Eisen, 1.000 Lutinum
gestern 10:00:00`;
const reportRows = farmReportPayload(parseFarmReports(reportPaste, new Date(2026, 7, 17, 12, 0, 0)));
ok(reportRows.length === 3, '3 Berichte im Payload, got ' + reportRows.length);

out = await rpc('ingest_farm_reports', reportRows);
ok(out.rows === 3 && out.changed === 3, 'Erstarchivierung: alle drei neu — ' + JSON.stringify(out));
out = await rpc('ingest_farm_reports', reportRows);
ok(out.rows === 3 && out.changed === 0, 'derselbe Paste erzeugt keine Dubletten — ' + JSON.stringify(out));

// Ein neuer Angriff derselben Farm vom selben Planeten, nur später.
const later = [{
  origin: reportRows[0].origin, target: reportRows[0].target, player: 'Anakin',
  at: new Date(Date.UTC(2026, 7, 17, 15, 0, 0)).toISOString(),
  iron: 5000, lutinum: 0, water: 0, hydrogen: 0,
}];
out = await rpc('ingest_farm_reports', later);
ok(out.changed === 1, 'späterer Angriff auf dieselbe Farm zählt als neu, got ' + out.changed);

r = await db.query('select count(*)::int as n, sum(total)::bigint as t from farm_reports');
ok(r.rows[0].n === 4, '4 Berichte im Archiv, got ' + r.rows[0].n);
ok(Number(r.rows[0].t) === 228367 + 218527 + 81000 + 5000,
  'total wird als generierte Spalte gerechnet, got ' + r.rows[0].t);

r = await db.query("select * from farm_loot_daily order by day, origin");
ok(r.rows.length === 2, 'Tagesbeute je Planet gruppiert, got ' + JSON.stringify(r.rows.map((x) => [x.day, x.origin])));
ok(r.rows.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day)), 'day als ISO-Datum: ' + r.rows[0].day);
ok(r.rows.find((x) => x.origin === '12:99:4').reports === 2, 'zwei Angriffe von 12:99:4 an einem Tag');

r = await db.query("select * from farm_loot_targets order by total desc");
ok(r.rows.length === 2, '2 Ziele in der Rangliste, got ' + r.rows.length);
ok(r.rows[0].target === '12:43:9' && Number(r.rows[0].total) === 228367 + 81000 + 5000,
  'ergiebigstes Ziel korrekt summiert: ' + JSON.stringify(r.rows[0]));
ok(r.rows[0].reports === 3, '3 Angriffe auf 12:43:9, got ' + r.rows[0].reports);
ok(r.rows[0].target_player === 'Anakin', 'jüngster Besitzername übernommen, got ' + r.rows[0].target_player);
ok(Number(r.rows[0].last_total) === 5000 && Number(r.rows[0].last_iron) === 5000,
  'letzter Angriff (nicht der größte) landet in last_*: ' + JSON.stringify(r.rows[0].last_total));
ok(r.rows[0].last_origin === '12:101:5', 'Startplanet des letzten Angriffs, got ' + r.rows[0].last_origin);
ok(Number(r.rows[0].best_total) === 228367, 'bester Einzelangriff, got ' + r.rows[0].best_total);
ok(Number(r.rows[0].avg_total) === Math.round((228367 + 81000 + 5000) / 3),
  'Ø je Angriff, got ' + r.rows[0].avg_total);
ok(Date.parse(r.rows[0].last_at) > Date.parse(r.rows[0].first_at), 'first_at vor last_at');

// Der Farmatlas muss die View-Zeilen unverändert verarbeiten können.
const { archiveFarms } = await import('../src/farmstats.js');
const atlas = archiveFarms(r.rows);
ok(atlas.farms.length === 2, 'Atlas aus der View gebaut, got ' + atlas.farms.length);
ok(atlas.farms.every((f) => Number.isFinite(f.avg) && Number.isFinite(f.total) && f.reports > 0),
  'keine NaN aus bigint-Spalten: ' + JSON.stringify(atlas.farms.map((f) => [f.avg, f.total, f.reports])));

await db.query("select log_snapshot('farmberichte', 3, 3)");
r = await db.query("select count(*)::int as n from snapshots where kind = 'farmberichte'");
ok(r.rows[0].n === 1, 'Farmberichte dürfen protokolliert werden');

// ---------- Farmliste (Roster) ----------
out = await rpc('roster_add', [
  { origin: '12:101:5', target: '12:43:9', player: 'Anakin' },
  { origin: '12:101:5', target: '12:104:1', player: 'Heebads', note: 'nur nachts' },
  { origin: '12:101:5', target: '12:43:9', player: 'Anakin' },   // Dublette im selben Aufruf
  { origin: 'kaputt', target: '12:1:1' },                        // fliegt raus
]);
ok(out.changed === 2, 'zwei neue Farmen aufgenommen, got ' + JSON.stringify(out));
r = await db.query('select count(*)::int as n from farm_roster');
ok(r.rows[0].n === 2, 'nur gültige Koordinaten landen in der Liste, got ' + r.rows[0].n);

// Nochmal aufnehmen darf die Uhr eines aktiven Ziels nicht zurücksetzen.
await db.exec("update farm_roster set added_at = now() - interval '10 days'");
out = await rpc('roster_add', [{ origin: '12:101:5', target: '12:43:9', player: 'Anakin' }]);
ok(out.changed === 0, 'bekanntes aktives Ziel zählt nicht als neu, got ' + out.changed);
r = await db.query("select days_listed from farm_roster_stats where target = '12:43:9'");
ok(r.rows[0].days_listed === 10, 'added_at bleibt beim Doppelklick stehen, got ' + r.rows[0].days_listed);

// Die Ertragsspalten kommen aus dem Beute-Archiv — aber nur von diesem Planeten.
r = await db.query("select * from farm_roster_stats where origin = '12:101:5' and target = '12:43:9'");
ok(r.rows[0].reports === 2, 'nur Angriffe von 12:101:5 auf 12:43:9 zählen, got ' + r.rows[0].reports);
ok(Number(r.rows[0].total) === 228367 + 5000, 'Beute summiert, got ' + r.rows[0].total);
ok(Number(r.rows[0].per_day) === Math.round((228367 + 5000) / 10), 'per_day über die Listenzeit, got ' + r.rows[0].per_day);
ok(r.rows[0].hours_since_last != null, 'hours_since_last gesetzt');
ok(r.rows[0].target_player === 'Anakin', 'Spielername am Ziel, got ' + r.rows[0].target_player);
// Kennzahlen für die Karte: bester und letzter Flug, Rohstoffsplit.
ok(Number(r.rows[0].best_total) === 228367, 'best_total ist der stärkste Flug, got ' + r.rows[0].best_total);
ok(Number(r.rows[0].last_total) === 5000, 'last_total ist der jüngste Flug, got ' + r.rows[0].last_total);
ok(Number(r.rows[0].iron) + Number(r.rows[0].lutinum) + Number(r.rows[0].water) + Number(r.rows[0].hydrogen)
  === Number(r.rows[0].total), 'Rohstoffsummen ergeben die Gesamtbeute: ' + JSON.stringify(r.rows[0]));
// Lifetime zählt alle Flüge auf dieses Ziel — auch die vor der Aufnahme.
ok(r.rows[0].life_reports >= r.rows[0].reports && Number(r.rows[0].life_total) >= Number(r.rows[0].total),
  'life_* deckt mindestens die Listenzeit ab: ' + JSON.stringify(r.rows[0]));
ok(r.rows[0].life_last_at != null, 'life_last_at gesetzt');
ok('idle_confirmed' in r.rows[0], 'idle_confirmed steht auch an der Farmliste');

// Ein Ziel ohne jeden Angriff steht mit Nullen da, nicht mit NULL.
r = await db.query("select * from farm_roster_stats where target = '12:104:1'");
ok(r.rows[0].reports === 0 && Number(r.rows[0].total) === 0 && Number(r.rows[0].per_day) === 0,
  'unbeflogene Farm zeigt Nullen: ' + JSON.stringify(r.rows[0]));
ok(r.rows[0].slot_note === 'nur nachts', 'Notiz gespeichert, got ' + r.rows[0].slot_note);

// Austauschen: raus mit dem tauben Ziel, rein mit einem neuen.
out = await rpc('roster_remove', [{ origin: '12:101:5', target: '12:104:1', reason: 'kein Ertrag' }]);
ok(out.changed === 1, 'Ziel abgelegt, got ' + JSON.stringify(out));
r = await db.query("select active, drop_reason from farm_roster where target = '12:104:1'");
ok(r.rows[0].active === false && r.rows[0].drop_reason === 'kein Ertrag', 'Grund bleibt erhalten');
out = await rpc('roster_remove', [{ origin: '12:101:5', target: '12:104:1' }]);
ok(out.changed === 0, 'zweimal ablegen ändert nichts mehr, got ' + out.changed);

// Comeback: die Uhr startet neu, damit die alte Flaute nicht mitzählt.
out = await rpc('roster_add', [{ origin: '12:101:5', target: '12:104:1' }]);
ok(out.changed === 0, 'Wiederaufnahme ist keine neue Zeile, got ' + out.changed);
r = await db.query("select active, removed_at, days_listed from farm_roster_stats where target = '12:104:1'");
ok(r.rows[0].active === true && r.rows[0].removed_at === null && r.rows[0].days_listed === 0,
  'Wiederaufnahme setzt die Uhr zurück: ' + JSON.stringify(r.rows[0]));

// Kapazität je Planet.
await db.query("select roster_set_slots('12:101:5', 6, 'zwei Kleine Transporter')");
await db.query("select roster_set_slots('12:101:5', 9)");
r = await db.query("select slots, note from farm_slots where origin = '12:101:5'");
ok(r.rows[0].slots === 9 && r.rows[0].note === 'zwei Kleine Transporter',
  'Slots überschrieben, Notiz bleibt: ' + JSON.stringify(r.rows[0]));
threw = false;
try { await db.query("select roster_set_slots('12:101:5', -1)"); } catch { threw = true; }
ok(threw, 'negative Slotzahl wird abgelehnt');

out = await rpc('roster_forget', [{ origin: '12:101:5', target: '12:104:1' }]);
ok(out.changed === 1, 'endgültiges Vergessen entfernt die Zeile, got ' + out.changed);
r = await db.query('select count(*)::int as n from farm_roster');
ok(r.rows[0].n === 1, 'eine Farm bleibt übrig, got ' + r.rows[0].n);

// ---------- Rechte ----------
r = await db.query(`select has_table_privilege('anon', 'public.players', 'select') as anon_read,
                           has_table_privilege('authenticated', 'public.players', 'select') as auth_read,
                           has_table_privilege('authenticated', 'public.players', 'insert') as auth_write`);
ok(r.rows[0].anon_read === false, 'anon darf nicht lesen');
ok(r.rows[0].auth_read === true, 'authenticated darf lesen');
ok(r.rows[0].auth_write === false, 'authenticated darf nicht direkt schreiben');
r = await db.query(`select has_function_privilege('anon', 'public.ingest_players(jsonb)', 'execute') as anon_exec,
                           has_function_privilege('authenticated', 'public.ingest_players(jsonb)', 'execute') as auth_exec,
                           has_function_privilege('anon', 'public.ingest_farm_reports(jsonb)', 'execute') as anon_farm,
                           has_function_privilege('authenticated', 'public.ingest_farm_reports(jsonb)', 'execute') as auth_farm,
                           has_function_privilege('anon', 'public.log_snapshot(text,int,int)', 'execute') as anon_log,
                           has_function_privilege('authenticated', 'public.log_snapshot(text,int,int)', 'execute') as auth_log`);
ok(r.rows[0].anon_exec === false, 'anon darf nicht importieren');
ok(r.rows[0].auth_exec === true, 'authenticated darf importieren');
ok(r.rows[0].anon_farm === false, 'anon darf keine Berichte archivieren');
ok(r.rows[0].auth_farm === true, 'authenticated darf Berichte archivieren');
ok(r.rows[0].anon_log === false, 'anon darf nicht protokollieren');
ok(r.rows[0].auth_log === true, 'authenticated darf protokollieren');

r = await db.query(`select has_table_privilege('anon', 'public.farm_reports', 'select') as anon_read,
                           has_table_privilege('authenticated', 'public.farm_reports', 'select') as auth_read,
                           has_table_privilege('authenticated', 'public.farm_reports', 'insert') as auth_write`);
ok(r.rows[0].anon_read === false, 'anon sieht das Beute-Archiv nicht');
ok(r.rows[0].auth_read === true, 'authenticated sieht das Beute-Archiv');
ok(r.rows[0].auth_write === false, 'authenticated schreibt nur über die RPC');

r = await db.query(`select relname from pg_class where relrowsecurity and relnamespace = 'public'::regnamespace order by relname`);
ok(r.rows.length === 8, 'RLS auf allen acht Tabellen, got ' + JSON.stringify(r.rows.map((x) => x.relname)));

r = await db.query(`select has_table_privilege('anon', 'public.farm_roster', 'select') as anon_read,
                           has_table_privilege('authenticated', 'public.farm_roster', 'select') as auth_read,
                           has_table_privilege('authenticated', 'public.farm_roster', 'update') as auth_write,
                           has_function_privilege('anon', 'public.roster_add(jsonb)', 'execute') as anon_add,
                           has_function_privilege('authenticated', 'public.roster_add(jsonb)', 'execute') as auth_add,
                           has_function_privilege('authenticated', 'public.roster_set_slots(text,int,text)', 'execute') as auth_slots`);
ok(r.rows[0].anon_read === false, 'anon sieht die Farmliste nicht');
ok(r.rows[0].auth_read === true, 'authenticated sieht die Farmliste');
ok(r.rows[0].auth_write === false, 'die Farmliste wird nur über die RPC gepflegt');
ok(r.rows[0].anon_add === false, 'anon darf nichts aufnehmen');
ok(r.rows[0].auth_add === true && r.rows[0].auth_slots === true, 'authenticated pflegt die Farmliste');

// ---------- Echte Pastes durch die echte Client-Abbildung ----------
const { parsePlayerHighscore, parsePlanetHighscore } = await import('../src/parse/highscore.js');
const { playerPayload, planetPayload } = await import('../src/sync/supabase.js');
const read = (f) => readFileSync(path.join(ROOT, 'fixtures', f), 'utf8');

await db.exec('truncate players, planets, snapshots restart identity cascade');
const realPlayers = parsePlayerHighscore(read('highscore_spieler.txt')).rows;
out = await rpc('ingest_players', playerPayload(realPlayers));
ok(out.rows === realPlayers.length && out.changed === realPlayers.length,
  `echter Spieler-Paste importiert (${realPlayers.length}) — ` + JSON.stringify(out));
out = await rpc('ingest_players', playerPayload(realPlayers));
ok(out.changed === 0, 'zweiter identischer Import erzeugt keine Änderung, got ' + out.changed);

const realPlanets = parsePlanetHighscore(read('highscore_planeten.txt')).rows;
out = await rpc('ingest_planets', planetPayload(realPlanets));
ok(out.rows === realPlanets.length && out.changed === realPlanets.length,
  `echter Planeten-Paste importiert (${realPlanets.length}) — ` + JSON.stringify(out));

r = await db.query(`select count(*)::int as n from inactive_farms where total_points is not null`);
ok(r.rows[0].n > realPlanets.length * 0.8, 'die meisten Planeten finden ihren Spieler, got ' + r.rows[0].n);
r = await db.query("select total_points, planet_points, research_points, planet_count, alliance from players where name = 'capy'");
ok(Number(r.rows[0].total_points) === 106958 && Number(r.rows[0].planet_points) === 87971
  && Number(r.rows[0].research_points) === 18987 && r.rows[0].planet_count === 10
  && r.rows[0].alliance === 'Fox-Wing', 'capy vollständig gespeichert: ' + JSON.stringify(r.rows[0]));

await db.close();
console.log(`\n${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
