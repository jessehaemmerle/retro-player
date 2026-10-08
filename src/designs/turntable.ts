/**
 * Plattenspieler (Direktantrieb, Nussbaum-Zarge, Alu-Deck).
 * - Die Platte ist eine Picture-Disc mit dem Album-Cover und dreht sich.
 * - Der Tonarm muss auf die Platte gezogen werden; die Position auf der Platte
 *   entspricht der Position im Titel (außen = Anfang, innen = Ende).
 * - Drehknöpfe: Lautstärke (stufenlos) und Geschwindigkeit (33/45).
 */
import * as THREE from 'three';
import { Design, damp, type FrameState } from './base';
import { makeKnob, makeRoundButton } from './parts';
import type { SceneSpec } from '../engine/stage';
import { boxProjectUV, disc, filletProfile, lathe, mm, roundedBox, shadows, tube } from '../engine/geom';
import { brushedAluminum, chrome, emissive, knurledMetal, paint, plastic, rubber, woodVeneer } from '../engine/materials';
import { PanelPainter } from '../engine/panel';
import { canvasTexture, makeCanvas, paperNormal, radialAnisotropy, vinylNormal, vinylRoughness } from '../engine/textures';
import type { TrackInfo } from '../playback/types';

// Maße in Metern
const FOOT_H = 0.014;
const W = 0.46, D = 0.36, H = 0.078;
const BODY_TOP = FOOT_H + H;
const DECK_Y = BODY_TOP + 0.0015;
const PLATTER_C = new THREE.Vector3(-0.045, 0, -0.008);
const PLATTER_R = 0.15, PLATTER_H = 0.026;
const PLATTER_Y = DECK_Y + 0.004;
const REC_R = 0.1505, REC_T = 0.0018;
const REC_Y = PLATTER_Y + PLATTER_H + REC_T; // Oberseite Platte
const PIVOT = new THREE.Vector3(0.17, 0, -0.098);
const ARM_Y = REC_Y + 0.021;
const PIVOT_DIST = Math.hypot(PIVOT.x - PLATTER_C.x, PIVOT.z - PLATTER_C.z);
const ARM_L = PIVOT_DIST + 0.016; // Überhang 16 mm
const R_OUTER = 0.1455, R_INNER = 0.0615;
const LIFT_ANGLE = Math.asin(0.009 / ARM_L); // Cue-Höhe 9 mm
const RPM = { 33: 33.333, 45: 45 };

export class Turntable extends Design {
  readonly id = 'turntable';
  readonly name = 'Plattenspieler';
  readonly description = 'Direktantrieb, Nussbaum & gebürstetes Aluminium. Tonarm auf die Platte ziehen.';
  readonly scene: SceneSpec = {
    hdri: 'studio_small_09',
    envIntensity: 0.85,
    envRotation: 20,
    background: 'wooden_lounge',
    bgBlur: 0.55,
    bgIntensity: 0.32,
    bgRotation: 30,
    exposure: 1.0,
    ground: { surface: 'oaktable', size: 1.6, fade: [1.1, 2.2], blur: [0.38, 1.1], roughness: 1, normalScale: 0.6, rotation: 90, clearcoat: 0.25, tint: '#d8cfc4' },
    key: { position: [-1.4, 2.2, -0.9], intensity: 1.6, color: '#fff3e6', softness: 7, area: 0.55 },
    fill: { position: [1.5, 0.8, 1.6], intensity: 0.25, color: '#dfe8ff' },
    camera: { fov: 32, target: [0.0, 0.07, 0.02], azimuth: 8, polar: 52, frame: [0.7, 0.5], azimuthRange: 45, polarRange: [18, 78], zoom: [0.42, 1.5] },
    contactShadow: { width: 1.4, depth: 1.0, height: 0.12, blur: 2.2, darkness: 1.6, opacity: 0.95 },
  };

  private platter = new THREE.Group();
  private record!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private sleeveArt!: THREE.MeshPhysicalMaterial;
  private sleeve = new THREE.Group();
  private armYaw = new THREE.Group();
  private armPitch = new THREE.Group();
  private headshell = new THREE.Group();
  private cueLever = new THREE.Group();
  private volumeKnob!: THREE.Group;
  private speedKnob!: THREE.Group;
  private startCap!: THREE.Mesh;
  private ledMat!: THREE.MeshStandardMaterial;
  private strobeMat!: THREE.MeshStandardMaterial;

  // Zustand
  private speed: 33 | 45 = 33;
  private omega = 0; // rad/s Plattenteller
  private yaw = 0;
  private lift = 1; // 0 = Nadel auf Platte, 1 = angehoben
  private dragYaw: number | null = null;
  private autoReturn = true;
  private pausedFor = 0;
  private wasDown = false;
  private pressT = 0;
  private restYaw = 0;
  private minYaw = 0;
  private pendingPlayUntil = 0;
  private displayedVolume = 0.6;

  // ------------------------------------------------------------------ Geometrie

  /** Gierwinkel des Arms, bei dem die Nadel auf Radius r liegt. */
  private yawForRadius(r: number): number {
    const dx = PLATTER_C.x - PIVOT.x, dz = PLATTER_C.z - PIVOT.z;
    const base = Math.atan2(-dz, dx);
    const c = (ARM_L * ARM_L + PIVOT_DIST * PIVOT_DIST - r * r) / (2 * ARM_L * PIVOT_DIST);
    return base + Math.acos(THREE.MathUtils.clamp(c, -1, 1));
  }

  private radiusForYaw(yaw: number): number {
    const sx = PIVOT.x + Math.cos(yaw) * ARM_L;
    const sz = PIVOT.z - Math.sin(yaw) * ARM_L;
    return Math.hypot(sx - PLATTER_C.x, sz - PLATTER_C.z);
  }

  private radiusForProgress(p: number) {
    return R_OUTER - (R_OUTER - R_INNER) * THREE.MathUtils.clamp(p, 0, 1);
  }
  private progressForRadius(r: number) {
    return THREE.MathUtils.clamp((R_OUTER - r) / (R_OUTER - R_INNER), 0, 0.995);
  }

  protected async build() {
    const walnut = await this.ctx.stage.loadSurface('walnut');
    this.restYaw = this.yawForRadius(0.235);
    this.minYaw = this.yawForRadius(0.055);
    this.yaw = this.restYaw;

    this.buildPlinth(walnut);
    this.buildPlatter();
    this.buildTonearm();
    this.buildFrontPanel();
    this.buildSleeve();
    shadows(this.root);
    this.record.castShadow = true;
  }

  private buildPlinth(walnut: Awaited<ReturnType<typeof this.ctx.stage.loadSurface>>) {
    const wood = woodVeneer(walnut, [1, 1], { clearcoat: 0.55, clearcoatRoughness: 0.28, color: new THREE.Color('#e8dccf') });
    const body = new THREE.Mesh(boxProjectUV(roundedBox(W, H, D, mm(5), 5), 0.75, [0.13, 0.4]), wood);
    body.position.y = FOOT_H + H / 2;
    this.root.add(body);

    // Aluminium-Deck (leicht eingelassen, mit Fase)
    const deckP = new PanelPainter(W * 1000 - 24, D * 1000 - 24, { color: '#c9c9c7', rough: 0.34, metal: 1, brushed: 0.9 }, { ppm: 4, ink: { color: '#1a1a1a', rough: 0.6 } });
    // Beschriftungen am Deck
    const toPx = (x: number, z: number): [number, number] => [(x + W / 2) * 1000 - 12, (z + D / 2) * 1000 - 12];
    const [px, pz] = toPx(PIVOT.x, PIVOT.z);
    deckP.text('UP', px - 33, pz + 36, { size: 3, weight: 600, spacing: 0.4 });
    deckP.text('DOWN', px - 33, pz + 49, { size: 3, weight: 600, spacing: 0.4 });
    deckP.line(px - 33, pz + 39.5, px - 33, pz + 45.5, 0.4);
    deckP.text('ANTI-SKATING', px + 34, pz - 22, { size: 2.2, weight: 500, spacing: 0.3 });
    const [sx, sz] = toPx(-0.21, 0.155);
    deckP.text('QUARTZ LOCKED · DIRECT DRIVE', sx, sz, { size: 2.6, weight: 500, align: 'left', spacing: 0.5 });
    const deck = new THREE.Mesh(roundedBox(W - 0.024, 0.003, D - 0.024, mm(1.2), 3), deckP.material({ clearcoat: 0.0 }, 0.75));
    deck.position.y = DECK_Y - 0.0015;
    this.root.add(deck);

    // Gummifüße mit Metallring
    const footMat = rubber('#141414');
    const ringMat = chrome({ roughness: 1 });
    for (const [x, z] of [[-W / 2 + 0.04, -D / 2 + 0.04], [W / 2 - 0.04, -D / 2 + 0.04], [-W / 2 + 0.04, D / 2 - 0.04], [W / 2 - 0.04, D / 2 - 0.04]]) {
      const foot = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.024, 0, mm(2)], [0.026, FOOT_H * 0.6, mm(1)], [0.03, FOOT_H * 0.62], [0.03, FOOT_H], [0, FOOT_H]], 4), 48), footMat);
      const ring = new THREE.Mesh(lathe([[0.0302, FOOT_H * 0.62], [0.0305, FOOT_H * 0.8], [0.0302, FOOT_H * 0.98]], 48), ringMat);
      foot.position.set(x, 0, z);
      ring.position.set(x, 0, z);
      this.root.add(foot, ring);
    }
  }

  private buildPlatter() {
    const p = this.platter;
    p.position.set(PLATTER_C.x, PLATTER_Y, PLATTER_C.z);
    this.root.add(p);

    // Lagerschale unter dem Teller (dunkel)
    const well = new THREE.Mesh(new THREE.CylinderGeometry(PLATTER_R + 0.003, PLATTER_R + 0.003, 0.004, 96, 1, true), paint('#070707', 0.7));
    well.position.set(PLATTER_C.x, DECK_Y + 0.0015, PLATTER_C.z);
    this.root.add(well);

    // Tellerrand mit Stroboskop-Punkten
    const c = makeCanvas(4096, 128);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#5d5e60';
    ctx.fillRect(0, 0, 4096, 128);
    const rows = [180, 133, 216, 160];
    rows.forEach((n, i) => {
      const y = 14 + i * 26;
      for (let k = 0; k < n; k++) {
        const x = (k / n) * 4096;
        ctx.fillStyle = '#e9e9ea';
        ctx.fillRect(x, y, (4096 / n) * 0.5, 18);
      }
    });
    ctx.fillStyle = '#d9dadb';
    ctx.fillRect(0, 0, 4096, 6);
    ctx.fillRect(0, 122, 4096, 6);
    const rimTex = canvasTexture(c, { srgb: true });
    const rimMat = new THREE.MeshPhysicalMaterial({ map: rimTex, metalness: 1, roughness: 0.18 });
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(PLATTER_R, PLATTER_R - 0.002, PLATTER_H - 0.003, 160, 1, true), rimMat);
    rim.position.y = (PLATTER_H - 0.003) / 2;
    p.add(rim);
    // Fasen oben/unten
    const alu = chrome({ roughness: 1, color: new THREE.Color(0.8, 0.8, 0.8) });
    const chTop = new THREE.Mesh(lathe([[PLATTER_R, PLATTER_H - 0.003], [PLATTER_R - 0.0008, PLATTER_H - 0.0008], [PLATTER_R - 0.003, PLATTER_H]], 160), alu);
    p.add(chTop);
    const top = new THREE.Mesh(disc(PLATTER_R - 0.003, 128), plastic('#0d0d0d', { gloss: 0.1, texture: 'coarse' }));
    top.position.y = PLATTER_H;
    p.add(top);

    // Picture-Disc
    const recMat = new THREE.MeshPhysicalMaterial({
      color: '#0c0c0c',
      roughness: 1,
      roughnessMap: vinylRoughness(),
      normalMap: vinylNormal(),
      normalScale: new THREE.Vector2(0.18, 0.18),
      metalness: 0,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
      anisotropy: 0.92,
      anisotropyMap: radialAnisotropy(0.03),
      specularIntensity: 0.9,
    });
    const recTop = new THREE.Mesh(disc(REC_R - mm(0.6), 160), recMat);
    recTop.position.y = PLATTER_H + REC_T;
    this.record = recTop;
    const edgeMat = new THREE.MeshPhysicalMaterial({ color: '#0a0a0a', roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.1 });
    const recEdge = new THREE.Mesh(
      lathe([[REC_R - mm(0.6), PLATTER_H + REC_T], [REC_R - mm(0.1), PLATTER_H + REC_T - mm(0.2)], [REC_R, PLATTER_H + REC_T * 0.5], [REC_R - mm(0.1), PLATTER_H + mm(0.2)], [REC_R - mm(0.6), PLATTER_H]], 160),
      edgeMat,
    );
    p.add(recTop, recEdge);

    // Spindel
    const spindle = new THREE.Mesh(
      lathe(filletProfile([[0, 0], [mm(3.6), 0], [mm(3.6), PLATTER_H + REC_T + mm(11), mm(1.5)], [0, PLATTER_H + REC_T + mm(12.5)]], 4), 32),
      chrome(),
    );
    p.add(spindle);

    // Stroboskoplampe (Glimmlicht, leuchtet bei laufendem Motor)
    this.strobeMat = emissive('#ff7a2a', 0);
    const strobe = new THREE.Mesh(roundedBox(0.008, 0.006, 0.002, mm(1)), this.strobeMat);
    strobe.position.set(PLATTER_C.x - 0.111, DECK_Y + 0.0045, PLATTER_C.z + 0.113);
    strobe.rotation.y = Math.PI * 0.25;
    const strobeHousing = new THREE.Mesh(roundedBox(0.014, 0.009, 0.011, mm(2.5)), plastic('#121212', { gloss: 0.5 }));
    strobeHousing.position.set(PLATTER_C.x - 0.115, DECK_Y + 0.0045, PLATTER_C.z + 0.117);
    strobeHousing.rotation.y = Math.PI * 0.25;
    this.root.add(strobe, strobeHousing);
  }

  private buildTonearm() {
    const chromeM = chrome();
    const black = plastic('#0a0a0b', { gloss: 0.55, texture: 'fine' });
    const satin = brushedAluminum({ color: new THREE.Color(0.75, 0.75, 0.76) });

    // Lagerbock (fest)
    const base = new THREE.Group();
    base.position.set(PIVOT.x, DECK_Y, PIVOT.z);
    const plinthRing = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.031, 0], [0.031, 0.004, mm(1)], [0.027, 0.006, mm(1)], [0, 0.006]], 3), 64), satin);
    const column = new THREE.Mesh(lathe(filletProfile([[0, 0.006], [0.016, 0.006], [0.016, 0.02, mm(1.5)], [0.012, 0.024, mm(1)], [0.012, ARM_Y - DECK_Y - 0.012], [0, ARM_Y - DECK_Y - 0.012]], 3), 48), black);
    base.add(plinthRing, column);
    // Höhenverstellring (gerändelt)
    const hRing = new THREE.Mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.006, 64, 1, true), knurledMetal(90));
    hRing.position.y = 0.014;
    base.add(hRing);
    // Armstütze
    const restA = this.restYaw;
    // Punkt (0.15 | 0.004) auf dem Armrohr im Ruhezustand
    const restLocal = new THREE.Vector3(0.15, 0, 0.004).applyAxisAngle(new THREE.Vector3(0, 1, 0), restA);
    const restPos = new THREE.Vector3(restLocal.x, 0, restLocal.z);
    const restPost = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.006, 0], [0.006, 0.003], [0.0035, 0.004], [0.0035, ARM_Y - DECK_Y - 0.0042], [0, ARM_Y - DECK_Y - 0.0042]], 3), 24), black);
    restPost.position.copy(restPos);
    const cradle = new THREE.Mesh(roundedBox(0.016, 0.006, 0.01, mm(2)), rubber('#1a1a1a'));
    cradle.position.copy(restPos).setY(ARM_Y - DECK_Y - 0.0012);
    cradle.rotation.y = restA;
    base.add(restPost, cradle);
    // Lift-Hebel (Cue)
    this.cueLever.position.set(-0.03, 0.006, 0.03);
    const cueBase = new THREE.Mesh(roundedBox(0.012, 0.014, 0.022, mm(2)), black);
    cueBase.position.y = 0.007;
    const cueArm = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.03, 16), chromeM);
    cueArm.rotation.z = Math.PI / 2;
    cueArm.position.set(-0.015, 0.012, 0);
    const cueKnob = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 24, 16), black);
    cueKnob.position.set(-0.031, 0.012, 0);
    const cuePivot = new THREE.Group();
    cuePivot.add(cueArm, cueKnob);
    this.cueLever.add(cueBase, cuePivot);
    this.cueLever.userData.pivot = cuePivot;
    base.add(this.cueLever);
    this.root.add(base);

    // Arm: Gier- und Nickgruppe am Drehpunkt
    this.armYaw.position.set(PIVOT.x, ARM_Y, PIVOT.z);
    this.armYaw.add(this.armPitch);
    this.root.add(this.armYaw);

    // Kardanlager
    const gimbal = new THREE.Mesh(roundedBox(0.026, 0.02, 0.03, mm(3)), chromeM);
    this.armPitch.add(gimbal);
    const gimbalCap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.034, 32), black);
    gimbalCap.rotation.x = Math.PI / 2;
    this.armPitch.add(gimbalCap);

    // S-förmiges Armrohr
    const endX = ARM_L - 0.058;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0, 0),
      new THREE.Vector3(0.05, 0, 0.0),
      new THREE.Vector3(0.1, 0, -0.006),
      new THREE.Vector3(0.15, 0, 0.004),
      new THREE.Vector3(endX - 0.012, 0, 0.022),
      new THREE.Vector3(endX, 0, 0.028),
    ]);
    const armTube = new THREE.Mesh(tube(curve, 0.0042, 120, 20), chromeM);
    this.armPitch.add(armTube);
    // Hinteres Rohr + Gegengewicht
    const rear = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.085, 24), chromeM);
    rear.rotation.z = Math.PI / 2;
    rear.position.x = -0.042;
    this.armPitch.add(rear);
    const cw = new THREE.Group();
    const cwBody = new THREE.Mesh(lathe(filletProfile([[0, 0], [0.0175, 0, mm(1.5)], [0.0175, 0.026, mm(1.5)], [0, 0.026]], 4), 64), black);
    const cwRing = new THREE.Mesh(new THREE.CylinderGeometry(0.0182, 0.0182, 0.008, 64, 1, true), knurledMetal(110, { color: new THREE.Color(0.85, 0.85, 0.86) }));
    cwRing.position.y = 0.022;
    const cwScale = new THREE.Mesh(new THREE.CylinderGeometry(0.0179, 0.0179, 0.006, 64, 1, true), this.counterweightScaleMat());
    cwScale.position.y = 0.012;
    cw.add(cwBody, cwRing, cwScale);
    cw.rotation.z = Math.PI / 2;
    cw.position.x = -0.058;
    this.armPitch.add(cw);
    // Anti-Skating-Knopf am Lagerbock
    const as = makeKnob({ radius: 0.006, height: 0.006, style: 'black', indicator: 'line' });
    as.spin.rotation.y = -0.6;
    as.group.position.set(0.034, 0.006, -0.012);
    base.add(as.group);

    // Headshell am Rohrende → zeigt auf den Nadelpunkt (ARM_L, ., 0)
    const head = this.headshell;
    const tip = new THREE.Vector3(ARM_L, 0, 0);
    const start = new THREE.Vector3(endX, 0, 0.028);
    head.position.copy(start);
    const dir = tip.clone().sub(start);
    head.rotation.y = Math.atan2(-dir.z, dir.x);
    const len = dir.length();
    // Bajonett-Kupplung
    const coupler = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.014, 32), chromeM);
    coupler.rotation.z = Math.PI / 2;
    coupler.position.x = 0.002;
    head.add(coupler);
    const shell = new THREE.Mesh(roundedBox(0.05, 0.003, 0.019, mm(1.2)), brushedAluminum({ color: new THREE.Color(0.08, 0.08, 0.085) }));
    shell.position.set(0.012 + 0.025, -0.002, 0);
    head.add(shell);
    // Fingerlift
    const liftCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.03, -0.002, 0.009),
      new THREE.Vector3(0.036, -0.0, 0.017),
      new THREE.Vector3(0.042, 0.004, 0.022),
    ]);
    head.add(new THREE.Mesh(tube(liftCurve, 0.0012, 24, 10), chromeM));
    // Tonabnehmer
    const cart = new THREE.Mesh(roundedBox(0.026, 0.016, 0.017, mm(1.5)), plastic('#181818', { gloss: 0.6 }));
    cart.position.set(len - 0.012, -0.0115, 0);
    head.add(cart);
    const cartFront = new THREE.Mesh(roundedBox(0.008, 0.009, 0.0172, mm(1)), plastic('#b5121b', { gloss: 0.7 }));
    cartFront.position.set(len - 0.0005, -0.0145, 0);
    head.add(cartFront);
    const cantilever = new THREE.Mesh(new THREE.CylinderGeometry(0.00035, 0.0005, 0.006, 8), chromeM);
    cantilever.position.set(len + 0.0028, -0.0185, 0);
    cantilever.rotation.z = 1.1;
    head.add(cantilever);
    this.armPitch.add(head);
    head.traverse((o) => (o.userData.passThrough = false));

    // Leichte Neigung im Ruhezustand
    this.armPitch.rotation.z = LIFT_ANGLE;
    this.armYaw.rotation.y = this.yaw;
  }

  private counterweightScaleMat() {
    const c = makeCanvas(1024, 64);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, 1024, 64);
    ctx.fillStyle = '#e6e2d6';
    ctx.font = '500 26px Jost';
    ctx.textAlign = 'center';
    for (let i = 0; i < 40; i++) {
      const x = (i / 40) * 1024;
      ctx.fillRect(x, 0, 2, i % 5 === 0 ? 26 : 14);
      if (i % 5 === 0) ctx.fillText(String((i / 5) % 4), x, 56);
    }
    return new THREE.MeshPhysicalMaterial({ map: canvasTexture(c, { srgb: true }), roughness: 0.35, clearcoat: 0.4 });
  }

  private buildFrontPanel() {
    const pw = 410, ph = 50; // mm
    const p = new PanelPainter(pw, ph, { color: '#cfcfcd', rough: 0.3, metal: 1, brushed: 1 }, { ppm: 8, ink: { color: '#141414', rough: 0.55 } });
    const xv = 340, xs = 40, xb = 98;
    p.scale(xv, 25, 17.6, { from: -135, to: 135, ticks: 11, major: 1, len: 1.5, majorLen: 2.4, width: 0.35, labels: ['0', '2', '4', '6', '8', '10'], labelR: 23.6, labelSize: 2.5 });
    p.text('VOLUME', xv - 33, 25, { size: 3.1, weight: 600, spacing: 0.7, align: 'right' });
    p.scale(xs, 25, 12.4, { from: -45, to: 45, ticks: 2, majorLen: 2, labels: ['33', '45'], labelR: 17.2, labelSize: 2.6 });
    p.text('SPEED', xs + 22, 25, { size: 3.1, weight: 600, spacing: 0.7, align: 'left' });
    p.text('START · STOP', xb, 41.5, { size: 2.6, weight: 600, spacing: 0.6 });
    p.text('ARCADIA', pw / 2, 21.5, { size: 6.4, weight: 600, spacing: 3.4, font: 'Michroma' });
    p.text('ST-77  QUARTZ DIRECT DRIVE TURNTABLE', pw / 2, 31.5, { size: 2.5, weight: 500, spacing: 0.9 });
    // Trennlinien
    p.line(150, 10, 150, 40, 0.3);
    p.line(260, 10, 260, 40, 0.3);
    const mat = p.material({}, 0.7);
    const panel = new THREE.Mesh(roundedBox(pw / 1000, ph / 1000, 0.003, mm(1.2), 3), mat);
    const pz = D / 2 + 0.0005;
    panel.position.set(0, FOOT_H + H / 2, pz);
    this.root.add(panel);
    const toX = (x: number) => (x - pw / 2) / 1000;
    const cy = FOOT_H + H / 2;

    // Lautstärke-Knopf
    const vol = makeKnob({ radius: 0.0155, height: 0.017, style: 'aluminum', ridges: 72, skirt: { radius: 0.0175, height: 0.0025 }, indicator: 'notch' });
    vol.group.rotation.x = Math.PI / 2;
    vol.group.position.set(toX(xv), cy, pz + 0.0015);
    this.volumeKnob = vol.spin;
    this.root.add(vol.group);

    // Geschwindigkeitswähler
    const spd = makeKnob({ radius: 0.0105, height: 0.014, style: 'aluminum', ridges: 48, indicator: 'notch' });
    spd.group.rotation.x = Math.PI / 2;
    spd.group.position.set(toX(xs), cy, pz + 0.0015);
    this.speedKnob = spd.spin;
    this.root.add(spd.group);

    // Start/Stop-Taste + LED
    const btn = makeRoundButton({ radius: 0.0072, height: 0.006, material: chrome(), bezel: plastic('#111', { gloss: 0.6 }), bezelRadius: 0.0098 });
    btn.group.rotation.x = Math.PI / 2;
    btn.group.position.set(toX(xb), cy, pz + 0.0015);
    this.startCap = btn.cap;
    this.root.add(btn.group);
    this.ledMat = emissive('#ff2a14', 0);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0018, 16, 12), this.ledMat);
    led.scale.z = 0.6;
    led.position.set(toX(xb), cy + 0.0155, pz + 0.0016);
    const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.0021, 0.0004, 8, 24), chrome());
    ledRing.position.copy(led.position);
    this.root.add(led, ledRing);
  }

  private buildSleeve() {
    const s = 0.314;
    // Kartonhülle mit Cover (unverändert dargestellt)
    this.sleeveArt = new THREE.MeshPhysicalMaterial({ color: '#2a2a2a', roughness: 0.62, normalMap: paperNormal(), normalScale: new THREE.Vector2(0.25, 0.25), sheen: 0.25, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff') });
    const cardEdge = new THREE.MeshPhysicalMaterial({ color: '#d9d2c4', roughness: 0.85, normalMap: paperNormal(), normalScale: new THREE.Vector2(0.4, 0.4) });
    const body = new THREE.Mesh(roundedBox(s, 0.0035, s, mm(0.8), 2), cardEdge);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(s - 0.0016, s - 0.0016).rotateX(-Math.PI / 2), this.sleeveArt);
    top.position.y = 0.00175 + 0.0003; // deutlich über dem Karton (kein Z-Fighting)
    this.sleeve.add(body, top);
    this.sleeve.position.set(-0.44, 0.00175, 0.11);
    this.sleeve.rotation.y = 0.26;
    this.root.add(this.sleeve);
  }

  // ------------------------------------------------------------------ Interaktion

  registerControls() {
    const ia = this.ctx.interaction;
    const sfx = this.ctx.sfx;
    // Tonarm ziehen
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(REC_Y + 0.012));
    const hit = new THREE.Vector3();
    ia.add({
      kind: 'drag',
      object: this.armPitch,
      label: () => (this.lift < 0.5 ? 'Tonarm anheben & verschieben' : 'Tonarm auf die Platte ziehen'),
      onStart: () => {
        this.dragYaw = this.yaw;
        sfx.click();
      },
      onMove: (ray) => {
        if (!ray.intersectPlane(plane, hit)) return;
        const local = hit.clone().sub(new THREE.Vector3(PIVOT.x, 0, PIVOT.z));
        let a = Math.atan2(-local.z, local.x);
        // auf sinnvollen Bereich begrenzen
        const lo = Math.min(this.minYaw, this.restYaw), hi = Math.max(this.minYaw, this.restYaw);
        while (a < lo - Math.PI) a += Math.PI * 2;
        while (a > hi + Math.PI) a -= Math.PI * 2;
        this.dragYaw = THREE.MathUtils.clamp(a, lo, hi + 0.02);
      },
      onEnd: () => {
        const r = this.radiusForYaw(this.dragYaw ?? this.yaw);
        this.dragYaw = null;
        if (r <= REC_R - 0.002 && r >= R_INNER - 0.004) {
          // Nadel absetzen → spielen ab Position
          const pb = this.pb;
          const dur = pb.state.track?.durationMs ?? 0;
          this.autoReturn = false;
          this.pendingPlayUntil = performance.now() + 4000;
          if (dur > 0) pb.seek(this.progressForRadius(r) * dur);
          if (pb.state.paused) pb.play();
        } else {
          // zurück zur Stütze → Pause
          this.autoReturn = true;
          if (!this.pb.state.paused) this.pb.pause();
        }
      },
    });

    // Lautstärke
    ia.add({
      kind: 'knob',
      object: this.volumeKnob,
      label: () => `Lautstärke ${Math.round(this.pb.state.volume * 10 * 10) / 10}`,
      get: () => this.pb.state.volume,
      set: (v) => this.pb.setVolume(v),
      travel: 260,
    });

    // Geschwindigkeit 33/45
    ia.add({
      kind: 'knob',
      object: this.speedKnob,
      label: () => `Geschwindigkeit: ${this.speed} U/min`,
      get: () => (this.speed === 33 ? 0 : 1),
      set: (v) => {
        const s = v > 0.5 ? 45 : 33;
        if (s !== this.speed) {
          this.speed = s;
          sfx.detent();
        }
      },
      steps: 2,
      travel: 60,
    });

    // Start/Stop
    ia.add({
      kind: 'button',
      object: this.startCap.parent!,
      label: 'Start / Stop',
      onPress: () => {
        this.pressT = 1;
        sfx.click();
        const pb = this.pb;
        if (pb.state.paused) {
          this.autoReturn = false;
          this.pendingPlayUntil = performance.now() + 4000;
          pb.play();
        } else {
          this.autoReturn = true;
          pb.pause();
        }
      },
    });

    // Lift-Hebel
    ia.add({
      kind: 'button',
      object: this.cueLever,
      label: () => (this.pb.state.paused ? 'Lift: absenken (Play)' : 'Lift: anheben (Pause)'),
      onPress: () => {
        sfx.click();
        const pb = this.pb;
        if (pb.state.paused) {
          this.autoReturn = false;
          this.pendingPlayUntil = performance.now() + 4000;
          pb.play();
        } else {
          this.autoReturn = false;
          pb.pause();
        }
      },
    });
  }

  // ------------------------------------------------------------------ Laufzeit

  onTrack(track: TrackInfo | null, art: THREE.Texture | null) {
    void track;
    const m = this.record.material;
    m.map = art;
    m.color.set(art ? '#ffffff' : '#0c0c0c');
    m.needsUpdate = true;
    this.sleeveArt.map = art;
    this.sleeveArt.color.set(art ? '#ffffff' : '#2a2a2a');
    this.sleeveArt.needsUpdate = true;
  }

  syncImmediately(f: FrameState) {
    if (f.playing) {
      this.yaw = this.yawForRadius(this.radiusForProgress(f.progress));
      this.lift = 0;
      this.omega = (RPM[this.speed] / 60) * Math.PI * 2;
      this.autoReturn = false;
      this.wasDown = true;
    } else {
      this.yaw = this.restYaw;
      this.lift = 1;
      this.omega = 0;
      this.autoReturn = true;
    }
    this.displayedVolume = f.volume;
  }

  update(f: FrameState) {
    const dt = f.dt;
    const now = performance.now();
    const wantPlay = f.playing || (now < this.pendingPlayUntil && !!f.track);
    if (f.playing) this.pendingPlayUntil = 0;

    // --- Tonarm-Logik
    let yawTarget = this.yaw;
    let liftTarget = this.lift;
    const trackYaw = this.yawForRadius(this.radiusForProgress(f.progress));
    if (this.dragYaw !== null) {
      yawTarget = this.dragYaw;
      liftTarget = 1;
    } else if (wantPlay) {
      this.pausedFor = 0;
      const off = Math.abs(this.yaw - trackYaw);
      if (this.lift < 0.02 && off < 0.03) {
        yawTarget = trackYaw; // spielt: folgt der Rille
        liftTarget = 0;
      } else if (off > 0.004) {
        liftTarget = 1;
        if (this.lift > 0.95) yawTarget = trackYaw;
      } else {
        yawTarget = trackYaw;
        liftTarget = 0;
      }
    } else {
      this.pausedFor += dt;
      liftTarget = 1;
      if (this.autoReturn || this.pausedFor > 90) {
        if (this.lift > 0.95) yawTarget = this.restYaw;
      }
    }
    // Bewegung: geführt (Automatik) gleichmäßig, beim Spielen direkt
    if (this.dragYaw !== null) this.yaw = damp(this.yaw, yawTarget, 22, dt);
    else if (liftTarget === 0 && this.lift < 0.02) this.yaw = yawTarget;
    else {
      const maxStep = 0.9 * dt;
      this.yaw += THREE.MathUtils.clamp(yawTarget - this.yaw, -maxStep, maxStep);
    }
    // Lift: abwärts gedämpft (Silikon), aufwärts schnell
    if (liftTarget < this.lift) this.lift = Math.max(liftTarget, this.lift - dt * 0.9);
    else this.lift = Math.min(liftTarget, this.lift + dt * 3.5);

    const down = this.lift < 0.001;
    if (down && !this.wasDown) {
      this.ctx.sfx.needleDrop();
    }
    this.wasDown = down;
    this.ctx.sfx.crackle(down && f.playing);

    this.armYaw.rotation.y = this.yaw;
    // Nadel liegt etwas tiefer als die Ruhe-Höhe (Auflagekraft); bei Lift → Cue-Höhe
    const ease = this.lift * this.lift * (3 - 2 * this.lift);
    this.armPitch.rotation.z = LIFT_ANGLE * ease;
    // leichte Rillenschwingung beim Abspielen
    if (down && f.playing) this.armPitch.rotation.x = Math.sin(f.time * ((RPM[this.speed] / 60) * Math.PI * 2)) * 0.0012;
    else this.armPitch.rotation.x = 0;

    // Lift-Hebel-Stellung
    const cuePivot = this.cueLever.userData.pivot as THREE.Group;
    cuePivot.rotation.z = damp(cuePivot.rotation.z, liftTarget > 0.5 ? 0.35 : 0, 10, dt);

    // --- Plattenteller: Motor an, solange gespielt wird oder der Arm zur Platte fährt
    const motor = wantPlay || this.dragYaw !== null && this.radiusForYaw(this.dragYaw) < REC_R;
    const omegaTarget = motor ? (RPM[this.speed] / 60) * Math.PI * 2 : 0;
    this.omega = damp(this.omega, omegaTarget, motor ? 2.4 : 1.1, dt);
    this.platter.rotation.y -= this.omega * dt;
    this.ledMat.emissiveIntensity = motor ? 16 : 0;
    this.strobeMat.emissiveIntensity = motor ? 10 : 0;

    // --- Knöpfe
    this.displayedVolume = damp(this.displayedVolume, f.volume, 18, dt);
    this.volumeKnob.rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * this.displayedVolume);
    const spdAngle = this.speed === 33 ? -45 : 45;
    this.speedKnob.rotation.y = damp(this.speedKnob.rotation.y, -THREE.MathUtils.degToRad(spdAngle), 20, dt);
    this.pressT = Math.max(0, this.pressT - dt * 6);
    this.startCap.position.y = -0.0018 * Math.sin(Math.min(1, this.pressT) * Math.PI);
  }
}
