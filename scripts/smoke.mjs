/**
 * Dev-build smoke test: drives the real app in headless Chromium at 390x844
 * (mobile-first check) and screenshots each phase. Not part of `npm test` —
 * run manually with `node scripts/smoke.mjs` while `vite preview` serves dist.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173';
const OUT = process.env.SMOKE_OUT ?? 'smoke';
const executablePath = '/opt/pw-browsers/chromium';

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/?seed=SMOKE-1`);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/1-intro.png` });

// Walk the whole intro (frame count comes from data/intro.json)
for (let i = 0; i < 12; i++) {
  const btn = page.locator('[data-act="next"]');
  if ((await btn.count()) === 0) break;
  await btn.click();
  await page.waitForTimeout(150);
}
await page.screenshot({ path: `${OUT}/2-opener-event.png` });

// Resolve the opening ruin event (option 1: take the core and run)
await page.locator('[data-opt="0"]').click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/3-opener-outcome.png` });
await page.locator('[data-act="ack"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/4-sector-map.png` });

// Explore first node of the starting system
const nodeBtn = page.locator('#panel [data-node]').first();
if ((await nodeBtn.count()) > 0) {
  await nodeBtn.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/5-node-event.png` });
  const opt = page.locator('[data-opt="0"]');
  if ((await opt.count()) > 0) {
    await opt.click();
    await page.waitForTimeout(150);
    await page.locator('[data-act="ack"]').click();
    await page.waitForTimeout(200);
  }
}

// Save/resume check: reload and confirm we come back to the map, not the intro
await page.reload();
await page.waitForTimeout(400);
const overlayHidden = await page.locator('#overlay').isHidden();
await page.screenshot({ path: `${OUT}/6-after-reload.png` });

console.log(JSON.stringify({ overlayHiddenAfterReload: overlayHidden, errors }, null, 2));
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
