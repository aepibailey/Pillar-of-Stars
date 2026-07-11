/**
 * Combat smoke test: drives a real ship fight at 390x844 via the ?hostile=1
 * dev override. Not part of `npm test`. Run with `vite preview` serving dist.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4185';
const OUT = process.env.SMOKE_OUT ?? 'csmoke';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/?seed=CSMOKE&hostile=1`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(400);

// Skip the intro.
for (let i = 0; i < 12; i++) {
  const b = page.locator('[data-act="next"]');
  if ((await b.count()) === 0) break;
  await b.click();
  await page.waitForTimeout(100);
}
// Opener → map.
await page.locator('[data-opt="0"]').click();
await page.waitForTimeout(100);
await page.locator('[data-act="ack"]').click();
await page.waitForTimeout(250);

// Explore first node → hostile encounter (forced) → engage → combat.
await page.locator('#panel [data-node]').first().click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/1-hostile-event.png` });
await page.locator('[data-opt="0"]').click(); // engage
await page.waitForTimeout(120);
await page.locator('[data-act="ack"]').click(); // → combat
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/2-combat.png` });
const inCombat = (await page.locator('.sheet.combat').count()) > 0;

// Fight: target hull, add weapons power, fire, until a result screen appears.
let rounds = 0;
let ended = false;
while (rounds++ < 40 && !ended) {
  const cont = page.locator('[data-act="combat-ack"]');
  if (await cont.count()) {
    await page.screenshot({ path: `${OUT}/3-result.png` });
    await cont.click();
    await page.waitForTimeout(200);
    ended = true;
    break;
  }
  for (const [w, t] of [
    ['0', 'hull'],
    ['1', 'shields'],
    ['2', 'hull'],
  ]) {
    const b = page.locator(`[data-wt="${w}"][data-tid="${t}"]`);
    if (await b.count()) await b.first().click();
  }
  const fire = page.locator('[data-act="fire"]');
  if (await fire.count()) await fire.click();
  await page.waitForTimeout(130);
}
await page.screenshot({ path: `${OUT}/4-after.png` });

console.log(JSON.stringify({ inCombat, ended, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
