// Rendert eine Parameter-Variation (für Licht-Tuning): node scripts/sweep.mjs design "envrot=0" "envrot=90" ...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [design, ...variants] = process.argv.slice(2);
const out = process.env.OUT ?? 'screenshots/sweep';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1000), height: Number(process.env.H ?? 650) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text()); });
for (const v of variants) {
  await page.goto(`${process.env.BASE ?? 'http://127.0.0.1:5173/'}?demo=1&design=${design}&${v}${process.env.PARAMS ?? ''}`);
  await page.waitForTimeout(Number(process.env.WAIT ?? 9000));
  const name = v.replace(/[^a-z0-9.=-]+/gi, '_');
  await page.screenshot({ path: `${out}/${design}_${name}.png`, timeout: 180000 });
  console.log('saved', name);
}
await browser.close();
