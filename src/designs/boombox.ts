/**
 * 80er-Boombox: silberne Front, Lochblech-Lautsprecher mit schwingenden Membranen,
 * Kassettenfach mit laufender Kassette, VFD-Anzeige (14-Segment-Laufschrift für
 * den Titel, 7-Segment für die Zeit, Spektrumanalysator) und Piano-Tasten.
 */
import * as THREE from 'three';
import { Design, damp, formatTime, type FrameState } from './base';
import { Cassette } from './cassette';
import { SegmentCanvas, displayMaterial, makeKnob, marquee } from './parts';
import type { SceneSpec } from '../engine/stage';
import { disc, extrudePanel, filletProfile, lathe, mm, roundedBox, roundedRectPath, roundedRectShape, shadows, tube } from '../engine/geom';
import { chrome, emissive, paint, plastic, rubber, tintedWindow } from '../engine/materials';
import { PanelPainter } from '../engine/panel';
import { canvasTexture, makeCanvas, perforatedAlpha, speakerConeColor, withRepeat } from '../engine/textures';
import { toSegmentText } from '../engine/fonts';
import type { TrackInfo } from '../playback/types';

const W = 0.62, H = 0.3, D = 0.15;
const FEET = 0.008;
const CY = FEET + H / 2; // Gehäusemitte
const FACE_T = 0.022; // Tiefe der Frontplatte (bildet die Ausschnitt-Wände)
const FZ = D / 2; // Vorderseite
const WOOF = { x: 0.2, y: -0.03, r: 0.09 };
const TWEET = { x: 0.2, y: 0.104, r: 0.026 };
const DISP = { x: 0, y: 0.098, w: 0.17, h: 0.058 };
const DOOR = { x: 0, y: -0.026, w: 0.162, h: 0.106 };

type KeyId = 'rec' | 'play' | 'rew' | 'ff' | 'stop' | 'pause';

export class Boombox extends Design {
  readonly id = 'boombox';
  readonly name = 'Boombox';
  readonly description = 'Ghettoblaster der 80er mit VFD-Anzeige, Piano-Tasten und Kassettendeck.';
  readonly scene: SceneSpec = {
    hdri: 'studio_small_09',
    envIntensity: 0.9,
    envRotation: 300,
    background: 'wooden_lounge',
    bgBlur: 0.5,
    bgIntensity: 0.3,
    bgRotation: 200,
    exposure: 1.0,
    ground: { surface: 'concrete', size: 1.4, fade: [1.2, 2.4], blur: [0.45, 1.3], roughness: 1, normalScale: 1, tint: '#bdb7ae' },
    key: { position: [-1.2, 1.8, 1.4], intensity: 1.7, color: '#fff1e2', softness: 8, area: 0.6 },
    fill: { position: [1.6, 0.9, 1.2], intensity: 0.3, color: '#dce6ff' },
    camera: { fov: 30, target: [0, 0.17, 0.02], azimuth: -8, polar: 74, frame: [0.88, 0.56], azimuthRange: 50, polarRange: [35, 88], zoom: [0.4, 1.5] },
    contactShadow: { width: 1.2, depth: 0.6, height: 0.2, blur: 2.4, darkness: 1.5, opacity: 0.95 },
  };

  private cassette = new Cassette({ shell: 'smoke', labelColor: '#f1ece1', stripe: '#e0662e' });
  private door = new THREE.Group();
  private doorOpen = 0;
  private ejected = false;
  private cones: THREE.Object3D[] = [];
  private vfd = new SegmentCanvas(1024, 352, '#000');
  private keys = new Map<KeyId, { group: THREE.Group; press: number; held: boolean }>();
  private pauseLatched = false;
  private volumeKnob!: THREE.Group;
  private toneKnob!: THREE.Group;
  private tone = 0.5;
  private ledMat = emissive('#ff2200', 0);
  private shownVolume = 0.6;
  private lastTitle = '';

  protected async build() {
    this.buildBody();
    this.buildSpeakers();
    this.buildDisplay();
    this.buildDeck();
    this.buildKeys();
    this.buildTop();
    shadows(this.root);
  }

  private buildBody() {
    const shell = plastic('#151515', { gloss: 0.25, texture: 'coarse', seed: 3 });
    const body = new THREE.Mesh(roundedBox(W, H, D - FACE_T, 0.016, 5), shell);
    body.position.set(0, CY, -FACE_T / 2);
    this.root.add(body);

    // Frontplatte mit Ausschnitten
    const shape = roundedRectShape(W, H, 0.016);
    for (const s of [-1, 1]) {
      shape.holes.push(new THREE.Path().absarc(WOOF.x * s, WOOF.y, WOOF.r, 0, Math.PI * 2, true));
      shape.holes.push(new THREE.Path().absarc(TWEET.x * s, TWEET.y, TWEET.r, 0, Math.PI * 2, true));
    }
    shape.holes.push(roundedRectPath(DISP.w, DISP.h, 0.004, DISP.x, DISP.y));
    shape.holes.push(roundedRectPath(DOOR.w, DOOR.h, 0.005, DOOR.x, DOOR.y));

    const p = new PanelPainter(W * 1000, H * 1000, { color: '#c4c5c8', rough: 0.4, metal: 0.55, brushed: 0.45 }, { ppm: 5, ink: { color: '#121212', rough: 0.5 } });
    const px = (x: number) => (x + W / 2) * 1000;
    const py = (y: number) => (H / 2 - y) * 1000;
    // Schwarze Zierflächen um Lautsprecher & Mitte
    for (const s of [-1, 1]) {
      p.circle(px(WOOF.x * s), py(WOOF.y), WOOF.r * 1000 + 7, { color: '#151515', rough: 0.45 });
      p.circle(px(TWEET.x * s), py(TWEET.y), TWEET.r * 1000 + 5, { color: '#151515', rough: 0.45 });
    }
    p.rect(px(-0.098), py(0.135), 196, 270 - 15, { color: '#1a1a1a', rough: 0.4 }, 0, 4);
    p.text('HYPERSONIC', px(0), py(0.1415), { size: 7.2, font: 'Michroma', weight: 400, spacing: 2.2, ink: { color: '#e9e9e9', rough: 0.4 } });
    p.text('HS-850  STEREO RADIO CASSETTE RECORDER', px(-WOOF.x), py(-0.136), { size: 3.4, weight: 600, spacing: 0.8 });
    p.text('2-WAY 4-SPEAKER  ·  SUPER BASS', px(WOOF.x), py(-0.136), { size: 3.4, weight: 600, spacing: 0.8 });
    p.text('AUTO STOP  ·  FULL LOGIC  ·  METAL', px(0), py(-0.085), { size: 2.6, weight: 500, spacing: 0.6, ink: { color: '#d8d8d8' } });
    // Skalen um die Knöpfe
    p.scale(px(0.05), py(-0.111), 14.5, { from: -135, to: 135, ticks: 11, major: 2, len: 1.2, majorLen: 2, labels: ['0', '', '', '', '', '10'], labelSize: 2.4, ink: { color: '#e4e4e4' } });
    p.text('VOLUME', px(0.05), py(-0.137), { size: 2.6, weight: 600, spacing: 0.6, ink: { color: '#e4e4e4' } });
    p.scale(px(-0.05), py(-0.111), 12, { from: -135, to: 135, ticks: 9, major: 4, len: 1.2, majorLen: 2, labels: ['LOW', 'HIGH'], labelSize: 2.2, labelR: 19, ink: { color: '#e4e4e4' } });
    p.text('TONE', px(-0.05), py(-0.137), { size: 2.6, weight: 600, spacing: 0.6, ink: { color: '#e4e4e4' } });
    // Mikrofon-Lochkreise
    for (const s of [-1, 1]) {
      const cx = px(0.083 * s), cy = py(0.141);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        p.circle(cx + Math.cos(a) * 1.6, cy + Math.sin(a) * 1.6, 0.42, { color: '#050505', rough: 0.9 });
      }
      p.circle(cx, cy, 0.42, { color: '#050505', rough: 0.9 });
    }
    p.text('MIC', px(-0.083) + 7, py(0.141), { size: 2, weight: 600, ink: { color: '#d0d0d0' }, align: 'left' });

    const faceMat = p.material({ clearcoat: 0.35, clearcoatRoughness: 0.2 }, 0.45);
    const wallMat = plastic('#0d0d0d', { gloss: 0.2, texture: 'fine', smudges: false });
    const face = new THREE.Mesh(extrudePanel(shape, FACE_T, 0.0012, 48), [faceMat, wallMat]);
    face.position.set(0, CY, FZ - FACE_T);
    this.root.add(face);

    // Kontroll-LED
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0019, 16, 10), this.ledMat);
    led.scale.z = 0.5;
    led.position.set(0.075, CY + DISP.y - DISP.h / 2 - 0.006, FZ + 0.0006);
    this.root.add(led);

    // Knöpfe (vorne, Achse +z)
    const vol = makeKnob({ radius: 0.0125, height: 0.013, style: 'aluminum', ridges: 54, indicator: 'notch' });
    vol.group.rotation.x = Math.PI / 2;
    vol.group.position.set(0.05, CY - 0.111, FZ);
    this.volumeKnob = vol.spin;
    const tone = makeKnob({ radius: 0.0105, height: 0.012, style: 'aluminum', ridges: 46, indicator: 'notch' });
    tone.group.rotation.x = Math.PI / 2;
    tone.group.position.set(-0.05, CY - 0.111, FZ);
    this.toneKnob = tone.spin;
    this.root.add(vol.group, tone.group);

    // Füße
    const foot = rubber('#111');
    for (const [x, z] of [[-0.26, -0.045], [0.26, -0.045], [-0.26, 0.045], [0.26, 0.045]]) {
      const f = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.012, 0, mm(2)], [0.014, FEET], [0, FEET]], 3), 32), foot);
      f.position.set(x, 0, z);
      this.root.add(f);
    }
  }

  private buildSpeaker(r: number, kind: 'woofer' | 'tweeter'): THREE.Group {
    const g = new THREE.Group();
    // Lautsprecherkorb/Frontring
    const frameMat = paint('#0b0b0b', 0.5);
    frameMat.side = THREE.DoubleSide;
    const frame = new THREE.Mesh(lathe([[r * 0.94, 0], [r, 0], [r, -0.002], [r * 0.93, -0.003]], 64), frameMat);
    frame.rotation.x = Math.PI / 2;
    frame.position.z = -0.009;
    g.add(frame);
    const cone = new THREE.Group();
    const coneR = r * 0.8;
    const capR = r * (kind === 'woofer' ? 0.28 : 0.55);
    // Sicke (Gummi, halbrund)
    const sProf: Array<[number, number]> = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      sProf.push([coneR + (r * 0.92 - coneR) * (0.5 - 0.5 * Math.cos(a)), Math.sin(a) * r * 0.05 - 0.003]);
    }
    const surround = new THREE.Mesh(lathe(sProf, 64), rubber('#141414', { roughness: 0.7, side: THREE.DoubleSide }));
    surround.rotation.x = Math.PI / 2;
    cone.add(surround);
    if (kind === 'woofer') {
      const depth = Math.min(r * 0.32, 0.011);
      const membrane = new THREE.Mesh(
        lathe([[capR, -0.003 - depth], [coneR * 0.6, -0.003 - depth * 0.45], [coneR, -0.003]], 64),
        new THREE.MeshPhysicalMaterial({ map: speakerConeColor('#1d1b19'), roughness: 0.92, specularIntensity: 0.4, side: THREE.DoubleSide }),
      );
      membrane.rotation.x = Math.PI / 2;
      cone.add(membrane);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(capR * 1.25, 32, 16, 0, Math.PI * 2, 0, 0.7), new THREE.MeshPhysicalMaterial({ color: '#0f0f0f', roughness: 0.7, specularIntensity: 0.4 }));
      cap.rotation.x = Math.PI / 2;
      cap.position.z = -0.003 - depth - capR * 1.25 * Math.cos(0.7) + 0.004;
      cone.add(cap);
    } else {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(capR, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), chrome({ roughness: 1, color: new THREE.Color(0.6, 0.6, 0.62) }));
      dome.rotation.x = Math.PI / 2;
      dome.position.z = -0.006;
      dome.scale.y = 0.6;
      cone.add(dome);
    }
    cone.position.z = -0.009;
    cone.userData.baseZ = -0.009;
    g.add(cone);
    if (kind === 'woofer') this.cones.push(cone);

    // Lochblech-Gitter
    const holes = (r * 2) / 0.0024;
    const grille = new THREE.Mesh(
      disc(r * 1.005, 96),
      new THREE.MeshPhysicalMaterial({
        color: '#18181a',
        metalness: 0.6,
        roughness: 0.62,
        alphaMap: withRepeat(perforatedAlpha(0.6), holes / 2, holes / 2 / 1.72),
        transparent: true,
      }),
    );
    // Mip-Bias gegen Moiré: aus normalem Abstand verschwimmen die Löcher wie auf einem Foto,
    // beim Heranzoomen werden sie sichtbar.
    grille.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('texture2D( alphaMap, vAlphaMapUv ).g', 'texture2D( alphaMap, vAlphaMapUv, 1.6 ).g');
    };
    grille.rotation.x = Math.PI / 2;
    grille.position.z = -0.0006;
    grille.userData.passThrough = true;
    g.add(grille);
    // Chromring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.0015, 0.0034, 20, 128), chrome());
    ring.position.z = 0.0016;
    g.add(ring);
    return g;
  }

  private buildSpeakers() {
    for (const s of [-1, 1]) {
      const w = this.buildSpeaker(WOOF.r, 'woofer');
      w.position.set(WOOF.x * s, CY + WOOF.y, FZ);
      const t = this.buildSpeaker(TWEET.r, 'tweeter');
      t.position.set(TWEET.x * s, CY + TWEET.y, FZ);
      this.root.add(w, t);
    }
  }

  private buildDisplay() {
    const dispMat = displayMaterial(this.vfd.texture, 8);
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(DISP.w - 0.004, DISP.h - 0.004), dispMat);
    disp.position.set(DISP.x, CY + DISP.y, FZ - 0.012);
    disp.userData.noAO = true;
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(DISP.w, DISP.h), tintedWindow('#0a1412', 0.45));
    cover.position.set(DISP.x, CY + DISP.y, FZ - 0.003);
    cover.userData.passThrough = true;
    this.root.add(disp, cover);
  }

  private buildDeck() {
    // Kassettenfach: dunkler Innenraum
    const well = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.w, DOOR.h), paint('#0a0a0a', 0.7));
    well.position.set(DOOR.x, CY + DOOR.y, FZ - FACE_T + 0.0005);
    this.root.add(well);
    // Kassette
    this.cassette.group.position.set(DOOR.x, CY + DOOR.y + 0.004, FZ - FACE_T + 0.0075);
    this.root.add(this.cassette.group);

    // Tür (kippt nach vorne auf)
    this.door.position.set(DOOR.x, CY + DOOR.y - DOOR.h / 2, FZ - 0.004);
    const frameShape = roundedRectShape(DOOR.w - 0.002, DOOR.h - 0.002, 0.004, 0, DOOR.h / 2);
    frameShape.holes.push(roundedRectPath(0.118, 0.074, 0.006, 0, DOOR.h / 2 + 0.006));
    const p = new PanelPainter((DOOR.w - 0.002) * 1000, (DOOR.h - 0.002) * 1000, { color: '#a9aaad', rough: 0.36, metal: 0.8, brushed: 0.4 }, { ppm: 8 });
    p.text('AUTO REVERSE · CrO₂/METAL', 80, 98, { size: 2.8, weight: 600, spacing: 0.6 });
    p.text('◀ PUSH EJECT', 140, 8, { size: 2.6, weight: 600, spacing: 0.4 });
    const frame = new THREE.Mesh(extrudePanel(frameShape, 0.005, 0.0012, 24), [p.material({ clearcoat: 0.3 }, 0.4), plastic('#111')]);
    this.door.add(frame);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.076), tintedWindow('#1c1712', 0.42));
    win.position.set(0, DOOR.h / 2 + 0.006, 0.0025);
    win.userData.passThrough = true;
    this.door.add(win);
    this.root.add(this.door);
  }

  private keyLabel(sym: string, color = '#f2f2f2'): THREE.Texture {
    const c = makeCanvas(128, 96);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#121212';
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = color;
    ctx.font = '600 44px Jost';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym, 64, 50);
    return canvasTexture(c, { srgb: true });
  }

  private buildKeys() {
    const defs: Array<[KeyId, string, string, string]> = [
      ['rec', '●', '#ff3b2a', 'Aufnahme'],
      ['play', '▶', '#f2f2f2', 'Wiedergabe'],
      ['rew', '◀◀', '#f2f2f2', 'Zurück (Rewind)'],
      ['ff', '▶▶', '#f2f2f2', 'Vor (Fast Forward)'],
      ['stop', '■ ▲', '#f2f2f2', 'Stop / Eject'],
      ['pause', '❚❚', '#f2f2f2', 'Pause'],
    ];
    const keyW = 0.027, gap = 0.003, keyD = 0.052;
    const total = defs.length * keyW + (defs.length - 1) * gap;
    const topY = FEET + H;
    // Schacht
    const slot = new THREE.Mesh(roundedBox(total + 0.008, 0.004, keyD + 0.006, mm(1.5)), paint('#050505', 0.8));
    slot.position.set(0, topY - 0.0015, FZ - FACE_T - keyD / 2 - 0.004);
    this.root.add(slot);
    const keyMat = plastic('#161616', { gloss: 0.55, texture: 'fine' });
    defs.forEach(([id, sym, col], i) => {
      const g = new THREE.Group();
      // Drehpunkt an der Hinterkante
      g.position.set(-total / 2 + keyW / 2 + i * (keyW + gap), topY + 0.001, FZ - FACE_T - keyD - 0.004);
      const body = new THREE.Mesh(roundedBox(keyW, 0.016, keyD, mm(2.2), 3), keyMat);
      body.position.set(0, 0.002, keyD / 2);
      g.add(body);
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(keyW - 0.008, 0.012), new THREE.MeshPhysicalMaterial({ map: this.keyLabel(sym, col), roughness: 0.45 }));
      lab.rotation.x = -Math.PI / 2;
      lab.position.set(0, 0.0101, keyD - 0.012);
      g.add(lab);
      // Chromleiste vorne
      const strip = new THREE.Mesh(roundedBox(keyW - 0.002, 0.0035, 0.002, mm(0.8)), chrome());
      strip.position.set(0, 0.005, keyD + 0.0002);
      g.add(strip);
      this.root.add(g);
      this.keys.set(id, { group: g, press: 0, held: false });
    });
  }

  private buildTop() {
    const topY = FEET + H;
    // Tragegriff
    const chromeM = chrome();
    for (const s of [-1, 1]) {
      const mount = new THREE.Mesh(roundedBox(0.03, 0.026, 0.04, mm(5)), plastic('#141414', { gloss: 0.4 }));
      mount.position.set(0.215 * s, topY + 0.011, -0.01);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.034, 32), chromeM);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(0.215 * s, topY + 0.016, -0.01);
      this.root.add(mount, pin);
    }
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, topY + 0.016, -0.01),
      new THREE.Vector3(-0.19, topY + 0.07, -0.01),
      new THREE.Vector3(-0.15, topY + 0.085, -0.01),
      new THREE.Vector3(0.15, topY + 0.085, -0.01),
      new THREE.Vector3(0.19, topY + 0.07, -0.01),
      new THREE.Vector3(0.2, topY + 0.016, -0.01),
    ], false, 'centripetal');
    const handle = new THREE.Mesh(tube(curve, 0.0078, 160, 24), chromeM);
    this.root.add(handle);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.2, 40), rubber('#121212'));
    grip.rotation.z = Math.PI / 2;
    grip.position.set(0, topY + 0.085, -0.01);
    // Rillen im Griff
    for (let i = -6; i <= 6; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0012, 8, 40), rubber('#0c0c0c'));
      r.rotation.y = Math.PI / 2;
      r.position.set(i * 0.0145, topY + 0.085, -0.01);
      this.root.add(r);
    }
    this.root.add(grip);

    // Teleskopantenne (eingefahren) an der Rückseite
    const antBase = new THREE.Mesh(roundedBox(0.022, 0.02, 0.02, mm(4)), plastic('#141414', { gloss: 0.4 }));
    antBase.position.set(0.27, topY + 0.006, -D / 2 + 0.018);
    this.root.add(antBase);
    const segs = [0.0052, 0.0045, 0.0038, 0.0031];
    segs.forEach((r, i) => {
      const len = 0.1 - i * 0.012;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), chromeM);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0.26 - len / 2 - i * 0.035, topY + 0.009, -D / 2 + 0.018);
      this.root.add(rod);
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 24, 16), chromeM);
    ball.position.set(0.26 - (0.1 - 3 * 0.012) - 3 * 0.035 - 0.004, topY + 0.009, -D / 2 + 0.018);
    this.root.add(ball);
    // Halteclip
    const clip = new THREE.Mesh(roundedBox(0.012, 0.014, 0.016, mm(3)), plastic('#141414'));
    clip.position.set(-0.05, topY + 0.005, -D / 2 + 0.018);
    this.root.add(clip);
  }

  // ------------------------------------------------------------------ Interaktion

  private pressKey(id: KeyId) {
    const k = this.keys.get(id)!;
    k.press = 1;
    this.ctx.sfx.clunk();
    const pb = this.pb;
    switch (id) {
      case 'play':
        this.ejected = false;
        this.pauseLatched = false;
        if (pb.state.paused) pb.play();
        break;
      case 'pause':
        if (this.pauseLatched) {
          this.pauseLatched = false;
          pb.play();
        } else if (!pb.state.paused) {
          this.pauseLatched = true;
          pb.pause();
        }
        break;
      case 'stop':
        this.pauseLatched = false;
        if (!pb.state.paused) pb.pause();
        else this.ejected = !this.ejected;
        break;
      case 'ff':
        this.ejected = false;
        pb.next();
        break;
      case 'rew':
        this.ejected = false;
        pb.previous();
        break;
      case 'rec':
        break;
    }
  }

  registerControls() {
    const ia = this.ctx.interaction;
    const labels: Record<KeyId, string> = { rec: 'REC', play: 'Play', rew: 'Rewind (vorheriger Titel)', ff: 'Fast Forward (nächster Titel)', stop: 'Stop / Eject', pause: 'Pause' };
    for (const [id, k] of this.keys) {
      ia.add({ kind: 'button', object: k.group, label: labels[id], onPress: () => this.pressKey(id), onRelease: () => (k.held = false) });
    }
    ia.add({ kind: 'knob', object: this.volumeKnob, label: () => `Lautstärke ${Math.round(this.pb.state.volume * 100)} %`, get: () => this.pb.state.volume, set: (v) => this.pb.setVolume(v) });
    ia.add({ kind: 'knob', object: this.toneKnob, label: 'Klang (Tone)', get: () => this.tone, set: (v) => (this.tone = v) });
    ia.add({
      kind: 'button',
      object: this.door,
      label: () => (this.ejected ? 'Kassettenfach schließen' : 'Kassettenfach'),
      onPress: () => {
        if (this.ejected) {
          this.ejected = false;
          this.ctx.sfx.click();
        }
      },
    });
  }

  // ------------------------------------------------------------------ Laufzeit

  onTrack(track: TrackInfo | null, art: THREE.Texture | null) {
    this.cassette.setTrack(track, art);
  }

  syncImmediately(f: FrameState) {
    this.shownVolume = f.volume;
    this.cassette.setProgress(f.progress);
  }

  private drawVfd(f: FrameState) {
    const v = this.vfd;
    const on = '#9dfff0';
    const off = 'rgba(110,255,230,0.075)';
    v.clear();
    const ctx = v.ctx;
    const title = f.track ? toSegmentText(`${f.track.artists} - ${f.track.name}`) : 'NO TAPE';
    const scroll = marquee(title, 12, f.time, 3.4);
    v.segText(scroll, 34, 132, { size: 86, cells: 12, kind: 14, on, off, italic: true });
    // Spektrum
    const bands = f.audio.bands;
    const bx = 40, by = 318, bw = 34, bh = 15, gapY = 6;
    for (let i = 0; i < bands.length; i++) {
      const lit = Math.round(bands[i] * 8);
      for (let s = 0; s < 8; s++) {
        ctx.fillStyle = s < lit ? on : off;
        ctx.fillRect(bx + i * (bw + 8), by - s * (bh + gapY), bw, bh);
      }
    }
    // Zeit & Titelnummer
    const t = f.track ? formatTime(f.positionMs) : '-:--';
    v.segText(t.padStart(5, ' '), 640, 318, { size: 108, cells: 5, kind: 7, on, off, italic: true });
    ctx.font = '600 26px Jost';
    ctx.fillStyle = on;
    ctx.fillText(f.playing ? '▶ PLAY' : this.ejected ? '▲ EJECT' : '❚❚ STOP', 610, 190);
    ctx.fillStyle = on;
    ctx.fillText('STEREO', 790, 190);
    ctx.fillStyle = f.track ? on : off;
    ctx.fillText('TAPE', 920, 190);
    ctx.fillStyle = off;
    ctx.fillText('FM   AM   SW', 40, 190);
    ctx.fillStyle = on;
    ctx.font = '600 22px Jost';
    ctx.fillText(`VOL ${String(Math.round(f.volume * 30)).padStart(2, '0')}`, 380, 190);
    v.texture.needsUpdate = true;
  }

  update(f: FrameState) {
    const dt = f.dt;
    // Kassette & Bandlauf
    this.cassette.setProgress(f.progress);
    if (f.playing) this.cassette.spin(dt, 1);
    // Membranen
    const ex = f.audio.bass * 0.0022 + f.audio.level[0] * 0.0006;
    for (const c of this.cones) c.position.z = damp(c.position.z, (c.userData.baseZ as number) + ex, 40, dt);
    // Tasten: PLAY rastet ein, PAUSE ebenfalls
    for (const [id, k] of this.keys) {
      const latched = (id === 'play' && (f.playing || this.pauseLatched)) || (id === 'pause' && this.pauseLatched);
      k.press = Math.max(0, k.press - dt * 5);
      const target = latched ? 0.75 : k.press > 0 ? 1 : 0;
      const cur = (k.group.userData.t as number | undefined) ?? 0;
      const t = damp(cur, target, 30, dt);
      k.group.userData.t = t;
      k.group.rotation.x = t * 0.16;
    }
    // Tür
    this.doorOpen = damp(this.doorOpen, this.ejected ? 1 : 0, 6, dt);
    this.door.rotation.x = this.doorOpen * 0.42;
    this.cassette.group.position.z = FZ - FACE_T + 0.0075 + this.doorOpen * 0.012;
    // Knöpfe
    this.shownVolume = damp(this.shownVolume, f.volume, 18, dt);
    this.volumeKnob.rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * this.shownVolume);
    this.toneKnob.rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * this.tone);
    this.ledMat.emissiveIntensity = f.playing ? 16 : 0.0;
    // VFD mit ~30 fps aktualisieren
    const key = `${Math.floor(f.time * 30)}`;
    if (key !== this.lastTitle) {
      this.lastTitle = key;
      this.drawVfd(f);
    }
  }
}
