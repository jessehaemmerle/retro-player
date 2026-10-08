// Erzeugt die PWA-Icons (realistisch schattierte Schallplatte) per Headless-Chromium.
import { chromium } from 'playwright-core';

const html = (size, pad, bg) => `<!doctype html><html><body style="margin:0;background:${bg}">
<canvas id="c" width="${size}" height="${size}"></canvas>
<script>
(() => {
const c = document.getElementById('c'), x = c.getContext('2d'), S = ${size}, P = ${pad};
if (${bg === 'transparent' ? 'false' : 'true'}) { x.fillStyle = '${bg}'; x.fillRect(0,0,S,S); }
const R = S/2 - P, cx = S/2, cy = S/2;
// Schatten
x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = S*0.04; x.shadowOffsetY = S*0.015;
x.beginPath(); x.arc(cx, cy, R, 0, Math.PI*2); x.fillStyle = '#0c0c0c'; x.fill(); x.restore();
// Rillen
for (let r = R*0.98; r > R*0.36; r -= Math.max(0.6, S/700)) {
  const v = 14 + Math.random()*10 + (Math.abs(r - R*0.7) < R*0.006 ? -8 : 0);
  x.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.lineWidth = Math.max(0.5, S/900);
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI*2); x.stroke();
}
// Anisotroper Glanz (zwei Speichen)
const g = x.createConicGradient(-Math.PI/4, cx, cy);
g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.06, 'rgba(255,255,255,.28)'); g.addColorStop(0.12, 'rgba(255,255,255,0)');
g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(0.56, 'rgba(255,255,255,.22)'); g.addColorStop(0.62, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0)');
x.save(); x.beginPath(); x.arc(cx, cy, R, 0, Math.PI*2); x.arc(cx, cy, R*0.35, 0, Math.PI*2, true); x.clip(); x.fillStyle = g; x.fillRect(0,0,S,S); x.restore();
// Label
const lg = x.createRadialGradient(cx - R*0.08, cy - R*0.1, 0, cx, cy, R*0.34);
lg.addColorStop(0, '#f6b862'); lg.addColorStop(1, '#c97f2c');
x.beginPath(); x.arc(cx, cy, R*0.34, 0, Math.PI*2); x.fillStyle = lg; x.fill();
x.fillStyle = 'rgba(60,30,5,.75)'; x.font = '600 ' + (R*0.058) + 'px sans-serif'; x.textAlign = 'center';
x.fillText('RETRO PLAYER', cx, cy - R*0.15);
x.font = '500 ' + (R*0.05) + 'px sans-serif'; x.fillText('33⅓ RPM', cx, cy + R*0.21);
x.beginPath(); x.arc(cx, cy, R*0.025, 0, Math.PI*2); x.fillStyle = '#1a1a1a'; x.fill();
})();
</script></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const jobs = [
  ['public/icons/icon-512.png', 512, 16, 'transparent'],
  ['public/icons/icon-192.png', 192, 6, 'transparent'],
  ['public/icons/icon-maskable-512.png', 512, 92, '#1a1714'],
  ['public/icons/apple-touch-icon.png', 180, 14, '#1a1714'],
];
for (const [file, size, pad, bg] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size, pad, bg));
  await page.locator('#c').screenshot({ path: file, omitBackground: bg === 'transparent' });
  console.log('wrote', file);
}
await browser.close();
