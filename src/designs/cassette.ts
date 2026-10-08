/**
 * Compact Cassette (100,4 × 63,8 × 12 mm) mit Sichtfenster, Bandwickeln,
 * Zahnrad-Naben, Schrauben und beschriftetem Etikett.
 * Wickelradien folgen dem Fortschritt: links wird kleiner, rechts größer.
 * Lokales Koordinatensystem: Vorderseite zeigt nach +z, Einheit Meter.
 */
import * as THREE from 'three';
import { extrudePanel, filletProfile, lathe, mm, roundedRectPath, screwHead } from '../engine/geom';
import { glass, paint, plastic } from '../engine/materials';
import { canvasTexture, makeCanvas, paperNormal } from '../engine/textures';
import type { TrackInfo } from '../playback/types';

const CW = 100.4, CH = 63.8, CT = 12; // mm
const HUB_X = 21.3, HUB_Y = 4.2;
const HUB_R = 11, PACK_MAX = 24.2;
const WIN = { w: 64, h: 22, r: 3, y: HUB_Y };

function outline(): THREE.Shape {
  // Außenkontur mit abgeschrägter Unterkante (Kopfzugang)
  const s = new THREE.Shape();
  const w = CW / 2, h = CH / 2, r = 2.5;
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

function scaleShape(shape: THREE.Shape, k: number): THREE.Shape {
  const pts = shape.getPoints(24).map((p) => p.multiplyScalar(k));
  const s = new THREE.Shape(pts);
  s.holes = shape.holes.map((h) => new THREE.Path(h.getPoints(24).map((p) => p.multiplyScalar(k))));
  return s;
}

export class Cassette {
  readonly group = new THREE.Group();
  private reels: Array<{ hub: THREE.Group; pack: THREE.Mesh }> = [];
  private labelCanvas: HTMLCanvasElement;
  private labelTex: THREE.CanvasTexture;
  private angle = [0, 0];
  private artImg: CanvasImageSource | null = null;
  readonly depth = mm(CT);

  constructor(opts: { shell?: 'black' | 'smoke' | 'white'; labelColor?: string; stripe?: string } = {}) {
    const g = this.group;
    const shellColor = opts.shell === 'white' ? '#e9e6df' : opts.shell === 'smoke' ? '#2b2826' : '#141414';
    const shellMat = plastic(shellColor, { gloss: 0.55, texture: 'fine', seed: 5 });
    const k = 0.001;

    // Rückschale (ohne Fenster)
    const back = new THREE.Mesh(extrudePanel(scaleShape(outline(), k), mm(5.6), mm(0.6), 8), shellMat);
    back.position.z = -mm(CT / 2);
    g.add(back);

    // Vorderschale mit Fensteröffnung
    const front = outline();
    front.holes.push(roundedRectPath(WIN.w, WIN.h, WIN.r, 0, WIN.y));
    const frontMesh = new THREE.Mesh(extrudePanel(scaleShape(front, k), mm(5.6), mm(0.6), 8), shellMat);
    frontMesh.position.z = mm(0.4);
    g.add(frontMesh);
    // Innenraum (dunkle Rückwand hinter dem Fenster)
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(mm(WIN.w + 4), mm(WIN.h + 4)), paint('#0c0c0c', 0.8));
    inner.position.set(0, mm(WIN.y), -mm(CT / 2) + mm(5.7));
    g.add(inner);

    // Klares Fenster
    const winShape = new THREE.Shape();
    winShape.curves = roundedRectPath(WIN.w + 1.5, WIN.h + 1.5, WIN.r, 0, WIN.y).curves;
    const winGeo = new THREE.ShapeGeometry(scaleShape(winShape, k), 8);
    const win = new THREE.Mesh(winGeo, glass({ roughness: 1, thickness: 0.001 }));
    win.position.z = mm(2.6);
    win.userData.passThrough = true;
    g.add(win);

    // Etikett mit Aussparung fürs Fenster
    this.labelCanvas = makeCanvas(1004, 638);
    this.labelTex = canvasTexture(this.labelCanvas, { srgb: true });
    const lab = new THREE.Shape();
    const lw = CW - 9, lh = CH - 17;
    lab.curves = roundedRectPath(lw, lh, 2, 0, CH / 2 - 4 - lh / 2).curves;
    lab.holes.push(roundedRectPath(WIN.w + 3, WIN.h + 3, WIN.r + 1, 0, WIN.y));
    const labGeo = new THREE.ShapeGeometry(scaleShape(lab, k), 12);
    // UV relativ zur Etikettfläche
    labGeo.computeBoundingBox();
    const bb = labGeo.boundingBox!;
    const pos = labGeo.getAttribute('position');
    const uv = labGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++)
      uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    const labelMat = new THREE.MeshPhysicalMaterial({ map: this.labelTex, roughness: 0.6, normalMap: paperNormal(), normalScale: new THREE.Vector2(0.3, 0.3), sheen: 0.2, sheenRoughness: 0.6 });
    const label = new THREE.Mesh(labGeo, labelMat);
    label.position.z = mm(6.15);
    g.add(label);
    this.labelAspect = (bb.max.x - bb.min.x) / (bb.max.y - bb.min.y);

    // Wickel & Naben
    const tapeMat = new THREE.MeshPhysicalMaterial({ color: '#3b2a1f', roughness: 0.38, metalness: 0.1, sheen: 0.4, sheenColor: new THREE.Color('#8a6a50') });
    const hubMat = plastic('#efeee9', { gloss: 0.5, texture: 'smooth' });
    for (const side of [-1, 1]) {
      const hub = new THREE.Group();
      hub.position.set(mm(HUB_X * side), mm(HUB_Y), 0);
      // Nabenring mit Zähnen
      const ring = new THREE.Mesh(lathe(filletProfile([[mm(4.2), -mm(3)], [mm(HUB_R), -mm(3)], [mm(HUB_R), mm(3)], [mm(4.2), mm(3)]], 2), 48), hubMat);
      ring.rotation.x = Math.PI / 2;
      hub.add(ring);
      for (let t = 0; t < 6; t++) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(mm(1.6), mm(2.2), mm(5)), hubMat);
        const a = (t / 6) * Math.PI * 2;
        tooth.position.set(Math.cos(a) * mm(4.4), Math.sin(a) * mm(4.4), 0);
        tooth.rotation.z = a + Math.PI / 2;
        hub.add(tooth);
      }
      // Klemmkeil (dunkle Kerbe) – zeigt die Drehung
      const clip = new THREE.Mesh(new THREE.BoxGeometry(mm(3), mm(2), mm(6.2)), paint('#2a2a2a', 0.6));
      clip.position.set(mm(HUB_R - 1.2), 0, 0);
      hub.add(clip);
      const pack = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, mm(5.6), 96, 1, false), tapeMat);
      pack.rotation.x = Math.PI / 2;
      pack.position.copy(hub.position);
      g.add(hub, pack);
      this.reels.push({ hub, pack });
    }
    // Band entlang der Unterkante (durch die Kopföffnungen sichtbar)
    const tapeStrip = new THREE.Mesh(new THREE.BoxGeometry(mm(80), mm(0.4), mm(3.8)), tapeMat);
    tapeStrip.position.set(0, -mm(CH / 2 - 2.2), 0);
    g.add(tapeStrip);

    // Schrauben
    const screwMetal = new THREE.MeshPhysicalMaterial({ color: '#8d8d8d', metalness: 1, roughness: 0.35 });
    const slot = paint('#1a1a1a', 0.8);
    for (const [x, y] of [[-46, 27], [46, 27], [-46, -27], [46, -27], [0, -25]]) {
      const s = screwHead(mm(1.6), screwMetal, slot);
      s.rotation.x = Math.PI / 2;
      s.position.set(mm(x), mm(y), mm(6.0));
      g.add(s);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.setProgress(0);
    this.drawLabel(null, opts.labelColor ?? '#efe9dc', opts.stripe ?? '#d9542c');
    this.labelColor = opts.labelColor ?? '#efe9dc';
    this.stripe = opts.stripe ?? '#d9542c';
  }

  private labelAspect = 1.8;
  private labelColor: string;
  private stripe: string;

  setProgress(p: number) {
    const area = PACK_MAX * PACK_MAX - HUB_R * HUB_R;
    const rL = Math.sqrt(HUB_R * HUB_R + area * (1 - p));
    const rR = Math.sqrt(HUB_R * HUB_R + area * p);
    this.reels[0].pack.scale.set(mm(rL), 1, mm(rL));
    this.reels[1].pack.scale.set(mm(rR), 1, mm(rR));
    this.radii = [rL, rR];
  }
  private radii = [PACK_MAX, HUB_R];

  /** Dreht die Naben entsprechend der Bandgeschwindigkeit (4,76 cm/s × factor). */
  spin(dt: number, factor: number) {
    for (let i = 0; i < 2; i++) {
      const omega = (47.6 * factor) / this.radii[i]; // rad/s (mm/s ÷ mm)
      this.angle[i] += omega * dt;
      this.reels[i].hub.rotation.z = this.angle[i];
      this.reels[i].pack.rotation.y = this.angle[i];
    }
  }

  setTrack(track: TrackInfo | null, art: THREE.Texture | null) {
    this.artImg = (art?.image as CanvasImageSource | undefined) ?? null;
    this.drawLabel(track, this.labelColor, this.stripe);
  }

  private drawLabel(track: TrackInfo | null, bg: string, stripe: string) {
    const c = this.labelCanvas;
    const ctx = c.getContext('2d')!;
    const W = c.width, H = c.height;
    // Etikett ist breiter als hoch → Canvas passend verzerren vermeiden
    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Farbstreifen unten
    ctx.fillStyle = stripe;
    ctx.fillRect(0, H * 0.79, W, H * 0.065);
    ctx.fillStyle = '#2f2f2f';
    ctx.fillRect(0, H * 0.87, W, H * 0.028);
    // Linien zum Beschriften
    ctx.strokeStyle = 'rgba(80,90,120,0.35)';
    ctx.lineWidth = 2;
    for (const y of [0.135, 0.228]) {
      ctx.beginPath();
      ctx.moveTo(W * 0.09, H * y);
      ctx.lineTo(W * 0.79, H * y);
      ctx.stroke();
    }
    // Seitenbuchstabe & Kleingedrucktes
    ctx.fillStyle = '#1b1b1b';
    ctx.font = `700 ${H * 0.12}px Jost`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('A', W * 0.022, H * 0.15);
    ctx.font = `500 ${H * 0.042}px Jost`;
    ctx.fillText('C-90 · HIGH BIAS · 70µs', W * 0.03, H * 0.965);
    ctx.textAlign = 'right';
    ctx.fillText('NR  ON □  OFF ■', W * 0.97, H * 0.965);
    ctx.textAlign = 'left';
    // Handschrift
    const title = track?.name ?? 'Mixtape';
    const artist = track?.artists ?? '';
    ctx.fillStyle = '#1d2a6b';
    let size = H * 0.095;
    ctx.font = `400 ${size}px "Permanent Marker"`;
    while (ctx.measureText(title).width > W * 0.68 && size > H * 0.045) {
      size *= 0.93;
      ctx.font = `400 ${size}px "Permanent Marker"`;
    }
    ctx.save();
    ctx.translate(W * 0.1, H * 0.122);
    ctx.rotate(-0.01);
    ctx.fillText(title, 0, 0);
    ctx.restore();
    size = H * 0.06;
    ctx.font = `400 ${size}px "Permanent Marker"`;
    while (ctx.measureText(artist).width > W * 0.68 && size > H * 0.035) {
      size *= 0.93;
      ctx.font = `400 ${size}px "Permanent Marker"`;
    }
    ctx.fillStyle = '#2b3a80';
    ctx.fillText(artist, W * 0.1, H * 0.215);
    // Cover als Aufkleber oben rechts
    if (this.artImg) {
      const s = H * 0.19;
      ctx.save();
      ctx.translate(W * 0.885, H * 0.118);
      ctx.rotate(0.04);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(-s / 2 + 3, -s / 2 + 4, s, s);
      ctx.drawImage(this.artImg, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.restore();
    this.labelTex.needsUpdate = true;
    void this.labelAspect;
  }
}
