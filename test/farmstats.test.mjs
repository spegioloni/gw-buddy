// Beute-Archiv: Aggregation, Diagrammbau und die Client-Abbildung der Berichte.
import { dayAxis, stackByResource, stackByOrigin, lootStats, archiveFarms, farmFlights, RESOURCES } from '../src/farmstats.js';
import { stackedBars, barList } from '../src/views/charts.js';
import { farmReportPayload } from '../src/sync/supabase.js';
import { parseFarmReports } from '../src/parse/farmberichte.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

const row = (day, origin, iron, lutinum = 0, water = 0, hydrogen = 0, reports = 1) => ({
  day, origin, iron, lutinum, water, hydrogen,
  total: iron + lutinum + water + hydrogen, reports,
});

// ---------- Tagesachse ----------
{
  const rows = [row('2026-08-10', 'a', 100), row('2026-08-13', 'a', 200)];
  const days = dayAxis(rows);
  ok(days.length === 4, 'Lücken werden aufgefüllt, got ' + days.length);
  ok(days[0] === '2026-08-10' && days[3] === '2026-08-13', 'Achse von erst bis letzt: ' + days.join(','));
  ok(dayAxis([]).length === 0, 'leeres Archiv -> leere Achse');
  ok(dayAxis(rows, '2026-08-15').at(-1) === '2026-08-15', 'Achse reicht bis heute');
}

// ---------- Stapel nach Rohstoff ----------
{
  const rows = [row('2026-08-10', 'a', 100, 10, 1, 0), row('2026-08-10', 'b', 50, 5, 0, 0)];
  const s = stackByResource(rows);
  ok(s.keys.length === 4 && s.keys[0].key === 'iron', 'vier Rohstoffe in der Legende');
  ok(s.bars.length === 1 && s.bars[0].values.iron === 150, 'Planeten je Tag addiert, got ' + s.bars[0].values.iron);
  ok(s.bars[0].total === 166, 'Tagessumme, got ' + s.bars[0].total);
}

// ---------- Stapel nach eigenem Planeten ----------
{
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row('2026-08-10', `p${i}`, (10 - i) * 100));
  const s = stackByOrigin(rows, null, 3);
  ok(s.keys.length === 4, '3 Planeten + Sammelposten, got ' + s.keys.length);
  ok(s.keys[0].key === 'p0' && s.keys.at(-1).key === '__rest', 'stärkster Planet zuerst, Rest zuletzt');
  ok(s.keys.at(-1).label === 'Weitere (7)', 'Sammelposten benennt die Anzahl, got ' + s.keys.at(-1).label);
  ok(s.bars[0].values.p0 === 1000, 'stärkster Planet unverändert, got ' + s.bars[0].values.p0);
  ok(s.bars[0].values.__rest === 700 + 600 + 500 + 400 + 300 + 200 + 100,
    'Rest korrekt gebündelt, got ' + s.bars[0].values.__rest);
  ok(s.bars[0].total === 5500, 'nichts geht verloren, got ' + s.bars[0].total);
  ok(s.keys.every((k) => /^#/.test(k.color)), 'jede Reihe hat eine Farbe');
}

// ---------- Kopfzahlen ----------
{
  const rows = [
    row('2026-08-10', 'a', 1000, 0, 0, 0, 3),
    row('2026-08-16', 'a', 500, 0, 0, 0, 1),
    row('2026-08-17', 'b', 200, 100, 0, 0, 2),
  ];
  const s = lootStats(rows, '2026-08-17');
  ok(s.total === 1800, 'Gesamtbeute, got ' + s.total);
  ok(s.reports === 6, 'Berichte gezählt, got ' + s.reports);
  ok(s.byResource.iron === 1700 && s.byResource.lutinum === 100, 'nach Rohstoff aufgeteilt');
  ok(s.last7 === 800, 'letzte 7 Tage ohne den 10.08., got ' + s.last7);
  ok(s.todayLoot === 300, 'Tagesbeute heute, got ' + s.todayLoot);
  ok(s.bestDay.day === '2026-08-10' && s.bestDay.total === 1000, 'bester Tag: ' + JSON.stringify(s.bestDay));
  ok(s.activeDays === 3 && s.perDayAvg === 600, 'Schnitt je Farmtag, got ' + s.perDayAvg);
  ok(s.origins === 2, 'zwei eigene Planeten aktiv, got ' + s.origins);
  ok(lootStats([], '2026-08-17').perDayAvg === 0, 'leeres Archiv teilt nicht durch null');
}

// ---------- SVG ----------
{
  const rows = [row('2026-08-10', 'a', 100, 50, 0, 0), row('2026-08-11', 'a', 0, 0, 0, 0, 0)];
  const svg = stackedBars(stackByResource(rows), { title: 'Test' });
  ok(svg.includes('<svg'), 'liefert SVG');
  ok((svg.match(/<rect/g) || []).length === 4, 'zwei Segmente + zwei Hover-Flächen, got ' + (svg.match(/<rect/g) || []).length);
  ok(svg.includes('10.08.'), 'Datum deutsch beschriftet');
  ok(!/undefined|NaN/.test(svg), 'keine Lücken im SVG');
  ok(stackedBars({ keys: [], bars: [] }).includes('chart-empty'), 'leeres Archiv zeigt Hinweis');

  const list = barList(RESOURCES.map(([key, label, color]) => ({ label, value: 100, color })));
  ok((list.match(/barlist-row/g) || []).length === 4, 'Rangliste mit vier Zeilen');
  ok(!/NaN/.test(list), 'Rangliste ohne NaN');
  ok(barList([]).includes('chart-empty'), 'leere Rangliste zeigt Hinweis');
  // XSS: Spielernamen kommen aus dem Spiel und dürfen kein Markup einschleusen.
  ok(barList([{ label: '<img src=x onerror=1>', value: 5 }]).includes('&lt;img'), 'Label wird escaped');
}

// ---------- Client-Abbildung der Berichte ----------
{
  const raw = `Angriffsberichte
12:101:5\t12:43:9
Bericht
spegioloni [KWLNZ]\t10\t0
Anakin\t0\t0
118.863 Eisen, 70.364 Lutinum, 16.406 Wasser, 22.734 Wasserstoff
heute 11:34:31
12:99:4\t12:104:1
Bericht
spegioloni [KWLNZ]\t10\t0
Heebads\t0\t0
106.352 Eisen
ohne Datum`;
  const reports = parseFarmReports(raw, new Date(2026, 7, 17, 12, 0, 0));
  const payload = farmReportPayload(reports);
  ok(reports.length === 2, '2 Berichte geparst, got ' + reports.length);
  ok(payload.length === 1, 'Bericht ohne Zeitstempel fliegt raus, got ' + payload.length);
  ok(payload[0].origin === '12:101:5' && payload[0].target === '12:43:9', 'Start und Ziel richtig herum');
  ok(payload[0].player === 'Anakin', 'Farmname übernommen, got ' + payload[0].player);
  ok(payload[0].iron === 118863 && payload[0].hydrogen === 22734, 'Rohstoffe einzeln übertragen');
  ok(payload[0].at.endsWith('Z'), 'Zeitpunkt als ISO-UTC, got ' + payload[0].at);
  ok(Date.parse(payload[0].at) === reports[0].at, 'Zeitpunkt verlustfrei, got ' + payload[0].at);
}

// ---------- Farmatlas aus dem Archiv ----------
{
  const iso = (backDays, h = 10) => new Date(new Date(2026, 7, 17, h, 0, 0).getTime() - backDays * 86400e3).toISOString();
  const targets = [
    { target: '12:43:9', target_player: 'Anakin', total: 900000, reports: 3, avg_total: 300000,
      best_total: 400000, first_at: iso(9), last_at: iso(0), last_origin: '12:101:5',
      last_total: 250000, last_iron: 200000, last_lutinum: 30000, last_water: 10000, last_hydrogen: 10000 },
    { target: '12:104:1', target_player: 'Heebads', total: 800000, reports: 1, avg_total: 800000,
      best_total: 800000, first_at: iso(4), last_at: iso(4), last_origin: '12:99:4',
      last_total: 800000, last_iron: 600000, last_lutinum: 150000, last_water: 30000, last_hydrogen: 20000 },
    { target: '12:44:5', target_player: null, total: 100000, reports: 2, avg_total: 50000,
      best_total: 60000, first_at: iso(30), last_at: iso(1), last_origin: '12:97:1',
      last_total: 40000, last_iron: 40000, last_lutinum: 0, last_water: 0, last_hydrogen: 0 },
  ];
  const a = archiveFarms(targets, new Date(2026, 7, 17, 20, 0, 0));
  ok(a.source === 'archiv', 'Quelle markiert');
  ok(a.farms.length === 3 && a.reports === 6, 'alle Ziele und Berichte gezählt, got ' + a.farms.length + '/' + a.reports);
  ok(a.farms[0].target === '12:104:1', 'nach Ø-Beute sortiert, got ' + a.farms[0].target);
  ok(a.farms[0].avg === 800000 && a.farms[0].total === 800000, 'Ø und letzte Beute übernommen');
  ok(a.farms.at(-1).player === 'Unbekannt', 'fehlender Spielername abgefangen');
  ok(a.attackedToday.length === 1 && a.attackedToday[0].target === '12:43:9',
    'heute angeflogen erkannt, got ' + JSON.stringify(a.attackedToday.map((f) => f.target)));
  ok(a.notAttackedToday.length === 2, 'zwei Ziele offen, got ' + a.notAttackedToday.length);
  ok(a.notAttackedToday[0].target === '12:104:1', 'offene Liste ebenfalls nach Ø sortiert');
  ok(a.farms.find((f) => f.target === '12:104:1').idleDays === 4, 'Pause in Tagen, got '
    + a.farms.find((f) => f.target === '12:104:1').idleDays);
  ok(a.farms.find((f) => f.target === '12:43:9').idleDays === 0, 'heute angeflogen -> 0 Tage');
  ok(a.farms[0].resources.iron === 600000 && a.farms[0].resources.hydrogen === 20000,
    'Rohstoffe des jüngsten Angriffs');
  ok(archiveFarms([], new Date()).farms.length === 0, 'leeres Archiv kippt nicht');
  // Postgres liefert bigint je nach Treiber als String — darf nicht "NaN" werden.
  const asText = archiveFarms([{ ...targets[0], avg_total: '300000', total: '900000', last_total: '250000' }]);
  ok(asText.farms[0].avg === 300000 && asText.farms[0].sum === 900000, 'bigint als Text verarbeitet');
}

// ---------- Laufende Flotten ----------
{
  const own = new Set(['12:101:5', '12:99:4']);
  const fleets = [
    { own: true, section: 'hin', mission: 'Angriff', start: '12:101:5', ziel: '12:43:9', at: 5000 },
    { own: true, section: 'hin', mission: 'Spionage', start: '12:101:5', ziel: '12:50:1', at: 3000 },
    { own: true, section: 'rueck', mission: 'Rückflug', start: '12:104:1', ziel: '12:99:4', at: 9000 },
    { own: true, section: 'hin', mission: 'Transport', start: '12:101:5', ziel: '12:99:4', at: 1000 },
    { own: false, section: 'fremd', mission: 'Angriff', start: '9:9:9', ziel: '12:101:5', at: 2000 },
  ];
  const f = farmFlights(fleets, own);
  ok(f.size === 2, 'nur echte Farmflüge, got ' + JSON.stringify([...f.keys()]));
  ok(f.get('12:43:9').kind === 'hin' && f.get('12:43:9').mission === 'Angriff', 'Angriff als Anflug erkannt');
  ok(f.get('12:104:1').kind === 'rueck', 'Rückflug am Startfeld erkannt');
  ok(!f.has('12:50:1'), 'Spionage gilt nicht als Farmflug');
  ok(!f.has('12:99:4'), 'eigener Planet ist keine Farm');
  ok(!f.has('12:101:5'), 'feindlicher Angriff auf mich zählt nicht');

  // Anflug schlägt Rückflug, danach gewinnt die frühere Ankunft.
  const mixed = farmFlights([
    { own: true, section: 'rueck', mission: 'Rückflug', start: '12:43:9', ziel: '12:101:5', at: 100 },
    { own: true, section: 'hin', mission: 'Angriff', start: '12:101:5', ziel: '12:43:9', at: 900 },
    { own: true, section: 'hin', mission: 'Angriff', start: '12:99:4', ziel: '12:43:9', at: 400 },
  ], own);
  ok(mixed.get('12:43:9').kind === 'hin' && mixed.get('12:43:9').at === 400,
    'Anflug vor Rückflug, frühester zuerst: ' + JSON.stringify(mixed.get('12:43:9')));
  ok(farmFlights([], own).size === 0, 'ohne Flotten leer');
  ok(farmFlights([{ own: true, section: 'hin', mission: 'Angriff', ziel: '12:43:9', at: null }], own)
    .get('12:43:9').at === null, 'Flotte ohne Ankunftszeit kippt nicht');
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
