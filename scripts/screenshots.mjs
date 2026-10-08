// Rendert alle (oder ausgewählte) Designs im Demo-Modus und speichert Screenshots.
// Nutzung: node scripts/screenshots.mjs [url] [design1,design2] [outDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const only = process.argv[3] ? process.argv[3].split(',') : ['turntable', 'boombox', 'amplifier', 'walkman', 'discman'];
const out = process.argv[4] ?? 'screenshots';
const width = Number(process.env.W ?? 1600);
const height = Number(process.env.H ?? 1000);
const wait = Number(process.env.WAIT ?? 9000);
fs.mkdirSync(out, { recursive: true });

const executablePath = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const d of only) {
  const extra = process.env.PARAMS ?? '';
  await page.goto(`${base}?demo=1&design=${d}${extra}`, { waitUntil: 'load' });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${d}.png`, timeout: 180000 });
  console.log('saved', `${out}/${d}.png`);
}
await browser.close();
