// Verifikation der Parser gegen die echten Fixtures. Start: node test/parse.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { detectType } from '../src/parse/detect.js';
import { parseGesamt } from '../src/parse/gesamt.js';
import { parseUebersicht } from '../src/parse/uebersicht.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(ROOT, 'fixtures', f), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const near = (a, b) => a === b;

// ---------- Gesamtübersicht ----------
const gText = read('gesamt.txt');
console.log('detect(gesamt):', detectType(gText));
ok(detectType(gText) === 'gesamt', 'detect gesamt');
const G = parseGesamt(gText);

ok(G.owner === 'spegioloni', 'owner = spegioloni, got ' + G.owner);
ok(G.planetCount === 8, 'planetCount 8, got ' + G.planetCount);
ok(G.planets.length === 8, 'planets len 8, got ' + G.planets.length);
ok(G.planets[0] === '12:101:5', 'planet0, got ' + G.planets[0]);
ok(G.planets[7] === '12:99:4', 'planet7, got ' + G.planets[7]);

const p0 = G.byPlanet['12:101:5'];
ok(p0.points === 2544, 'p0 points 2544, got ' + p0.points);
ok(p0.resources.iron === 344761, 'p0 iron 344761, got ' + p0.resources.iron);
ok(p0.resources.water === 203057, 'p0 water, got ' + p0.resources.water);
ok(p0.production.iron === 16925, 'p0 iron prod, got ' + p0.production.iron);
ok(p0.waterUsage === -11736, 'p0 water usage, got ' + p0.waterUsage);
ok(p0.buildings.commandCenter === 22, 'p0 KZ 22, got ' + p0.buildings.commandCenter);
ok(p0.buildings.ironStorage.level === 19, 'p0 ironStorage lvl 19, got ' + JSON.stringify(p0.buildings.ironStorage));
ok(p0.buildings.ironStorage.cap === 21960000, 'p0 ironStorage cap, got ' + JSON.stringify(p0.buildings.ironStorage));
ok(p0.ships.recycler === 30, 'p0 recycler 30, got ' + p0.ships.recycler);
ok(p0.ships.spyProbe === 197, 'p0 spyProbe 197, got ' + p0.ships.spyProbe);
ok(p0.ships.longeagleV === 24, 'p0 longeagleV 24, got ' + p0.ships.longeagleV);
ok(p0.buildOrder === null, 'p0 no build order, got ' + JSON.stringify(p0.buildOrder));
ok(p0.shipyardFreeSec === 18 * 3600 + 22 * 60 + 19, 'p0 shipyard 18:22:19, got ' + p0.shipyardFreeSec);

// Planet mit laufendem Bau + idle shipyard
const p97 = G.byPlanet['12:97:1'];
ok(p97.buildOrder && p97.buildOrder.name === 'Eisenspeicher', 'p97 build Eisenspeicher, got ' + JSON.stringify(p97.buildOrder));
ok(p97.buildOrder.remainingSec === 24 * 60 + 38, 'p97 build 00:24:38, got ' + (p97.buildOrder && p97.buildOrder.remainingSec));
ok(p97.shipyardFreeSec === null, 'p97 shipyard idle (-), got ' + p97.shipyardFreeSec);

const p31 = G.byPlanet['12:31:6'];
ok(p31.ships.spyProbe === 20, 'p31 spyProbe 20, got ' + p31.ships.spyProbe);
ok(p31.defense !== undefined, 'p31 has defense');
ok(p31.buildOrder && p31.buildOrder.name === 'Kommandozentrale' && p31.buildOrder.level === 7, 'p31 build KZ 7, got ' + JSON.stringify(p31.buildOrder));

// Totals
ok(G.totals.resources.iron === 539921, 'total iron 539921, got ' + G.totals.resources.iron);
ok(G.totals.points === 3966, 'total points 3966, got ' + G.totals.points);

// Freie Kapazität: Planeten ohne Bauauftrag / idle shipyard
const noBuild = G.planets.filter((c) => !G.byPlanet[c].buildOrder);
const idleYard = G.planets.filter((c) => G.byPlanet[c].shipyardFreeSec == null);
console.log('  ohne Bauauftrag:', noBuild.join(', '));
console.log('  Schiffsfabrik idle:', idleYard.join(', '));
ok(noBuild.includes('12:101:5') && noBuild.includes('12:99:1'), 'noBuild enthält 101:5 & 99:1');
ok(idleYard.includes('12:99:1') && idleYard.includes('12:97:1'), 'idleYard enthält 99:1 & 97:1');

// Fremdtext nach der Verteidigungs-Sektion darf keine Bestände erfinden:
// eine unbekannte Sektion beendet die aktive Sektion, unbekannte Zeilen
// werden nicht als Schiffe/Verteidigung gezählt.
{
  const cols = G.planets.map(() => '449').join('\t');
  const tainted = `${gText}\nForschung\nWaffentechnik\t${cols}\t-\t449\nAllerlei\t${cols}\t-\t449\n`;
  const T = parseGesamt(tainted);
  const defSum = (c) => Object.values(T.byPlanet[c].defense).reduce((s, n) => s + n, 0);
  const shipKeys = (c) => Object.keys(T.byPlanet[c].ships);
  ok(G.planets.every((c) => defSum(c) === 0),
    'Fremdsektion erzeugt keine Verteidigung, got ' + G.planets.map(defSum).join(','));
  ok(shipKeys('12:44:5').every((k) => k !== 'Waffentechnik'),
    'Fremdzeile landet nicht in ships');
}

// ---------- Übersichtsseite ----------
const uText = read('uebersicht.txt');
console.log('\ndetect(uebersicht):', detectType(uText));
ok(detectType(uText) === 'uebersicht', 'detect uebersicht');
const own = new Set(G.planets);
const U = parseUebersicht(uText, own);

ok(U.snapshot.sec === 10 * 3600 + 3 * 60 + 23, 'snapshot 10:03:23, got ' + U.snapshot.sec);
ok(U.snapshot.date && U.snapshot.date.d === 7 && U.snapshot.date.m === 8 && U.snapshot.date.y === 2026, 'snapshot date 07.08.2026, got ' + JSON.stringify(U.snapshot.date));
ok(U.activePlanet === '12:101:5', 'active planet 12:101:5, got ' + U.activePlanet);
ok(U.activeResources.iron === 344241, 'active iron 344241, got ' + U.activeResources.iron);
ok(U.activeResources.hydrogen === 107337, 'active hydrogen, got ' + U.activeResources.hydrogen);
ok(U.counts.fremdeFlotten === 16, 'count fremde 16, got ' + U.counts.fremdeFlotten);
ok(U.counts.gebaeude === 99, 'count gebaeude 99, got ' + U.counts.gebaeude);

ok(U.buildOrders.length === 6, 'buildOrders 6, got ' + U.buildOrders.length);
const bo0 = U.buildOrders[0];
ok(bo0.name === 'Schiffsfabrik' && bo0.level === 1 && bo0.coord === '12:99:4', 'buildOrder0, got ' + JSON.stringify(bo0));
ok(bo0.remainingSec === 10 * 60 + 20, 'buildOrder0 time 00:10:20, got ' + bo0.remainingSec);

ok(U.ships.recycler === 30, 'active recycler 30, got ' + U.ships.recycler);
ok(U.ships.spyProbe === 197, 'active spyProbe 197, got ' + U.ships.spyProbe);
ok(U.tradePost.water === 186450, 'tradePost water 186450, got ' + U.tradePost.water);

// Flotten
const attacks = U.fleets.filter((e) => e.hostile);
const rueck = U.fleets.filter((e) => e.section === 'rueck');
const hin = U.fleets.filter((e) => e.section === 'hin');
console.log('  Flotten total:', U.fleets.length, '| Angriffe:', attacks.length, '| Hin:', hin.length, '| Rück:', rueck.length);
ok(U.fleets.length === 22, 'fleets total 22 (4+5+12+1), got ' + U.fleets.length);
ok(attacks.length === 4, 'attacks 4, got ' + attacks.length);
ok(rueck.length === 12, 'rueck 12, got ' + rueck.length);

// Feindangriff auf eigenen Planeten korrekt als Ziel erkannt
const atkHome = attacks.find((e) => e.ziel === '12:101:5');
ok(!!atkHome, 'Angriff auf 12:101:5 erkannt');
const handel = U.fleets.find((e) => e.mission === 'Handel');
ok(!!handel && handel.ziel === '12:101:5', 'Handel-Flotte Ziel 12:101:5, got ' + JSON.stringify(handel && handel.ziel));

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
