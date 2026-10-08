/** Lädt das Spotify Web Playback SDK genau einmal. */
let loading: Promise<void> | null = null;

export function loadPlaybackSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Spotify Web Playback SDK konnte nicht geladen werden.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
