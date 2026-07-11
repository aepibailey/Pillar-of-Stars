/**
 * Boarding smoke: uses ?board=1 (fights open already boardable) to reach the
 * Board button, enter personal combat, exercise the ground UI, and finish the
 * boarding. Verifies the whole §7.2/7.3 flow renders with no console errors.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4199';
const OUT = process.env.SMOKE_OUT ?? 'board';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/?seed=BOARD&board=1`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('pillar-of-stars.tutorial.combat', 'done');
});
await page.goto(`${BASE}/?seed=BOARD&board=1`);
await page.waitForTimeout(400);

for (let i = 0; i < 12; i++) {
  const b = page.locator('[data-act="next"]');
  if ((await b.count()) === 0) break;
  await b.click();
  await page.waitForTimeout(80);
}
await page.locator('[data-opt="0"]').click();
await page.waitForTimeout(80);
await page.locator('[data-act="ack"]').click();
await page.waitForTimeout(200);
await page.locator('#panel [data-node]').first().click();
await page.waitForTimeout(120);
await page.locator('[data-opt="0"]').click();
await page.waitForTimeout(100);
await page.locator('[data-act="ack"]').click();
await page.waitForTimeout(200);

const boardShown = (await page.locator('[data-act="board"]').count()) > 0;
await page.screenshot({ path: `${OUT}/1-boardable.png` });
await page.locator('[data-act="board"]').click();
await page.waitForTimeout(200);
const groundShown = (await page.locator('.sheet.ground').count()) > 0;
await page.screenshot({ path: `${OUT}/2-ground.png` });

// Fight it out: pick a foe, lethal aimed shots, vent when hot, until it ends.
let guard = 0;
let ackSeen = false;
while (guard++ < 80) {
  const ack = page.locator('[data-act="ground-ack"]');
  if (await ack.count()) {
    await page.screenshot({ path: `${OUT}/3-outcome.png` });
    await ack.click();
    await page.waitForTimeout(200);
    ackSeen = true;
    break;
  }
  const foe = page.locator('[data-gtarget]:not([disabled])').first();
  if (await foe.count()) await foe.click();
  const aimed = page.locator('[data-gact="aimed"]');
  const vent = page.locator('[data-gact="vent"]');
  // Alternate aimed shots with vents to manage heat.
  if (guard % 3 === 0 && (await vent.count())) await vent.click();
  else if (await aimed.count()) await aimed.click();
  await page.waitForTimeout(90);
}
const backToMap = (await page.locator('#map').count()) > 0 && (await page.locator('.sheet.ground').count()) === 0;

console.log(JSON.stringify({ boardShown, groundShown, ackSeen, backToMap, errors }, null, 2));
await browser.close();
process.exit(errors.length || !boardShown || !groundShown || !ackSeen ? 1 : 0);
