// Prüft die 3D-Bedienelemente im Demo-Modus (Headless-Chromium, Dev-Server muss laufen).
// Nutzung: node scripts/interaction-test.mjs [baseUrl]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) failures++;
};

async function load(design) {
  await page.goto(`${base}?demo=1&quality=low&clean=1&design=${design}`);
  await page.waitForFunction((d) => window.__app?.currentId === d && window.__app.current, design, { timeout: 120000 });
  await page.waitForTimeout(1500);
}
/** Bildschirmposition eines Objekts (Pfad im Design) bzw. eines lokalen Punkts darin. */
async function screenOf(expr, local = [0, 0, 0]) {
  return page.evaluate(
    ([expr, local]) => {
      const app = window.__app;
      const d = app.current;
      const obj = new Function('d', `return ${expr}`)(d);
      const THREE_V = app.stage.camera.position.constructor;
      const v = new THREE_V(...local);
      obj.updateWorldMatrix(true, false);
      v.applyMatrix4(obj.matrixWorld).project(app.stage.camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    },
    [expr, local],
  );
}
const state = () => page.evaluate(() => ({ paused: window.__app.playback.state.paused, pos: window.__app.playback.position(), vol: window.__app.playback.state.volume, track: window.__app.playback.state.track?.name }));
async function click(p) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(600);
}
async function drag(a, b, steps = 12) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
}

// ---------------- Plattenspieler
await load('turntable');
{
  const s0 = await state();
  check('turntable: startet pausiert', s0.paused);
  const head = await screenOf('d.headshell', [0.045, -0.008, 0]);
  // Ziel: Punkt auf der Platte (Radius ~10 cm, Richtung Arm)
  const target = await screenOf('d.platter', [0.06, 0.03, 0.08]);
  await drag(head, target, 16);
  await page.waitForTimeout(1500);
  const s1 = await state();
  check('turntable: Nadel absetzen startet Wiedergabe', !s1.paused, JSON.stringify(s1));
  check('turntable: Position entspricht Radius (> 0 s)', s1.pos > 5000, `${Math.round(s1.pos / 1000)} s`);
  const knob = await screenOf('d.volumeKnob');
  const v0 = (await state()).vol;
  await drag(knob, { x: knob.x, y: knob.y - 80 });
  const v1 = (await state()).vol;
  check('turntable: Lautstärkeknopf dreht', v1 > v0 + 0.1, `${v0.toFixed(2)} → ${v1.toFixed(2)}`);
  const btn = await screenOf('d.startCap');
  await click(btn);
  check('turntable: Start/Stop pausiert', (await state()).paused);
}

// ---------------- Boombox
await load('boombox');
{
  const play = await screenOf("d.keys.get('play').group", [0, 0.01, 0.03]);
  await click(play);
  check('boombox: PLAY-Taste spielt', !(await state()).paused);
  const t0 = (await state()).track;
  const ff = await screenOf("d.keys.get('ff').group", [0, 0.01, 0.03]);
  await click(ff);
  const t1 = (await state()).track;
  check('boombox: FF wechselt Titel', t0 !== t1, `${t0} → ${t1}`);
  const stop = await screenOf("d.keys.get('stop').group", [0, 0.01, 0.03]);
  await click(stop);
  check('boombox: STOP pausiert', (await state()).paused);
  const vol = await screenOf('d.volumeKnob');
  const v0 = (await state()).vol;
  await drag(vol, { x: vol.x, y: vol.y + 60 });
  check('boombox: VOLUME dreht', (await state()).vol < v0 - 0.05);
}

// ---------------- Receiver
await load('amplifier');
{
  const power = await screenOf('d.powerBtn');
  await click(power);
  check('receiver: POWER spielt', !(await state()).paused);
  const tune = await screenOf("d.knobs.get('tuning')");
  const p0 = (await state()).pos;
  await drag(tune, { x: tune.x, y: tune.y - 120 });
  await page.waitForTimeout(400);
  const p1 = (await state()).pos;
  check('receiver: TUNING spult vor', p1 > p0 + 20000, `${Math.round(p0 / 1000)} → ${Math.round(p1 / 1000)} s`);
  const t0 = (await state()).track;
  const seek = await screenOf("d.knobs.get('seek')");
  await drag(seek, { x: seek.x + 60, y: seek.y });
  check('receiver: SEEK ▶ nächster Titel', (await state()).track !== t0);
  const mute = await screenOf('d.toggles[0].lever', [0, 0, 0.008]);
  await click(mute);
  check('receiver: MUTING stumm', (await state()).vol === 0);
}

// ---------------- Walkman
await load('walkman');
{
  const play = await screenOf("d.keys.get('play').group", [0, 0.004, 0]);
  await click(play);
  check('walkman: PLAY spielt', !(await state()).paused);
  const hot = await screenOf('d.hotline', [0, 0.003, 0]);
  await click(hot);
  check('walkman: HOTLINE stumm', (await state()).vol === 0);
  await click(hot);
  check('walkman: HOTLINE Ton wieder an', (await state()).vol > 0);
  const stop = await screenOf("d.keys.get('stop').group", [0, 0.004, 0]);
  await click(stop);
  check('walkman: STOP pausiert', (await state()).paused);
}

// ---------------- Discman
await load('discman');
{
  const play = await screenOf("d.buttons.get('play').cap", [0, 0.002, 0]);
  await click(play);
  check('discman: ▶❚❚ spielt', !(await state()).paused);
  const t0 = (await state()).track;
  const next = await screenOf("d.buttons.get('next').cap", [0, 0.002, 0]);
  await click(next);
  check('discman: ▶▶ nächster Titel', (await state()).track !== t0);
  const open = await screenOf('d.openSlider');
  await click(open);
  check('discman: OPEN pausiert', (await state()).paused);
}

await browser.close();
console.log(failures ? `\n${failures} Fehler` : '\nAlle Interaktionen OK');
process.exit(failures ? 1 : 0);
