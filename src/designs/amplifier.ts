/**
 * Stereo-Receiver der 70er: Nussbaumgehäuse, gebürstete Alu-Front, hinterleuchtete
 * Senderskala und zwei VU-Meter.
 * - Skalenzeiger = Position im Titel; der große TUNING-Knopf spult.
 * - SEEK-Wahlschalter (federt zurück): links = vorheriger, rechts = nächster Titel.
 * - POWER = Play/Pause (Lampen glimmen an/aus), VOLUME = Lautstärke, MUTING = Stumm.
 */
import * as THREE from 'three';
import { Design, Needle, damp, formatTime, type FrameState } from './base';
import { makeKnob } from './parts';
import type { SceneSpec } from '../engine/stage';
import { boxProjectUV, extrudePanel, filletProfile, lathe, mm, roundedBox, roundedRectPath, roundedRectShape, shadows } from '../engine/geom';
import { chrome, paint, plastic, tintedWindow, woodVeneer } from '../engine/materials';
import { PanelPainter } from '../engine/panel';
import { canvasTexture, makeCanvas } from '../engine/textures';
import type { TrackInfo } from '../playback/types';

const W = 0.48, H = 0.155, D = 0.36;
const FEET = 0.012;
const WOOD_T = 0.015;
const FP = { w: W - 2 * WOOD_T - 0.004, h: H - WOOD_T - 0.007 }; // Frontplatte
const CY = FEET + (H - WOOD_T) / 2 + 0.0015;
const FZ = D / 2 - 0.004; // Front liegt 4 mm hinter der Holzkante
const DIAL = { x: -0.058, y: 0.033, w: 0.31, h: 0.052 };
const METERS = [
  { x: 0.129, y: 0.033 },
  { x: 0.184, y: 0.033 },
];
const METER = { w: 0.05, h: 0.054 };
const ROW_Y = -0.034;

type KnobId = 'bass' | 'treble' | 'balance' | 'seek' | 'volume' | 'tuning';

export class Amplifier extends Design {
  readonly id = 'amplifier';
  readonly name = 'Receiver';
  readonly description = 'Stereo-Receiver mit hinterleuchteter Senderskala und VU-Metern.';
  readonly scene: SceneSpec = {
    hdri: 'studio_small_09',
    envIntensity: 0.75,
    envRotation: 180,
    background: 'wooden_lounge',
    bgBlur: 0.45,
    bgIntensity: 0.28,
    bgRotation: 120,
    exposure: 1.0,
    ground: { surface: 'darkwood', size: 1.2, fade: [1.0, 2.0], blur: [0.4, 1.0], roughness: 0.9, normalScale: 0.5, clearcoat: 0.35, rotation: 90, tint: '#c9b9a8' },
    key: { position: [-1.3, 1.9, 1.2], intensity: 1.5, color: '#ffeedd', softness: 8, area: 0.55 },
    fill: { position: [1.5, 0.7, 1.4], intensity: 0.25, color: '#dfe8ff' },
    camera: { fov: 30, target: [0, 0.085, 0.06], azimuth: 14, polar: 70, frame: [0.66, 0.34], azimuthRange: 50, polarRange: [30, 88], zoom: [0.38, 1.6] },
    contactShadow: { width: 1.0, depth: 0.8, height: 0.12, blur: 2.4, darkness: 1.5, opacity: 0.95 },
    bloom: { strength: 0.2, radius: 0.3, threshold: 3.2 },
  };

  private dialCanvas = makeCanvas(2048, 346);
  private dialTex = canvasTexture(this.dialCanvas, { srgb: true });
  private dialMat!: THREE.MeshStandardMaterial;
  private pointer = new THREE.Group();
  private pointerMat!: THREE.MeshStandardMaterial;
  private meterMats: THREE.MeshStandardMaterial[] = [];
  private needles: THREE.Group[] = [];
  private needlePhys = [new Needle(90, 11), new Needle(90, 11)];
  private knobs = new Map<KnobId, THREE.Group>();
  private values: Record<KnobId, number> = { bass: 0.5, treble: 0.55, balance: 0.5, seek: 0.5, volume: 0.6, tuning: 0 };
  private powerBtn!: THREE.Group;
  private powerPress = 0;
  private toggles: Array<{ lever: THREE.Group; on: boolean; label: string }> = [];
  private muted = false;
  private preMute = 0.6;
  private lamp = 0; // Glühlampen-Helligkeit 0..1
  private stereoLamp!: THREE.MeshStandardMaterial;
  private tuneDrag: number | null = null;
  private lastDial = '';
  private trackTitle = '';

  protected async build() {
    const walnut = await this.ctx.stage.loadSurface('walnut');
    // Gehäuse
    const wood = woodVeneer(walnut, [1, 1], { clearcoat: 0.6, clearcoatRoughness: 0.25, color: new THREE.Color('#d8c6b4') });
    // Holzhaube: Deckel + Seitenteile (Gehrung als feine Fuge sichtbar)
    const top = new THREE.Mesh(boxProjectUV(roundedBox(W, WOOD_T, D, 0.006, 4), 0.7, [0.3, 0.1]), wood);
    top.position.set(0, FEET + H - WOOD_T / 2, 0);
    this.root.add(top);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(boxProjectUV(roundedBox(WOOD_T, H - WOOD_T, D, 0.006, 4), 0.7, [0.1 + s * 0.2, 0.3]), wood);
      side.position.set(s * (W / 2 - WOOD_T / 2), FEET + (H - WOOD_T) / 2, 0);
      this.root.add(side);
    }
    // Stahlboden & dunkles Chassis hinter der Front
    const bottom = new THREE.Mesh(roundedBox(W - 2 * WOOD_T, 0.004, D - 0.004, mm(1)), paint('#121212', 0.5));
    bottom.position.set(0, FEET + 0.002, 0);
    const chassis = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * WOOD_T, H - WOOD_T), paint('#060606', 0.8));
    chassis.position.set(0, FEET + (H - WOOD_T) / 2, FZ - 0.016);
    this.root.add(bottom, chassis);

    this.buildFaceplate();
    this.buildDial();
    this.buildMeters();
    this.buildControls();

    // Füße
    const footMat = plastic('#101010', { gloss: 0.3 });
    for (const [x, z] of [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.14], [0.2, 0.14]]) {
      const f = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.016, 0, mm(2)], [0.019, FEET, mm(1)], [0, FEET]], 3), 40), footMat);
      f.position.set(x, 0, z);
      this.root.add(f);
    }
    shadows(this.root);
  }

  private buildFaceplate() {
    const p = new PanelPainter(FP.w * 1000, FP.h * 1000, { color: '#d2d2cf', rough: 0.3, metal: 1, brushed: 1 }, { ppm: 7, ink: { color: '#161616', rough: 0.55 } });
    const px = (x: number) => (x + FP.w / 2) * 1000;
    const py = (y: number) => (FP.h / 2 - y) * 1000;
    // Fenster-Einfassungen (schwarz lackiert)
    p.rect(px(DIAL.x - DIAL.w / 2) - 2.5, py(DIAL.y + DIAL.h / 2) - 2.5, DIAL.w * 1000 + 5, DIAL.h * 1000 + 5, { color: '#0c0c0c', rough: 0.4 }, 0, 2);
    for (const m of METERS) p.rect(px(m.x - METER.w / 2) - 2, py(m.y + METER.h / 2) - 2, METER.w * 1000 + 4, METER.h * 1000 + 4, { color: '#0c0c0c', rough: 0.4 }, 0, 2);
    // Beschriftungen
    p.text('SOLARIS', px(-FP.w / 2 + 0.009), py(-0.0055), { size: 3.6, font: 'Michroma', spacing: 1.4, align: 'left' });
    p.text('MODEL 2600  STEREOPHONIC RECEIVER', px(FP.w / 2 - 0.009), py(-0.0055), { size: 2.2, weight: 600, spacing: 0.7, align: 'right' });
    p.text('LEFT', px(METERS[0].x), py(0.0035) + 2.2, { size: 2.1, weight: 600, spacing: 0.4 });
    p.text('RIGHT', px(METERS[1].x), py(0.0035) + 2.2, { size: 2.1, weight: 600, spacing: 0.4 });

    const lbl = (x: number, t: string, yOff = 0.023) => p.text(t, px(x), py(ROW_Y - yOff), { size: 2.3, weight: 600, spacing: 0.6 });
    const knobScale = (x: number, r: number, labels?: string[], from = -135, to = 135, ticks = 11) =>
      p.scale(px(x), py(ROW_Y), r * 1000 + 2.2, { from, to, ticks, major: 5, len: 1, majorLen: 1.8, width: 0.3, labels, labelSize: 1.9 });
    knobScale(-0.15, 0.0125, ['−', '0', '+'], -135, 135, 11);
    lbl(-0.15, 'BASS');
    knobScale(-0.105, 0.0125, ['−', '0', '+'], -135, 135, 11);
    lbl(-0.105, 'TREBLE');
    knobScale(-0.06, 0.0125, ['L', '', 'R'], -135, 135, 11);
    lbl(-0.06, 'BALANCE');
    p.scale(px(-0.012), py(ROW_Y), 15, { from: -60, to: 60, ticks: 3, major: 1, majorLen: 2, labels: ['◀', '·', '▶'], labelSize: 2.4, labelR: 19 });
    lbl(-0.012, 'SEEK STATION');
    knobScale(0.05, 0.021, ['0', '2', '4', '6', '8', '10'], -135, 135, 21);
    lbl(0.05, 'VOLUME', 0.031);
    p.text('TUNING', px(0.172), py(ROW_Y - 0.031), { size: 2.3, weight: 600, spacing: 0.6 });
    p.text('POWER', px(-0.203), py(ROW_Y + 0.013), { size: 2.1, weight: 600, spacing: 0.5 });
    p.text('ON · OFF', px(-0.203), py(ROW_Y - 0.014), { size: 1.7, weight: 500, spacing: 0.3 });
    p.text('PHONES', px(-0.203), py(-0.0625), { size: 1.7, weight: 600, spacing: 0.4 });
    p.text('MUTING', px(0.094), py(ROW_Y + 0.016), { size: 1.8, weight: 600, spacing: 0.3 });
    p.text('LOUDNESS', px(0.12), py(ROW_Y + 0.016), { size: 1.8, weight: 600, spacing: 0.3 });
    p.text('ON', px(0.094), py(ROW_Y + 0.0095), { size: 1.5, weight: 500 });
    p.text('ON', px(0.12), py(ROW_Y + 0.0095), { size: 1.5, weight: 500 });
    // feine Trennlinie
    p.line(px(-FP.w / 2 + 0.006), py(0.0035), px(FP.w / 2 - 0.006), py(0.0035), 0.25);

    const shape = roundedRectShape(FP.w, FP.h, mm(1.5));
    shape.holes.push(roundedRectPath(DIAL.w, DIAL.h, mm(1.5), DIAL.x, DIAL.y));
    for (const m of METERS) shape.holes.push(roundedRectPath(METER.w, METER.h, mm(1.5), m.x, m.y));
    const face = new THREE.Mesh(extrudePanel(shape, 0.004, mm(0.6), 16), [p.material({}, 0.75), paint('#0a0a0a', 0.6)]);
    face.position.set(0, CY, FZ - 0.004);
    this.root.add(face);
  }

  private buildDial() {
    // Hinterleuchtete Skala hinter getöntem Glas
    this.dialMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: this.dialTex, emissiveIntensity: 0, roughness: 0.5 });
    const scale = new THREE.Mesh(new THREE.PlaneGeometry(DIAL.w, DIAL.h), this.dialMat);
    scale.position.set(DIAL.x, CY + DIAL.y, FZ - 0.006);
    scale.userData.noAO = true;
    this.root.add(scale);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(DIAL.w, DIAL.h), tintedWindow('#0b0f12', 0.35));
    glass.position.set(DIAL.x, CY + DIAL.y, FZ + 0.0002);
    glass.userData.passThrough = true;
    this.root.add(glass);
    // Zeiger (rot leuchtend)
    this.pointerMat = new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff3a1c', emissiveIntensity: 0, roughness: 0.4 });
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0012, DIAL.h * 0.86, 0.0012), this.pointerMat);
    this.pointer.add(needle);
    this.pointer.position.set(DIAL.x, CY + DIAL.y, FZ - 0.003);
    this.root.add(this.pointer);
    this.stereoLamp = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff4020', emissiveIntensity: 0 });
  }

  private drawDial(f: FrameState) {
    const c = this.dialCanvas;
    const ctx = c.getContext('2d')!;
    const Wp = c.width, Hp = c.height;
    const k = Wp / (DIAL.w * 1000); // px pro mm
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, Wp, Hp);
    const blue = '#9fd6ff', dim = 'rgba(150,200,255,0.55)', amber = '#ffcf7a';
    const x0 = 22 * k, x1 = Wp - 22 * k;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Titelzeile (wie eine Senderkennung)
    ctx.font = `600 ${3.4 * k}px Jost`;
    ctx.fillStyle = amber;
    ctx.textAlign = 'left';
    const label = this.trackTitle ? `♪  ${this.trackTitle}` : 'SOLARIS · FM STEREO / AM';
    let text = label;
    while (ctx.measureText(text).width > Wp * 0.7 && text.length > 4) text = text.slice(0, -2);
    if (text !== label) text = text.trimEnd() + '…';
    ctx.fillText(text, x0, 7 * k);
    ctx.textAlign = 'right';
    ctx.fillStyle = blue;
    ctx.font = `600 ${3.0 * k}px Jost`;
    ctx.fillText(f.track ? `${formatTime(f.positionMs)} / ${formatTime(f.durationMs)}` : '', x1, 7 * k);
    ctx.textAlign = 'center';
    // FM-Skala
    ctx.strokeStyle = blue;
    ctx.fillStyle = blue;
    ctx.lineWidth = 0.35 * k;
    const fmY = 20 * k;
    for (let i = 0; i <= 40; i++) {
      const x = x0 + ((x1 - x0) * i) / 40;
      const major = i % 4 === 0;
      ctx.beginPath();
      ctx.moveTo(x, fmY + (major ? 0 : 1.6 * k));
      ctx.lineTo(x, fmY + 4 * k);
      ctx.stroke();
      if (major) {
        ctx.font = `500 ${3.1 * k}px Jost`;
        ctx.fillText(String(88 + i / 2), x, fmY - 3 * k);
      }
    }
    ctx.font = `600 ${2.6 * k}px Jost`;
    ctx.fillStyle = amber;
    ctx.fillText('FM', x0 - 12 * k, fmY + 2 * k);
    ctx.fillText('MHz', x1 + 12 * k, fmY + 2 * k);
    // AM-Skala
    const amY = 33 * k;
    ctx.fillStyle = dim;
    ctx.strokeStyle = dim;
    const am = [530, 600, 700, 800, 1000, 1200, 1400, 1600];
    for (let i = 0; i <= 28; i++) {
      const x = x0 + ((x1 - x0) * i) / 28;
      ctx.beginPath();
      ctx.moveTo(x, amY);
      ctx.lineTo(x, amY + (i % 4 === 0 ? 3.4 : 1.8) * k);
      ctx.stroke();
      if (i % 4 === 0) {
        ctx.font = `500 ${2.7 * k}px Jost`;
        ctx.fillText(String(am[i / 4]), x, amY + 7 * k);
      }
    }
    ctx.fillStyle = amber;
    ctx.font = `600 ${2.6 * k}px Jost`;
    ctx.fillText('AM', x0 - 12 * k, amY + 2 * k);
    ctx.fillText('kHz', x1 + 12 * k, amY + 2 * k);
    // Logging-Skala
    ctx.fillStyle = 'rgba(150,200,255,0.35)';
    ctx.font = `500 ${2.2 * k}px Jost`;
    for (let i = 0; i <= 10; i++) ctx.fillText(String(i * 10), x0 + ((x1 - x0) * i) / 10, 48.5 * k);
    // Stereo-Anzeige
    ctx.fillStyle = f.playing ? '#ff5a3a' : 'rgba(255,90,58,0.12)';
    ctx.font = `700 ${2.6 * k}px Jost`;
    ctx.fillText('● STEREO', Wp * 0.86, 48.5 * k);
    this.dialTex.needsUpdate = true;
  }

  private meterFace(): THREE.CanvasTexture {
    const c = makeCanvas(512, 552);
    const ctx = c.getContext('2d')!;
    // warmes Papier (Hinterleuchtung kommt über Emission)
    const g = ctx.createRadialGradient(256, 420, 40, 256, 330, 420);
    g.addColorStop(0, '#fff2cf');
    g.addColorStop(1, '#e9cf96');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 552);
    const cx = 256, cy = 520, r = 340;
    const ang = (db: number) => {
      const t = (db + 20) / 23;
      return THREE.MathUtils.degToRad(-48 + 96 * t);
    };
    ctx.lineCap = 'butt';
    // Skalenbogen schwarz / rot
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2 + ang(-20), -Math.PI / 2 + ang(0));
    ctx.stroke();
    ctx.strokeStyle = '#c4271c';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, -Math.PI / 2 + ang(0), -Math.PI / 2 + ang(3));
    ctx.stroke();
    const marks = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
    ctx.font = '600 30px Jost';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of marks) {
      const a = ang(m);
      ctx.strokeStyle = m > 0 ? '#c4271c' : '#1a1a1a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
      ctx.lineTo(cx + Math.sin(a) * (r + 26), cy - Math.cos(a) * (r + 26));
      ctx.stroke();
      ctx.fillStyle = m > 0 ? '#c4271c' : '#1a1a1a';
      ctx.fillText(m > 0 ? `+${m}` : String(m), cx + Math.sin(a) * (r + 52), cy - Math.cos(a) * (r + 52));
    }
    // Prozentskala innen
    ctx.font = '500 20px Jost';
    ctx.fillStyle = '#3a3a3a';
    for (const [p, db] of [[0, -20], [20, -14], [50, -6], [100, 0]] as const) {
      const a = ang(db);
      ctx.fillText(String(p), cx + Math.sin(a) * (r - 34), cy - Math.cos(a) * (r - 34));
    }
    ctx.font = '700 46px Jost';
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText('VU', cx, cy - 150);
    ctx.font = '500 18px Jost';
    ctx.fillText('SOLARIS', cx, cy - 110);
    return canvasTexture(c, { srgb: true });
  }

  private buildMeters() {
    const face = this.meterFace();
    for (const m of METERS) {
      const mat = new THREE.MeshStandardMaterial({ map: face, emissive: '#ffb45a', emissiveMap: face, emissiveIntensity: 0, roughness: 0.75 });
      this.meterMats.push(mat);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(METER.w, METER.h), mat);
      plane.position.set(m.x, CY + m.y, FZ - 0.008);
      plane.userData.noAO = true;
      this.root.add(plane);
      // Zeiger: Drehpunkt unterhalb des Fensters
      const pivot = new THREE.Group();
      // Drehpunkt exakt dort, wo die Skala gedruckt ist (Canvas 256/520 von 512×552)
      const pivotY = CY + m.y + (276 - 520) * (METER.h / 552);
      pivot.position.set(m.x, pivotY, FZ - 0.0065);
      const needleLen = 372 * (METER.h / 552);
      const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0006, needleLen, 0.0004), paint('#111', 0.5));
      needle.position.y = needleLen / 2;
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.0004, needleLen * 0.25, 0.00041), paint('#b81d14', 0.5));
      tip.position.y = needleLen * 0.86;
      pivot.add(needle, tip);
      this.needles.push(pivot);
      this.root.add(pivot);
      // Abdeckung der Zeigerlagerung (schwarzer Steg)
      const cover = new THREE.Mesh(roundedBox(METER.w, 0.007, 0.004, mm(1)), plastic('#0c0c0c', { gloss: 0.4 }));
      cover.position.set(m.x, CY + m.y - METER.h / 2 + 0.0035, FZ - 0.004);
      this.root.add(cover);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(METER.w, METER.h), tintedWindow('#ffffff', 0.08));
      glass.position.set(m.x, CY + m.y, FZ + 0.0002);
      glass.userData.passThrough = true;
      this.root.add(glass);
    }
  }

  private buildControls() {
    const z = FZ;
    const addKnob = (id: KnobId, x: number, r: number, big = false) => {
      const k = makeKnob({ radius: r, height: big ? 0.02 : 0.016, style: 'aluminum', ridges: big ? 80 : 60, skirt: { radius: r + 0.0035, height: 0.003 }, indicator: big ? 'notch' : 'line' });
      k.group.rotation.x = Math.PI / 2;
      k.group.position.set(x, CY + ROW_Y, z);
      this.knobs.set(id, k.spin);
      this.root.add(k.group);
    };
    addKnob('bass', -0.15, 0.0125);
    addKnob('treble', -0.105, 0.0125);
    addKnob('balance', -0.06, 0.0125);
    addKnob('seek', -0.012, 0.0135);
    addKnob('volume', 0.05, 0.021, true);
    addKnob('tuning', 0.172, 0.0225, true);

    // POWER-Taste (rechteckig, verchromt)
    this.powerBtn = new THREE.Group();
    const btn = new THREE.Mesh(roundedBox(0.02, 0.011, 0.008, mm(1.5), 3), chrome({ roughness: 1, color: new THREE.Color(0.75, 0.75, 0.76) }));
    btn.position.z = 0.004;
    const bez = new THREE.Mesh(roundedBox(0.024, 0.015, 0.002, mm(1)), paint('#0c0c0c', 0.5));
    this.powerBtn.add(btn, bez);
    this.powerBtn.position.set(-0.203, CY + ROW_Y, z);
    this.root.add(this.powerBtn);
    // Kopfhörerbuchse
    const jack = new THREE.Mesh(new THREE.TorusGeometry(0.0045, 0.0013, 12, 32), chrome());
    jack.position.set(-0.203, CY - 0.054, z + 0.001);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 24), paint('#020202', 0.9));
    hole.position.set(-0.203, CY - 0.054, z + 0.0004);
    this.root.add(jack, hole);

    // Kippschalter
    for (const [x, label] of [[0.094, 'Stummschaltung (Muting)'], [0.12, 'Loudness']] as const) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0045, 0.003, 24), chrome());
      base.rotation.x = Math.PI / 2;
      base.position.set(x, CY + ROW_Y, z + 0.0015);
      const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0033, 0.0033, 0.0025, 6), chrome());
      nut.rotation.x = Math.PI / 2;
      nut.position.set(x, CY + ROW_Y, z + 0.004);
      const lever = new THREE.Group();
      lever.position.set(x, CY + ROW_Y, z + 0.004);
      const bat = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.0012, 0], [0.0018, 0.014], [0.0021, 0.0155, mm(0.4)], [0, 0.0165]], 3), 20), chrome());
      bat.rotation.x = Math.PI / 2;
      lever.add(bat);
      this.root.add(base, nut, lever);
      this.toggles.push({ lever, on: false, label });
    }
  }

  // ------------------------------------------------------------------ Interaktion

  registerControls() {
    const ia = this.ctx.interaction;
    const sfx = this.ctx.sfx;
    const labels: Record<KnobId, string> = {
      bass: 'Bass',
      treble: 'Höhen',
      balance: 'Balance',
      seek: 'Sender suchen: ◀ voriger / nächster Titel ▶',
      volume: 'Lautstärke',
      tuning: 'Tuning: im Titel spulen',
    };
    for (const id of ['bass', 'treble', 'balance'] as KnobId[]) {
      ia.add({ kind: 'knob', object: this.knobs.get(id)!, label: labels[id], get: () => this.values[id], set: (v) => (this.values[id] = v) });
    }
    ia.add({
      kind: 'knob',
      object: this.knobs.get('volume')!,
      label: () => `Lautstärke ${Math.round(this.pb.state.volume * 100)} %`,
      get: () => this.pb.state.volume,
      set: (v) => {
        if (this.muted) this.setToggle(0, false);
        this.pb.setVolume(v);
      },
    });
    // SEEK: federnder Wahlschalter mit 3 Rasten
    let seekFired = false;
    ia.add({
      kind: 'knob',
      object: this.knobs.get('seek')!,
      label: labels.seek,
      steps: 3,
      travel: 70,
      get: () => this.values.seek,
      set: (v) => {
        this.values.seek = v;
        sfx.detent();
        if (!seekFired && v !== 0.5) {
          seekFired = true;
          if (v > 0.5) this.pb.next();
          else this.pb.previous();
        }
      },
      onEnd: () => {
        seekFired = false;
        this.values.seek = 0.5;
      },
    });
    // TUNING: Spulen; Zeiger folgt live, Sprung beim Loslassen
    ia.add({
      kind: 'knob',
      object: this.knobs.get('tuning')!,
      label: () => (this.pb.state.track ? `Tuning: ${formatTime((this.tuneDrag ?? this.pb.position() / Math.max(1, this.pb.state.track.durationMs)) * this.pb.state.track.durationMs)}` : 'Tuning'),
      travel: 420,
      axis: 'both',
      get: () => {
        const d = this.pb.state.track?.durationMs ?? 0;
        return this.tuneDrag ?? (d ? this.pb.position() / d : 0);
      },
      set: (v) => {
        this.tuneDrag = v;
      },
      onEnd: () => {
        const d = this.pb.state.track?.durationMs ?? 0;
        if (this.tuneDrag !== null && d) this.pb.seek(this.tuneDrag * d);
        this.tuneDrag = null;
      },
    });
    ia.add({
      kind: 'button',
      object: this.powerBtn,
      label: () => (this.pb.state.paused ? 'Power: Ein (Play)' : 'Power: Aus (Pause)'),
      onPress: () => {
        this.powerPress = 1;
        sfx.click();
        this.pb.toggle();
      },
    });
    this.toggles.forEach((t, i) => {
      ia.add({
        kind: 'button',
        object: t.lever,
        label: t.label,
        onPress: () => {
          sfx.click();
          this.setToggle(i, !t.on);
        },
      });
    });
  }

  private setToggle(i: number, on: boolean) {
    const t = this.toggles[i];
    t.on = on;
    if (i === 0) {
      if (on && !this.muted) {
        this.preMute = this.pb.state.volume || 0.5;
        this.muted = true;
        this.pb.setVolume(0);
      } else if (!on && this.muted) {
        this.muted = false;
        this.pb.setVolume(this.preMute);
      }
    }
  }

  // ------------------------------------------------------------------ Laufzeit

  onTrack(track: TrackInfo | null) {
    this.trackTitle = track ? `${track.name}  —  ${track.artists}` : '';
    this.lastDial = '';
  }

  syncImmediately(f: FrameState) {
    this.lamp = f.playing ? 1 : 0;
    this.values.volume = f.volume;
  }

  private dbAngle(level: number) {
    const db = 20 * Math.log10(Math.max(level, 1e-4)) + 3;
    const t = THREE.MathUtils.clamp((db + 20) / 23, -0.05, 1.08);
    return THREE.MathUtils.degToRad(-48 + 96 * t);
  }

  update(f: FrameState) {
    const dt = f.dt;
    // Glühlampen: träge an/aus
    const on = f.playing;
    this.lamp = damp(this.lamp, on ? 1 : 0, on ? 5 : 3, dt);
    const lamp = this.lamp;
    this.dialMat.emissiveIntensity = 2.6 * lamp;
    this.pointerMat.emissiveIntensity = 7 * lamp + 0.3;
    for (const m of this.meterMats) m.emissiveIntensity = 1.15 * lamp;
    this.stereoLamp.emissiveIntensity = on ? 4 : 0;

    // Skalenzeiger = Fortschritt (bzw. Tuning-Drag)
    const prog = this.tuneDrag ?? f.progress;
    const x0 = DIAL.x - DIAL.w / 2 + 0.022, x1 = DIAL.x + DIAL.w / 2 - 0.022;
    this.pointer.position.x = damp(this.pointer.position.x, x0 + (x1 - x0) * prog, this.tuneDrag !== null ? 25 : 8, dt);

    // VU-Meter
    for (let c = 0; c < 2; c++) {
      const lvl = on ? f.audio.level[c] : 0;
      const a = this.needlePhys[c].update(this.dbAngle(lvl), dt);
      this.needles[c].rotation.z = -a;
    }

    // Knöpfe
    this.values.volume = damp(this.values.volume, f.volume, 18, dt);
    const knobAngle = (v: number) => -THREE.MathUtils.degToRad(-135 + 270 * v);
    this.knobs.get('bass')!.rotation.y = knobAngle(this.values.bass);
    this.knobs.get('treble')!.rotation.y = knobAngle(this.values.treble);
    this.knobs.get('balance')!.rotation.y = knobAngle(this.values.balance);
    this.knobs.get('volume')!.rotation.y = knobAngle(this.values.volume);
    const seek = this.knobs.get('seek')!;
    seek.rotation.y = damp(seek.rotation.y, -THREE.MathUtils.degToRad((this.values.seek - 0.5) * 120), 14, dt);
    this.knobs.get('tuning')!.rotation.y = -prog * Math.PI * 6;
    // Kippschalter
    for (const t of this.toggles) t.lever.rotation.x = damp(t.lever.rotation.x, t.on ? -0.45 : 0.45, 25, dt);
    // Power-Taste
    this.powerPress = Math.max(0, this.powerPress - dt * 6);
    this.powerBtn.children[0].position.z = 0.004 - 0.0025 * Math.sin(Math.min(1, this.powerPress) * Math.PI) - (on ? 0.0012 : 0);

    // Skala neu zeichnen (Zeit ändert sich sekündlich)
    const key = `${this.trackTitle}|${Math.floor(f.positionMs / 1000)}|${on}`;
    if (key !== this.lastDial) {
      this.lastDial = key;
      this.drawDial(f);
    }
  }
}
