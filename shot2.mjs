import { chromium } from 'playwright';

const browser = await chromium.launch();

// Desktop: mobile-widths tests + hit/foreign rows
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('http://localhost:8080/index.html');
await page.click('#btnDemo');
await page.waitForTimeout(300);

// Zoom to "alles" to reveal more rows/foreign planets, then screenshot region around a hit row
await page.click('[data-tlzoom="alles"]');
await page.waitForTimeout(300);
const box = await page.locator('.gantt').boundingBox();
if (box) await page.screenshot({ path: 'shot-gantt-alles.png', clip: box });
await page.close();

// Tablet width
const p2 = await browser.newPage({ viewport: { width: 800, height: 1000 } });
await p2.goto('http://localhost:8080/index.html');
await p2.click('#btnDemo');
await p2.waitForTimeout(300);
const box2 = await p2.locator('.gantt').boundingBox();
if (box2) await p2.screenshot({ path: 'shot-tablet.png', clip: box2 });
await p2.close();

// Mobile width
const p3 = await browser.newPage({ viewport: { width: 380, height: 1200 } });
await p3.goto('http://localhost:8080/index.html');
await p3.click('#btnDemo');
await p3.waitForTimeout(300);
const box3 = await p3.locator('.gantt').boundingBox();
if (box3) await p3.screenshot({ path: 'shot-mobile.png', clip: box3 });
await p3.close();

await browser.close();
