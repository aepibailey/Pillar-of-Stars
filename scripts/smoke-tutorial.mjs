/**
 * First-combat tutorial smoke: verifies the coach card appears on the first
 * fight, walks it, and does NOT reappear on a second fight. Run vs vite preview.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4193';
const OUT = process.env.SMOKE_OUT ?? 'tut';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

async function toFirstCombat() {
  for (let i = 0; i < 12; i++) {
    const b = page.locator('[data-act="next"]');
    if ((await b.count()) === 0) break;
    await b.click();
    await page.waitForTimeout(90);
  }
  await page.locator('[data-opt="0"]').click();
  await page.waitForTimeout(90);
  await page.locator('[data-act="ack"]').click();
  await page.waitForTimeout(200);
  await page.locator('#panel [data-node]').first().click();
  await page.waitForTimeout(120);
  await page.locator('[data-opt="0"]').click();
  await page.waitForTimeout(100);
  await page.locator('[data-act="ack"]').click();
  await page.waitForTimeout(200);
}

await page.goto(`${BASE}/?seed=TUT&hostile=1`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(400);
await toFirstCombat();

const tutShown = (await page.locator('.tutcard').count()) > 0;
await page.screenshot({ path: `${OUT}/1-tutorial.png` });

// Walk the whole tutorial.
let steps = 0;
while ((await page.locator('[data-act="tut-next"]').count()) > 0 && steps < 12) {
  await page.locator('[data-act="tut-next"]').click();
  await page.waitForTimeout(120);
  steps++;
}
const tutGoneAfterWalk = (await page.locator('.tutcard').count()) === 0;
await page.screenshot({ path: `${OUT}/2-after-tutorial.png` });

// Win/finish this fight to get back to the map.
let guard = 0;
while (guard++ < 40) {
  const cont = page.locator('[data-act="combat-ack"]');
  if (await cont.count()) {
    await cont.click();
    await page.waitForTimeout(200);
    break;
  }
  const t = page.locator('[data-wt="0"][data-tid="hull"]');
  if (await t.count()) await t.first().click();
  const t2 = page.locator('[data-wt="2"][data-tid="hull"]');
  if (await t2.count()) await t2.first().click();
  const fire = page.locator('[data-act="fire"]');
  if (await fire.count()) await fire.click();
  await page.waitForTimeout(110);
}

// Second fight: tutorial must NOT reappear.
await page.locator('#panel [data-node]').first().click();
await page.waitForTimeout(120);
if ((await page.locator('[data-opt="0"]').count()) > 0) {
  await page.locator('[data-opt="0"]').click();
  await page.waitForTimeout(100);
  await page.locator('[data-act="ack"]').click();
  await page.waitForTimeout(200);
}
const inSecondCombat = (await page.locator('.sheet.combat').count()) > 0;
const tutOnSecond = (await page.locator('.tutcard').count()) > 0;

console.log(JSON.stringify({ tutShown, steps, tutGoneAfterWalk, inSecondCombat, tutOnSecond, errors }, null, 2));
await browser.close();
process.exit(errors.length || !tutShown || !tutGoneAfterWalk || tutOnSecond ? 1 : 0);
