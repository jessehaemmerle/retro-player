/** Kleine, schnelle Rausch-Funktionen für prozedurale Texturen. */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Wert-Rauschen, kachelbar mit Periode `period` (in Gitterzellen). */
export function valueNoise(x: number, y: number, seed = 0, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const wrap = (v: number) => (period ? ((v % period) + period) % period : v);
  const x0 = wrap(xi), x1 = wrap(xi + 1), y0 = wrap(yi), y1 = wrap(yi + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fraktales Rauschen (0..1), kachelbar wenn period > 0. */
export function fbm(x: number, y: number, octaves = 4, seed = 0, period = 0): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17, period ? period * freq : 0);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
