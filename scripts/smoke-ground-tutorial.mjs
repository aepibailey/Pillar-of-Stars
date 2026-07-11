/**
 * First-personal-combat tutorial smoke: verifies the coach card appears on the
 * first boarding, walks it, and does NOT reappear on a second boarding. Uses
 * ?board=1 so fights open already boardable. Mirrors smoke-tutorial.mjs.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4201';
const OUT = process.env.SMOKE_OUT ?? 'gtut';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/?seed=GTUT&board=1`);
await page.evaluate(() => {
  localStorage.clear();
  // Silence the SHIP-combat coach so only the ground coach is under test.
  localStorage.setItem('pillar-of-stars.tutorial.combat', 'done');
});
await page.goto(`${BASE}/?seed=GTUT&board=1`);
await page.waitForTimeout(400);

async function toBoarding() {
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
  await page.locator('[data-act="board"]').click();
  await page.waitForTimeout(200);
}

await toBoarding();
const tutShown = (await page.locator('.tutcard').count()) > 0;
await page.screenshot({ path: `${OUT}/1-tutorial.png` });

let steps = 0;
while ((await page.locator('[data-act="tut-next"]').count()) > 0 && steps < 14) {
  await page.locator('[data-act="tut-next"]').click();
  await page.waitForTimeout(120);
  steps++;
}
const tutGoneAfterWalk = (await page.locator('.tutcard').count()) === 0;
await page.screenshot({ path: `${OUT}/2-after.png` });

// Second boarding must NOT reappear. Preserve the 'done' ground marker, wipe
// the save + everything else, restart fresh, and board again.
await page.evaluate(() => {
  const g = localStorage.getItem('pillar-of-stars.tutorial.ground');
  localStorage.clear();
  localStorage.setItem('pillar-of-stars.tutorial.combat', 'done');
  if (g) localStorage.setItem('pillar-of-stars.tutorial.ground', g);
});
await page.goto(`${BASE}/?seed=GTUT2&board=1`);
await page.waitForTimeout(300);
await toBoarding();
const inSecondGround = (await page.locator('.sheet.ground').count()) > 0;
const tutOnSecond = (await page.locator('.tutcard').count()) > 0;

console.log(JSON.stringify({ tutShown, steps, tutGoneAfterWalk, inSecondGround, tutOnSecond, errors }, null, 2));
await browser.close();
process.exit(errors.length || !tutShown || !tutGoneAfterWalk || tutOnSecond ? 1 : 0);
