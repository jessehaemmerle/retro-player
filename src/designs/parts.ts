/** Wiederverwendbare, realistisch aufgebaute Bauteile: Drehknöpfe, Tasten, Segmentanzeigen. */
import * as THREE from 'three';
import { disc, filletProfile, lathe, mm } from '../engine/geom';
import { chrome, knurledMetal, plastic, spunAluminum, paint } from '../engine/materials';
import { canvasTexture, makeCanvas } from '../engine/textures';

export interface KnobOptions {
  radius: number;
  height: number;
  style: 'aluminum' | 'black' | 'chrome' | 'blackAlu';
  ridges?: number; // Rändelung (0 = glatt)
  skirt?: { radius: number; height: number };
  indicator?: 'line' | 'dot' | 'notch' | 'none';
  indicatorColor?: string;
  segments?: number;
}

/**
 * Drehknopf mit Achse +y. Rückgabe: Gruppe (fest) und `spin` (dreht um y).
 * Aufbau: optionale Skirt-Scheibe, gerändelter Mantel, Fase, abgedrehte Kappe, Markierung.
 */
export function makeKnob(o: KnobOptions): { group: THREE.Group; spin: THREE.Group } {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const seg = o.segments ?? 72;
  const R = o.radius, H = o.height;
  const chamfer = Math.min(R * 0.12, H * 0.25);

  const sideMat =
    o.style === 'black'
      ? plastic('#0b0b0c', { gloss: 0.35, texture: 'fine' })
      : o.ridges
        ? knurledMetal(o.ridges, { color: o.style === 'chrome' ? new THREE.Color(0.9, 0.9, 0.9) : new THREE.Color(0.78, 0.78, 0.79), roughness: o.style === 'chrome' ? 0.12 : 0.28 })
        : o.style === 'chrome'
          ? chrome()
          : o.style === 'blackAlu'
            ? knurledMetal(1, { color: new THREE.Color(0.04, 0.04, 0.045), roughness: 0.35, normalMap: null })
            : knurledMetal(1, { roughness: 0.25, normalMap: null });
  const capMat =
    o.style === 'black'
      ? plastic('#0b0b0c', { gloss: 0.5, texture: 'smooth' })
      : o.style === 'blackAlu'
        ? spunAluminum({ color: new THREE.Color(0.05, 0.05, 0.055) })
        : o.style === 'chrome'
          ? chrome()
          : spunAluminum();

  let y0 = 0;
  if (o.skirt) {
    const sk = new THREE.Mesh(
      lathe(filletProfile([[0, 0], [o.skirt.radius, 0], [o.skirt.radius, o.skirt.height, mm(0.6)], [R, o.skirt.height], [0, o.skirt.height]], 3), seg),
      o.style === 'black' ? sideMat : spunAluminum(),
    );
    // Skirt-Oberseite mit planarer Drehstruktur
    const skTop = new THREE.Mesh(disc(o.skirt.radius - mm(0.6), seg, R * 0.98), capMat);
    skTop.position.y = o.skirt.height + 1e-5;
    spin.add(sk, skTop);
    y0 = o.skirt.height;
  }

  // Mantel (offener Zylinder; UV-u läuft um den Umfang → Rändelung)
  const sideH = H - chamfer;
  const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R, sideH, seg, 1, true), sideMat);
  side.position.y = y0 + sideH / 2;
  spin.add(side);
  // Fase oben
  const ch = new THREE.Mesh(lathe([[R, y0 + sideH], [R - chamfer * 0.35, y0 + sideH + chamfer * 0.75], [R - chamfer, y0 + H]], seg), o.style === 'black' ? sideMat : chrome({ roughness: 1 }));
  spin.add(ch);
  // Kappe
  const cap = new THREE.Mesh(disc(R - chamfer, seg), capMat);
  cap.position.y = y0 + H;
  spin.add(cap);

  // Markierung
  const indColor = o.indicatorColor ?? (o.style === 'black' || o.style === 'blackAlu' ? '#e8e4da' : '#111');
  if (o.indicator === 'line' || o.indicator === undefined) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(R * 0.07, mm(0.12), (R - chamfer) * 0.62), paint(indColor, 0.5));
    line.position.set(0, y0 + H + mm(0.04), -(R - chamfer) * 0.55);
    spin.add(line);
  } else if (o.indicator === 'dot') {
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.09, R * 0.09, mm(0.15), 24), paint(indColor, 0.4));
    dot.position.set(0, y0 + H + mm(0.05), -(R - chamfer) * 0.72);
    spin.add(dot);
  } else if (o.indicator === 'notch') {
    // Kerbe im Mantel + Linie auf der Kappe
    const notch = new THREE.Mesh(new THREE.BoxGeometry(R * 0.08, H * 0.9, R * 0.08), paint('#0a0a0a', 0.6));
    notch.position.set(0, y0 + H * 0.5, -R + R * 0.02);
    const line = new THREE.Mesh(new THREE.BoxGeometry(R * 0.06, mm(0.12), (R - chamfer) * 0.45), paint('#0a0a0a', 0.6));
    line.position.set(0, y0 + H + mm(0.04), -(R - chamfer) * 0.7);
    spin.add(notch, line);
  }
  spin.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return { group, spin };
}

/** Runde Drucktaste mit Hub. Achse +y. */
export function makeRoundButton(o: { radius: number; height: number; material: THREE.Material; bezel?: THREE.Material; bezelRadius?: number }) {
  const group = new THREE.Group();
  const cap = new THREE.Mesh(
    lathe(filletProfile([[0, 0], [o.radius, 0], [o.radius, o.height, o.radius * 0.25], [0, o.height + o.radius * 0.04]], 5), 48),
    o.material,
  );
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);
  if (o.bezel) {
    const br = o.bezelRadius ?? o.radius * 1.25;
    const bez = new THREE.Mesh(
      lathe(filletProfile([[o.radius * 1.03, 0], [o.radius * 1.03, o.height * 0.35], [br, o.height * 0.35, mm(0.6)], [br, 0]], 3), 48),
      o.bezel,
    );
    bez.receiveShadow = true;
    group.add(bez);
  }
  return { group, cap };
}

/**
 * Segmentanzeige (LED/VFD/LCD) auf Canvas-Basis mit DSEG-Schriften.
 * Unbeleuchtete Segmente bleiben schwach sichtbar – wie bei echten Anzeigen.
 */
export class SegmentCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  private last = '';

  constructor(
    readonly width: number,
    readonly height: number,
    private bg = '#000',
  ) {
    this.canvas = makeCanvas(width, height);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = canvasTexture(this.canvas, { srgb: true });
    this.clear();
  }

  clear() {
    this.ctx.fillStyle = this.bg;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Zeichnet Segmenttext. `cells` = Anzahl Stellen; Leerzeichen werden zu
   * "!" (alles aus, volle Breite). Gibt nichts zurück; markiert Textur zum Update.
   */
  segText(
    text: string,
    x: number,
    y: number,
    o: { size: number; cells: number; kind: 7 | 14; on: string; off: string; italic?: boolean; align?: 'left' | 'right'; glow?: number },
  ) {
    const ctx = this.ctx;
    const family = o.kind === 7 ? 'DSEG7' : 'DSEG14';
    ctx.font = `${o.italic ? 'italic ' : ''}700 ${o.size}px ${family}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const all = o.kind === 7 ? '8' : '~';
    let t = text.slice(0, o.cells);
    if (o.align === 'right') t = t.padStart(o.cells, ' ');
    else t = t.padEnd(o.cells, ' ');
    // Doppelpunkte/Punkte haben eigene Breiten → Zeichen einzeln setzen
    const cellW = ctx.measureText(all).width;
    let cx = x;
    for (const ch of t) {
      if (ch === '.' || ch === ':') {
        ctx.fillStyle = o.on;
        ctx.fillText(ch, cx - cellW * 0.12, y);
        continue;
      }
      ctx.fillStyle = o.off;
      ctx.fillText(all, cx, y);
      if (ch !== ' ') {
        ctx.save();
        ctx.fillStyle = o.on;
        if (o.glow) {
          ctx.shadowColor = o.on;
          ctx.shadowBlur = o.glow;
        }
        ctx.fillText(ch, cx, y);
        ctx.restore();
      }
      cx += cellW;
    }
  }

  /** Nur aktualisieren, wenn sich der Inhalt geändert hat. */
  commit(key: string) {
    if (key === this.last) return;
    this.last = key;
    this.texture.needsUpdate = true;
  }
}

/** Material für leuchtende Anzeigen (LED/VFD): Emission über HDR, sonst schwarz. */
export function displayMaterial(tex: THREE.Texture, intensity = 2.2): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#000000',
    emissive: '#ffffff',
    emissiveMap: tex,
    emissiveIntensity: intensity,
    roughness: 0.6,
    metalness: 0,
  });
}

/** Wiedergabe-Laufschrift: liefert ein Fenster aus einem langen Text. */
export function marquee(text: string, cells: number, time: number, speed = 3.2): string {
  if (text.length <= cells) return text;
  const gap = '    ';
  const full = text + gap;
  const off = Math.floor(time * speed) % full.length;
  return (full + full).slice(off, off + cells);
}
