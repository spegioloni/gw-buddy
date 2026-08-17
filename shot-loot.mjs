// Rauchtest des Beute-Archivs im Farmen-Tab (ohne echtes Supabase-Projekt).
// Voraussetzung: node test/serve.mjs läuft auf :8080.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('!! ' + e.message); });

await page.goto('http://localhost:8080/index.html');
await page.click('[data-tab="farmen"]');
await page.waitForFunction(() => !!window.__gw, null, { timeout: 60000 });

// Ohne Login darf nur der Hinweis stehen, keine Knöpfe.
console.log('abgemeldet:', (await page.locator('#view .panel .body .empty').last().innerText()).trim());
console.log('Archiv-Knopf sichtbar:', await page.locator('#btnLootPush').count());

// Berichte einfügen — der Text muss ein Re-Render überleben.
const paste = [
  'Angriffsberichte',
  '12:101:5\t12:43:9', 'Bericht', 'spegioloni [KWLNZ]\t10\t0', 'Anakin\t0\t0',
  '118.863 Eisen, 70.364 Lutinum, 16.406 Wasser, 22.734 Wasserstoff', 'heute 11:34:31',
  '12:99:4\t12:104:1', 'Bericht', 'spegioloni [KWLNZ]\t10\t0', 'Heebads\t0\t0',
  '106.352 Eisen, 66.517 Lutinum, 16.272 Wasser, 29.386 Wasserstoff', 'gestern 10:26:04',
].join('\n');
await page.locator('#inputFarmReports').fill(paste);
await page.evaluate(() => window.__gw.render());
console.log('Text nach Re-Render:', (await page.locator('#inputFarmReports').inputValue()).length, 'Zeichen');
await page.click('#btnAnalyzeFarms');
await page.waitForTimeout(150);
console.log('erkannte Farmen:', await page.locator('.farm-row').count());

// Eingeloggt + Archivdaten -> Diagramme müssen rechnen.
const seed = () => page.evaluate(() => {
  const s = window.__gw.state;
  s.radar.user = { email: 'ich@example.com' };
  const day = (back) => new Date(Date.now() - back * 86400e3).toLocaleDateString('sv-SE');
  s.loot.rows = [
    { day: day(9), origin: '12:101:5', iron: 900000, lutinum: 400000, water: 90000, hydrogen: 120000, total: 1510000, reports: 7 },
    { day: day(9), origin: '12:99:4', iron: 300000, lutinum: 120000, water: 20000, hydrogen: 30000, total: 470000, reports: 3 },
    { day: day(2), origin: '12:101:5', iron: 500000, lutinum: 250000, water: 40000, hydrogen: 60000, total: 850000, reports: 5 },
    { day: day(0), origin: '12:97:1', iron: 120000, lutinum: 60000, water: 5000, hydrogen: 9000, total: 194000, reports: 2 },
  ];
  s.loot.targets = [
    { target: '12:43:9', target_player: 'Anakin', total: 1800000, reports: 9, avg_total: 200000,
      best_total: 260000, last_at: new Date().toISOString(), last_origin: '12:101:5',
      last_total: 228367, last_iron: 118863, last_lutinum: 70364, last_water: 16406, last_hydrogen: 22734 },
    { target: '12:104:1', target_player: 'Heebads', total: 900000, reports: 4, avg_total: 225000,
      best_total: 250000, last_at: new Date(Date.now() - 3 * 86400e3).toISOString(), last_origin: '12:99:4',
      last_total: 218527, last_iron: 106352, last_lutinum: 66517, last_water: 16272, last_hydrogen: 29386 },
    { target: '12:44:5', target_player: '<img src=x>', total: 324000, reports: 4, avg_total: 81000,
      best_total: 90000, last_at: new Date(Date.now() - 86400e3).toISOString(), last_origin: '12:97:1',
      last_total: 81000, last_iron: 80000, last_lutinum: 1000, last_water: 0, last_hydrogen: 0 },
  ];
  s.loot.loadedAt = Date.now();
  // Laufende Flotten wie aus der Übersichtsseite: ein Anflug und ein Rückflug.
  s.ownPlanets = new Set(['12:101:5', '12:99:4', '12:97:1']);
  s.fleets = [
    { own: true, section: 'hin', mission: 'Angriff', start: '12:101:5', ziel: '12:104:1', at: Date.now() + 2712e3 },
    { own: true, section: 'rueck', mission: 'Rückflug', start: '12:44:5', ziel: '12:99:4', at: Date.now() + 640e3 },
  ];
  window.__gw.render();
});

// Der Auto-Load beim Tabwechsel läuft asynchron (supabase-js kommt per CDN)
// und setzt radar.user beim Abschluss zurück — also so lange nachlegen, bis
// die Anmeldung steht.
for (let i = 0; i < 20; i++) {
  await seed();
  if (await page.locator('[data-loot="split"]').count()) break;
  await page.waitForTimeout(500);
}

const kpis = await page.locator('.loot-signals .sig').allInnerTexts();
console.log('Kennzahlen:', kpis.map((k) => k.replace(/\n/g, ' ')).join(' || '));
console.log('Balken (Rohstoff-Stapel):', await page.locator('.chart svg rect').count());
console.log('Legende:', (await page.locator('.chart-legend').first().innerText()).replace(/\n/g, ' '));
console.log('Ranglistenzeilen:', await page.locator('.barlist-row').count());
console.log('Atlas-Quelle:', (await page.locator('.farm-intro p').innerText()).slice(0, 60));
console.log('Kacheln:', (await page.locator('.farm-signals').innerText()).replace(/\n/g, ' '));
console.log('Heute offen:', (await page.locator('.farm-columns .section').last().innerText()).replace(/\n/g, ' | ').slice(0, 500));
console.log('Unterwegs-Zeilen:', await page.locator('.farm-row.enroute').count());
const cd = await page.locator('.farm-row.enroute .cd').first().innerText();
await page.waitForTimeout(1200);
const cd2 = await page.locator('.farm-row.enroute .cd').first().innerText();
console.log('Countdown läuft:', cd, '->', cd2);
if (cd === cd2) errors.push('Countdown der laufenden Flotte steht still');
await page.screenshot({ path: 'shot-loot-resource.png', fullPage: true });

// Umschalten auf die Planeten-Aufteilung.
await seed();
await page.selectOption('[data-loot="split"]', 'origin');
await page.waitForTimeout(150);
console.log('Legende nach Umschalten:', (await page.locator('.chart-legend').first().innerText()).replace(/\n/g, ' '));
await page.screenshot({ path: 'shot-loot-origin.png', fullPage: true });

// Rangliste von Gesamtertrag auf Ertrag je Flug umstellen.
const rankOrder = async () => (await page.locator('.section:has([data-loot="rank"]) .barlist-value').allInnerTexts()).join(' | ').replace(/\n/g, ' ');
const totalOrder = await rankOrder();
const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
console.log('color-scheme:', scheme);
if (scheme !== 'dark') errors.push('color-scheme ist nicht dark — native Dropdowns bleiben weiß');
await page.selectOption('[data-loot="rank"]', 'avg');
const avgHead = await page.locator('.section h2', { has: page.locator('[data-loot="rank"]') }).innerText();
const avgOrder = await rankOrder();
console.log('Rangliste Gesamt:', totalOrder, '\nRangliste je Flug:', avgOrder, '\nÜberschrift:', avgHead.replace(/\n/g, ' '));
if (totalOrder === avgOrder) errors.push('Rangliste ändert sich beim Umstellen nicht');
if (!avgHead.includes('je Flug')) errors.push('Überschrift bleibt bei „Ergiebigste"');
await page.screenshot({ path: 'shot-loot-rank.png', fullPage: true });

// Archivieren ohne Login-Session -> Berechtigungsfehler, kein stiller Absturz.
await page.click('#btnLootPush');
await page.waitForFunction(() => window.__gw.state.loot.busy === null, null, { timeout: 60000 });
console.log('Archivieren sagt:', await page.locator('#view .empty.bad').innerText().catch(() => '(keine Meldung)'));

const html = await page.locator('#view').innerHTML();
if (/NaN|undefined/.test(html)) errors.push('NaN/undefined in der Ausgabe');
if (html.includes('<img src=x>')) errors.push('Spielername wurde nicht escaped');

console.log(errors.length ? 'FEHLER:\n' + errors.join('\n') : '✅ keine JS-Fehler');
await browser.close();
process.exit(errors.length ? 1 : 0);
