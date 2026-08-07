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

const { state, ingest, serverNow } = await import('../src/state.js');
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

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
