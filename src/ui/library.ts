import type { App } from '../app';
import { api, pickImage, type SpAlbum, type SpDevice, type SpPlaylist, type SpTrack, type Paging } from '../spotify/api';
import type { DemoController } from '../playback/demoController';
import type { SpotifyController } from '../playback/spotifyController';
import { formatTime } from '../designs/base';
import { icons } from './icons';
import { el, iconButton, setIconLabel, svg } from './dom';

type Tab = 'search' | 'playlists' | 'albums' | 'tracks' | 'recent' | 'devices';

const TABS: Array<[Tab, string]> = [
  ['search', 'Suche'],
  ['playlists', 'Playlists'],
  ['albums', 'Alben'],
  ['tracks', 'Lieblingssongs'],
  ['recent', 'Zuletzt gehört'],
  ['devices', 'Geräte'],
];

export class Library {
  isOpen = false;
  private drawer = el('aside', 'drawer glass');
  private list = el('div', 'list');
  private search = el('label', 'searchbox');
  private input = el('input');
  private tabBtns = new Map<Tab, HTMLButtonElement>();
  private tabsEl = el('div', 'tabs');
  private tab: Tab = 'playlists';
  private playingUri: string | null = null;
  private searchTimer = 0;
  private cache = new Map<string, unknown>();
  private requestId = 0;

  constructor(
    private app: App,
    root: HTMLElement,
  ) {
    const d = this.drawer;
    d.setAttribute('aria-label', 'Bibliothek');
    const header = el('header');
    header.append(el('h2', '', 'Bibliothek'));
    header.append(iconButton('icon-btn', icons.close, '', 'Schließen (Esc)', () => this.close()));
    const tabs = this.tabsEl;
    tabs.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
      const b = el('button', 'pill', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.show(id));
      tabs.append(b);
      this.tabBtns.set(id, b);
    }
    this.search.append(svg(icons.search), this.input);
    this.input.type = 'search';
    this.input.placeholder = 'Titel, Alben, Playlists suchen …';
    this.input.setAttribute('aria-label', 'Suche');
    this.input.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.runSearch(this.input.value.trim()), 350);
    });
    d.append(header, tabs, this.search, this.list);
    root.append(d);
  }

  open(tab?: Tab) {
    this.isOpen = true;
    this.drawer.classList.add('open');
    this.show(tab ?? (this.app.playback.kind === 'demo' ? 'playlists' : this.tab));
    if ((tab ?? this.tab) === 'search') setTimeout(() => this.input.focus(), 250);
  }

  close() {
    this.isOpen = false;
    this.drawer.classList.remove('open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  reset() {
    this.cache.clear();
    if (this.isOpen) this.show(this.tab);
  }

  markPlaying(uri: string | null) {
    this.playingUri = uri;
    this.list.querySelectorAll<HTMLElement>('.item[data-uri]').forEach((i) => i.classList.toggle('playing', i.dataset.uri === uri));
  }

  // ------------------------------------------------------------------ Ansichten

  private show(tab: Tab) {
    this.tab = tab;
    for (const [id, b] of this.tabBtns) b.setAttribute('aria-selected', String(id === tab));
    const demo = this.app.playback.kind === 'demo';
    this.tabsEl.hidden = demo;
    this.search.hidden = demo || tab !== 'search';
    if (demo) return this.renderDemo();
    const id = ++this.requestId;
    switch (tab) {
      case 'search':
        this.runSearch(this.input.value.trim());
        break;
      case 'playlists':
        this.loadPaged('playlists', (o) => api.myPlaylists(o), (items) => this.renderPlaylists(items.filter(Boolean) as SpPlaylist[]), id);
        break;
      case 'albums':
        this.loadPaged('albums', (o) => api.savedAlbums(o), (items) => this.renderAlbums(items.map((i) => i.album)), id);
        break;
      case 'tracks':
        this.loadPaged('tracks', (o) => api.savedTracks(o), (items) => this.renderTracks(items.map((i) => i.track)), id);
        break;
      case 'recent':
        this.loadRecent(id);
        break;
      case 'devices':
        this.loadDevices(id);
        break;
    }
  }

  private message(text: string, action?: [string, () => void]) {
    const m = el('div', 'empty', text);
    if (action) {
      const b = iconButton('icon-btn spotify more', icons.spotify, action[0], action[0], action[1]);
      m.append(el('br'), b);
    }
    this.list.replaceChildren(m);
  }

  private renderDemo() {
    const demo = this.app.playback as DemoController;
    const head = el('div', 'empty', 'Demo-Modus: Die Geräte laufen mit Beispieltiteln (ohne Ton). Verbinde Spotify, um deine Bibliothek zu sehen und echte Musik zu hören.');
    const rows = demo.demoTracks.map((t, i) =>
      this.item({
        img: t.artUrlSmall,
        title: t.name,
        sub: `${t.artists} · ${t.album}`,
        detail: formatTime(t.durationMs),
        uri: t.uri,
        onClick: () => this.app.playback.playUris({ offsetIndex: i }),
      }),
    );
    this.list.replaceChildren(head, el('h3', '', 'Demo-Titel'), ...rows);
  }

  private async loadPaged<T>(key: string, fetchPage: (offset: number) => Promise<Paging<T>>, render: (items: T[]) => HTMLElement[], reqId: number) {
    type Entry = { items: T[]; next: boolean };
    let entry = this.cache.get(key) as Entry | undefined;
    if (!entry) {
      this.message('Lade …');
      try {
        const page = await fetchPage(0);
        entry = { items: page.items, next: !!page.next };
        this.cache.set(key, entry);
      } catch (e) {
        if (reqId === this.requestId) this.message(`Konnte nicht geladen werden: ${(e as Error).message}`);
        return;
      }
    }
    if (reqId !== this.requestId) return;
    const nodes = render(entry.items);
    if (!nodes.length) return this.message('Hier ist noch nichts.');
    if (entry.next) {
      const more = el('button', 'pill more', 'Mehr laden');
      more.addEventListener('click', async () => {
        more.disabled = true;
        try {
          const page = await fetchPage(entry!.items.length);
          entry!.items.push(...page.items);
          entry!.next = !!page.next;
          this.show(this.tab);
        } catch {
          more.disabled = false;
        }
      });
      nodes.push(more);
    }
    this.list.replaceChildren(...nodes);
    this.markPlaying(this.playingUri);
  }

  private async runSearch(q: string) {
    const reqId = ++this.requestId;
    if (!q) {
      this.message('Suche nach Titeln, Alben oder Playlists.');
      return;
    }
    this.message('Suche …');
    try {
      const r = await api.search(q);
      if (reqId !== this.requestId) return;
      const nodes: HTMLElement[] = [];
      const tracks = r.tracks?.items ?? [];
      if (tracks.length) nodes.push(el('h3', '', 'Titel'), ...this.renderTracks(tracks));
      const albums = r.albums?.items ?? [];
      if (albums.length) nodes.push(el('h3', '', 'Alben'), ...this.renderAlbums(albums));
      const pls = (r.playlists?.items ?? []).filter(Boolean) as SpPlaylist[];
      if (pls.length) nodes.push(el('h3', '', 'Playlists'), ...this.renderPlaylists(pls));
      if (!nodes.length) return this.message(`Keine Treffer für „${q}“.`);
      this.list.replaceChildren(...nodes);
      this.markPlaying(this.playingUri);
    } catch (e) {
      if (reqId === this.requestId) this.message(`Suche fehlgeschlagen: ${(e as Error).message}`);
    }
  }

  private async loadRecent(reqId: number) {
    this.message('Lade …');
    try {
      const r = await api.recentlyPlayed();
      if (reqId !== this.requestId) return;
      // Duplikate entfernen
      const seen = new Set<string>();
      const tracks = r.items.map((i) => i.track).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
      const nodes = this.renderTracks(tracks);
      if (!nodes.length) return this.message('Noch nichts gehört.');
      this.list.replaceChildren(...nodes);
      this.markPlaying(this.playingUri);
    } catch (e) {
      if (reqId === this.requestId) this.message(`Konnte nicht geladen werden: ${(e as Error).message}`);
    }
  }

  private async loadDevices(reqId: number) {
    this.message('Suche Geräte …');
    try {
      const { devices } = await api.devices();
      if (reqId !== this.requestId) return;
      const sp = this.app.playback as SpotifyController;
      const local = sp.localDeviceId;
      const nodes: HTMLElement[] = [el('div', 'empty', 'Wähle, wo die Musik spielen soll. Die Geräte hier im Fenster steuern dann das gewählte Spotify-Gerät.')];
      const sorted = [...devices].sort((a, b) => Number(b.id === local) - Number(a.id === local));
      for (const d of sorted) nodes.push(this.deviceItem(d, d.id === local));
      if (!devices.some((d) => d.id === local)) nodes.push(el('div', 'empty', 'Der Browser-Player ist noch nicht bereit (Spotify Premium erforderlich).'));
      const refresh = el('button', 'pill more', 'Aktualisieren');
      refresh.addEventListener('click', () => this.show('devices'));
      nodes.push(refresh);
      this.list.replaceChildren(...nodes);
    } catch (e) {
      if (reqId === this.requestId) this.message(`Geräte konnten nicht geladen werden: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ Elemente

  private item(o: { img: string | null; title: string; sub: string; detail?: string; uri?: string; round?: boolean; onClick: () => void }): HTMLElement {
    const b = el('button', `item${o.round ? ' round' : ''}`);
    b.type = 'button';
    if (o.uri) b.dataset.uri = o.uri;
    if (o.img) {
      const img = el('img');
      img.src = o.img;
      img.alt = '';
      img.decoding = 'async';
      b.append(img);
    } else b.append(el('div', 'ph'));
    const text = el('div');
    text.style.minWidth = '0';
    text.append(el('div', 't', o.title), el('div', 's', o.sub));
    b.append(text, el('div', 'd', o.detail ?? ''));
    b.addEventListener('click', () => {
      o.onClick();
      if (matchMedia('(max-width: 720px)').matches) this.close();
    });
    return b;
  }

  private renderTracks(tracks: SpTrack[]): HTMLElement[] {
    const list = tracks.filter((t) => t && t.uri);
    return list.map((t, i) =>
      this.item({
        img: pickImage(t.album?.images, 64),
        title: t.name,
        sub: t.artists.map((a) => a.name).join(', '),
        detail: formatTime(t.duration_ms),
        uri: t.uri,
        onClick: () => this.app.playback.playUris({ uris: list.slice(i, i + 100).map((x) => x.uri) }),
      }),
    );
  }

  private renderAlbums(albums: SpAlbum[]): HTMLElement[] {
    return albums
      .filter((a) => a && a.uri)
      .map((a) =>
        this.item({
          img: pickImage(a.images, 64),
          title: a.name,
          sub: `${a.artists.map((x) => x.name).join(', ')}${a.release_date ? ' · ' + a.release_date.slice(0, 4) : ''}`,
          uri: a.uri,
          onClick: () => this.app.playback.playUris({ contextUri: a.uri }),
        }),
      );
  }

  private renderPlaylists(pls: SpPlaylist[]): HTMLElement[] {
    return pls.map((p) =>
      this.item({
        img: pickImage(p.images, 64),
        title: p.name,
        sub: p.owner?.display_name ? `von ${p.owner.display_name}` : 'Playlist',
        uri: p.uri,
        onClick: () => this.app.playback.playUris({ contextUri: p.uri }),
      }),
    );
  }

  private deviceItem(d: SpDevice, isLocal: boolean): HTMLElement {
    const b = el('button', `item device${d.is_active ? ' active' : ''}`);
    b.type = 'button';
    const ic = el('div');
    setIconLabel(ic, icons.devices, '');
    const text = el('div');
    text.style.minWidth = '0';
    text.append(el('div', 't', isLocal ? `${d.name} (dieser Browser)` : d.name), el('div', 's', `${d.type}${d.is_active ? ' · aktiv' : ''}${d.volume_percent != null ? ` · ${d.volume_percent} %` : ''}`));
    b.append(ic, text, el('div', 'd', d.is_restricted ? 'gesperrt' : ''));
    b.disabled = d.is_restricted || !d.id;
    b.addEventListener('click', async () => {
      if (!d.id) return;
      await (this.app.playback as SpotifyController).transferTo(d.id);
      setTimeout(() => this.show('devices'), 1200);
    });
    return b;
  }
}
