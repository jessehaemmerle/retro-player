import { Emitter } from '../util/emitter';
import { paintDemoCover } from './demoArt';
import { emptyState, interpolatedPosition, type PlaybackController, type PlaybackEvents, type TrackInfo } from './types';

const DEMO_TRACKS: Array<Omit<TrackInfo, 'artUrl' | 'artUrlSmall' | 'id' | 'uri' | 'spotifyUrl'> & { cover: number }> = [
  { name: 'Neon Boulevard', artists: 'Chrome Hearts Club', album: 'Neon Boulevard', durationMs: 214_000, trackNumber: 1, cover: 0 },
  { name: 'Blue Smoke', artists: 'The Ella Morrow Quartet', album: 'Midnight Lounge', durationMs: 262_000, trackNumber: 2, cover: 1 },
  { name: 'Shapes in Motion', artists: 'Kandinsky Radio', album: 'analog dreams', durationMs: 198_000, trackNumber: 3, cover: 2 },
  { name: 'Golden Hour', artists: 'Marlowe & Vine', album: 'Sunday Vinyl', durationMs: 236_000, trackNumber: 4, cover: 3 },
  { name: 'Rewind Forever', artists: 'Tape Loop Society', album: 'Tape Loop', durationMs: 187_000, trackNumber: 5, cover: 4 },
];

/**
 * Demo-Wiedergabe ohne Spotify: simuliert Zeitverlauf, Titelwechsel und Lautstärke,
 * damit alle Geräte ohne Account erkundet werden können (ohne Ton).
 */
export class DemoController implements PlaybackController {
  readonly kind = 'demo' as const;
  readonly events = new Emitter<PlaybackEvents>();
  readonly state = emptyState();
  private index = 0;
  private tracks: TrackInfo[];
  private timer = 0;

  constructor() {
    this.tracks = DEMO_TRACKS.map((t, i) => {
      const art = paintDemoCover(t.cover);
      return {
        ...t,
        id: `demo-${i}`,
        uri: `demo:${i}`,
        artUrl: art,
        artUrlSmall: art,
        spotifyUrl: null,
      };
    });
    this.state.ready = true;
    this.state.deviceName = 'Demo';
    this.state.local = true;
    this.state.track = this.tracks[0];
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  position(): number {
    return interpolatedPosition(this.state);
  }

  activate(): void {}

  private tick() {
    const t = this.state.track;
    if (!t || this.state.paused) return;
    if (this.position() >= t.durationMs - 50) {
      if (this.state.repeat === 'track') this.seek(0);
      else this.load(this.index + 1, false);
    }
  }

  private load(i: number, keepPaused = true) {
    const paused = keepPaused ? this.state.paused : false;
    this.index = (i + this.tracks.length) % this.tracks.length;
    this.state.track = this.tracks[this.index];
    this.state.positionMs = 0;
    this.state.updatedAt = performance.now();
    this.state.paused = paused;
    this.events.emit('track', this.state.track);
    this.events.emit('state', this.state);
  }

  private set(paused: boolean) {
    this.state.positionMs = this.position();
    this.state.updatedAt = performance.now();
    this.state.paused = paused;
    this.events.emit('state', this.state);
  }

  async play() {
    this.set(false);
  }
  async pause() {
    this.set(true);
  }
  async toggle() {
    this.set(!this.state.paused);
  }
  async next() {
    this.load(this.state.shuffle ? Math.floor(Math.random() * this.tracks.length) : this.index + 1);
  }
  async previous() {
    if (this.position() > 3000) return this.seek(0);
    this.load(this.index - 1);
  }
  async seek(ms: number) {
    this.state.positionMs = Math.max(0, Math.min(ms, (this.state.track?.durationMs ?? 0) - 500));
    this.state.updatedAt = performance.now();
    this.events.emit('state', this.state);
  }
  setVolume(v: number) {
    this.state.volume = Math.max(0, Math.min(1, v));
    this.events.emit('state', this.state);
  }
  async setShuffle(on: boolean) {
    this.state.shuffle = on;
    this.events.emit('state', this.state);
  }
  async cycleRepeat() {
    const order = ['off', 'context', 'track'] as const;
    this.state.repeat = order[(order.indexOf(this.state.repeat) + 1) % 3];
    this.events.emit('state', this.state);
  }
  async playUris(opts: { offsetIndex?: number }) {
    this.load(opts.offsetIndex ?? 0, false);
  }
  get demoTracks(): readonly TrackInfo[] {
    return this.tracks;
  }
  dispose() {
    clearInterval(this.timer);
  }
}
