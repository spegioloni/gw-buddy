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

const { state, ingest, ingestRequiredPair, hasRequiredData, serverNow, clearAll } = await import('../src/state.js');
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
ok(tl.every((e) => state.ownPlanets.has(e.coord)), 'timeline nur eigene Planeten');
ok(tl.length === 25, 'timeline 19+6=25, got ' + tl.length);
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

/* ---------- Sind die Rohstoffe save? ---------- */
const D = await import('../src/domain.js');
const P = await import('../src/data/production.js');

// Speicherkapazität und Sockel gegen die Spielwerte.
ok(D.storageCap(0) === 300000, 'Speicher Stufe 0 = 300.000');
ok(D.storageCap(1) === 360000, 'Speicher Stufe 1 = 360.000');
ok(D.storageCap(10) === 6300000, 'Speicher Stufe 10 = 6.300.000');
ok(D.storageCap(19) === 21960000, 'Speicher Stufe 19 = 21.960.000');
ok(D.storageCap(20) === 24300000, 'Speicher Stufe 20 = 24.300.000');
ok(D.protectedAmount(D.storageCap(1)) === 7200, 'Sockel Stufe 1 = 7.200');
ok(D.protectedAmount(D.storageCap(13)) === 208800, 'Sockel Stufe 13 = 208.800');
ok(D.protectedAmount(D.storageCap(20)) === 486000, 'Sockel Stufe 20 = 486.000');

// Produktionstabellen (Stichproben aus minenstufen.md).
ok(P.tableRate('ironMine', 16) === 2638, 'Eisenmine 16 = 2.638/h');
ok(P.tableRate('lutinumRefinery', 1) === 20, 'Lutinumraffinerie 1 = 20/h');
ok(P.tableRate('extendedChemicalFactory', 12) === 4611, 'Erw. Chemiefabrik 12 = 4.611/h');
ok(P.tableRate('ironMine', 0) === 0, 'Stufe 0 produziert nichts');

clearAll();
ingest(read('gesamt.txt'));
ingest(read('uebersicht.txt'));
const ref = state.refAt;

const storageRows = A.storageSafety();
ok(storageRows.every((r) => (
  r.status === (r.coverageHours < 12 ? 'danger' : r.coverageHours < 24 ? 'warning' : 'safe')
)), 'Speicherstatus: unter 12 h rot, 12–24 h gelb, ab 24 h sicher');

// Wasser wird bewusst ignoriert.
ok(!A.PLUNDER_RESOURCES.includes('water'), 'Wasser zählt nicht als Beute');
ok(A.PLUNDER_RESOURCES.length === 3, 'genau Eisen, Lutinum, Wasserstoff');

// 12:101:5: Speicher 19 schützt 439.200 — 344.241 Eisen liegen darunter.
const risk0 = A.plunderRisk('12:101:5', ref);
const iron0 = risk0.byRes.find((r) => r.key === 'iron');
console.log('12:101:5 @Snapshot: Eisen', iron0.stock, '/ Sockel', iron0.floor, '-> Beute', risk0.loot);
ok(risk0.known, 'Beute für eigenen Planeten bekannt');
ok(iron0.cap === 21960000, 'Kapazität aus der Klammer der Gesamtübersicht');
ok(iron0.floor === 439200, 'Sockel 439.200, got ' + iron0.floor);
ok(iron0.stock === 344241, 'Bestand zum Snapshot unverändert, got ' + iron0.stock);
ok(risk0.safe && risk0.loot === 0, 'zum Snapshot alles unter dem Sockel');

// Hochrechnung: 16.925 Eisen/h -> nach 10 h sind 344.241+169.250 immer noch save,
// der Sockel wird erst später überschritten.
const iron10 = A.resourceAt(state.planets.get('12:101:5'), 'iron', ref + 10 * 3600e3);
ok(Math.abs(iron10.stock - (344241 + 169250)) <= 1, 'lineare Förderung, got ' + iron10.stock);
ok(iron10.unsafeAt != null && iron10.unsafeAt > ref, 'Zeitpunkt für "wird plünderbar" berechnet');
const hoursToUnsafe = (iron10.unsafeAt - ref) / 3600e3;
ok(Math.abs(hoursToUnsafe - (439200 - 344241) / 16925) < 0.01,
  'unsafeAt trifft den Sockel, got ' + hoursToUnsafe.toFixed(2) + 'h');

// Speicherdeckel: nach 10 Jahren steht der Bestand exakt auf der Kapazität.
const ironFull = A.resourceAt(state.planets.get('12:101:5'), 'iron', ref + 87600 * 3600e3);
ok(ironFull.stock === 21960000 && ironFull.full, 'Bestand wird am Speicher gedeckelt');
ok(ironFull.loot === 21960000 - 439200, 'volle Beute = Kapazität minus Sockel');

// Laufender Minenausbau hebt die Rate ab Fertigstellung (Eisenmine 15 -> 16).
const p445 = state.planets.get('12:44:5');
const up = A.resourceAt(p445, 'iron', ref + 10 * 3600e3);
console.log('12:44:5 Eisen: Rate', up.rate, '-> ', up.rateLater, 'ab Ausbau auf Stufe', up.upgrade?.level);
ok(up.upgrade?.level === 16, 'Ausbau der Eisenmine auf Stufe 16 erkannt');
ok(up.rateLater - up.rate === 2638 - 2306, 'Ratensprung = Tabellendifferenz, got ' + (up.rateLater - up.rate));
const doneH = p445.buildOrder.remainingSec / 3600;
const expect445 = 1880 + 2327 * doneH + (2327 + 332) * (10 - doneH);
ok(Math.abs(up.stock - expect445) <= 2, 'Bestand stückweise integriert, got ' + up.stock);

// Ein Ausbau, der keinen Rohstoff betrifft, ändert die Rate nicht.
const lut445 = A.resourceAt(p445, 'lutinum', ref + 10 * 3600e3);
ok(lut445.upgrade === null && lut445.rate === lut445.rateLater,
  'Eisenminen-Ausbau lässt Lutinum unberührt');

// Fremde Planeten liefern kein Ergebnis statt einer erfundenen Zahl.
ok(!A.plunderRisk('12:40:2', ref).known, 'fremder Planet: Beute unbekannt');

// planetStatus rechnet auf den nächsten Einschlag statt auf jetzt.
const impact445 = A.nextImpactOn('12:44:5');
ok(!!impact445, '12:44:5 hat einen Einschlag');
const st445 = A.planetStatus('12:44:5');
ok(st445.loot.forImpact && st445.loot.at === impact445.at,
  'Beute-Chip zeigt den Stand zum Einschlag');

// --- Regression: dieselbe Tabelle zweimal im Paste ----------------------
// Beim Kopieren aus dem Spiel landet die Auftragsliste gern doppelt im Text.
// Derselbe Planet + dasselbe Gebäude + dieselbe Stufe ist EIN Auftrag.
{
  const raw = read('uebersicht.txt');
  const lines = raw.split(/\r?\n/);
  const head = lines.findIndex((l) => /^Gebäudeaufträge/.test(l.trim()));
  const end = lines.findIndex((l, i) => i > head && /^Forschungsaufträge/.test(l.trim()));
  ok(head > 0 && end > head, 'Gebäudeaufträge-Block im Fixture gefunden');
  const doubled = [
    ...lines.slice(0, end),
    ...lines.slice(head, end),   // Block ein zweites Mal
    ...lines.slice(end),
  ].join('\n');

  const before = state.buildOrders.length;
  ingest(doubled);
  ok(state.uebersicht.buildOrders.length === 12,
    'Parser sieht die Liste doppelt, got ' + state.uebersicht.buildOrders.length);
  ok(state.buildOrders.length === 6,
    'doppelt eingefügte Auftragsliste ergibt 6 Aufträge, got ' + state.buildOrders.length);
  const keys = state.buildOrders.map((o) => `${o.coord}|${o.key}|${o.level}`);
  ok(new Set(keys).size === keys.length, 'keine Dubletten in state.buildOrders');
  ok(before === 6, 'Ausgangslage 6 Aufträge, got ' + before);
  ingest(read('uebersicht.txt'));
}

// --- Regression: Rückflug zwischen zwei Einschlägen ---------------------
// Landet eine eigene Flotte nach Einschlag A und vor Einschlag B, steht sie
// bei B im Feuer — Marker UND Online-Fenster müssen das gleich bewerten.
{
  const coord = '12:44:5';
  const pl = state.planets.get(coord);
  const ref = state.refAt;
  const saveFleets = state.fleets;
  const at1 = ref + 30 * 60e3, back = ref + 40 * 60e3, at2 = ref + 130 * 60e3;
  state.fleets = [
    { ziel: coord, start: '9:9:9', at: at1, hostile: true, own: false, spy: false, mission: 'Angriff' },
    { ziel: coord, start: coord, at: back, hostile: false, own: true, spy: false, mission: 'Rückflug' },
    { ziel: coord, start: '9:9:9', at: at2, hostile: true, own: false, spy: false, mission: 'Angriff' },
  ];
  const hadShips = A.stationedSummary(pl).hasAny;
  ok(hadShips === A.stationedSummary(pl).hasAny, 'Setup');
  ok(!A.impactVerdict(coord, at2).shipsSafe,
    'Einschlag nach Rückflug: Flotte gilt als stationiert');
  const wins = A.saveWindows();
  const w2 = wins.find((w) => w.impacts.some((i) => i.at === at2));
  ok(!!w2 && w2.level === 'critical',
    'Online-Fenster nach Rückflug ist kritisch, got ' + (w2 ? w2.level : 'kein Fenster'));

  // Kernversprechen: kein Fenster darf "safe" sein, wenn ein Einschlag darin
  // laut Marker nicht save ist.
  for (const w of wins) {
    const worst = w.impacts.every((i) => A.impactVerdict(i.ziel, i.at).safe);
    ok(w.level === 'safe' ? worst : true,
      `Fenster ${new Date(w.from).toTimeString().slice(0, 5)} als safe, obwohl ein Einschlag es nicht ist`);
  }
  state.fleets = saveFleets;
}

// --- Regression: erwartete Rückkehr hält die Kurve bis zum Rückflug hoch -
{
  const { renderFlotten } = await import('../src/views/flotten.js');
  const ref = new Date(2026, 7, 10, 14, 17, 0).getTime();
  const arrivalAt = ref - 10 * 60e3;
  const returnAt = ref + 8 * 3600e3;
  const realNow = Date.now;
  Date.now = () => ref;
  state.serverOffset = 0;
  state.refAt = ref;
  state.ownPlanets = new Set(['12:99:1']);
  state.planets = new Map([['12:99:1', {
    coord: '12:99:1', mine: true, ships: {}, defense: {}, points: 315,
  }]]);
  state.fleets = [{
    section: 'hin', own: true, hostile: false, mission: 'Angriff',
    start: '12:99:1', ziel: '12:1:2', at: arrivalAt, returnAt,
    ships: { longeagleV: 246 }, cargo: {},
  }];
  try {
    const html = renderFlotten();
    ok(html.includes(`&quot;at&quot;:${returnAt}`),
      'Luftkurve reduziert die Flotte erst bei der erwarteten Rückkehr');
    ok(!html.includes(`&quot;at&quot;:${arrivalAt}`),
      'Luftkurve reduziert die Flotte nicht bei der Zielankunft');
    ok(A.stationedAt(state.planets.get('12:99:1'), '12:99:1', returnAt).total === 246,
      'Flotte steht nach der erwarteten Rückkehr wieder am Heimatplaneten');
    ok(A.arrivalsBeforeAt('12:99:1', returnAt)[0]?.at === returnAt,
      'Gefahrenbewertung verwendet für den Rückkehrer die Rückkehrzeit');
    const returnEvent = A.timelineEvents().find((event) =>
      event.type === 'rueck' && event.coord === '12:99:1' && event.at === returnAt,
    );
    ok(!!returnEvent, 'Lage-Zeitleiste enthält die erwartete Rückkehr am Heimatplaneten');
  } finally {
    Date.now = realNow;
  }
}

// --- Pflicht-Paar: Übersicht als HTML ODER als reiner Text ----------------
{
  const gesamt = read('gesamt.txt');
  const textOverview = read('uebersicht.txt');
  const htmlOverview = readFileSync(path.join(ROOT, '..', 'uebersicht.html'), 'utf8');

  clearAll();
  const rText = ingestRequiredPair(textOverview, gesamt);
  ok(rText.ok, 'Text-Übersicht wird als Pflicht-Paar akzeptiert: ' + rText.message);
  ok(hasRequiredData(), 'hasRequiredData mit Text-Übersicht');
  ok(state.fleetSource === 'text', 'fleetSource text, got ' + state.fleetSource);
  ok(state.htmlText === '', 'HTML-Slot bleibt beim Text-Import leer');

  clearAll();
  const rHtml = ingestRequiredPair(htmlOverview, gesamt);
  ok(rHtml.ok, 'HTML-Übersicht wird als Pflicht-Paar akzeptiert: ' + rHtml.message);
  ok(hasRequiredData(), 'hasRequiredData mit HTML-Übersicht');
  ok(state.fleetSource === 'html', 'fleetSource html, got ' + state.fleetSource);
  ok(state.uebersichtText === '', 'Text-Slot bleibt beim HTML-Import leer');

  // Der zweite Import ersetzt den ersten vollständig — sonst mischt das
  // andere Format ältere Flotten wieder ein.
  ingestRequiredPair(textOverview, gesamt);
  ok(state.htmlText === '' && state.fleetSource === 'text',
    'Text-Import verdrängt eine zuvor eingefügte HTML-Übersicht');

  clearAll();
  const rSwapped = ingestRequiredPair(gesamt, textOverview);
  ok(!rSwapped.ok, 'vertauschte Felder werden abgelehnt');
  ok(!hasRequiredData(), 'kein hasRequiredData nach abgelehntem Paar');
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail === 0 ? 0 : 1);
