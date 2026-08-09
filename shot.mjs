import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto('http://localhost:8080/index.html');
await page.click('#btnDemo');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shot-full.png', fullPage: true });
await page.waitForTimeout(1000);
const box = await page.locator('.gantt').boundingBox();
if (box) await page.screenshot({ path: 'shot-gantt.png', clip: box });
const cardBox = await page.locator('.tl-row').first().locator('.lab-card').boundingBox();
if (cardBox) {
  const pad = 20;
  await page.screenshot({ path: 'shot-card-zoom.png', clip: {
    x: Math.max(0, cardBox.x - pad), y: Math.max(0, cardBox.y - pad),
    width: cardBox.width + pad * 2, height: cardBox.height + pad * 2,
  } });
}
await browser.close();
