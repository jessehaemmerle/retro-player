/**
 * Tragbarer CD-Player (90er) auf Leder.
 * - CD mit aufgedrucktem Cover; dreht sich beim Abspielen mit echter
 *   Rotations-Bewegungsunschärfe, im Stillstand ist das Motiv scharf.
 * - Reflektives LCD (Titelnummer & Zeit), Tasten ◀◀ ▶❚❚ ▶▶ ■, Lautstärkerad,
 *   HOLD-Schalter und OPEN-Schieber (Deckel klappt auf, Wiedergabe pausiert).
 */
import * as THREE from 'three';
import { Design, damp, formatTime, type FrameState } from './base';
import { SegmentCanvas, makeRoundButton } from './parts';
import type { SceneSpec } from '../engine/stage';
import { disc, extrudePanel, filletProfile, lathe, mm, roundedBox, roundedRectShape, shadows } from '../engine/geom';
import { chrome, glass, knurledMetal, paint, plastic, rubber } from '../engine/materials';
import { PanelPainter } from '../engine/panel';
import { canvasTexture, makeCanvas, radialAnisotropy } from '../engine/textures';
import type { TrackInfo } from '../playback/types';

const W = 0.134, DZ = 0.142, H = 0.029;
const LID_T = 0.008;
const BODY_TOP = 0.002 + H - LID_T;
const CORNER = 0.026;
const WIN = { x: 0, z: -0.012, r: 0.038 };
const CD_R = 0.06;
const LCD = { x: -0.03, z: 0.05, w: 0.05, d: 0.018 };
type BtnId = 'prev' | 'play' | 'next' | 'stop';

export class Discman extends Design {
  readonly id = 'discman';
  readonly name = 'Discman';
  readonly description = 'Tragbarer CD-Player mit Sichtfenster, LCD und Anti-Skip – auf Leder.';
  readonly scene: SceneSpec = {
    hdri: 'studio_small_09',
    envIntensity: 0.9,
    envRotation: 200,
    background: 'wooden_lounge',
    bgBlur: 0.6,
    bgIntensity: 0.25,
    bgRotation: 90,
    exposure: 1.0,
    ground: { surface: 'leather', size: 0.5, fade: [0.5, 1.0], blur: [0.17, 0.5], roughness: 1, normalScale: 0.8, tint: '#b5a89c', clearcoat: 0.15 },
    key: { position: [-0.8, 1.6, 0.4], intensity: 1.6, color: '#fff2e4', softness: 9, area: 0.25 },
    fill: { position: [0.8, 0.6, 1.0], intensity: 0.3, color: '#e1e8ff' },
    camera: { fov: 30, target: [0, 0.012, 0.006], azimuth: -6, polar: 46, frame: [0.27, 0.22], azimuthRange: 70, polarRange: [5, 80], zoom: [0.4, 1.6] },
    contactShadow: { width: 0.4, depth: 0.4, height: 0.04, blur: 2.2, darkness: 1.6, opacity: 0.95 },
  };

  private lid = new THREE.Group();
  private lidOpen = 0;
  private open = false;
  private cd = new THREE.Group();
  private cdMat!: THREE.MeshPhysicalMaterial;
  private cdCanvas = makeCanvas(1024, 1024);
  private cdTex = canvasTexture(this.cdCanvas, { srgb: true });
  private blurUniform = { value: 0 };
  private omega = 0;
  private lcd = new SegmentCanvas(640, 230, '#a7ae98');
  private buttons = new Map<BtnId, { cap: THREE.Object3D; press: number }>();
  private wheel!: THREE.Group;
  private hold = false;
  private holdKnob!: THREE.Mesh;
  private openSlider!: THREE.Group;
  private shownVolume = 0.6;
  private lcdKey = '';
  private trackNo = 1;
  private lastTrackId = '';

  protected async build() {
    this.buildBody();
    this.buildCd();
    this.buildLid();
    this.buildSides();
    shadows(this.root);
  }

  private buildBody() {
    const silver = plastic('#8f9297', { gloss: 0.45, texture: 'fine', seed: 7 });
    silver.metalness = 0.55;
    silver.roughness = 1;
    const shape = roundedRectShape(W, DZ, CORNER);
    const body = new THREE.Mesh(extrudePanel(shape, H - LID_T, 0.004, 32), silver);
    body.rotation.x = -Math.PI / 2;
    body.position.y = 0.002;
    this.root.add(body);
    // Fach unter dem Deckel (dunkel) + Spindel
    const well = new THREE.Mesh(disc(CD_R + 0.003, 96), paint('#101010', 0.7));
    well.position.set(WIN.x, BODY_TOP + 0.0002, WIN.z);
    this.root.add(well);
    // Füße
    for (const [x, z] of [[-0.045, -0.05], [0.045, -0.05], [-0.045, 0.05], [0.045, 0.05]]) {
      const f = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.005, 0, mm(1)], [0.005, 0.002], [0, 0.002]], 2), 24), rubber('#111'));
      f.position.set(x, 0, z);
      this.root.add(f);
    }
  }

  private buildCd() {
    // Prozedurale Rotations-Unschärfe für die bedruckte CD-Oberseite
    this.cdMat = new THREE.MeshPhysicalMaterial({ map: this.cdTex, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.08, metalness: 0.0 });
    const blur = this.blurUniform;
    this.cdMat.onBeforeCompile = (sh) => {
      sh.uniforms.uBlur = blur;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBlur;')
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec2 cuv = vMapUv - 0.5;
            vec4 acc = vec4(0.0);
            for (int i = 0; i < 24; i++) {
              float a = uBlur * (float(i) / 23.0 - 0.5);
              float s = sin(a), c = cos(a);
              acc += texture2D(map, vec2(cuv.x * c - cuv.y * s, cuv.x * s + cuv.y * c) + 0.5);
            }
            diffuseColor *= acc / 24.0;
          #endif`,
        );
    };
    this.cdMat.customProgramCacheKey = () => 'cd-rot-blur';
    const top = new THREE.Mesh(disc(CD_R, 128, 0.0075), this.cdMat);
    top.position.y = 0.0012;
    this.cd.add(top);
    // Kante & Unterseite (Polycarbonat, silbrig)
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(CD_R, CD_R, 0.0012, 128, 1, true), chrome({ roughness: 1, color: new THREE.Color(0.7, 0.72, 0.75) }));
    edge.position.y = 0.0006;
    this.cd.add(edge);
    // Spindel mit Kugelhalter
    const hub = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.0074, 0], [0.0074, 0.003, mm(0.8)], [0.006, 0.0042, mm(1)], [0, 0.0045]], 4), 48), plastic('#1a1a1a', { gloss: 0.6 }));
    this.cd.add(hub);
    for (let i = 0; i < 3; i++) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 12, 8), chrome());
      const a = (i / 3) * Math.PI * 2;
      ball.position.set(Math.cos(a) * 0.0068, 0.0028, Math.sin(a) * 0.0068);
      this.cd.add(ball);
    }
    this.cd.position.set(WIN.x, BODY_TOP + 0.0006, WIN.z);
    this.root.add(this.cd);
    this.drawCd(null);
  }

  private drawCd(art: CanvasImageSource | null) {
    const c = this.cdCanvas;
    const ctx = c.getContext('2d')!;
    const S = c.width, R = S / 2;
    ctx.clearRect(0, 0, S, S);
    // Silberner Grund (Rand & Nabenbereich)
    const g = ctx.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, '#9aa0a8');
    g.addColorStop(1, '#c9cdd3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R * 0.975, 0, Math.PI * 2);
    ctx.arc(R, R, R * 0.36, 0, Math.PI * 2, true);
    ctx.clip();
    if (art) ctx.drawImage(art, 0, 0, S, S);
    else {
      ctx.fillStyle = '#e8e6e0';
      ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#333';
      ctx.font = '600 56px Jost';
      ctx.textAlign = 'center';
      ctx.fillText('DIGITAL AUDIO', R, R * 1.55);
    }
    ctx.restore();
    // Transparenter Stapelring
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(R, R, R * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    this.cdTex.needsUpdate = true;
  }

  private buildLid() {
    // Deckel scharniert an der Hinterkante
    this.lid.position.set(0, BODY_TOP, -DZ / 2 + 0.004);
    this.root.add(this.lid);
    const inner = new THREE.Group();
    inner.position.set(0, 0, DZ / 2 - 0.004);
    this.lid.add(inner);

    const shape = roundedRectShape(W, DZ, CORNER);
    shape.holes.push(new THREE.Path().absarc(WIN.x, -WIN.z, WIN.r, 0, Math.PI * 2, true));
    const p = new PanelPainter(W * 1000, DZ * 1000, { color: '#c4c6ca', rough: 0.3, metal: 1, brushed: 0 }, { ppm: 11, ink: { color: '#25272b', rough: 0.5 } });
    const px = (x: number) => (x + W / 2) * 1000;
    const pz = (z: number) => (z + DZ / 2) * 1000;
    // Ring um das Fenster
    p.circle(px(WIN.x), pz(WIN.z), WIN.r * 1000 + 3.2, { color: '#2a2c30', rough: 0.4 }, 1.4);
    p.draw({ color: '#2a2c30' }, (ctx, style) => {
      ctx.fillStyle = style;
      ctx.font = '600 2.4px Jost';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = 'ANTI-SKIP 45 SEC  ·  1-BIT DAC  ·  DIGITAL AUDIO  ·  ';
      const r = WIN.r * 1000 + 6.2;
      const cx = px(WIN.x), cy = pz(WIN.z);
      const step = 0.052;
      for (let i = 0; i < text.length; i++) {
        const a = -Math.PI * 0.95 + i * step;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.rotate(a + Math.PI / 2);
        ctx.fillText(text[i], 0, 0);
        ctx.restore();
      }
    });
    p.text('DISCWAVE', px(LCD.x - LCD.w / 2), pz(LCD.z - LCD.d / 2 - 0.0062), { size: 3.6, font: 'Michroma', spacing: 0.8, align: 'left' });
    p.text('D-88  PORTABLE CD PLAYER', px(LCD.x - LCD.w / 2), pz(LCD.z + LCD.d / 2 + 0.0052), { size: 1.8, weight: 600, spacing: 0.4, align: 'left' });
    // LCD-Rahmen & Tastenbeschriftung
    p.rect(px(LCD.x - LCD.w / 2) - 1.6, pz(LCD.z - LCD.d / 2) - 1.6, LCD.w * 1000 + 3.2, LCD.d * 1000 + 3.2, { color: '#1b1c1f', rough: 0.4 }, 0, 2.5);
    p.text('◀◀', px(0.012), pz(0.0655), { size: 2.2, weight: 700 });
    p.text('▶ ❚❚', px(0.035), pz(0.0665), { size: 2.2, weight: 700 });
    p.text('▶▶', px(0.058), pz(0.0655), { size: 2.2, weight: 700 });
    p.text('■ STOP', px(0.0418), pz(0.0355), { size: 1.9, weight: 700, spacing: 0.2, align: 'left' });
    p.text('OPEN ▶', px(W / 2 - 0.013), pz(0.018), { size: 1.9, weight: 700, spacing: 0.2, align: 'right' });
    const lidMat = p.material({ clearcoat: 0.6, clearcoatRoughness: 0.12 }, 0);
    lidMat.anisotropy = 0.5;
    lidMat.anisotropyMap = radialAnisotropy(0.2);
    const lidMesh = new THREE.Mesh(extrudePanel(shape, LID_T, 0.0025, 48), [lidMat, plastic('#9fa2a7', { gloss: 0.5 })]);
    lidMesh.rotation.x = -Math.PI / 2;
    inner.add(lidMesh);
    // Rauchglas-Fenster
    const win = new THREE.Mesh(disc(WIN.r + 0.001, 96), glass({ roughness: 1, tint: '#4a4640', smoke: 0.55, thickness: 0.002 }));
    win.position.set(WIN.x, LID_T - 0.0015, WIN.z);
    win.userData.passThrough = true;
    inner.add(win);

    // LCD
    const lcdMat = new THREE.MeshPhysicalMaterial({ map: this.lcd.texture, roughness: 0.55, emissive: '#c7e09a', emissiveMap: this.lcd.texture, emissiveIntensity: 0.0 });
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(LCD.w, LCD.d), lcdMat);
    lcd.rotation.x = -Math.PI / 2;
    lcd.position.set(LCD.x, LID_T + 0.0009, LCD.z);
    const lcdGlass = new THREE.Mesh(new THREE.PlaneGeometry(LCD.w + 0.002, LCD.d + 0.002), glass({ roughness: 1, thickness: 0.001 }));
    lcdGlass.rotation.x = -Math.PI / 2;
    lcdGlass.position.set(LCD.x, LID_T + 0.0014, LCD.z);
    lcdGlass.userData.passThrough = true;
    inner.add(lcd, lcdGlass);
    // Vertiefung um das LCD
    const lcdWell = new THREE.Mesh(roundedBox(LCD.w + 0.003, 0.0012, LCD.d + 0.003, mm(0.8)), paint('#121315', 0.6));
    lcdWell.position.set(LCD.x, LID_T + 0.0001, LCD.z);
    inner.add(lcdWell);

    // Tasten
    const defs: Array<[BtnId, number, number, number]> = [
      ['prev', 0.012, 0.05, 0.0055],
      ['play', 0.035, 0.05, 0.0088],
      ['next', 0.058, 0.05, 0.0055],
      ['stop', 0.035, 0.0355, 0.0042],
    ];
    for (const [id, x, z, r] of defs) {
      const b = makeRoundButton({
        radius: r,
        height: 0.002,
        material: id === 'play' ? chrome({ roughness: 1, color: new THREE.Color(0.75, 0.76, 0.78) }) : plastic('#2b2d31', { gloss: 0.6 }),
        bezel: plastic('#1a1b1e', { gloss: 0.4 }),
        bezelRadius: r + 0.0012,
      });
      b.group.position.set(x, LID_T - 0.0003, z);
      inner.add(b.group);
      this.buttons.set(id, { cap: b.group, press: 0 });
    }
  }

  private buildSides() {
    // Lautstärkerad links
    this.wheel = new THREE.Group();
    this.wheel.position.set(-W / 2 + 0.003, H / 2 + 0.001, 0.035);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 48, 1, true), knurledMetal(48, { color: new THREE.Color(0.25, 0.26, 0.28) }));
    const caps = new THREE.Mesh(new THREE.CylinderGeometry(0.0088, 0.0088, 0.0038, 32), plastic('#2a2b2e'));
    this.wheel.add(d, caps);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.0041, 0.002), paint('#e8e8e8'));
    mark.position.set(-0.008, 0, 0);
    this.wheel.add(mark);
    this.root.add(this.wheel);
    // HOLD-Schieber vorne
    const holdSlot = new THREE.Mesh(roundedBox(0.016, 0.004, 0.002, mm(0.8)), paint('#0c0c0c', 0.7));
    holdSlot.position.set(-0.035, H / 2 - 0.002, DZ / 2 + 0.0002);
    this.holdKnob = new THREE.Mesh(roundedBox(0.006, 0.0032, 0.003, mm(0.8)), plastic('#e2621b', { gloss: 0.6 }));
    this.holdKnob.position.set(-0.039, H / 2 - 0.002, DZ / 2 + 0.0008);
    this.root.add(holdSlot, this.holdKnob);
    // OPEN-Schieber rechts
    this.openSlider = new THREE.Group();
    const os = new THREE.Mesh(roundedBox(0.003, 0.005, 0.014, mm(1)), plastic('#8f9297', { gloss: 0.5 }));
    this.openSlider.add(os);
    this.openSlider.position.set(W / 2 + 0.0008, BODY_TOP - 0.004, 0.018);
    this.root.add(this.openSlider);
    // Kopfhörerbuchse & Line-Out vorne
    for (const x of [0.022, 0.034]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0028, 0.0008, 10, 24), chrome());
      ring.position.set(x, H / 2 - 0.002, DZ / 2 + 0.0003);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.002, 20), paint('#020202', 0.9));
      hole.position.set(x, H / 2 - 0.002, DZ / 2 + 0.0002);
      this.root.add(ring, hole);
    }
  }

  // ------------------------------------------------------------------ Interaktion

  private press(id: BtnId) {
    const b = this.buttons.get(id)!;
    b.press = 1;
    this.ctx.sfx.click();
    if (this.hold) {
      this.ctx.sfx.detent();
      return;
    }
    const pb = this.pb;
    if (this.open && id === 'play') {
      this.open = false;
    }
    switch (id) {
      case 'play':
        if (pb.state.paused) this.ctx.sfx.whirr(0.5);
        pb.toggle();
        break;
      case 'stop':
        pb.pause();
        pb.seek(0);
        break;
      case 'next':
        pb.next();
        break;
      case 'prev':
        pb.previous();
        break;
    }
  }

  registerControls() {
    const ia = this.ctx.interaction;
    const labels: Record<BtnId, string> = { prev: '◀◀ Zurück', play: 'Play / Pause', next: 'Vor ▶▶', stop: 'Stop' };
    for (const [id, b] of this.buttons) ia.add({ kind: 'button', object: b.cap, label: () => (this.hold ? 'HOLD aktiv' : labels[id]), onPress: () => this.press(id) });
    ia.add({
      kind: 'knob',
      object: this.wheel,
      label: () => `Lautstärke ${Math.round(this.pb.state.volume * 100)} %`,
      axis: 'vertical',
      travel: 200,
      get: () => this.pb.state.volume,
      set: (v) => this.pb.setVolume(v),
    });
    ia.add({
      kind: 'button',
      object: this.holdKnob,
      label: () => (this.hold ? 'HOLD lösen' : 'HOLD (Tasten sperren)'),
      onPress: () => {
        this.hold = !this.hold;
        this.ctx.sfx.detent();
      },
    });
    ia.add({
      kind: 'button',
      object: this.openSlider,
      label: () => (this.open ? 'Deckel schließen' : 'OPEN – Deckel öffnen'),
      onPress: () => this.toggleLid(),
    });
    ia.add({
      kind: 'button',
      object: this.lid,
      label: () => (this.open ? 'Deckel schließen' : ''),
      enabled: () => this.open,
      onPress: () => this.toggleLid(),
    });
  }

  private toggleLid() {
    this.open = !this.open;
    this.ctx.sfx.click();
    if (this.open && !this.pb.state.paused) this.pb.pause();
  }

  // ------------------------------------------------------------------ Laufzeit

  onTrack(track: TrackInfo | null, art: THREE.Texture | null) {
    this.drawCd((art?.image as CanvasImageSource | undefined) ?? null);
    if (track && track.id !== this.lastTrackId) {
      this.trackNo = track.trackNumber > 1 ? track.trackNumber : this.lastTrackId ? this.trackNo + 1 : 1;
      this.lastTrackId = track.id;
    }
  }

  syncImmediately(f: FrameState) {
    this.omega = f.playing ? 32 : 0;
    this.shownVolume = f.volume;
  }

  private drawLcd(f: FrameState) {
    const l = this.lcd;
    const on = '#1d2219';
    const off = 'rgba(40,50,35,0.07)';
    const ctx = l.ctx;
    l.clear();
    // Segmentschatten auf dem Reflektor (LCDs werfen einen leichten Versatzschatten)
    const draw = (dx: number, dy: number, col: string, ghost: string) => {
      const tn = String(f.track ? this.trackNo : 0).padStart(2, '0');
      l.segText(tn, 30 + dx, 150 + dy, { size: 92, cells: 2, kind: 7, on: col, off: ghost, italic: true });
      const t = f.track ? formatTime(f.positionMs) : '--:--';
      l.segText(t.padStart(5, ' '), 260 + dx, 150 + dy, { size: 92, cells: 5, kind: 7, on: col, off: ghost, italic: true });
    };
    draw(5, 5, 'rgba(40,48,34,0.18)', 'rgba(0,0,0,0)');
    draw(0, 0, on, off);
    ctx.fillStyle = on;
    ctx.font = '700 26px Jost';
    ctx.fillText('TRACK', 30, 200);
    ctx.fillText(f.playing ? '▶' : '❚❚', 260, 200);
    if (this.hold) ctx.fillText('HOLD', 330, 200);
    if (this.pb.state.shuffle) ctx.fillText('SHUF', 430, 200);
    if (this.pb.state.repeat !== 'off') ctx.fillText(this.pb.state.repeat === 'track' ? 'RPT 1' : 'RPT', 520, 200);
    // Batterie
    ctx.strokeStyle = on;
    ctx.lineWidth = 3;
    ctx.strokeRect(540, 22, 64, 26);
    ctx.fillRect(604, 29, 6, 12);
    for (let i = 0; i < 3; i++) ctx.fillRect(546 + i * 19, 27, 15, 16);
    // Lautstärkebalken
    const v = Math.round(f.volume * 16);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i < v ? on : off;
      ctx.fillRect(30 + i * 22, 22, 16, 10 + i * 1.2);
    }
    l.texture.needsUpdate = true;
  }

  update(f: FrameState) {
    const dt = f.dt;
    // CD-Rotation (≈ 300 U/min) mit Trägheit
    const spinning = f.playing && !this.open;
    this.omega = damp(this.omega, spinning ? 32 : 0, spinning ? 2.5 : 1.4, dt);
    this.cd.rotation.y -= this.omega * dt;
    // Unschärfe = Winkel, den die CD während einer Belichtung (≈ 1/50 s) überstreicht
    this.blurUniform.value = Math.min(this.omega / 50, Math.PI * 2);

    // Deckel
    this.lidOpen = damp(this.lidOpen, this.open ? 1 : 0, 7, dt);
    this.lid.rotation.x = -this.lidOpen * 1.15;
    // Tasten
    for (const b of this.buttons.values()) {
      b.press = Math.max(0, b.press - dt * 7);
      b.cap.position.y = LID_T - 0.0003 - Math.sin(Math.min(1, b.press) * Math.PI) * 0.0009;
    }
    this.holdKnob.position.x = damp(this.holdKnob.position.x, this.hold ? -0.031 : -0.039, 20, dt);
    this.openSlider.position.z = damp(this.openSlider.position.z, this.open ? 0.012 : 0.018, 20, dt);
    this.shownVolume = damp(this.shownVolume, f.volume, 16, dt);
    this.wheel.rotation.y = -this.shownVolume * Math.PI * 1.6;

    const key = `${f.track?.id}|${Math.floor(f.positionMs / 1000)}|${f.playing}|${this.hold}|${Math.round(f.volume * 16)}|${this.trackNo}|${this.pb.state.shuffle}|${this.pb.state.repeat}`;
    if (key !== this.lcdKey) {
      this.lcdKey = key;
      this.drawLcd(f);
    }
  }
}
