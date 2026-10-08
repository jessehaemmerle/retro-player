/**
 * PanelPainter: zeichnet Frontplatten mit Siebdruck-Beschriftung.
 * Erzeugt parallel Farb-, ORM- (G = Rauheit, B = Metallizität) und optional
 * Anisotropie-Map, damit Druckfarbe matt & nichtmetallisch auf gebürstetem
 * Metall sitzt – genau wie bei echten Geräten.
 * Koordinaten in Millimetern, Ursprung oben links.
 */
import * as THREE from 'three';
import { canvasTexture, makeCanvas } from './textures';
import { mulberry32 } from './noise';

export interface Ink {
  color: string;
  rough?: number;
  metal?: number;
}

export interface PanelBase {
  color: string;
  rough: number;
  metal: number;
  /** Lineare Bürstung (entlang x) – erzeugt Streifen & Anisotropie */
  brushed?: number;
  /** Rauheitsrauschen (Kunststoffe) */
  noise?: number;
}

export interface TextOpts {
  size: number; // Schriftgröße in mm (Versalhöhe ~0.7 × size)
  font?: string;
  weight?: number | string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  spacing?: number; // Zeichenabstand in mm
  ink?: Ink;
  italic?: boolean;
  rotate?: number; // Grad
}

export class PanelPainter {
  readonly color: CanvasRenderingContext2D;
  readonly orm: CanvasRenderingContext2D;
  readonly aniso: CanvasRenderingContext2D | null;
  readonly ppm: number;
  readonly w: number;
  readonly h: number;
  private defaultInk: Ink;

  constructor(widthMm: number, heightMm: number, base: PanelBase, opts: { ppm?: number; ink?: Ink; seed?: number } = {}) {
    const maxPx = 4096;
    this.ppm = Math.min(opts.ppm ?? 6, maxPx / widthMm, maxPx / heightMm);
    this.w = widthMm;
    this.h = heightMm;
    const pw = Math.round(widthMm * this.ppm);
    const ph = Math.round(heightMm * this.ppm);
    this.color = makeCanvas(pw, ph).getContext('2d', { willReadFrequently: false })!;
    this.orm = makeCanvas(pw, ph).getContext('2d')!;
    this.aniso = base.brushed ? makeCanvas(pw, ph).getContext('2d')! : null;
    this.defaultInk = opts.ink ?? { color: '#111', rough: 0.55, metal: 0 };

    for (const ctx of [this.color, this.orm, this.aniso]) {
      if (!ctx) continue;
      ctx.scale(this.ppm, this.ppm);
      ctx.lineCap = 'round';
    }
    this.fillBase(base, pw, ph, opts.seed ?? 1);
  }

  private ormStyle(rough: number, metal: number) {
    return `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
  }

  private fillBase(base: PanelBase, pw: number, ph: number, seed: number) {
    this.color.fillStyle = base.color;
    this.color.fillRect(0, 0, this.w, this.h);
    this.orm.fillStyle = this.ormStyle(base.rough, base.metal);
    this.orm.fillRect(0, 0, this.w, this.h);
    if (this.aniso) {
      this.aniso.fillStyle = 'rgb(255,128,255)'; // Richtung +u, volle Stärke
      this.aniso.fillRect(0, 0, this.w, this.h);
    }
    if (base.brushed || base.noise) {
      // Pixelgenaue Struktur direkt in ImageData schreiben
      const rnd = mulberry32(seed);
      const cImg = this.color.getImageData(0, 0, pw, ph);
      const oImg = this.orm.getImageData(0, 0, pw, ph);
      const c = cImg.data, o = oImg.data;
      const amt = base.brushed ?? 0;
      const nAmt = base.noise ?? 0;
      // Streifen: pro Zeile eine 1D-Rauschfunktion mit langer Korrelation in x
      const coarse = 90, fine = 9;
      const kc = new Float32Array(Math.ceil(pw / coarse) + 2);
      const kf = new Float32Array(Math.ceil(pw / fine) + 2);
      const smooth = (k: Float32Array, x: number, step: number) => {
        const p = x / step, i0 = Math.floor(p), t = p - i0, s = t * t * (3 - 2 * t);
        return k[i0] + (k[i0 + 1] - k[i0]) * s;
      };
      for (let y = 0; y < ph; y++) {
        const rowOff = (rnd() - 0.5) * 0.5;
        if (amt) {
          for (let k = 0; k < kc.length; k++) kc[k] = rnd() - 0.5;
          for (let k = 0; k < kf.length; k++) kf[k] = rnd() - 0.5;
        }
        for (let x = 0; x < pw; x++) {
          const i = (y * pw + x) * 4;
          let n = 0;
          if (amt) n += (smooth(kc, x, coarse) * 0.7 + smooth(kf, x, fine) * 0.3 + rowOff * 0.4) * amt;
          if (nAmt) n += (rnd() - 0.5) * nAmt;
          c[i] += n * 14; c[i + 1] += n * 14; c[i + 2] += n * 14;
          o[i + 1] += n * 30;
        }
      }
      this.color.putImageData(cImg, 0, 0);
      this.orm.putImageData(oImg, 0, 0);
    }
  }

  private inkOf(ink?: Ink): Required<Ink> {
    const k = { ...this.defaultInk, ...ink };
    return { color: k.color, rough: k.rough ?? 0.55, metal: k.metal ?? 0 };
  }

  /** Führt eine Zeichenoperation in allen Kanälen aus (Farbe/ORM/Anisotropie). */
  draw(ink: Ink | undefined, fn: (ctx: CanvasRenderingContext2D, style: string) => void) {
    const k = this.inkOf(ink);
    this.color.save();
    fn(this.color, k.color);
    this.color.restore();
    this.orm.save();
    fn(this.orm, this.ormStyle(k.rough, k.metal));
    this.orm.restore();
    if (this.aniso) {
      this.aniso.save();
      fn(this.aniso, 'rgb(255,128,0)'); // Druck: keine Anisotropie
      this.aniso.restore();
    }
  }

  text(str: string, x: number, y: number, o: TextOpts) {
    this.draw(o.ink, (ctx, style) => {
      ctx.fillStyle = style;
      ctx.font = `${o.italic ? 'italic ' : ''}${o.weight ?? 500} ${o.size}px ${o.font ?? 'Jost'}`;
      ctx.textAlign = o.align ?? 'center';
      ctx.textBaseline = o.baseline ?? 'middle';
      ctx.translate(x, y);
      if (o.rotate) ctx.rotate((o.rotate * Math.PI) / 180);
      if (o.spacing) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.spacing}px`;
      ctx.fillText(str, 0, 0);
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, ink?: Ink) {
    this.draw(ink, (ctx, style) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
  }

  rect(x: number, y: number, w: number, h: number, ink?: Ink, stroke?: number, radius = 0) {
    this.draw(ink, (ctx, style) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      if (stroke) {
        ctx.strokeStyle = style;
        ctx.lineWidth = stroke;
        ctx.stroke();
      } else {
        ctx.fillStyle = style;
        ctx.fill();
      }
    });
  }

  circle(x: number, y: number, r: number, ink?: Ink, stroke?: number) {
    this.draw(ink, (ctx, style) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (stroke) {
        ctx.strokeStyle = style;
        ctx.lineWidth = stroke;
        ctx.stroke();
      } else {
        ctx.fillStyle = style;
        ctx.fill();
      }
    });
  }

  /**
   * Skala um einen Drehknopf: Winkel in Grad, 0° = oben, im Uhrzeigersinn.
   * labels werden gleichmäßig auf die Hauptstriche verteilt.
   */
  scale(
    cx: number,
    cy: number,
    r: number,
    opts: { from: number; to: number; ticks: number; major?: number; len?: number; majorLen?: number; width?: number; labels?: string[]; labelSize?: number; labelR?: number; ink?: Ink; dots?: boolean },
  ) {
    const { from, to, ticks } = opts;
    const major = opts.major ?? 1;
    for (let i = 0; i < ticks; i++) {
      const a = ((from + ((to - from) * i) / (ticks - 1)) * Math.PI) / 180;
      const isMajor = i % major === 0;
      const len = isMajor ? (opts.majorLen ?? 2.2) : (opts.len ?? 1.2);
      const sx = cx + Math.sin(a) * r, sy = cy - Math.cos(a) * r;
      if (opts.dots) {
        this.circle(sx, sy, isMajor ? 0.55 : 0.35, opts.ink);
      } else {
        const ex = cx + Math.sin(a) * (r + len), ey = cy - Math.cos(a) * (r + len);
        this.line(sx, sy, ex, ey, (opts.width ?? 0.35) * (isMajor ? 1.3 : 1), opts.ink);
      }
    }
    if (opts.labels) {
      const n = opts.labels.length;
      const lr = opts.labelR ?? r + (opts.majorLen ?? 2.2) + 2.2;
      opts.labels.forEach((label, i) => {
        const a = ((from + ((to - from) * i) / Math.max(1, n - 1)) * Math.PI) / 180;
        this.text(label, cx + Math.sin(a) * lr, cy - Math.cos(a) * lr, { size: opts.labelSize ?? 2.4, ink: opts.ink, weight: 500 });
      });
    }
  }

  /** Eigenes Zeichnen im Farbkanal (z. B. Logos), ohne Einfluss auf ORM. */
  colorOnly(fn: (ctx: CanvasRenderingContext2D) => void) {
    this.color.save();
    fn(this.color);
    this.color.restore();
  }

  textures(): { map: THREE.CanvasTexture; orm: THREE.CanvasTexture; aniso: THREE.CanvasTexture | null } {
    return {
      map: canvasTexture(this.color.canvas, { srgb: true }),
      orm: canvasTexture(this.orm.canvas),
      aniso: this.aniso ? canvasTexture(this.aniso.canvas) : null,
    };
  }

  /** Fertiges Material mit allen Maps. */
  material(extra: THREE.MeshPhysicalMaterialParameters = {}, anisotropy = 0.7): THREE.MeshPhysicalMaterial {
    const t = this.textures();
    const m = new THREE.MeshPhysicalMaterial({
      map: t.map,
      roughnessMap: t.orm,
      metalnessMap: t.orm,
      roughness: 1,
      metalness: 1,
      ...extra,
    });
    if (t.aniso) {
      m.anisotropy = anisotropy;
      m.anisotropyMap = t.aniso;
    }
    return m;
  }
}
