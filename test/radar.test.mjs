// Highscore-Parser und Farmradar-Bewertung. Start: node test/radar.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { detectType } from '../src/parse/detect.js';
import { parsePlayerHighscore, parsePlanetHighscore, splitPlayerName } from '../src/parse/highscore.js';
import { distance, nearestOwn, rankFarms, coordParts, formatIdle, attackIndex, dayStart, farmExportPairs, farmExportName, npcCandidates } from '../src/radar.js';

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
// Zwei Zeilen tragen nur Tage (alte View), zwei die feineren Stunden.
const rows = [
  { owner_name: 'Schlaefer', galaxy: 12, system: 104, position: 3, points: 2000, player_idle_days: 9, player_idle_hours: 216, total_points: 5000 },
  { owner_name: 'Aktiv', galaxy: 12, system: 102, position: 1, points: 9000, player_idle_days: 0, player_idle_hours: 0, total_points: 90000 },
  { owner_name: 'WeitWeg', galaxy: 12, system: 140, position: 4, points: 4000, player_idle_days: 20, total_points: 4000 },
  { owner_name: 'AndereGalaxie', galaxy: 3, system: 101, position: 2, points: 8000, player_idle_days: 20, total_points: 4000 },
];
const opts = { own: ['12:101:5'], idleHours: 72, maxSystems: 20, sameGalaxyOnly: true };
const ranked = rankFarms(rows, opts);
ok(ranked.length === 1, 'nur der erreichbare Schläfer bleibt, got ' + ranked.length);
ok(ranked[0].owner_name === 'Schlaefer', 'richtiger Kandidat, got ' + ranked[0].owner_name);
ok(ranked[0].systemGap === 3, 'systemGap 3, got ' + ranked[0].systemGap);
ok(ranked[0].nearestOwn === '12:101:5', 'nearestOwn, got ' + ranked[0].nearestOwn);
ok(ranked[0].idleHours === 216 && ranked[0].idleDays === 9, 'Stunden und Tage im Ergebnis');
ok(ranked[0].score > 0, 'score gesetzt');

ok(rankFarms(rows, { ...opts, maxSystems: 60 }).length === 2, 'größerer Umkreis holt WeitWeg dazu');
ok(rankFarms(rows, { ...opts, maxSystems: 200, sameGalaxyOnly: false }).length === 2,
  'ohne Galaxiefilter bleibt die andere Galaxie zu weit weg (150 Gewicht)');
ok(rankFarms(rows, { ...opts, idleHours: 360 }).length === 0, 'höhere Schwelle filtert');
ok(rankFarms(rows, { ...opts, maxPoints: 4000 }).length === 0, 'Punktedeckel filtert');
ok(rankFarms(rows, { ...opts, own: [] }).length === 0, 'ohne Bezugspunkt kein Ergebnis');

// Eigene Planeten sind keine Farmen — weder die bekannten Koordinaten noch
// eine Kolonie desselben Spielers, die noch nicht in der Übersicht steht.
const eigene = [
  { owner_name: 'Ich', galaxy: 12, system: 101, position: 5, points: 6000, player_idle_hours: 200, total_points: 30000 },
  { owner_name: 'Ich', galaxy: 12, system: 103, position: 2, points: 3000, player_idle_hours: 200, total_points: 30000 },
  ...rows,
];
const ohneEigene = rankFarms(eigene, { ...opts, mine: ['12:101:5'] });
ok(!ohneEigene.some((r) => r.owner_name === 'Ich'), 'eigene Planeten fallen raus: '
  + JSON.stringify(ohneEigene.map((r) => r.coord)));
ok(ohneEigene.length === 1, 'die Farm bleibt, got ' + ohneEigene.length);
ok(rankFarms(eigene, { ...opts, mine: ['12:101:5'], own: ['12:101:5'] })
  .every((r) => r.coord !== '12:101:5'), 'der Bezugspunkt taucht nie als Ziel auf');
// Ohne eigene Liste bleibt der Bezugspunkt selbst trotzdem draußen.
ok(rankFarms(eigene, opts).every((r) => r.coord !== '12:101:5'), 'own dient als Rückfallebene für mine');

// Zeilen ohne Stundenspalte (noch nicht aktualisierte View) zählen als Tage×24.
ok(rankFarms([{ owner_name: 'NurTage', galaxy: 12, system: 102, position: 1, points: 100, player_idle_days: 2 }],
  { ...opts, idleHours: 48 }).length === 1, 'Tage dienen als Rückfallebene');

// Der eigentliche Zweck der Stunden: frische Importe testbar machen.
const frisch = [
  { owner_name: 'Frisch', galaxy: 12, system: 102, position: 1, points: 500, player_idle_hours: 21, player_idle_days: 0, total_points: 500 },
];
ok(rankFarms(frisch, { ...opts, idleHours: 72 }).length === 0, '21 h reichen für 3 Tage nicht');
ok(rankFarms(frisch, { ...opts, idleHours: 6 }).length === 1, 'mit 6-Stunden-Schwelle sichtbar');
ok(rankFarms(frisch, { ...opts, idleHours: 24 }).length === 0, '24-Stunden-Schwelle greift genau');

// Lesbare Darstellung der Schwelle.
ok(formatIdle(6) === '6 h', 'Stunden, got ' + formatIdle(6));
ok(formatIdle(47) === '47 h', 'unter zwei Tagen bleibt es bei Stunden, got ' + formatIdle(47));
ok(formatIdle(72) === '3 T', 'volle Tage ohne Rest, got ' + formatIdle(72));
ok(formatIdle(75) === '3 T 3 h', 'Tage plus Rest, got ' + formatIdle(75));

// Nähere und größere Ziele stehen oben.
const two = rankFarms([
  { owner_name: 'Nah', galaxy: 12, system: 102, position: 1, points: 2000, player_idle_days: 5, total_points: 2000 },
  { owner_name: 'Fern', galaxy: 12, system: 118, position: 1, points: 2000, player_idle_days: 5, total_points: 2000 },
], opts);
ok(two[0].owner_name === 'Nah', 'näheres Ziel zuerst');

// ---------- Bereits gefarmte Ziele ----------
const jetzt = new Date(2024, 4, 10, 14, 0, 0);
const heuteFrueh = new Date(2024, 4, 10, 6, 30, 0).toISOString();
const gestern = new Date(2024, 4, 9, 22, 0, 0).toISOString();

ok(dayStart(jetzt) === new Date(2024, 4, 10).getTime(), 'dayStart trifft lokale Mitternacht');

const idx = attackIndex([
  { target: '12:104:3', reports: 4, total: 180000, avg_total: 45000, last_at: heuteFrueh },
  { target: '12:105:1', reports: 3, total: 90000, last_at: gestern },   // alt: ohne avg_total
  { target: 'kaputt', reports: 9, total: 9 },
]);
ok(idx.size === 2, 'unbrauchbare Koordinate fliegt raus, got ' + idx.size);
ok(idx.get('12:104:3').avg === 45000, 'avg_total wird übernommen');
ok(idx.get('12:105:1').avg === 30000, 'ohne avg_total wird total/reports gerechnet, got ' + idx.get('12:105:1').avg);
ok(idx.get('12:105:1').lastAt === Date.parse(gestern), 'last_at als Zeitstempel');

const bekannt = rankFarms(rows, { ...opts, attacks: idx, now: jetzt });
ok(bekannt.length === 1 && bekannt[0].attack.reports === 4, 'Angriffsdaten hängen am Ergebnis');
ok(bekannt[0].attackedToday === true, 'heute angeflogen wird erkannt');

ok(rankFarms(rows, { ...opts, attacks: idx, onlyUntouched: true, now: jetzt }).length === 0,
  '„nur nie angegriffene" blendet die bekannte Farm aus');
ok(rankFarms(rows, { ...opts, attacks: idx, notToday: true, now: jetzt }).length === 0,
  '„heute noch nicht angeflogen" blendet die heutige Farm aus');

// Gestern angeflogen: von notToday unberührt, von onlyUntouched aber schon.
const gesternIdx = attackIndex([{ target: '12:104:3', reports: 2, total: 100, last_at: gestern }]);
const gesternRanked = rankFarms(rows, { ...opts, attacks: gesternIdx, notToday: true, now: jetzt });
ok(gesternRanked.length === 1 && gesternRanked[0].attackedToday === false,
  'gestern angeflogen bleibt bei notToday sichtbar');
ok(rankFarms(rows, { ...opts, attacks: gesternIdx, onlyUntouched: true, now: jetzt }).length === 0,
  'onlyUntouched greift unabhängig vom Tag');

// Ohne Archiv verhält sich alles wie zuvor.
const ohne = rankFarms(rows, { ...opts, onlyUntouched: true, notToday: true, now: jetzt });
ok(ohne.length === 1 && ohne[0].attack === null, 'ohne Archiv bleiben alle Ziele „neu"');

// ---------- Export der Farmenliste ----------
const expo = farmExportPairs([
  { coord: '12:105:6', owner_name: '' },
  { galaxy: 12, system: 68, position: 5, owner_name: 'Manor' },
  { coord: '12:102:7', owner_name: 'Boyaa' },
  { coord: '12:102:7', owner_name: 'Booyaa' },
  { coord: '12:68:5', owner_name: 'Manor' },          // Dublette
  { coord: 'kaputt', owner_name: 'Nix' },
  { coord: '12:68:7', owner_name: 'Necrom' },
]);
ok(JSON.stringify(expo) === JSON.stringify([
  ['12:68:5', 'Manor'], ['12:68:7', 'Necrom'],
  ['12:102:7', 'Booyaa'], ['12:102:7', 'Boyaa'], ['12:105:6', ''],
]), 'Exportpaare sortiert und entdoppelt, got ' + JSON.stringify(expo));
ok(farmExportPairs([{ target: '12:99:3', target_player: 'Psytasche' }])[0][1] === 'Psytasche',
  'Archivzeilen (target/target_player) taugen auch als Quelle');
ok(farmExportPairs(null).length === 0, 'ohne Zeilen leeres Ergebnis');

const stamp = new Date(2026, 7, 18);
ok(farmExportName('', stamp) === 'Farmen-18-08-2026.json', 'Dateiname, got ' + farmExportName('', stamp));
ok(farmExportName('12:101:5', stamp) === 'Farmen-12_101_5-18-08-2026.json',
  'Dateiname je Planet, got ' + farmExportName('12:101:5', stamp));

// ---------- NPCs & Kampfbericht-Ziele ohne Highscore-Eintrag ----------
const radarRows = [
  { owner_name: 'Schlaefer', galaxy: 12, system: 104, position: 3, points: 2000 },
];
const npcOpts = { radarRows, own: ['12:101:5'], maxSystems: 20, sameGalaxyOnly: true };

const npcTargets = [
  { target: '12:104:3', target_player: 'Schlaefer', reports: 2, total: 1000, avg_total: 500, last_at: heuteFrueh }, // im Highscore bekannt -> kein NPC
  { target: '12:106:2', target_player: 'NPC-Dorf', reports: 3, total: 9000, avg_total: 3000, best_total: 4000, last_total: 3500, last_at: heuteFrueh },
  { target: '12:190:1', target_player: 'ZuWeit', reports: 1, total: 100, avg_total: 100, last_at: heuteFrueh },
  { target: 'kaputt', target_player: 'Nix', reports: 1, total: 1 },
];
const npcs = npcCandidates(npcTargets, npcOpts);
ok(npcs.length === 1, 'nur das unbekannte, erreichbare Ziel bleibt, got ' + npcs.length);
ok(npcs[0].coord === '12:106:2', 'richtiges Ziel, got ' + npcs[0].coord);
ok(npcs[0].owner_name === 'NPC-Dorf', 'Name aus dem Bericht übernommen');
ok(npcs[0].attack.reports === 3 && npcs[0].attack.avg === 3000, 'Angriffszahlen übernommen');
ok(npcs[0].points === 0, 'keine Highscore-Punkte bekannt');
ok(npcCandidates(npcTargets, { ...npcOpts, own: [] }).length === 0, 'ohne Bezugspunkt kein Ergebnis');
ok(npcCandidates([], npcOpts).length === 0, 'ohne Ziele leeres Ergebnis');

console.log(`\n${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
