// Highscore-Parser und Farmradar-Bewertung. Start: node test/radar.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { detectType } from '../src/parse/detect.js';
import { parsePlayerHighscore, parsePlanetHighscore, splitPlayerName } from '../src/parse/highscore.js';
import { distance, nearestOwn, rankFarms, coordParts } from '../src/radar.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(path.join(ROOT, 'fixtures', f), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };

// ---------- Spieler-Highscore ----------
const sText = read('highscore_spieler.txt');
ok(detectType(sText) === 'highscore_spieler', 'detect spieler, got ' + detectType(sText));
const S = parsePlayerHighscore(sText);
ok(S.pages === 2, 'spieler pages 2, got ' + S.pages);
ok(S.rows.length === 200, 'spieler rows 200, got ' + S.rows.length);

const capy = S.rows[0];
ok(capy.name === 'capy', 'name capy, got ' + capy.name);
ok(capy.alliance === 'Fox-Wing', 'alliance Fox-Wing, got ' + capy.alliance);
ok(capy.planetPoints === 87971, 'planetPoints, got ' + capy.planetPoints);
ok(capy.researchPoints === 18987, 'researchPoints, got ' + capy.researchPoints);
ok(capy.totalPoints === 106958, 'totalPoints, got ' + capy.totalPoints);
ok(capy.planetCount === 10, 'planetCount, got ' + capy.planetCount);
ok(S.rows.some((r) => r.alliance === null), 'Spieler ohne Allianz erkannt');
ok(S.rows.every((r) => r.name && r.totalPoints != null), 'alle Zeilen vollständig');

ok(splitPlayerName('Grisu [8472-OSS]').alliance === '8472-OSS', 'Tag mit Ziffern');
ok(splitPlayerName('Blacklight').alliance === null, 'ohne Tag');
ok(splitPlayerName('P-Copy').name === 'P-Copy', 'Bindestrich im Namen');

// ---------- Planeten-Highscore ----------
const pText = read('highscore_planeten.txt');
ok(detectType(pText) === 'highscore_planeten', 'detect planeten, got ' + detectType(pText));
const P = parsePlanetHighscore(pText);
ok(P.pages === 3, 'planeten pages 3, got ' + P.pages);
ok(P.rows.length === 200, 'planeten rows 200, got ' + P.rows.length);

const first = P.rows[0];
ok(first.coord === '10:103:7', 'coord, got ' + first.coord);
ok(first.galaxy === 10 && first.system === 103 && first.position === 7, 'coord zerlegt');
ok(first.owner === 'Pubsmaus', 'owner, got ' + first.owner);
ok(first.points === 10019, 'points, got ' + first.points);
ok(P.rows.every((r) => r.owner && r.points != null), 'alle Planetenzeilen vollständig');

// Menü- und Pager-Zeilen dürfen nicht als Datenzeilen durchrutschen.
ok(!P.rows.some((r) => r.owner === 'Nächste »'), 'Pager ignoriert');

// ---------- Entfernungen ----------
ok(coordParts('12:101:5').system === 101, 'coordParts');
ok(coordParts('kaputt') === null, 'coordParts lehnt Unsinn ab');
ok(distance('12:101:5', '12:106:5') === 5, 'Systemabstand, got ' + distance('12:101:5', '12:106:5'));
ok(distance('12:101:5', '12:101:9') === 0.04, 'Position als Tiebreaker, got ' + distance('12:101:5', '12:101:9'));
ok(distance('12:101:5', '13:101:5') === 150, 'Galaxiesprung, got ' + distance('12:101:5', '13:101:5'));
ok(nearestOwn('12:110:1', ['12:101:5', '12:108:2']).coord === '12:108:2', 'nächster eigener Planet');

// ---------- Bewertung ----------
const rows = [
  { owner_name: 'Schlaefer', galaxy: 12, system: 104, position: 3, points: 2000, player_idle_days: 9, planet_idle_days: 9, total_points: 5000 },
  { owner_name: 'Aktiv', galaxy: 12, system: 102, position: 1, points: 9000, player_idle_days: 0, planet_idle_days: 0, total_points: 90000 },
  { owner_name: 'WeitWeg', galaxy: 12, system: 140, position: 4, points: 4000, player_idle_days: 20, planet_idle_days: 20, total_points: 4000 },
  { owner_name: 'AndereGalaxie', galaxy: 3, system: 101, position: 2, points: 8000, player_idle_days: 20, planet_idle_days: 20, total_points: 4000 },
];
const opts = { own: ['12:101:5'], idleDays: 3, maxSystems: 20, sameGalaxyOnly: true };
const ranked = rankFarms(rows, opts);
ok(ranked.length === 1, 'nur der erreichbare Schläfer bleibt, got ' + ranked.length);
ok(ranked[0].owner_name === 'Schlaefer', 'richtiger Kandidat, got ' + ranked[0].owner_name);
ok(ranked[0].systemGap === 3, 'systemGap 3, got ' + ranked[0].systemGap);
ok(ranked[0].nearestOwn === '12:101:5', 'nearestOwn, got ' + ranked[0].nearestOwn);
ok(ranked[0].score > 0, 'score gesetzt');

ok(rankFarms(rows, { ...opts, maxSystems: 60 }).length === 2, 'größerer Umkreis holt WeitWeg dazu');
ok(rankFarms(rows, { ...opts, maxSystems: 200, sameGalaxyOnly: false }).length === 2,
  'ohne Galaxiefilter bleibt die andere Galaxie zu weit weg (150 Gewicht)');
ok(rankFarms(rows, { ...opts, idleDays: 15 }).length === 0, 'höhere Schwelle filtert');
ok(rankFarms(rows, { ...opts, maxPoints: 4000 }).length === 0, 'Punktedeckel filtert');
ok(rankFarms(rows, { ...opts, own: [] }).length === 0, 'ohne Bezugspunkt kein Ergebnis');

// Nähere und größere Ziele stehen oben.
const two = rankFarms([
  { owner_name: 'Nah', galaxy: 12, system: 102, position: 1, points: 2000, player_idle_days: 5, total_points: 2000 },
  { owner_name: 'Fern', galaxy: 12, system: 118, position: 1, points: 2000, player_idle_days: 5, total_points: 2000 },
], opts);
ok(two[0].owner_name === 'Nah', 'näheres Ziel zuerst');

console.log(`\n${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
