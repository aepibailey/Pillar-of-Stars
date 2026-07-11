/**
 * Combat smoke test: drives a real ship fight at 390x844 via the ?hostile=1
 * dev override, and exercises the Explain + Ship panels. Run with vite preview.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4191';
const OUT = process.env.SMOKE_OUT ?? 'csmoke';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/?seed=CSMOKE2&hostile=1`);
await page.evaluate(() => {
  localStorage.clear();
  // This test exercises combat mechanics, not the first-combat tutorial —
  // pre-dismiss the coach card so it doesn't intercept the Fire button.
  localStorage.setItem('pillar-of-stars.tutorial.combat', 'done');
});
await page.reload();
await page.waitForTimeout(400);

for (let i = 0; i < 12; i++) {
  const b = page.locator('[data-act="next"]');
  if ((await b.count()) === 0) break;
  await b.click();
  await page.waitForTimeout(100);
}
await page.locator('[data-opt="0"]').click();
await page.waitForTimeout(100);
await page.locator('[data-act="ack"]').click();
await page.waitForTimeout(250);

// Ship panel from the map (item 3).
await page.locator('.shipbtn').click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/ship-panel.png` });
await page.locator('[data-act="modal-close"]').click();
await page.waitForTimeout(150);

// Explore → hostile → engage → combat.
await page.locator('#panel [data-node]').first().click();
await page.waitForTimeout(150);
await page.locator('[data-opt="0"]').click();
await page.waitForTimeout(120);
await page.locator('[data-act="ack"]').click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/combat.png` });

// Explain modal (item 2).
await page.locator('[data-act="explain"]').click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/explain.png` });
await page.locator('[data-act="modal-close"]').click();
await page.waitForTimeout(150);

// Target the laser only, keep weapons power low, to show the underpowered flag,
// then fire and confirm a log line (item 4/5).
const lasBtn = page.locator('[data-wt="1"][data-tid="hull"]');
if (await lasBtn.count()) await lasBtn.click();
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/underpowered.png` });

// Play out the fight.
let rounds = 0;
let ended = false;
while (rounds++ < 40 && !ended) {
  const cont = page.locator('[data-act="combat-ack"]');
  if (await cont.count()) {
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
  await page.waitForTimeout(120);
}

console.log(JSON.stringify({ ended, errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
