// Rauchtest des Farmradar-Tabs ohne echtes Supabase-Projekt.
// Voraussetzung: node test/serve.mjs läuft auf :8080.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const headings = () => page.locator('#view .panel .head h3').allInnerTexts();

await page.goto('http://localhost:8080/index.html');
await page.click('[data-tab="farmradar"]');
await page.waitForFunction(() => window.__gw && window.__gw.state.radar.busy === null, null, { timeout: 60000 });
console.log('abgemeldet:', await headings());
await page.screenshot({ path: 'shot-radar-config.png', fullPage: true });

// „Projekt wechseln" blendet das Konfigurationsformular ein.
await page.click('#btnRadarResetCfg');
console.log('Projekt wechseln:', await headings());
await page.click('#btnRadarSaveCfg');
await page.waitForFunction(() => window.__gw.state.radar.busy === null, null, { timeout: 60000 });
console.log('nach Speichern:', await headings());

// Ab hier: eingeloggter Nutzer, damit die Vollansicht rendert.
await page.evaluate(() => {
  const s = window.__gw.state;
  s.radar.user = { email: 'ich@example.com' };
  s.radar.error = null;
  s.ownPlanets = new Set(['12:101:5', '12:99:1']);
  s.radar.rows = [
    { owner_name: 'Schlaefer', alliance: 'ZZZ', galaxy: 12, system: 104, position: 3, points: 2000, player_idle_days: 9, planet_idle_days: 9, total_points: 5000, planet_count: 3 },
    { owner_name: 'Schlaefer', alliance: 'ZZZ', galaxy: 12, system: 97, position: 8, points: 1500, player_idle_days: 9, planet_idle_days: 9, total_points: 5000, planet_count: 3 },
    { owner_name: 'Doese', alliance: null, galaxy: 12, system: 110, position: 1, points: 900, player_idle_days: 4, planet_idle_days: 4, total_points: 1200, planet_count: 1 },
  ];
  s.radar.snapshots = [{ kind: 'spieler', taken_at: new Date().toISOString(), row_count: 863, changed_count: 12 }];
  s.radar.loadedAt = Date.now();
  window.__gw.render();
});
console.log('eingeloggt:', await headings());
console.log('Zielkarten:', await page.locator('.farm-card').count());
console.log('Bestes Ziel:', (await page.locator('.farm-card').first().innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: 'shot-radar.png', fullPage: true });

// Der eingefügte Text muss ein Re-Render überleben — daran ist der
// Übertragen-Knopf schon einmal gescheitert.
const paste = readFileSync(new URL('./test/fixtures/highscore_spieler.txt', import.meta.url), 'utf8');
await page.locator('#inputHighscore').fill(paste);
await page.waitForTimeout(400);
console.log('Erkennung:', await page.locator('.panel .pill').last().innerText());
await page.evaluate(() => window.__gw.render());
const survived = await page.locator('#inputHighscore').inputValue();
console.log('Text nach Re-Render:', survived.length, 'Zeichen');

await page.click('#btnRadarPush');
await page.waitForFunction(() => window.__gw.state.radar.busy === null, null, { timeout: 60000 });
const pushMsg = await page.locator('#view .empty.bad').innerText().catch(() => '(keine Meldung)');
console.log('Übertragen ohne Login sagt:', pushMsg);
if (/Bitte zuerst eine Highscore-Liste/.test(pushMsg)) errors.push('Paste ging beim Re-Render verloren');

// Regler: Wert muss gespeichert werden und die Liste filtern.
await page.evaluate(() => {
  const el = document.querySelector('[data-radar="idleHours"]');
  el.value = '168';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
console.log('gespeichert:', await page.evaluate(() => localStorage.getItem('gw_radar')));

console.log(errors.length ? 'FEHLER:\n' + errors.join('\n') : '✅ keine JS-Fehler');
await browser.close();
process.exit(errors.length ? 1 : 0);
