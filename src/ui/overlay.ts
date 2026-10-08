import type { App } from '../app';
import type { PlaybackController, PlaybackState } from '../playback/types';
import { formatTime } from '../designs/base';
import { icons } from './icons';
import { el, iconButton, setIconLabel } from './dom';
import { Library } from './library';
import { Settings } from './settings';
import { setupInstall } from './install';
import { getClientId, isLoggedIn, login } from '../spotify/auth';
import { api, pickImage } from '../spotify/api';

const HINTS: Record<string, string> = {
  turntable: 'Tonarm auf die Platte ziehen, um abzuspielen – die Position auf der Platte ist die Position im Song. Rechts unten: Lautstärke.',
  boombox: 'Piano-Tasten oben drücken (▶ rastet ein, ◀◀/▶▶ wechseln den Titel). VOLUME-Knopf für die Lautstärke.',
  amplifier: 'POWER = Play/Pause · TUNING spult im Titel · SEEK STATION wechselt den Titel · MUTING schaltet stumm.',
  walkman: 'Tasten an der Oberkante drücken · Rändelrad links = Lautstärke · orange HOTLINE-Taste = stumm.',
  discman: '▶❚❚ drücken · Rad links = Lautstärke · OPEN-Schieber rechts öffnet den Deckel · HOLD sperrt die Tasten.',
};

export function mountUI(app: App, root: HTMLElement) {
  new Overlay(app, root);
  // ?clean=1 blendet die Oberfläche aus (z. B. für Screenshots)
  if (new URLSearchParams(location.search).has('clean')) root.style.display = 'none';
}

class Overlay {
  private designBtns = new Map<string, HTMLButtonElement>();
  private np!: {
    art: HTMLImageElement;
    title: HTMLElement;
    artist: HTMLElement;
    open: HTMLAnchorElement;
    pos: HTMLElement;
    dur: HTMLElement;
    seek: HTMLInputElement;
    play: HTMLButtonElement;
    shuffle: HTMLButtonElement;
    repeat: HTMLButtonElement;
    device: HTMLElement;
    vol: HTMLInputElement;
  };
  private hint = el('div', 'hint glass');
  private toasts = el('div', 'toasts');
  private loader = el('div', 'loader');
  private welcome = el('div', 'welcome glass');
  private connectBtn!: HTMLButtonElement;
  private demoBadge!: HTMLElement;
  private library: Library;
  private settings: Settings;
  private unsub: Array<() => void> = [];
  private seeking = false;
  private idleTimer = 0;
  private hintTimer = 0;
  private shownHints = new Set<string>();

  constructor(
    private app: App,
    private root: HTMLElement,
  ) {
    this.library = new Library(app, root);
    this.settings = new Settings(app, root);
    this.buildTopbar();
    this.buildNowPlaying();
    this.loader.append(el('div', 'disc'), el('span', '', 'Lade …'));
    root.append(this.hint, this.toasts, this.loader, this.welcome);
    this.buildWelcome();

    app.events.on('design', (id) => this.onDesign(id));
    app.events.on('playback', (pb) => this.bindPlayback(pb));
    app.events.on('loading', (on) => this.loader.classList.toggle('visible', on));
    app.events.on('toast', (t) => this.toast(t.text, t.kind));
    this.bindPlayback(app.playback);
    this.setupIdle();
    this.setupKeys();
    requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------------ Aufbau

  private buildTopbar() {
    const bar = el('header', 'topbar ui-fadeable');
    const brand = el('div', 'brand glass', 'Retro Player');
    brand.append(el('small', '', 'für Spotify'));
    this.demoBadge = el('span', 'demo-badge', 'DEMO');
    brand.append(this.demoBadge);
    const nav = el('nav', 'designs glass');
    nav.setAttribute('aria-label', 'Gerät wählen');
    this.app.designList.forEach((d, i) => {
      const b = iconButton('', icons[d.id as keyof typeof icons] ?? '', d.name, `${d.name} (${i + 1})`, () => this.app.switchDesign(d.id), true);
      b.className = '';
      b.setAttribute('aria-pressed', 'false');
      nav.append(b);
      this.designBtns.set(d.id, b);
    });
    const actions = el('div', 'actions glass');
    const libBtn = iconButton('icon-btn', icons.library, 'Bibliothek', 'Bibliothek & Suche (L)', () => this.library.toggle());
    this.connectBtn = iconButton('icon-btn spotify', icons.spotify, 'Verbinden', 'Mit Spotify verbinden', () => this.connect());
    const installBtn = iconButton('icon-btn', icons.install, 'Installieren', 'Als App installieren', () => {});
    installBtn.hidden = true;
    setupInstall(installBtn, (m) => this.toast(m));
    const fsBtn = iconButton('icon-btn', icons.expand, '', 'Vollbild (F)', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => setIconLabel(fsBtn, document.fullscreenElement ? icons.shrink : icons.expand, ''));
    const setBtn = iconButton('icon-btn', icons.settings, '', 'Einstellungen', () => this.settings.open());
    actions.append(libBtn, this.connectBtn, installBtn, fsBtn, setBtn);
    bar.append(brand, nav, actions);
    this.root.append(bar);
  }

  private buildNowPlaying() {
    const card = el('section', 'nowplaying glass ui-fadeable');
    card.setAttribute('aria-label', 'Aktueller Titel');
    const art = el('img', 'np-art');
    art.alt = 'Album-Cover';
    art.decoding = 'async';
    const meta = el('div', 'np-meta');
    const title = el('div', 'np-title', '–');
    const artist = el('div', 'np-artist', '');
    const open = el('a', 'np-open');
    setIconLabel(open, icons.spotify, 'Auf Spotify öffnen');
    open.target = '_blank';
    open.rel = 'noopener';
    meta.append(title, artist, open);
    const prog = el('div', 'np-progress');
    const pos = el('span', '', '0:00');
    const seek = el('input', 'range');
    seek.type = 'range';
    seek.min = '0';
    seek.max = '1000';
    seek.value = '0';
    seek.setAttribute('aria-label', 'Position');
    const dur = el('span', '', '0:00');
    prog.append(pos, seek, dur);
    seek.addEventListener('input', () => {
      this.seeking = true;
      const d = this.app.playback.state.track?.durationMs ?? 0;
      pos.textContent = formatTime((Number(seek.value) / 1000) * d);
      seek.style.setProperty('--p', `${Number(seek.value) / 10}%`);
    });
    seek.addEventListener('change', () => {
      const d = this.app.playback.state.track?.durationMs ?? 0;
      this.app.playback.seek((Number(seek.value) / 1000) * d);
      this.seeking = false;
    });

    const controls = el('div', 'np-controls');
    const main = el('div', 'main');
    const shuffle = iconButton('icon-btn', icons.shuffle, '', 'Zufallswiedergabe', () => this.app.playback.setShuffle(!this.app.playback.state.shuffle));
    const prev = iconButton('icon-btn', icons.prev, '', 'Vorheriger Titel', () => this.app.playback.previous());
    const play = iconButton('icon-btn play', icons.play, '', 'Play/Pause (Leertaste)', () => this.app.playback.toggle());
    const next = iconButton('icon-btn', icons.next, '', 'Nächster Titel', () => this.app.playback.next());
    const repeat = iconButton('icon-btn', icons.repeat, '', 'Wiederholen', () => this.app.playback.cycleRepeat());
    main.append(shuffle, prev, play, next, repeat);
    const device = el('button', 'np-device icon-btn');
    setIconLabel(device, icons.devices, '');
    device.title = 'Wiedergabegerät wählen';
    device.addEventListener('click', () => this.library.open('devices'));
    const volWrap = el('div', 'np-vol');
    setIconLabel(volWrap, icons.volume, '');
    const vol = el('input', 'range');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.setAttribute('aria-label', 'Lautstärke');
    vol.addEventListener('input', () => this.app.playback.setVolume(Number(vol.value) / 100));
    volWrap.append(vol);
    controls.append(main, volWrap);
    device.style.gridColumn = '1 / -1';
    device.style.justifyContent = 'flex-start';
    device.style.maxWidth = 'none';
    device.style.height = '24px';
    card.append(art, meta, prog, controls, device);
    this.root.append(card);
    this.np = { art, title, artist, open, pos, dur, seek, play, shuffle, repeat, device, vol };
  }

  private buildWelcome() {
    const hasId = !!getClientId();
    this.welcome.append(
      el('h1', '', 'Retro Player'),
      el(
        'p',
        '',
        'Höre deine Spotify-Musik über fotorealistische Klassiker – vom Plattenspieler bis zum Discman.' +
          (hasId ? '' : ' Für die Verbindung brauchst du einmalig eine eigene Spotify-Client-ID (Anleitung in den Einstellungen).'),
      ),
    );
    const row = el('div', 'row');
    const c = iconButton('icon-btn spotify', icons.spotify, 'Mit Spotify verbinden', 'Mit Spotify verbinden', () => this.connect());
    const d = iconButton('icon-btn', icons.eye, 'Erst mal umsehen (Demo)', 'Demo ansehen', () => {
      sessionStorage.setItem('rp.welcomeSeen', '1');
      this.welcome.hidden = true;
    });
    d.style.border = '1px solid var(--line-strong)';
    row.append(c, d);
    this.welcome.append(row);
    this.welcome.hidden = isLoggedIn() || sessionStorage.getItem('rp.welcomeSeen') === '1' || new URLSearchParams(location.search).has('demo');
  }

  // ------------------------------------------------------------------ Verhalten

  private async connect() {
    if (this.app.playback.kind === 'spotify') {
      this.settings.open();
      return;
    }
    if (!getClientId()) {
      this.welcome.hidden = true;
      this.settings.open(true);
      return;
    }
    try {
      await login();
    } catch (e) {
      this.toast((e as Error).message, 'error');
      this.settings.open(true);
    }
  }

  private onDesign(id: string) {
    for (const [k, b] of this.designBtns) b.setAttribute('aria-pressed', String(k === id));
    clearTimeout(this.hintTimer);
    const text = HINTS[id];
    if (!text) return;
    const first = !this.shownHints.has(id);
    this.shownHints.add(id);
    this.hint.textContent = text;
    this.hint.classList.add('visible');
    this.hintTimer = window.setTimeout(() => this.hint.classList.remove('visible'), first ? 7000 : 3500);
  }

  private bindPlayback(pb: PlaybackController) {
    this.unsub.forEach((u) => u());
    this.unsub = [
      pb.events.on('state', (s) => this.renderState(s)),
      pb.events.on('track', () => this.renderState(pb.state)),
      pb.events.on('needs-content', () => {
        this.toast('Wähle zuerst Musik aus deiner Bibliothek.');
        this.library.open('playlists');
      }),
    ];
    const spotify = pb.kind === 'spotify';
    this.demoBadge.hidden = spotify;
    setIconLabel(this.connectBtn, icons.spotify, spotify ? 'Konto' : 'Verbinden');
    this.connectBtn.classList.toggle('spotify', !spotify);
    if (spotify) {
      this.welcome.hidden = true;
      api
        .me()
        .then((me) => {
          const name = me.display_name ?? 'Konto';
          const img = pickImage(me.images, 64);
          if (img) {
            const avatar = el('img', 'avatar');
            avatar.src = img;
            avatar.alt = '';
            this.connectBtn.replaceChildren(avatar, el('span', 'label', name));
          } else setIconLabel(this.connectBtn, icons.spotify, name);
          this.connectBtn.title = `Angemeldet als ${me.display_name ?? me.id}`;
        })
        .catch(() => {});
    }
    this.library.reset();
    this.renderState(pb.state);
  }

  private renderState(s: PlaybackState) {
    const t = s.track;
    const np = this.np;
    np.title.textContent = t?.name ?? 'Nichts ausgewählt';
    np.artist.textContent = t ? `${t.artists}${t.album ? ' · ' + t.album : ''}` : 'Öffne die Bibliothek, um Musik zu wählen';
    const art = t?.artUrlSmall ?? '';
    if (np.art.dataset.src !== art) {
      np.art.dataset.src = art;
      if (art) np.art.src = art;
      else np.art.removeAttribute('src');
    }
    np.open.hidden = !t?.spotifyUrl;
    if (t?.spotifyUrl) np.open.href = t.spotifyUrl;
    setIconLabel(np.play, s.paused ? icons.play : icons.pause, '');
    np.play.title = s.paused ? 'Abspielen (Leertaste)' : 'Pause (Leertaste)';
    np.shuffle.classList.toggle('active', s.shuffle);
    np.repeat.classList.toggle('active', s.repeat !== 'off');
    setIconLabel(np.repeat, s.repeat === 'track' ? icons.repeatOne : icons.repeat, '');
    setIconLabel(np.device, icons.devices, s.deviceName ?? (this.app.playback.kind === 'spotify' ? 'Kein aktives Gerät – hier tippen' : 'Demo-Modus (ohne Ton)'));
    if (document.activeElement !== np.vol) np.vol.value = String(Math.round(s.volume * 100));
    this.library.markPlaying(t?.uri ?? null);
  }

  private tick = () => {
    const pb = this.app.playback;
    const t = pb.state.track;
    if (!this.seeking) {
      const p = pb.position();
      const d = t?.durationMs ?? 0;
      this.np.pos.textContent = formatTime(p);
      this.np.dur.textContent = formatTime(d);
      const v = d ? Math.round((p / d) * 1000) : 0;
      if (this.np.seek.value !== String(v)) {
        this.np.seek.value = String(v);
        this.np.seek.style.setProperty('--p', `${v / 10}%`);
      }
    }
    this.np.vol.style.setProperty('--p', `${this.np.vol.value}%`);
    requestAnimationFrame(this.tick);
  };

  toast(text: string, kind: 'info' | 'error' = 'info') {
    const t = el('div', `toast glass ${kind}`, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(
      () => {
        t.classList.add('leaving');
        setTimeout(() => t.remove(), 350);
      },
      kind === 'error' ? 7000 : 4000,
    );
  }

  private setupIdle() {
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => {
        const busy = this.library.isOpen || this.settings.isOpen || !this.welcome.hidden || this.app.playback.state.paused;
        if (!busy) document.body.classList.add('idle');
      }, 4000);
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, wake, { passive: true });
    wake();
  }

  private toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  private setupKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]') && e.key !== 'Escape') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const pb = this.app.playback;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          pb.toggle();
          break;
        case 'ArrowRight':
          if (e.shiftKey) pb.next();
          else pb.seek(pb.position() + 10000);
          break;
        case 'ArrowLeft':
          if (e.shiftKey) pb.previous();
          else pb.seek(pb.position() - 10000);
          break;
        case 'ArrowUp':
          e.preventDefault();
          pb.setVolume(pb.state.volume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          pb.setVolume(pb.state.volume - 0.05);
          break;
        case 'n':
        case 'N':
          pb.next();
          break;
        case 'p':
        case 'P':
          pb.previous();
          break;
        case 'l':
        case 'L':
          this.library.toggle();
          break;
        case 'f':
        case 'F':
          this.toggleFullscreen();
          break;
        case 'r':
        case 'R':
          this.app.stage.resetView();
          break;
        case 'Escape':
          this.library.close();
          this.settings.close();
          break;
        default:
          if (/^[1-9]$/.test(e.key)) {
            const d = this.app.designList[Number(e.key) - 1];
            if (d) this.app.switchDesign(d.id);
          }
      }
    });
  }
}
