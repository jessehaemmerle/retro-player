/**
 * Spotify-Login per "Authorization Code Flow with PKCE".
 * Komplett clientseitig – es wird kein Client-Secret und kein eigener Server benötigt.
 * https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
 */

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export const SCOPES = [
  // Pflicht für das Web Playback SDK
  'streaming',
  'user-read-email',
  'user-read-private',
  // Steuerung & Status
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  // Bibliothek
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-recently-played',
];

const LS_CLIENT_ID = 'rp.clientId';
const LS_TOKEN = 'rp.token';
const SS_PKCE = 'rp.pkce';

interface StoredToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export function getClientId(): string {
  const fromEnv = (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim();
  return localStorage.getItem(LS_CLIENT_ID)?.trim() || fromEnv || '';
}

export function setClientId(id: string): void {
  const v = id.trim();
  if (v) localStorage.setItem(LS_CLIENT_ID, v);
  else localStorage.removeItem(LS_CLIENT_ID);
}

/** Redirect-URI = Basis-URL der App. Muss exakt so im Spotify-Dashboard eingetragen sein. */
export function getRedirectUri(): string {
  const url = new URL(import.meta.env.BASE_URL, location.origin);
  return url.toString();
}

/** Spotify akzeptiert seit 2025 kein "localhost" mehr, nur 127.0.0.1 bzw. HTTPS. */
export function redirectUriProblem(): string | null {
  if (location.hostname === 'localhost') {
    return 'Spotify erlaubt „localhost“ nicht als Redirect-URI. Bitte die App über http://127.0.0.1:' + location.port + ' öffnen.';
  }
  if (location.protocol !== 'https:' && location.hostname !== '127.0.0.1' && location.hostname !== '[::1]') {
    return 'Spotify verlangt HTTPS (Ausnahme: http://127.0.0.1). Bitte die App über HTTPS hosten.';
  }
  return null;
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(LS_TOKEN);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

function storeToken(t: TokenResponse, previousRefresh?: string): StoredToken {
  const token: StoredToken = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previousRefresh ?? '',
    expiresAt: Date.now() + t.expires_in * 1000,
    scope: t.scope,
  };
  localStorage.setItem(LS_TOKEN, JSON.stringify(token));
  return token;
}

export function isLoggedIn(): boolean {
  return !!readToken()?.refreshToken;
}

export function logout(): void {
  localStorage.removeItem(LS_TOKEN);
}

function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error('Keine Spotify Client-ID hinterlegt.');
  const problem = redirectUriProblem();
  if (problem) throw new Error(problem);

  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem(SS_PKCE, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await sha256Base64Url(verifier),
    redirect_uri: getRedirectUri(),
    state,
  });
  location.assign(`${AUTHORIZE_URL}?${params}`);
}

/**
 * Verarbeitet die Rückkehr von accounts.spotify.com (?code=…&state=…).
 * Gibt true zurück, wenn ein Login abgeschlossen wurde.
 */
export async function handleRedirect(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');
  if (!code && !error) return false;

  // URL sofort säubern, damit ein Reload den Code nicht erneut einlöst
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('state');
  history.replaceState(null, '', url.pathname + url.search + url.hash);

  if (error) throw new Error(error === 'access_denied' ? 'Login wurde abgebrochen.' : `Spotify-Login fehlgeschlagen: ${error}`);

  const pkce = JSON.parse(sessionStorage.getItem(SS_PKCE) ?? 'null') as { verifier: string; state: string } | null;
  sessionStorage.removeItem(SS_PKCE);
  if (!pkce || pkce.state !== state) throw new Error('Ungültiger Login-Status. Bitte erneut anmelden.');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: getRedirectUri(),
      client_id: getClientId(),
      code_verifier: pkce.verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Token-Abruf fehlgeschlagen: ${body.error_description ?? res.status}`);
  }
  storeToken((await res.json()) as TokenResponse);
  return true;
}

let refreshing: Promise<StoredToken | null> | null = null;

async function refresh(token: StoredToken): Promise<StoredToken | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: getClientId(),
    }),
  });
  if (!res.ok) {
    // Refresh-Token abgelaufen/widerrufen → neu anmelden
    if (res.status === 400 || res.status === 401) logout();
    return null;
  }
  return storeToken((await res.json()) as TokenResponse, token.refreshToken);
}

/** Liefert ein gültiges Access-Token (erneuert es bei Bedarf). */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  const token = readToken();
  if (!token) return null;
  if (!forceRefresh && token.expiresAt - Date.now() > 60_000) return token.accessToken;
  refreshing ??= refresh(token).finally(() => (refreshing = null));
  return (await refreshing)?.accessToken ?? null;
}
