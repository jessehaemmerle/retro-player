/**
 * Schlanker Client für die Spotify Web API.
 * Berücksichtigt die Änderungen vom Februar 2026 (Development Mode):
 *  - Suche liefert max. 10 Ergebnisse pro Seite
 *  - Playlist-Inhalte nur für eigene Playlists → wir spielen Playlists direkt per context_uri ab
 */
import { getAccessToken } from './auth';

const API = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

export interface SpImage {
  url: string;
  width: number | null;
  height: number | null;
}
export interface SpArtist {
  id: string;
  name: string;
  uri: string;
}
export interface SpAlbum {
  id: string;
  name: string;
  uri: string;
  images: SpImage[];
  artists: SpArtist[];
  release_date?: string;
  total_tracks?: number;
  external_urls?: { spotify?: string };
}
export interface SpTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  track_number?: number;
  artists: SpArtist[];
  album: SpAlbum;
  external_urls?: { spotify?: string };
  type: 'track';
}
export interface SpEpisode {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  images: SpImage[];
  show?: { name: string; publisher?: string };
  type: 'episode';
}
export interface SpPlaylist {
  id: string;
  name: string;
  uri: string;
  images: SpImage[] | null;
  owner: { display_name?: string; id: string };
  description?: string;
}
export interface SpDevice {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
}
export interface SpPlaybackState {
  device: SpDevice;
  shuffle_state: boolean;
  repeat_state: 'off' | 'track' | 'context';
  timestamp: number;
  progress_ms: number | null;
  is_playing: boolean;
  item: SpTrack | SpEpisode | null;
  context: { uri: string; type: string } | null;
}
export interface Paging<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}
export interface SpUser {
  id: string;
  display_name: string | null;
  images?: SpImage[];
}

type Query = Record<string, string | number | boolean | undefined>;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}, attempt = 0): Promise<T> {
  const token = await getAccessToken(attempt === 1);
  if (!token) throw new SpotifyApiError(401, 'Nicht bei Spotify angemeldet.');

  const url = new URL(API + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && attempt === 0) return request<T>(method, path, opts, 1);
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('Retry-After') ?? '1');
    await sleep(Math.min(wait, 10) * 1000);
    return request<T>(method, path, opts, attempt + 2);
  }
  if (res.status === 204 || res.status === 202) return null as T;
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const err = data?.error;
    const message = typeof err === 'object' ? err.message : typeof err === 'string' ? err : `HTTP ${res.status}`;
    throw new SpotifyApiError(res.status, message, err?.reason);
  }
  return data as T;
}

export const api = {
  me: () => request<SpUser>('GET', '/me'),

  // --- Player ---
  playbackState: () => request<SpPlaybackState | null>('GET', '/me/player', { query: { additional_types: 'track,episode' } }),
  devices: () => request<{ devices: SpDevice[] }>('GET', '/me/player/devices'),
  transfer: (deviceId: string, play: boolean) => request<null>('PUT', '/me/player', { body: { device_ids: [deviceId], play } }),
  play: (
    deviceId: string | undefined,
    body?: { context_uri?: string; uris?: string[]; offset?: { position?: number; uri?: string }; position_ms?: number },
  ) => request<null>('PUT', '/me/player/play', { query: { device_id: deviceId }, body: body ?? {} }),
  pause: (deviceId?: string) => request<null>('PUT', '/me/player/pause', { query: { device_id: deviceId } }),
  next: (deviceId?: string) => request<null>('POST', '/me/player/next', { query: { device_id: deviceId } }),
  previous: (deviceId?: string) => request<null>('POST', '/me/player/previous', { query: { device_id: deviceId } }),
  seek: (ms: number, deviceId?: string) =>
    request<null>('PUT', '/me/player/seek', { query: { position_ms: Math.max(0, Math.round(ms)), device_id: deviceId } }),
  volume: (percent: number, deviceId?: string) =>
    request<null>('PUT', '/me/player/volume', { query: { volume_percent: Math.round(percent), device_id: deviceId } }),
  shuffle: (state: boolean, deviceId?: string) => request<null>('PUT', '/me/player/shuffle', { query: { state, device_id: deviceId } }),
  repeat: (state: 'off' | 'track' | 'context', deviceId?: string) =>
    request<null>('PUT', '/me/player/repeat', { query: { state, device_id: deviceId } }),

  // --- Bibliothek ---
  search: (q: string, offset = 0) =>
    request<{ tracks?: Paging<SpTrack>; albums?: Paging<SpAlbum>; playlists?: Paging<SpPlaylist | null> }>('GET', '/search', {
      query: { q, type: 'track,album,playlist', limit: 10, offset },
    }),
  myPlaylists: (offset = 0) => request<Paging<SpPlaylist | null>>('GET', '/me/playlists', { query: { limit: 50, offset } }),
  savedAlbums: (offset = 0) => request<Paging<{ album: SpAlbum }>>('GET', '/me/albums', { query: { limit: 50, offset } }),
  savedTracks: (offset = 0) => request<Paging<{ track: SpTrack }>>('GET', '/me/tracks', { query: { limit: 50, offset } }),
  recentlyPlayed: () => request<{ items: { track: SpTrack; played_at: string }[] }>('GET', '/me/player/recently-played', { query: { limit: 50 } }),
};

/** Wählt das kleinste Bild ≥ minSize (Spotify liefert absteigend sortiert). */
export function pickImage(images: SpImage[] | null | undefined, minSize = 0): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 640) >= minSize) ?? sorted[sorted.length - 1]).url;
}
