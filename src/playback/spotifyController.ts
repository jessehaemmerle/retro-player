import { api, pickImage, SpotifyApiError, type SpPlaybackState, type SpTrack, type SpEpisode } from '../spotify/api';
import { getAccessToken } from '../spotify/auth';
import { loadPlaybackSdk } from '../spotify/sdk';
import { Emitter } from '../util/emitter';
import { emptyState, interpolatedPosition, type PlaybackController, type PlaybackEvents, type TrackInfo } from './types';

const PLAYER_NAME = 'Retro Player';

function trackFromApi(item: SpTrack | SpEpisode): TrackInfo {
  if (item.type === 'episode') {
    return {
      id: item.id,
      uri: item.uri,
      name: item.name,
      artists: item.show?.name ?? 'Podcast',
      album: item.show?.name ?? '',
      artUrl: pickImage(item.images, 600),
      artUrlSmall: pickImage(item.images, 120),
      durationMs: item.duration_ms,
      trackNumber: 1,
      spotifyUrl: `https://open.spotify.com/episode/${item.id}`,
    };
  }
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    artists: item.artists.map((a) => a.name).join(', '),
    album: item.album?.name ?? '',
    artUrl: pickImage(item.album?.images, 600),
    artUrlSmall: pickImage(item.album?.images, 120),
    durationMs: item.duration_ms,
    trackNumber: item.track_number ?? 1,
    spotifyUrl: item.external_urls?.spotify ?? `https://open.spotify.com/track/${item.id}`,
  };
}

function trackFromSdk(t: Spotify.Track): TrackInfo {
  const id = t.id ?? t.uri;
  return {
    id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    album: t.album.name,
    artUrl: pickImage(t.album.images as never, 600),
    artUrlSmall: pickImage(t.album.images as never, 120),
    durationMs: t.duration_ms,
    trackNumber: 1,
    spotifyUrl: t.id ? `https://open.spotify.com/${t.type === 'episode' ? 'episode' : 'track'}/${t.id}` : null,
  };
}

export class SpotifyController implements PlaybackController {
  readonly kind = 'spotify' as const;
  readonly events = new Emitter<PlaybackEvents>();
  readonly state = emptyState();

  private player: Spotify.Player | null = null;
  private deviceId: string | null = null;
  private activeDeviceId: string | null = null;
  private hasContext = false;
  private pollTimer = 0;
  private volumeTimer = 0;
  private disposed = false;
  private activated = false;
  /** Zeitpunkt der letzten lokalen Aktion → kurz keine veralteten Poll-Daten übernehmen */
  private holdUntil = 0;

  async init(): Promise<void> {
    this.state.ready = true; // Fernsteuerung anderer Geräte ist sofort möglich
    this.schedulePoll(0);
    document.addEventListener('visibilitychange', this.onVisibility);

    try {
      await loadPlaybackSdk();
    } catch (e) {
      this.events.emit('error', (e as Error).message);
      return;
    }
    if (this.disposed) return;

    const player = new Spotify.Player({
      name: PLAYER_NAME,
      volume: this.state.volume,
      getOAuthToken: (cb) => {
        getAccessToken().then((t) => cb(t ?? ''));
      },
    });
    this.player = player;

    player.addListener('ready', ({ device_id }) => {
      this.deviceId = device_id;
      this.events.emit('notice', 'Spotify verbunden – „Retro Player“ ist als Gerät verfügbar.');
      this.schedulePoll(300);
    });
    player.addListener('not_ready', () => {
      this.deviceId = null;
      this.state.local = false;
      this.emitState();
    });
    player.addListener('player_state_changed', (s) => {
      if (!s) {
        // Wiedergabe wurde auf ein anderes Gerät übertragen
        if (this.state.local) {
          this.state.local = false;
          this.emitState();
          this.schedulePoll(500);
        }
        return;
      }
      this.applySdkState(s);
    });
    player.addListener('initialization_error', ({ message }) =>
      this.events.emit('error', `Wiedergabe im Browser nicht möglich (${message}). Andere Spotify-Geräte lassen sich trotzdem steuern.`),
    );
    player.addListener('authentication_error', () =>
      this.events.emit('error', 'Spotify-Anmeldung abgelaufen – bitte neu anmelden.'),
    );
    player.addListener('account_error', () =>
      this.events.emit('error', 'Für die Wiedergabe im Browser ist Spotify Premium erforderlich.'),
    );
    player.addListener('playback_error', ({ message }) => this.events.emit('error', `Wiedergabefehler: ${message}`));
    player.addListener('autoplay_failed', () =>
      this.events.emit('notice', 'Der Browser hat Autoplay blockiert – bitte einmal Play drücken.'),
    );

    const ok = await player.connect();
    if (!ok) this.events.emit('error', 'Verbindung zum Spotify-Player fehlgeschlagen.');
  }

  position(): number {
    return interpolatedPosition(this.state);
  }

  activate(): void {
    if (this.activated || !this.player) return;
    this.activated = true;
    this.player.activateElement().catch(() => (this.activated = false));
  }

  // ---------------------------------------------------------------- Steuerung

  async play(): Promise<void> {
    if (this.state.local && this.player) {
      this.optimistic({ paused: false });
      await this.player.resume();
      return;
    }
    if (this.activeDeviceId) {
      this.optimistic({ paused: false });
      await this.guard(() => api.play(this.activeDeviceId!));
      return;
    }
    // Kein aktives Gerät: Wiedergabe in diesen Browser holen (setzt letzten Kontext fort)
    if (!this.deviceId) {
      this.events.emit('error', 'Der Browser-Player ist noch nicht bereit.');
      return;
    }
    if (!this.hasContext) {
      this.events.emit('needs-content', undefined);
      return;
    }
    this.optimistic({ paused: false });
    await this.guard(() => api.transfer(this.deviceId!, true));
    this.schedulePoll(1200);
  }

  async pause(): Promise<void> {
    this.optimistic({ paused: true });
    if (this.state.local && this.player) await this.player.pause();
    else if (this.activeDeviceId) await this.guard(() => api.pause(this.activeDeviceId!));
  }

  async toggle(): Promise<void> {
    return this.state.paused ? this.play() : this.pause();
  }

  async next(): Promise<void> {
    this.holdUntil = performance.now() + 800;
    if (this.state.local && this.player) await this.player.nextTrack();
    else if (this.activeDeviceId) await this.guard(() => api.next(this.activeDeviceId!));
    this.schedulePoll(700);
  }

  async previous(): Promise<void> {
    // Wie bei echten Geräten: erst an den Anfang des Titels, dann zurück
    if (this.position() > 3000) return this.seek(0);
    this.holdUntil = performance.now() + 800;
    if (this.state.local && this.player) await this.player.previousTrack();
    else if (this.activeDeviceId) await this.guard(() => api.previous(this.activeDeviceId!));
    this.schedulePoll(700);
  }

  async seek(ms: number): Promise<void> {
    if (!this.state.track) return;
    const clamped = Math.max(0, Math.min(ms, this.state.track.durationMs - 500));
    this.optimistic({ positionMs: clamped });
    if (this.state.local && this.player) await this.player.seek(clamped);
    else if (this.activeDeviceId) await this.guard(() => api.seek(clamped, this.activeDeviceId!));
  }

  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, v));
    this.state.volume = vol;
    this.emitState();
    if (this.state.local && this.player) {
      this.player.setVolume(Math.max(vol, 0.0001)).catch(() => {});
      return;
    }
    clearTimeout(this.volumeTimer);
    this.volumeTimer = window.setTimeout(() => {
      if (this.activeDeviceId) this.guard(() => api.volume(vol * 100, this.activeDeviceId!));
    }, 250);
  }

  async setShuffle(on: boolean): Promise<void> {
    this.state.shuffle = on;
    this.emitState();
    await this.guard(() => api.shuffle(on, this.activeDeviceId ?? this.deviceId ?? undefined));
  }

  async cycleRepeat(): Promise<void> {
    const order = ['off', 'context', 'track'] as const;
    const next = order[(order.indexOf(this.state.repeat) + 1) % order.length];
    this.state.repeat = next;
    this.emitState();
    await this.guard(() => api.repeat(next, this.activeDeviceId ?? this.deviceId ?? undefined));
  }

  async playUris(opts: { contextUri?: string; uris?: string[]; offsetUri?: string; offsetIndex?: number }): Promise<void> {
    // Neue Musik spielt bevorzugt hier im Browser
    const target = this.deviceId ?? this.activeDeviceId;
    if (!target) {
      this.events.emit('error', 'Kein Wiedergabegerät verfügbar. Ist Spotify Premium aktiv?');
      return;
    }
    const body: Parameters<typeof api.play>[1] = {};
    if (opts.contextUri) body.context_uri = opts.contextUri;
    if (opts.uris) body.uris = opts.uris;
    if (opts.offsetUri) body.offset = { uri: opts.offsetUri };
    else if (opts.offsetIndex !== undefined) body.offset = { position: opts.offsetIndex };
    this.optimistic({ paused: false, positionMs: 0 });
    await this.guard(() => api.play(target, body));
    this.hasContext = true;
    this.schedulePoll(900);
  }

  /** Wiedergabe gezielt auf ein Gerät legen (Geräteauswahl in der UI). */
  async transferTo(deviceId: string): Promise<void> {
    await this.guard(() => api.transfer(deviceId, !this.state.paused));
    this.schedulePoll(1000);
  }

  get localDeviceId(): string | null {
    return this.deviceId;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.pollTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.player?.disconnect();
  }

  // ---------------------------------------------------------------- intern

  private optimistic(patch: { paused?: boolean; positionMs?: number }) {
    const pos = this.position();
    if (patch.paused !== undefined) this.state.paused = patch.paused;
    this.state.positionMs = patch.positionMs ?? pos;
    this.state.updatedAt = performance.now();
    this.holdUntil = performance.now() + 1500;
    this.emitState();
  }

  private async guard(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      const err = e as SpotifyApiError;
      if (err.status === 403 && err.reason === 'PREMIUM_REQUIRED') {
        this.events.emit('error', 'Diese Aktion erfordert Spotify Premium.');
      } else if (err.status === 404) {
        this.events.emit('error', 'Kein aktives Spotify-Gerät gefunden.');
      } else if (err.status === 403) {
        this.events.emit('error', `Aktion nicht erlaubt: ${err.message}`);
      } else {
        this.events.emit('error', err.message || 'Spotify-Anfrage fehlgeschlagen.');
      }
      this.schedulePoll(500);
    }
  }

  private setTrack(track: TrackInfo | null) {
    const prev = this.state.track;
    if (prev?.id === track?.id) {
      // gleiche Spur – evtl. bessere Metadaten übernehmen
      if (prev && track && track.trackNumber > 1) prev.trackNumber = track.trackNumber;
      return;
    }
    this.state.track = track;
    this.events.emit('track', track);
  }

  private applySdkState(s: Spotify.PlaybackState) {
    const wasLocal = this.state.local;
    this.state.local = true;
    this.activeDeviceId = this.deviceId;
    this.state.deviceName = PLAYER_NAME;
    this.hasContext = true;
    const cur = s.track_window.current_track;
    const changed = cur && cur.id !== this.state.track?.id;
    this.setTrack(cur ? trackFromSdk(cur) : null);
    this.state.paused = s.paused;
    this.state.positionMs = s.position;
    this.state.updatedAt = performance.now();
    this.state.shuffle = s.shuffle;
    this.state.repeat = s.repeat_mode === 2 ? 'track' : s.repeat_mode === 1 ? 'context' : 'off';
    this.holdUntil = 0;
    this.emitState();
    if (!wasLocal || changed) this.schedulePoll(600); // Titelnummer etc. nachladen
  }

  private applyApiState(s: SpPlaybackState | null) {
    if (performance.now() < this.holdUntil) return;
    if (!s || !s.device) {
      this.activeDeviceId = null;
      this.state.deviceName = null;
      if (!this.state.local) {
        this.state.paused = true;
        this.emitState();
      }
      return;
    }
    this.activeDeviceId = s.device.id;
    this.state.deviceName = s.device.name;
    this.state.local = !!this.deviceId && s.device.id === this.deviceId;
    if (s.item) {
      this.hasContext = true;
      this.setTrack(trackFromApi(s.item));
    }
    // Lokaler Zustand kommt präziser vom SDK – nur Fernsteuerung übernimmt API-Zeiten
    if (!this.state.local) {
      this.state.paused = !s.is_playing;
      this.state.positionMs = s.progress_ms ?? 0;
      this.state.updatedAt = performance.now();
      if (s.device.volume_percent != null) this.state.volume = s.device.volume_percent / 100;
    }
    this.state.shuffle = s.shuffle_state;
    this.state.repeat = s.repeat_state;
    this.emitState();
  }

  private emitState() {
    this.events.emit('state', this.state);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.schedulePoll(0);
  };

  private schedulePoll(delay: number) {
    clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => this.poll(), delay);
  }

  private async poll() {
    if (this.disposed) return;
    if (document.visibilityState === 'hidden') return; // wird bei Sichtbarkeit neu gestartet
    try {
      this.applyApiState(await api.playbackState());
    } catch (e) {
      if ((e as SpotifyApiError).status === 401) {
        this.events.emit('error', 'Spotify-Anmeldung abgelaufen – bitte neu anmelden.');
        return;
      }
    }
    // Lokal liefert das SDK Events → selten pollen; ferngesteuert öfter
    const interval = this.state.local ? 15000 : this.activeDeviceId ? 3000 : 8000;
    this.schedulePoll(interval);
  }
}
