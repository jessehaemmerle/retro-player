import type { Emitter } from '../util/emitter';

export interface TrackInfo {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  /** Großes Cover (≥ 600 px) – für Platte/CD/Kassetten-Label */
  artUrl: string | null;
  /** Kleines Cover für Listen/Overlay */
  artUrlSmall: string | null;
  durationMs: number;
  trackNumber: number;
  spotifyUrl: string | null;
}

export type RepeatMode = 'off' | 'context' | 'track';

export interface PlaybackState {
  track: TrackInfo | null;
  paused: boolean;
  /** Position zum Zeitpunkt `updatedAt` */
  positionMs: number;
  updatedAt: number;
  volume: number; // 0..1
  shuffle: boolean;
  repeat: RepeatMode;
  /** Gerät, auf dem gerade gespielt wird */
  deviceName: string | null;
  /** true, wenn die Wiedergabe in diesem Browser stattfindet */
  local: boolean;
  /** Steuerung ist möglich (eingeloggt + Gerät bereit bzw. Demo) */
  ready: boolean;
}

export interface PlaybackEvents extends Record<string, unknown> {
  state: PlaybackState;
  track: TrackInfo | null;
  error: string;
  notice: string;
  /** Es läuft nichts und es gibt keinen Kontext → Bibliothek öffnen */
  'needs-content': void;
}

export interface PlaybackController {
  readonly kind: 'demo' | 'spotify';
  readonly events: Emitter<PlaybackEvents>;
  readonly state: PlaybackState;
  /** Interpolierte aktuelle Position in ms */
  position(): number;
  play(): Promise<void>;
  pause(): Promise<void>;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): void;
  setShuffle(on: boolean): Promise<void>;
  cycleRepeat(): Promise<void>;
  /** Kontext (Album/Playlist) oder Liste von Track-URIs abspielen */
  playUris(opts: { contextUri?: string; uris?: string[]; offsetUri?: string; offsetIndex?: number }): Promise<void>;
  /** Muss in einer Nutzer-Geste aufgerufen werden (Autoplay-Policy) */
  activate(): void;
  dispose(): void;
}

export function emptyState(): PlaybackState {
  return {
    track: null,
    paused: true,
    positionMs: 0,
    updatedAt: performance.now(),
    volume: 0.6,
    shuffle: false,
    repeat: 'off',
    deviceName: null,
    local: false,
    ready: false,
  };
}

export function interpolatedPosition(s: PlaybackState): number {
  if (!s.track) return 0;
  const p = s.paused ? s.positionMs : s.positionMs + (performance.now() - s.updatedAt);
  return Math.max(0, Math.min(p, s.track.durationMs));
}
