// Testet die Spotify-Anbindung gegen eine gemockte Web API und ein Fake-Playback-SDK.
// Nutzung: node scripts/spotify-mock-test.mjs [baseUrl]   (Dev-Server muss laufen)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

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
const calls = [];
const art = fs.readFileSync('public/icons/icon-512.png');
const track = (n) => ({
  id: `t${n}`, uri: `spotify:track:t${n}`, name: `Testtitel ${n}`, type: 'track', duration_ms: 200000 + n * 1000, track_number: n,
  artists: [{ name: 'Testband', uri: 'spotify:artist:a' }],
  album: { id: 'al1', name: 'Testalbum', uri: 'spotify:album:al1', images: [{ url: 'https://i.scdn.co/image/fake640', width: 640, height: 640 }, { url: 'https://i.scdn.co/image/fake64', width: 64, height: 64 }], artists: [] },
  external_urls: { spotify: `https://open.spotify.com/track/t${n}` },
});

const FAKE_SDK = `
window.Spotify = { Player: class {
  constructor(o) { this.o = o; this.l = {}; this.state = null; window.__fakePlayer = this; }
  addListener(e, f) { this.l[e] = f; return true; }
  removeListener() { return true; }
  connect() { this.o.getOAuthToken((t) => { window.__sdkToken = t; }); setTimeout(() => this.l.ready && this.l.ready({ device_id: 'dev-local' }), 50); return Promise.resolve(true); }
  disconnect() {}
  getCurrentState() { return Promise.resolve(this.state); }
  setName() { return Promise.resolve(); }
  getVolume() { return Promise.resolve(this.vol ?? 0.6); }
  setVolume(v) { this.vol = v; window.__sdkCalls.push('volume:' + v.toFixed(2)); return Promise.resolve(); }
  pause() { window.__sdkCalls.push('pause'); this.emit({ paused: true }); return Promise.resolve(); }
  resume() { window.__sdkCalls.push('resume'); this.emit({ paused: false }); return Promise.resolve(); }
  togglePlay() { return this.state && this.state.paused ? this.resume() : this.pause(); }
  seek(ms) { window.__sdkCalls.push('seek:' + Math.round(ms)); this.emit({ position: ms }); return Promise.resolve(); }
  previousTrack() { window.__sdkCalls.push('prev'); return Promise.resolve(); }
  nextTrack() { window.__sdkCalls.push('next'); return Promise.resolve(); }
  activateElement() { window.__sdkCalls.push('activate'); return Promise.resolve(); }
  emit(patch) { this.state = Object.assign({}, this.state, patch); this.l.player_state_changed && this.l.player_state_changed(this.state); }
} };
window.__sdkCalls = [];
setTimeout(() => window.onSpotifyWebPlaybackSDKReady(), 10);
`;

await page.route('https://sdk.scdn.co/spotify-player.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SDK }));
await page.route('https://i.scdn.co/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: art, headers: { 'Access-Control-Allow-Origin': '*' } }));
await page.route('https://accounts.spotify.com/**', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ access_token: 'new-token', token_type: 'Bearer', expires_in: 3600, scope: 'streaming' }) }),
);
let playing = null; // aktueller Zustand für GET /me/player
await page.route('https://api.spotify.com/**', async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname.replace('/v1', '');
  const auth = req.headers()['authorization'];
  calls.push(`${req.method()} ${p}${url.search}`);
  const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
  if (auth !== 'Bearer test-token' && auth !== 'Bearer new-token') return json({ error: { status: 401, message: 'bad token' } }, 401);
  if (p === '/me') return json({ id: 'u1', display_name: 'Test Nutzer', images: [] });
  if (p === '/me/player' && req.method() === 'GET') return playing ? json(playing) : r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  if (p === '/me/player/devices') return json({ devices: [{ id: 'dev-local', is_active: true, is_restricted: false, name: 'Retro Player', type: 'Computer', volume_percent: 60 }, { id: 'dev-phone', is_active: false, is_restricted: false, name: 'Handy', type: 'Smartphone', volume_percent: 40 }] });
  if (p === '/me/playlists') return json({ items: [{ id: 'pl1', name: 'Meine Playlist', uri: 'spotify:playlist:pl1', images: [{ url: 'https://i.scdn.co/image/fake64', width: 64, height: 64 }], owner: { id: 'u1', display_name: 'Test Nutzer' } }], total: 1, limit: 50, offset: 0, next: null });
  if (p === '/search') return json({ tracks: { items: [track(7), track(8)], total: 2, limit: 10, offset: 0, next: null }, albums: { items: [], total: 0 }, playlists: { items: [null], total: 0 } });
  if (p === '/me/player/play') {
    await r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    const body = JSON.parse(req.postData() || '{}');
    const t = body.uris ? track(Number(body.uris[0].replace('spotify:track:t', ''))) : track(1);
    playing = { device: { id: 'dev-local', name: 'Retro Player', is_active: true, volume_percent: 60 }, is_playing: true, progress_ms: 0, item: t, shuffle_state: false, repeat_state: 'off', timestamp: Date.now(), context: null };
    await page.evaluate((t) => window.__fakePlayer.emit({ paused: false, position: 0, duration: t.duration_ms, shuffle: false, repeat_mode: 0, track_window: { current_track: t } }), t);
    return;
  }
  return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
});

// PKCE-Rückkehr simulieren: ?code=…&state=… → Token wird geholt und gespeichert
let tokenBody = '';
page.on('request', (req) => {
  if (req.url().startsWith('https://accounts.spotify.com/api/token')) tokenBody = req.postData() ?? '';
});
await page.goto(base + '?design=discman&quality=low');
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('rp.clientId', '0123456789abcdef0123456789abcdef');
  sessionStorage.setItem('rp.pkce', JSON.stringify({ verifier: 'v'.repeat(64), state: 'st4te' }));
});
await page.goto(base + '?design=discman&quality=low&code=authcode&state=st4te');
await page.waitForFunction(() => !!localStorage.getItem('rp.token'), null, { timeout: 60000 });
check('PKCE: Code gegen Token getauscht', tokenBody.includes('grant_type=authorization_code') && tokenBody.includes('code_verifier=' + 'v'.repeat(64)));
check('PKCE: Code aus der URL entfernt', !(await page.evaluate(() => location.search)).includes('code='));
// ab hier mit bekanntem Test-Token weiter
await page.evaluate(() => {
  localStorage.setItem('rp.token', JSON.stringify({ accessToken: 'test-token', refreshToken: 'r', expiresAt: Date.now() + 3600e3, scope: '' }));
});
await page.goto(base + '?design=discman&quality=low');
await page.waitForFunction(() => window.__app?.playback?.kind === 'spotify' && window.__app.currentId === 'discman', null, { timeout: 120000 });
await page.waitForFunction(() => window.__app.playback.localDeviceId === 'dev-local', null, { timeout: 20000 });
check('SDK verbunden, Gerät bereit', true);
check('SDK bekommt Token', (await page.evaluate(() => window.__sdkToken)) === 'test-token');
await page.waitForTimeout(800);
check('Konto-Name in der Kopfzeile', (await page.locator('.actions .label').allTextContents()).includes('Test Nutzer'));

// Bibliothek → Playlist abspielen
await page.keyboard.press('l');
await page.getByText('Meine Playlist').click();
await page.waitForTimeout(800);
check('PUT /me/player/play mit device_id & context_uri', calls.some((c) => c.startsWith('PUT /me/player/play?device_id=dev-local')));
await page.waitForFunction(() => document.querySelector('.np-title')?.textContent === 'Testtitel 1', null, { timeout: 5000 }).catch(() => {});
check('Titel in der Anzeige', (await page.locator('.np-title').textContent()) === 'Testtitel 1');
check('Wiedergabe läuft lokal', await page.evaluate(() => !window.__app.playback.state.paused && window.__app.playback.state.local));
await page.waitForTimeout(1500);
check('Cover geladen (Textur)', await page.evaluate(() => !!window.__app.art));

// Pause/Play über Leertaste → SDK
await page.keyboard.press('Escape');
await page.keyboard.press(' ');
await page.waitForTimeout(300);
check('Leertaste pausiert über SDK', (await page.evaluate(() => window.__sdkCalls)).includes('pause'));
await page.keyboard.press(' ');
await page.waitForTimeout(300);
check('Leertaste spielt über SDK', (await page.evaluate(() => window.__sdkCalls)).includes('resume'));
// Lautstärke & Spulen lokal über das SDK
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const sdk = await page.evaluate(() => window.__sdkCalls);
check('Lautstärke über SDK', sdk.some((c) => c.startsWith('volume:')));
check('Spulen über SDK', sdk.some((c) => c.startsWith('seek:')));

// Suche → Titel abspielen
await page.keyboard.press('l');
await page.getByRole('tab', { name: 'Suche' }).click();
await page.locator('.searchbox input').fill('test');
await page.waitForTimeout(900);
check('Suche fragt API (limit 10)', calls.some((c) => c.startsWith('GET /search') && c.includes('limit=10')));
await page.getByText('Testtitel 8').click();
await page.waitForTimeout(800);
check('Titel aus Suche spielt', (await page.locator('.np-title').textContent()) === 'Testtitel 8');

// Geräte-Liste
await page.getByRole('tab', { name: 'Geräte' }).click();
await page.waitForTimeout(600);
check('Geräteliste zeigt Handy', (await page.locator('.drawer .item .t').allTextContents()).some((t) => t.includes('Handy')));

await browser.close();
console.log(failures ? `\n${failures} Fehler` : '\nSpotify-Anbindung OK (Mock)');
process.exit(failures ? 1 : 0);
