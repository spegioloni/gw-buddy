// Smoke-Test für State-Merge + Analyse. Start: node test/state.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Minimaler localStorage-Stub für Node.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { state, ingest, serverNow, clearAll } = await import('../src/state.js');
const A = await import('../src/analysis.js');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(ROOT, 'fixtures', f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };

const rG = ingest(read('gesamt.txt'));
console.log('ingest gesamt:', rG.type, '·', rG.message);
ok(rG.type === 'gesamt', 'type gesamt');
ok(state.ownPlanets.size === 8, 'ownPlanets 8, got ' + state.ownPlanets.size);
ok(state.planets.size === 8, 'planets 8, got ' + state.planets.size);

const rU = ingest(read('uebersicht.txt'));
console.log('ingest uebersicht:', rU.type, '·', rU.message);
ok(rU.type === 'uebersicht', 'type uebersicht');
ok(state.fleets.length === 22, 'fleets 22, got ' + state.fleets.length);
ok(state.buildOrders.length === 6, 'buildOrders 6, got ' + state.buildOrders.length);

// Serverzeit-Offset plausibel (Snapshot 07.08.2026 10:03:23)
console.log('snapshotAge (s):', state.snapshotAge?.toFixed(0), '| serverNow:', new Date(serverNow()).toISOString());
ok(state.refAt != null, 'refAt gesetzt');

// Merge: aktiver Planet bekommt frische Rohstoffe aus Übersichtsseite.
const home = state.planets.get('12:101:5');
ok(home.resources.iron === 344241, 'home iron aus Übersicht 344241, got ' + home.resources.iron);
ok(home.buildings.commandCenter === 22, 'home KZ 22 aus Gesamt, got ' + home.buildings.commandCenter);
ok(home.ships.spyProbe === 197, 'home spyProbe 197, got ' + home.ships.spyProbe);

// Analyse
const threats = A.threatAnalysis();
const home_t = threats.find((t) => t.coord === '12:101:5');
ok(!!home_t && home_t.attacks.length >= 1, 'home hat Angriff');
ok(home_t.stationed && home_t.stationed.total > 0, 'home stationed>0, got ' + JSON.stringify(home_t?.stationed?.total));

const fc = A.freeCapacity();
console.log('freie Kapazität – ohne Bau:', fc.noBuild.join(','), '| idle Schiffsfabrik:', fc.idleYard.join(','));
ok(fc.noBuild.includes('12:101:5') && fc.noBuild.includes('12:99:1'), 'noBuild korrekt');
ok(fc.idleYard.includes('12:97:1'), 'idleYard korrekt');

const tl = A.timelineEvents();
const builds = tl.filter((e) => e.type === 'build');
const attacks = tl.filter((e) => e.type === 'attack');
console.log('timeline:', tl.length, '| builds:', builds.length, '| attacks:', attacks.length);
ok(tl.length === 28, 'timeline 22+6=28, got ' + tl.length);
ok(builds.length === 6, 'timeline builds 6, got ' + builds.length);

const ni = A.nextImpact();
console.log('nextImpact:', ni && (ni.start + ' -> ' + ni.ziel + ' in ' + Math.round((ni.at - serverNow()) / 1000) + 's'));
ok(!!ni, 'nextImpact vorhanden');

// Online-/Save-Fenster: gebündelte Zeitbereiche statt Einzelzeiten.
const wins = A.saveWindows();
console.log('Save-Fenster:', wins.map((w) => `${Math.round(w.durationSec / 60)}min/${w.impacts.length}x/${w.level}`).join(' '));
ok(wins.length > 0, 'Save-Fenster vorhanden');
ok(wins.every((w) => w.to > w.from), 'Fenster haben positive Dauer');
ok(wins.every((w) => w.durationSec >= A.SAVE_LEAD_SEC), 'Fenster mind. so lang wie der Vorlauf');
ok(wins.every((w, i) => i === 0 || w.from > wins[i - 1].to), 'Fenster überlappen sich nicht');
ok(wins.some((w) => w.impacts.length > 1), 'dichte Einschläge werden gebündelt');
ok(wins.some((w) => w.level === 'critical'), 'Fenster mit stationierter Flotte ist kritisch');

const crits = A.criticalPoints();
console.log('kritische Stellen:', crits.map((c) => c.kind).join(','));
ok(crits.some((c) => c.kind === 'loss'), 'Verlustrisiko erkannt');
ok(crits.findIndex((c) => c.level === 'warn') > crits.findIndex((c) => c.level === 'critical'),
  'kritische Punkte stehen vor Warnungen');

/* ---------- Regression: Bauaufträge aus der Übersichtsseite ---------- */
// Die Übersichtsseite listet ALLE laufenden Bauaufträge und ist frischer als
// die Gesamtübersicht — ein dort gelisteter Planet darf nie "frei" heißen.
const rU2 = ingest(read('u2.txt'));
ok(rU2.type === 'uebersicht', 'u2 als Übersichtsseite erkannt');
ok(state.uebersicht.activePlanet === '12:99:4',
  'aktiver Planet ohne [M]-Marker erkannt, got ' + state.uebersicht.activePlanet);
ok(state.uebersicht.buildSection === true, 'Gebäudeaufträge-Sektion erkannt');
ok(state.uebersicht.buildCount === 6, 'Auftragszähler 6, got ' + state.uebersicht.buildCount);

const p994 = state.planets.get('12:99:4');
console.log('12:99:4 Bauauftrag:', JSON.stringify(p994?.buildOrder));
ok(p994?.buildOrder?.name === 'Kommandozentrale' && p994.buildOrder.level === 2,
  '12:99:4 zeigt frischen Auftrag aus der Übersichtsseite');

const fc2 = A.freeCapacity();
console.log('freie Kapazität nach u2:', fc2.noBuild.join(','));
for (const b of state.buildOrders) {
  ok(!fc2.noBuild.includes(b.coord), `${b.coord} baut und darf nicht als frei gelten`);
}
ok(fc2.noBuild.length === 2, 'genau 2 freie Planeten, got ' + fc2.noBuild.length);

// --- g2.txt: Bauplatz und Schiffsfabrik sind unabhängig -------------------
// Die Zeile "Schiffsfabrik" im Kopf ist die Restlaufzeit der Schiffsproduktion,
// "-" heißt idle. Sie hat nichts mit dem Gebäude-Bauauftrag zu tun.
clearAll();
ingest(read('g2.txt'));
const g2yard = [...state.planets].map(([c, p]) => `${c}=${p.shipyardFreeSec}`).join(' ');
console.log('g2 shipyardFreeSec:', g2yard);
ok(state.planets.get('12:101:5').shipyardFreeSec === 129661,
  '12:101:5 Werft belegt (1 Tag, 12:01:01)');
ok(state.planets.get('12:99:1').shipyardFreeSec === null, '12:99:1 Werft idle');
ok(state.planets.get('12:97:1').shipyardFreeSec === null, '12:97:1 Werft idle');
ok(state.planets.get('12:99:4').shipyardFreeSec === null, '12:99:4 Werft idle');
ok(state.planets.get('12:101:5').buildings.shipFactory === 16,
  'Gebäudestufe Schiffsfabrik nicht mit der Restlaufzeit verwechselt');

const fc3 = A.freeCapacity();
console.log('g2 noBuild:', fc3.noBuild.join(','), '| idleYard:', fc3.idleYard.join(','));
ok(fc3.noBuild.join(',') === '12:97:1', 'nur 12:97:1 ohne Gebäude-Bauauftrag');
ok(fc3.idleYard.join(',') === '12:99:1,12:97:1,12:99:4',
  'drei idle Schiffsfabriken, got ' + fc3.idleYard.join(','));
ok(fc3.any.length === 3, 'Union der freien Kapazitäten = 3, got ' + fc3.any.length);
ok(fc3.idleYard.includes('12:99:4') && state.planets.get('12:99:4').buildOrder,
  'idle Werft trotz laufendem Gebäudebau wird erkannt');

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);

