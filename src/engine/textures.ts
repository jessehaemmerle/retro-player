/**
 * Prozedurale PBR-Texturen (Normal-, Rauheits- und Anisotropie-Maps), die auf Canvas
 * erzeugt werden. Damit bekommen Metall, Kunststoff, Gummi & Co. die Mikrostruktur,
 * die echte Oberflächen von "CG-glatten" unterscheidet.
 */
import * as THREE from 'three';
import { fbm, mulberry32, valueNoise } from './noise';

const cache = new Map<string, THREE.Texture>();

export let maxAnisotropy = 8;
export function setMaxAnisotropy(v: number) {
  maxAnisotropy = v;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; repeat?: [number, number]; wrap?: boolean; mipmaps?: boolean } = {},
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAnisotropy;
  if (opts.wrap || opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  if (opts.mipmaps === false) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  return t;
}

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Klont eine gecachte Textur mit eigenem repeat (teilt sich das Bild). */
export function withRepeat<T extends THREE.Texture>(tex: T, rx: number, ry: number, rotation = 0): T {
  const t = tex.clone() as T;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.rotation = rotation;
  t.needsUpdate = true;
  return t;
}

/** Erzeugt eine Normal-Map aus einem Höhenfeld (Float32Array, 0..1). */
function heightToNormal(h: Float32Array, w: number, hgt: number, strength: number, wrap = true): ImageData {
  const out = new ImageData(w, hgt);
  const d = out.data;
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + hgt) % hgt;
    } else {
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(hgt - 1, y));
    }
    return h[y * w + x];
  };
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Canvas-y zeigt nach unten, Textur-v nach oben → dy invertieren
      let nx = -dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return out;
}

function grayToImage(v: Float32Array, w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < v.length; i++) {
    const g = Math.max(0, Math.min(255, v[i] * 255));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g;
    d[i * 4 + 3] = 255;
  }
  return img;
}

function imageToCanvas(img: ImageData): HTMLCanvasElement {
  const c = makeCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/** Horizontale Box-Unschärfe (wrap) – erzeugt aus weißem Rauschen Schleifspuren. */
function streaks(w: number, h: number, radius: number, seed: number): Float32Array {
  const rnd = mulberry32(seed);
  const src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = rnd();
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + ((k + w) % w)];
    for (let x = 0; x < w; x++) {
      out[row + x] = sum / win;
      sum += src[row + ((x + radius + 1) % w)] - src[row + ((x - radius + w) % w)];
    }
  }
  // auf ±1 normalisieren
  let min = Infinity, max = -Infinity;
  for (const v of out) { if (v < min) min = v; if (v > max) max = v; }
  for (let i = 0; i < out.length; i++) out[i] = ((out[i] - min) / (max - min)) * 2 - 1;
  return out;
}

// ---------------------------------------------------------------------------
// Gebürstetes Metall
// ---------------------------------------------------------------------------

/** Rauheits-Map für linear gebürstetes Metall (Streifen entlang u). */
export function brushedRoughness(base: number, amp: number, seed = 1): THREE.CanvasTexture {
  return cached(`brushedR:${base}:${amp}:${seed}`, () => {
    const w = 1024, h = 512;
    const s1 = streaks(w, h, 90, seed);
    const s2 = streaks(w, h, 12, seed + 3);
    const v = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const rowVar = (valueNoise(0, y / 40, seed) - 0.5) * 0.6;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        v[i] = base + amp * (0.65 * s1[i] + 0.35 * s2[i] + rowVar);
      }
    }
    return canvasTexture(imageToCanvas(grayToImage(v, w, h)), { wrap: true });
  });
}

export function brushedNormal(strength = 1.2, seed = 1): THREE.CanvasTexture {
  return cached(`brushedN:${strength}:${seed}`, () => {
    const w = 1024, h = 512;
    const s = streaks(w, h, 40, seed + 11);
    for (let i = 0; i < s.length; i++) s[i] = s[i] * 0.5 + 0.5;
    return canvasTexture(imageToCanvas(heightToNormal(s, w, h, strength)), { wrap: true });
  });
}

/**
 * Anisotropie-Map für konzentrisch gedrehte Flächen (Knopfkappen, Plattenteller, Vinyl).
 * RG = tangentiale Richtung im UV-Raum, B = Stärke.
 */
export function radialAnisotropy(innerFade = 0.02): THREE.CanvasTexture {
  return cached(`radAniso:${innerFade}`, () => {
    const s = 512;
    const img = new ImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = (x + 0.5) / s - 0.5;
        const v = 0.5 - (y + 0.5) / s; // Canvas y ↓, Textur v ↑
        const r = Math.hypot(u, v) || 1e-6;
        const tx = -v / r, ty = u / r; // tangential
        const i = (y * s + x) * 4;
        d[i] = (tx * 0.5 + 0.5) * 255;
        d[i + 1] = (ty * 0.5 + 0.5) * 255;
        d[i + 2] = Math.min(1, r / Math.max(innerFade, 1e-4)) * 255;
        d[i + 3] = 255;
      }
    }
    return canvasTexture(imageToCanvas(img));
  });
}

/** Konzentrische Drehriefen als Rauheits-Map (für gedrehtes Aluminium). */
export function radialBrushedRoughness(base: number, amp: number, rings = 220, seed = 5): THREE.CanvasTexture {
  return cached(`radBrushR:${base}:${amp}:${rings}:${seed}`, () => {
    const s = 1024;
    const v = new Float32Array(s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s - 0.5, w = y / s - 0.5;
        const r = Math.hypot(u, w) * 2;
        const a = Math.atan2(w, u);
        const n = valueNoise(r * rings, 0.5, seed) * 0.6 + valueNoise(r * rings * 4.3, a * 0.5, seed + 1) * 0.4;
        v[y * s + x] = base + amp * (n - 0.5) * 2;
      }
    }
    return canvasTexture(imageToCanvas(grayToImage(v, s, s)));
  });
}

export function radialBrushedNormal(strength = 1.5, rings = 300, seed = 7): THREE.CanvasTexture {
  return cached(`radBrushN:${strength}:${rings}:${seed}`, () => {
    const s = 1024;
    const h = new Float32Array(s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s - 0.5, w = y / s - 0.5;
        const r = Math.hypot(u, w) * 2;
        h[y * s + x] = valueNoise(r * rings, 0.5, seed) * 0.7 + valueNoise(r * rings * 3.1, 2.5, seed) * 0.3;
      }
    }
    return canvasTexture(imageToCanvas(heightToNormal(h, s, s, strength, false)));
  });
}

// ---------------------------------------------------------------------------
// Rändelung, Kunststoff, Gummi
// ---------------------------------------------------------------------------

/**
 * Normal-Map für eine Rändelung (Riefen entlang v). Eine Kachel = eine Riefe.
 * Mit repeat.x = Anzahl der Riefen verwenden.
 */
export function knurlNormal(diamond = false): THREE.CanvasTexture {
  return cached(`knurl:${diamond}`, () => {
    const w = 32, h = diamond ? 32 : 4;
    const hgt = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        let v = 1 - Math.abs(u - 0.5) * 2; // Dreiecksprofil
        if (diamond) {
          const a = ((x + y) % w) / w, b = ((x - y + w) % w) / w;
          v = Math.min(1 - Math.abs(a - 0.5) * 2, 1 - Math.abs(b - 0.5) * 2);
        }
        hgt[y * w + x] = Math.pow(v, 0.8);
      }
    }
    return canvasTexture(imageToCanvas(heightToNormal(hgt, w, h, diamond ? 3 : 4)), { wrap: true });
  });
}

/** Feine "Orangenhaut"-Struktur von spritzgegossenem Kunststoff. */
export function plasticNormal(scale = 64, strength = 1.2, seed = 3): THREE.CanvasTexture {
  return cached(`plasticN:${scale}:${strength}:${seed}`, () => {
    const s = 512;
    const h = new Float32Array(s * s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) h[y * s + x] = fbm((x / s) * scale, (y / s) * scale, 3, seed, scale);
    return canvasTexture(imageToCanvas(heightToNormal(h, s, s, strength)), { wrap: true });
  });
}

/** Strukturierte (genarbte) Oberfläche, z. B. Gehäuse, Gummi. */
export function texturedNormal(scale = 90, strength = 3, seed = 9): THREE.CanvasTexture {
  return cached(`texN:${scale}:${strength}:${seed}`, () => {
    const s = 512;
    const h = new Float32Array(s * s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const n = fbm((x / s) * scale, (y / s) * scale, 2, seed, scale);
        h[y * s + x] = Math.pow(n, 1.6);
      }
    return canvasTexture(imageToCanvas(heightToNormal(h, s, s, strength)), { wrap: true });
  });
}

/**
 * Absolute Rauheit mit Fingerabdrücken, Wischspuren und Staub.
 * Material-roughness muss 1 sein, damit die Map die Werte direkt vorgibt.
 */
export function smudgeRoughness(base: number, smudge: number, seed = 1, density = 1): THREE.CanvasTexture {
  return cached(`smudge:${base}:${smudge}:${seed}:${density}`, () => {
    const s = 1024;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d')!;
    const g = Math.round(base * 255);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(0, 0, s, s);
    const rnd = mulberry32(seed);
    const level = Math.round(Math.min(1, base + smudge) * 255);
    // weiche Wischflecken
    for (let i = 0; i < 18 * density; i++) {
      const x = rnd() * s, y = rnd() * s, r = (0.04 + rnd() * 0.12) * s;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${level},${level},${level},${0.25 + rnd() * 0.3})`);
      grad.addColorStop(1, `rgba(${level},${level},${level},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fingerabdrücke: konzentrische, verzerrte Bögen
    for (let f = 0; f < 6 * density; f++) {
      const cx = rnd() * s, cy = rnd() * s, rot = rnd() * Math.PI;
      const sx = 0.022 * s * (0.8 + rnd() * 0.5), sy = sx * 1.35;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = `rgba(${level},${level},${level},${0.18 + rnd() * 0.2})`;
      ctx.lineWidth = s / 900;
      for (let k = 1; k < 14; k++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, (sx * k) / 14, (sy * k) / 14, 0, rnd() * 0.6, Math.PI * 2 - rnd() * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Staub & feine Kratzer
    for (let i = 0; i < 900 * density; i++) {
      const x = rnd() * s, y = rnd() * s;
      ctx.fillStyle = `rgba(${level},${level},${level},${0.3 + rnd() * 0.5})`;
      ctx.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 60 * density; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2, l = 10 + rnd() * 70;
      ctx.strokeStyle = `rgba(${level},${level},${level},${0.15 + rnd() * 0.25})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    return canvasTexture(c, { wrap: true });
  });
}

// ---------------------------------------------------------------------------
// Lochblech (Lautsprechergitter)
// ---------------------------------------------------------------------------

/** Eine Kachel Lochblech mit versetzten Löchern. alphaMap: weiß = Material, schwarz = Loch. */
export function perforatedAlpha(holeRatio = 0.62): THREE.CanvasTexture {
  return cached(`perfA:${holeRatio}`, () => {
    const w = 64, h = 110; // ~ sqrt(3) Verhältnis → hexagonale Anordnung
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    const r = (w / 2) * holeRatio;
    const holes = [
      [0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2],
    ];
    for (const [x, y] of holes) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvasTexture(c, { wrap: true });
  });
}

export function perforatedNormal(holeRatio = 0.62): THREE.CanvasTexture {
  return cached(`perfN:${holeRatio}`, () => {
    const w = 64, h = 110;
    const hgt = new Float32Array(w * h);
    const r = (w / 2) * holeRatio;
    const holes = [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let dmin = Infinity;
        for (const [hx, hy] of holes) dmin = Math.min(dmin, Math.hypot(x - hx, y - hy));
        // abgerundete Lochkante
        const e = Math.min(1, Math.max(0, (dmin - r) / 5));
        hgt[y * w + x] = Math.sin(e * Math.PI * 0.5);
      }
    return canvasTexture(imageToCanvas(heightToNormal(hgt, w, h, 2.5)), { wrap: true });
  });
}

// ---------------------------------------------------------------------------
// Papier / Membranen
// ---------------------------------------------------------------------------

/** Gepresste Papiermembran eines Lautsprechers (Farbe). */
export function speakerConeColor(tint = '#1c1b1a'): THREE.CanvasTexture {
  return cached(`cone:${tint}`, () => {
    const s = 512;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    const img = ctx.getImageData(0, 0, s, s);
    const d = img.data;
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const i = (y * s + x) * 4;
        const u = x / s - 0.5, v = y / s - 0.5;
        const a = Math.atan2(v, u);
        const r = Math.hypot(u, v);
        const fib = fbm(x / 6, y / 6, 3, 21) - 0.5;
        const radial = valueNoise(a * 60, r * 4, 4) - 0.5;
        const n = fib * 26 + radial * 10;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(c, { srgb: true });
  });
}

/** Papierstruktur (Etiketten, Kartonhüllen). */
export function paperNormal(): THREE.CanvasTexture {
  return cached('paperN', () => {
    const s = 512;
    const h = new Float32Array(s * s);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) h[y * s + x] = fbm(x / 3, y / 3, 3, 33, s / 3) * 0.6 + fbm(x / 40, y / 40, 2, 34, s / 40) * 0.4;
    return canvasTexture(imageToCanvas(heightToNormal(h, s, s, 1.3)), { wrap: true });
  });
}

// ---------------------------------------------------------------------------
// Vinyl
// ---------------------------------------------------------------------------

/**
 * Rillen-Struktur einer Schallplatte: Rauheit (G) mit Zwischenrillen-Bändern
 * zwischen den Titeln, Einlauf- und Auslaufrille.
 * Planares UV über den ganzen Plattendurchmesser (r = 0.5 am Rand).
 */
export function vinylRoughness(): THREE.CanvasTexture {
  return cached('vinylR', () => {
    const s = 1024;
    const img = new ImageData(s, s);
    const d = img.data;
    const R = 0.5; // UV-Radius des Außenrands
    const outerGroove = 0.488, innerGroove = 0.247; // ~146 mm & 74 mm bei 300 mm Platte
    const bands = [0.452, 0.414, 0.381, 0.345, 0.31, 0.279];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const u = (x + 0.5) / s - 0.5, v = (y + 0.5) / s - 0.5;
        const r = Math.hypot(u, v);
        let rough = 0.32;
        if (r > outerGroove || r < innerGroove) rough = 0.12; // glatter Rand/Auslauf
        for (const b of bands) if (Math.abs(r - b) < 0.0024) rough = 0.14; // Pausen zwischen Titeln
        // feine Modulation der Rillen
        rough += (valueNoise(r * 2400, 0.5, 2) - 0.5) * 0.06;
        if (r > R) rough = 0.5;
        const g = Math.max(0, Math.min(255, rough * 255));
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = g;
        d[i + 3] = 255;
      }
    return canvasTexture(imageToCanvas(img));
  });
}

/** Mikro-Rillen als Normal-Map (radial gerichtete Höhenänderung). */
export function vinylNormal(): THREE.CanvasTexture {
  return cached('vinylN', () => {
    const s = 2048;
    const img = new ImageData(s, s);
    const d = img.data;
    const grooves = 340; // sichtbare Rillen (stilisiert, damit kein Moiré entsteht)
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const u = (x + 0.5) / s - 0.5, v = 0.5 - (y + 0.5) / s;
        const r = Math.hypot(u, v) || 1e-6;
        const phase = r * grooves * Math.PI * 2;
        const slope = Math.cos(phase) * 0.22 + (valueNoise(r * 3000, 0.5, 9) - 0.5) * 0.15;
        // Normale kippt in radiale Richtung
        const nx = (u / r) * slope, ny = (v / r) * slope;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const i = (y * s + x) * 4;
        d[i] = (nx * 0.5 + 0.5) * 255;
        d[i + 1] = (ny * 0.5 + 0.5) * 255;
        d[i + 2] = (nz * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    return canvasTexture(imageToCanvas(img));
  });
}

/** Weiches, radiales Licht-/Schattenbild (z. B. für Glühlampen-Hinterleuchtung). */
export function radialGlow(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  return cached(`glow:${inner}:${outer}`, () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return canvasTexture(c, { srgb: true });
  });
}
