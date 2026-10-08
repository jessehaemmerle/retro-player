/**
 * Tragbarer Kassettenspieler (späte 70er) liegend auf Jeansstoff, mit Kopfhörer.
 * - Tasten an der Oberkante: ◀◀ (zurück), ▶ (rastet ein), ▶▶ (vor), ■▲ (Stop/Eject)
 * - Orange HOTLINE-Taste = Stummschaltung (wie das Original zum Unterhalten)
 * - Rändelrad an der Seite = Lautstärke
 * - Die Bandwickel zeigen den Fortschritt im Titel.
 */
import * as THREE from 'three';
import { Design, damp, type FrameState } from './base';
import { Cassette } from './cassette';
import type { SceneSpec } from '../engine/stage';
import { extrudePanel, filletProfile, lathe, mm, roundedBox, roundedRectPath, roundedRectShape, shadows, tube } from '../engine/geom';
import { anodized, chrome, fabric, glass, knurledMetal, paint, plastic, rubber } from '../engine/materials';
import { PanelPainter } from '../engine/panel';
import { canvasTexture, makeCanvas } from '../engine/textures';
import type { TrackInfo } from '../playback/types';

const BW = 0.1335, BH = 0.088, BD = 0.029;
const WIN = { w: 0.104, h: 0.054, y: -0.004 };

type KeyId = 'rew' | 'play' | 'ff' | 'stop';

export class Walkman extends Design {
  readonly id = 'walkman';
  readonly name = 'Walkman';
  readonly description = 'Tragbarer Kassettenspieler aus eloxiertem Aluminium – mit Kopfhörer auf Jeansstoff.';
  readonly scene: SceneSpec = {
    hdri: 'studio_small_09',
    envIntensity: 0.9,
    envRotation: 240,
    background: 'wooden_lounge',
    bgBlur: 0.6,
    bgIntensity: 0.25,
    bgRotation: 0,
    exposure: 1.0,
    ground: { surface: 'denim', size: 0.32, fade: [0.5, 1.0], blur: [0.16, 0.5], roughness: 1, normalScale: 1.2, tint: '#d6dbe6' },
    key: { position: [-0.9, 1.6, 0.5], intensity: 1.6, color: '#fff2e4', softness: 9, area: 0.3 },
    fill: { position: [0.8, 0.6, 1.0], intensity: 0.3, color: '#e1e8ff' },
    camera: { fov: 30, target: [0.055, 0.04, 0.02], azimuth: 4, polar: 64, frame: [0.38, 0.21], azimuthRange: 60, polarRange: [8, 80], zoom: [0.4, 1.6] },
    contactShadow: { width: 0.6, depth: 0.45, height: 0.05, blur: 2.2, darkness: 1.6, opacity: 0.95 },
  };

  private dev = new THREE.Group();
  private cassette = new Cassette({ shell: 'black', labelColor: '#f3efe6', stripe: '#2f6db5' });
  private door = new THREE.Group();
  private keys = new Map<KeyId, { group: THREE.Group; press: number }>();
  private hotline!: THREE.Group;
  private hotPress = 0;
  private wheel!: THREE.Group;
  private shownVolume = 0.6;
  private muted = false;
  private preMute = 0.6;
  private ejected = false;
  private doorOpen = 0;

  protected async build() {
    // Gerät steht aufrecht (Tür = +z, Tastenkante = +y), leicht zur Kamera gedreht
    const stand = new THREE.Group();
    stand.rotation.y = -0.3;
    stand.position.set(-0.01, 0, 0);
    this.dev.position.y = BH / 2 + 0.0004;
    stand.add(this.dev);
    this.root.add(stand);

    this.buildBody();
    this.buildKeys();
    this.buildSide();
    this.buildHeadphones();
    shadows(this.root);
  }

  private buildBody() {
    const blue = anodized('#3a5d93', { repeat: [1, 1] });
    const back = new THREE.Mesh(roundedBox(BW, BH, BD * 0.5, 0.006, 5), blue);
    back.position.z = -BD * 0.25;
    this.dev.add(back);

    // Front mit Fensterausschnitt (bedrucktes, gebürstetes Alu)
    const shape = roundedRectShape(BW, BH, 0.006);
    shape.holes.push(roundedRectPath(WIN.w, WIN.h, 0.004, 0, WIN.y));
    const p = new PanelPainter(BW * 1000, BH * 1000, { color: '#cfd0d2', rough: 0.32, metal: 1, brushed: 1 }, { ppm: 14, ink: { color: '#1a1f2a', rough: 0.5 } });
    const px = (x: number) => (x + BW / 2) * 1000;
    const py = (y: number) => (BH / 2 - y) * 1000;
    p.rect(px(-WIN.w / 2) - 2, py(WIN.y + WIN.h / 2) - 2, WIN.w * 1000 + 4, WIN.h * 1000 + 4, { color: '#11141b', rough: 0.4 }, 0, 4);
    p.text('TAPEMAN', px(-BW / 2 + 0.008), py(0.0345), { size: 5, font: 'Michroma', spacing: 1.2, align: 'left', ink: { color: '#2a4678' } });
    p.text('STEREO CASSETTE PLAYER  TP-2', px(BW / 2 - 0.008), py(0.0345), { size: 2.3, weight: 600, spacing: 0.5, align: 'right' });
    p.text('METAL', px(-BW / 2 + 0.008), py(-0.0385), { size: 2.2, weight: 700, spacing: 0.6, align: 'left' });
    p.text('◀ OPEN', px(BW / 2 - 0.008), py(-0.0385), { size: 2.2, weight: 600, spacing: 0.4, align: 'right' });
    p.line(px(-BW / 2 + 0.024), py(-0.0385), px(BW / 2 - 0.024), py(-0.0385), 0.25);
    const face = new THREE.Mesh(extrudePanel(shape, BD * 0.5, 0.0012, 24), [p.material({ clearcoat: 0.2 }, 0.75), anodized('#3a5d93')]);
    face.position.z = 0;
    this.dev.add(face);
    this.door.add(face);

    // Kassette im Fach
    const well = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), paint('#090909', 0.8));
    well.position.set(0, WIN.y, 0.0003);
    this.dev.add(well);
    const cs = 0.98;
    this.cassette.group.scale.setScalar(cs);
    this.cassette.group.position.set(0, WIN.y, 0.0066);
    this.dev.add(this.cassette.group);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w + 0.002, WIN.h + 0.002), glass({ roughness: 1, thickness: 0.0015, tint: '#d8dde6', smoke: 0.15 }));
    win.position.set(0, WIN.y, BD * 0.5 - 0.0008);
    win.userData.passThrough = true;
    this.door.add(win);
    this.dev.add(this.door);

    // Kopfhörerbuchsen & Gürtelclip-Schrauben
    for (const [i, x] of [[1, 0.046], [2, 0.058]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0036, 0.0011, 12, 32), chrome());
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, BH / 2 + 0.0002, 0.0);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0027, 24), paint('#020202', 0.9));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(x, BH / 2 + 0.0001, 0.0);
      this.dev.add(ring, hole);
      void i;
    }
  }

  private keyTexture(sym: string, color = '#22262e'): THREE.Texture {
    const c = makeCanvas(128, 96);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#c9cacc';
    ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = color;
    ctx.font = '700 42px Jost';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sym, 64, 50);
    return canvasTexture(c, { srgb: true });
  }

  private buildKeys() {
    // Reihenfolge in lokalen Koordinaten (+x → links im Bild nach dem Hinlegen)
    const defs: Array<[KeyId, string, number]> = [
      ['rew', '◀◀', -0.044],
      ['play', '▶', -0.024],
      ['ff', '▶▶', -0.004],
      ['stop', '■▲', 0.016],
    ];
    const kw = 0.017, kh = 0.007, kd = 0.014;
    for (const [id, sym, x] of defs) {
      const g = new THREE.Group();
      g.position.set(x, BH / 2, 0.0);
      const body = new THREE.Mesh(roundedBox(kw, kh, kd, mm(1.6), 3), chrome({ roughness: 1, color: new THREE.Color(0.78, 0.78, 0.8) }));
      body.position.y = kh / 2 - 0.0015;
      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(kw - 0.004, kd - 0.004),
        new THREE.MeshPhysicalMaterial({ map: this.keyTexture(sym), metalness: 0.9, roughness: 0.32 }),
      );
      top.rotation.x = -Math.PI / 2;
      top.position.y = kh - 0.0015 + 0.0001;
      g.add(body, top);
      this.dev.add(g);
      this.keys.set(id, { group: g, press: 0 });
    }
    // Schlitzblende
    const slot = new THREE.Mesh(roundedBox(0.084, 0.002, kd + 0.004, mm(1)), paint('#0a0a0a', 0.7));
    slot.position.set(-0.014, BH / 2 - 0.0005, 0);
    this.dev.add(slot);
    // HOTLINE-Taste (orange)
    this.hotline = new THREE.Group();
    this.hotline.position.set(0.032, BH / 2, 0.0);
    const hb = new THREE.Mesh(roundedBox(0.009, 0.006, 0.009, mm(2)), plastic('#f06a14', { gloss: 0.7 }));
    hb.position.y = 0.0015;
    this.hotline.add(hb);
    this.dev.add(this.hotline);
  }

  private buildSide() {
    // Lautstärke-Rändelrad an der rechten Seite (lokal +x)
    this.wheel = new THREE.Group();
    this.wheel.position.set(-BW / 2 + 0.004, 0.018, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.006, 64, 1, true), knurledMetal(70, { color: new THREE.Color(0.8, 0.8, 0.82) }));
    disc.rotation.x = Math.PI / 2;
    const faces = new THREE.Mesh(new THREE.CylinderGeometry(0.0113, 0.0113, 0.0058, 48), chrome({ roughness: 1 }));
    faces.rotation.x = Math.PI / 2;
    // Markierung
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.004, 0.0062), paint('#c22', 0.5));
    mark.position.set(-0.0095, 0, 0);
    this.wheel.add(disc, faces, mark);
    this.dev.add(this.wheel);
    // Schlitz um das Rad
    const slot = new THREE.Mesh(roundedBox(0.004, 0.026, 0.009, mm(1)), paint('#07080a', 0.8));
    slot.position.set(-BW / 2 + 0.0005, 0.018, 0);
    this.dev.add(slot);
    // Gravur "VOL" ist auf der Seite schwer zu lesen – kleine Skala-Punkte
    for (let i = 0; i < 5; i++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0005 + i * 0.00015, 12), paint('#e8e8e8', 0.5));
      dot.rotation.y = -Math.PI / 2;
      dot.position.set(-BW / 2 - 0.0001, 0.0045 - i * 0.0028, 0.007);
      this.dev.add(dot);
    }
  }

  private buildHeadphones() {
    const hp = new THREE.Group();
    hp.position.set(0.14, 0, 0.075);
    hp.rotation.y = 0.38;
    this.root.add(hp);
    const foam = fabric('#e8661a', { roughness: 1 });
    const housing = plastic('#c8c9cc', { gloss: 0.5, texture: 'fine' });
    const cups: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const cup = new THREE.Group();
      cup.position.set(s * 0.048, 0, 0);
      // Gehäuse (unten), Schaumstoff (oben)
      const shell = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.019, 0, mm(2)], [0.02, 0.008, mm(2)], [0, 0.008]], 4), 48), housing);
      const R = 0.028, base = 0.008, hh = 0.013;
      const prof: Array<[number, number]> = [[0, base], [R * 0.9, base]];
      for (let i = 14; i >= 1; i--) {
        const a = (i / 14) * Math.PI * 0.5;
        prof.push([R * Math.sin(a), base + hh * Math.pow(Math.cos(a), 0.65)]);
      }
      prof.push([0, base + hh]);
      const pad = new THREE.Mesh(lathe(prof, 64), foam);
      pad.scale.y = 0.95;
      cup.add(shell, pad);
      // Drahtbügel-Halterung
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0012, 10, 48, Math.PI), chrome());
      yoke.rotation.x = -Math.PI / 2;
      yoke.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      yoke.position.y = 0.004;
      cup.add(yoke);
      hp.add(cup);
      cups.push(new THREE.Vector3(s * 0.048 + s * -0.0, 0.004, 0));
    }
    // Kopfbügel (flach liegend)
    const band = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.048 - 0.021, 0.004, 0),
      new THREE.Vector3(-0.07, 0.004, -0.04),
      new THREE.Vector3(-0.04, 0.005, -0.075),
      new THREE.Vector3(0, 0.0055, -0.085),
      new THREE.Vector3(0.04, 0.005, -0.075),
      new THREE.Vector3(0.07, 0.004, -0.04),
      new THREE.Vector3(0.048 + 0.021, 0.004, 0),
    ]);
    hp.add(new THREE.Mesh(tube(band, 0.0016, 120, 12), chrome()));
    // Polsterung auf dem Bügel
    const padCurve = new THREE.CatmullRomCurve3(band.getPoints(40).slice(14, 27));
    hp.add(new THREE.Mesh(tube(padCurve, 0.0042, 40, 16), rubber('#1b1b1b', { roughness: 0.6 })));

    // Kabel vom linken Hörer zur Buchse (in Weltkoordinaten berechnet)
    this.root.updateMatrixWorld(true);
    const start = new THREE.Vector3(-0.048, 0.003, 0.012).applyMatrix4(hp.matrixWorld);
    const jackLocal = new THREE.Vector3(0.046, BH / 2 + 0.012, 0);
    const jack = jackLocal.clone().applyMatrix4(this.dev.matrixWorld);
    const plugBase = new THREE.Vector3(0.046, BH / 2 + 0.003, 0).applyMatrix4(this.dev.matrixWorld);
    const cable = new THREE.CatmullRomCurve3([
      start,
      start.clone().add(new THREE.Vector3(-0.02, 0, -0.01)),
      new THREE.Vector3(0.075, 0.0016, -0.035),
      new THREE.Vector3(jack.x + 0.03, 0.0016, jack.z - 0.04),
      new THREE.Vector3(jack.x + 0.012, jack.y * 0.55, jack.z - 0.018),
      new THREE.Vector3(jack.x + 0.002, jack.y + 0.006, jack.z - 0.004),
      jack,
    ]);
    this.root.add(new THREE.Mesh(tube(cable, 0.0011, 200, 8), rubber('#121212', { roughness: 0.5 })));
    // Stecker
    const plug = new THREE.Group();
    const sleeve = new THREE.Mesh(roundedBox(0.006, 0.014, 0.006, mm(1.5)), plastic('#151515', { gloss: 0.5 }));
    sleeve.position.y = 0.007;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, 0.006, 16), chrome());
    pin.position.y = -0.002;
    plug.add(sleeve, pin);
    plug.position.copy(plugBase);
    this.root.add(plug);
  }

  // ------------------------------------------------------------------ Interaktion

  private press(id: KeyId) {
    this.keys.get(id)!.press = 1;
    this.ctx.sfx.clunk();
    const pb = this.pb;
    if (id === 'play') {
      this.ejected = false;
      if (pb.state.paused) pb.play();
    } else if (id === 'stop') {
      if (!pb.state.paused) pb.pause();
      else this.ejected = !this.ejected;
    } else if (id === 'ff') pb.next();
    else if (id === 'rew') pb.previous();
  }

  registerControls() {
    const ia = this.ctx.interaction;
    const labels: Record<KeyId, string> = { rew: 'Rewind (vorheriger Titel)', play: 'Play', ff: 'Fast Forward (nächster Titel)', stop: 'Stop / Eject' };
    for (const [id, k] of this.keys) ia.add({ kind: 'button', object: k.group, label: labels[id], onPress: () => this.press(id) });
    ia.add({
      kind: 'button',
      object: this.hotline,
      label: () => (this.muted ? 'Hotline: Ton wieder an' : 'Hotline: Ton stumm (zum Unterhalten)'),
      onPress: () => {
        this.hotPress = 1;
        this.ctx.sfx.click();
        if (this.muted) {
          this.muted = false;
          this.pb.setVolume(this.preMute);
        } else {
          this.preMute = this.pb.state.volume || 0.5;
          this.muted = true;
          this.pb.setVolume(0);
        }
      },
    });
    ia.add({
      kind: 'knob',
      object: this.wheel,
      label: () => `Lautstärke ${Math.round(this.pb.state.volume * 100)} %`,
      travel: 180,
      axis: 'horizontal',
      get: () => this.pb.state.volume,
      set: (v) => {
        this.muted = false;
        this.pb.setVolume(v);
      },
    });
    ia.add({
      kind: 'button',
      object: this.door,
      label: () => (this.ejected ? 'Deckel schließen' : 'Kassettenfach'),
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

  update(f: FrameState) {
    const dt = f.dt;
    this.cassette.setProgress(f.progress);
    if (f.playing) this.cassette.spin(dt, 1);
    for (const [id, k] of this.keys) {
      k.press = Math.max(0, k.press - dt * 5);
      const latched = id === 'play' && f.playing;
      const target = latched ? 0.8 : k.press > 0 ? 1 : 0;
      const t = damp((k.group.userData.t as number) ?? 0, target, 30, dt);
      k.group.userData.t = t;
      k.group.position.y = BH / 2 - t * 0.0032;
    }
    this.hotPress = Math.max(0, this.hotPress - dt * 6);
    this.hotline.position.y = BH / 2 - (this.muted ? 0.0018 : 0) - this.hotPress * 0.0012;
    this.shownVolume = damp(this.shownVolume, f.volume, 16, dt);
    this.wheel.rotation.z = -this.shownVolume * Math.PI * 1.4;
    this.doorOpen = damp(this.doorOpen, this.ejected ? 1 : 0, 6, dt);
    // Deckel klappt an der Unterkante (lokal -y) auf
    this.door.position.set(0, -BH / 2, 0);
    this.door.children.forEach((c) => (c.userData.base ??= c.position.clone()));
    this.door.rotation.x = this.doorOpen * 0.5;
    for (const c of this.door.children) {
      const b = c.userData.base as THREE.Vector3;
      c.position.set(b.x, b.y + BH / 2, b.z);
    }
  }
}
