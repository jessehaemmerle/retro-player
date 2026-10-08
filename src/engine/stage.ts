/**
 * Stage: Renderer, Kamera, Beleuchtung (HDRI + Schlüssellicht), Untergrund mit
 * fotografischer Tiefenunschärfe, Kontaktschatten und Postprocessing
 * (GTAO, Bloom, Vignette/Körnung). Physikalisch basiert, Einheiten in Metern.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ContactShadow } from './contactShadow';
import { setMaxAnisotropy } from './textures';
import { applyShaderPatches } from './shaderPatches';

export type Quality = 'high' | 'medium' | 'low';

export type SurfaceName = 'oaktable' | 'walnut' | 'concrete' | 'denim' | 'leather' | 'darkwood';

export interface SceneSpec {
  hdri: string; // Datei in assets/hdri (ohne Endung)
  envIntensity: number;
  envRotation: number; // Grad
  background: string;
  bgBlur: number;
  bgIntensity: number;
  bgRotation: number;
  exposure: number;
  ground: {
    surface: SurfaceName;
    size: number; // Kantenlänge der Textur-Kachel in m
    tint?: string;
    roughness?: number;
    normalScale?: number;
    rotation?: number;
    fade: [number, number]; // Radius: Beginn/Ende der Ausblendung
    blur: [number, number]; // Radius: Beginn/Ende der Unschärfe
    clearcoat?: number;
  };
  key: {
    position: [number, number, number];
    intensity: number;
    color?: string;
    softness?: number; // Schattenweichheit
    area: number; // halbe Breite der Schattenkamera
  };
  fill?: { position: [number, number, number]; intensity: number; color?: string };
  camera: {
    fov: number;
    target: [number, number, number];
    azimuth: number; // Grad, 0 = von vorne (+z)
    polar: number; // Grad vom Zenit
    frame: [number, number]; // sichtbare Breite/Höhe in m
    azimuthRange: number; // ± Grad
    polarRange: [number, number];
    zoom: [number, number]; // min/max Faktor relativ zur Fit-Distanz
  };
  contactShadow: { width: number; depth: number; height: number; blur?: number; darkness?: number; opacity?: number };
  bloom?: { strength: number; radius: number; threshold: number };
}

const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    vignette: { value: 0.28 },
    grain: { value: 0.022 },
    ca: { value: 0.0025 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, vignette, grain, ca;
    uniform vec2 resolution;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * ca * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      vec2 asp = d * vec2(resolution.x / resolution.y, 1.0);
      float v = smoothstep(1.05, 0.25, length(asp));
      col *= mix(1.0 - vignette, 1.0, v);
      // Filmkorn, luminanzabhängig (in Schatten stärker)
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      float n = hash(vUv * resolution + fract(time) * 917.0) - 0.5;
      col += n * grain * (1.2 - l);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Gerätecontainer – nur dieser wirft Kontaktschatten */
  readonly deviceRoot = new THREE.Group();
  /** Umgebungscontainer (Boden, Kontaktschatten) */
  readonly envRoot = new THREE.Group();
  readonly key = new THREE.DirectionalLight(0xffffff, 2);
  readonly fill = new THREE.DirectionalLight(0xffffff, 0);

  private composer!: EffectComposer;
  private renderPass!: RenderPass;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private lens!: ShaderPass;
  private hdrLoader = new HDRLoader();
  private texLoader = new THREE.TextureLoader();
  private hdrCache = new Map<string, Promise<THREE.DataTexture>>();
  private texCache = new Map<string, Promise<THREE.Texture>>();
  private ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial> | null = null;
  private contact: ContactShadow | null = null;
  private spec: SceneSpec | null = null;
  private fitDistance = 1;
  private timer = new THREE.Timer();
  private frameCallbacks = new Set<(dt: number, t: number) => void>();
  private quality: Quality;
  private camAnim: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
  private lastInteraction = performance.now();
  private resizeObs: ResizeObserver;

  constructor(
    readonly container: HTMLElement,
    quality: Quality,
  ) {
    this.quality = quality;
    applyShaderPatches();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x0b0a09, 1);
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    container.appendChild(r.domElement);
    r.domElement.classList.add('stage-canvas');

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.02, 20);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.6;
    this.controls.addEventListener('start', () => {
      this.camAnim = null;
      this.lastInteraction = performance.now();
    });
    this.controls.addEventListener('change', () => (this.lastInteraction = performance.now()));

    this.scene.add(this.deviceRoot, this.envRoot);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00015;
    this.key.shadow.normalBias = 0.0006;
    this.scene.add(this.key, this.key.target, this.fill, this.fill.target);

    this.setupComposer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    r.setAnimationLoop((time) => this.frame(time));
  }

  // ---------------------------------------------------------------- Laden

  loadHdr(name: string): Promise<THREE.DataTexture> {
    let p = this.hdrCache.get(name);
    if (!p) {
      p = this.hdrLoader.loadAsync(`${import.meta.env.BASE_URL}assets/hdri/${name}.hdr`).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        return t;
      });
      this.hdrCache.set(name, p);
    }
    return p;
  }

  loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
    const key = `${url}|${srgb}`;
    let p = this.texCache.get(key);
    if (!p) {
      p = this.texLoader.loadAsync(url).then((t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        return t;
      });
      this.texCache.set(key, p);
    }
    return p;
  }

  /** Lädt einen Poly-Haven-Texturensatz (Farbe, Normal, Rauheit). */
  async loadSurface(name: SurfaceName) {
    const base = `${import.meta.env.BASE_URL}assets/textures/${name}`;
    const [map, normal, rough] = await Promise.all([
      this.loadTexture(`${base}_diff.webp`, true),
      this.loadTexture(`${base}_nor.webp`, false),
      this.loadTexture(`${base}_rough.webp`, false),
    ]);
    return { map, normal, rough };
  }

  // ---------------------------------------------------------------- Szene

  async applyScene(spec: SceneSpec): Promise<void> {
    // Debug-Overrides per URL (z. B. ?envrot=90&envint=0.8&exposure=1.1)
    const q = new URLSearchParams(location.search);
    if (q.has('envrot') || q.has('envint') || q.has('exposure') || q.has('bgrot')) {
      spec = { ...spec };
      if (q.has('envrot')) spec.envRotation = Number(q.get('envrot'));
      if (q.has('envint')) spec.envIntensity = Number(q.get('envint'));
      if (q.has('exposure')) spec.exposure = Number(q.get('exposure'));
      if (q.has('bgrot')) spec.bgRotation = Number(q.get('bgrot'));
    }
    this.spec = spec;
    const [env, bg, surface] = await Promise.all([this.loadHdr(spec.hdri), this.loadHdr(spec.background), this.loadSurface(spec.ground.surface)]);
    const s = this.scene;
    s.environment = env;
    s.environmentIntensity = spec.envIntensity;
    s.environmentRotation.set(0, THREE.MathUtils.degToRad(spec.envRotation), 0);
    s.background = bg;
    s.backgroundBlurriness = spec.bgBlur;
    s.backgroundIntensity = spec.bgIntensity;
    s.backgroundRotation.set(0, THREE.MathUtils.degToRad(spec.bgRotation), 0);
    this.renderer.toneMappingExposure = spec.exposure;

    // Schlüssellicht
    const k = spec.key;
    this.key.position.set(...k.position);
    this.key.intensity = k.intensity;
    this.key.color.set(k.color ?? '#ffffff');
    this.key.shadow.radius = k.softness ?? 6;
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -k.area;
    sc.right = sc.top = k.area;
    sc.near = 0.05;
    sc.far = 10;
    sc.updateProjectionMatrix();
    this.key.target.position.set(0, 0, 0);
    if (spec.fill) {
      this.fill.position.set(...spec.fill.position);
      this.fill.intensity = spec.fill.intensity;
      this.fill.color.set(spec.fill.color ?? '#ffffff');
    } else this.fill.intensity = 0;

    this.buildGround(spec, surface);
    if (this.bloom && spec.bloom) {
      this.bloom.strength = spec.bloom.strength;
      this.bloom.radius = spec.bloom.radius;
      this.bloom.threshold = spec.bloom.threshold;
    } else if (this.bloom) {
      this.bloom.strength = 0.14;
      this.bloom.radius = 0.18;
      this.bloom.threshold = 6;
    }
    this.configureCamera(true);
  }

  private buildGround(spec: SceneSpec, tex: { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }) {
    if (this.ground) {
      this.envRoot.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
    }
    const g = spec.ground;
    const extent = g.fade[1] * 2.2;
    const geo = new THREE.PlaneGeometry(extent, extent).rotateX(-Math.PI / 2);
    const rep = extent / g.size;
    const prep = (t: THREE.Texture) => {
      const c = t.clone();
      c.repeat.set(rep, rep);
      c.rotation = THREE.MathUtils.degToRad(g.rotation ?? 0);
      c.needsUpdate = true;
      return c;
    };
    const mat = new THREE.MeshPhysicalMaterial({
      map: prep(tex.map),
      normalMap: prep(tex.normal),
      roughnessMap: prep(tex.rough),
      roughness: g.roughness ?? 1,
      normalScale: new THREE.Vector2(g.normalScale ?? 1, g.normalScale ?? 1),
      color: new THREE.Color(g.tint ?? '#ffffff'),
      clearcoat: g.clearcoat ?? 0,
      clearcoatRoughness: 0.35,
      transparent: true,
      depthWrite: true,
    });
    const uni = {
      gFade: { value: new THREE.Vector2(...g.fade) },
      gBlur: { value: new THREE.Vector2(...g.blur) },
      gCenter: { value: new THREE.Vector2(spec.camera.target[0], spec.camera.target[2]) },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vGroundWorld;\nuniform vec2 gFade;\nuniform vec2 gBlur;\nuniform vec2 gCenter;\nfloat gDist; float gBias;',
        )
        .replace(
          '#include <map_fragment>',
          `gDist = length(vGroundWorld.xz - gCenter);
           gBias = smoothstep(gBlur.x, gBlur.y, gDist) * 5.0;
           #ifdef USE_MAP
             diffuseColor *= texture2D( map, vMapUv, gBias );
           #endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
           #ifdef USE_ROUGHNESSMAP
             roughnessFactor *= texture2D( roughnessMap, vRoughnessMapUv, gBias ).g;
           #endif`,
        )
        .replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 mapN = texture2D( normalMap, vNormalMapUv, gBias ).xyz * 2.0 - 1.0;\nmapN.xy *= 1.0 - smoothstep(gBlur.x, gBlur.y, gDist);',
        )
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(gFade.x, gFade.y, gDist);',
        );
    };
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.renderOrder = -1;
    ground.userData.forceAO = true;
    ground.position.set(spec.camera.target[0], 0, spec.camera.target[2]);
    this.ground = ground;
    this.envRoot.add(ground);
  }

  /** Kontaktschatten für das aktuelle Gerät neu berechnen. */
  updateContactShadow() {
    if (!this.spec) return;
    const cs = this.spec.contactShadow;
    this.contact?.dispose();
    if (this.contact) this.envRoot.remove(this.contact.group);
    this.contact = new ContactShadow(cs.width, cs.depth, cs.height, cs.blur ?? 2.5, cs.darkness ?? 1.4, cs.opacity ?? 0.9);
    this.contact.group.position.y = 0.0004;
    this.envRoot.add(this.contact.group);
    this.contact.update(this.renderer, this.scene, [this.envRoot, ...this.scene.children.filter((c) => c !== this.deviceRoot && c !== this.envRoot)]);
  }

  // ---------------------------------------------------------------- Kamera

  private cameraDirection(spec: SceneSpec['camera']): THREE.Vector3 {
    const az = THREE.MathUtils.degToRad(spec.azimuth);
    const po = THREE.MathUtils.degToRad(spec.polar);
    return new THREE.Vector3(Math.sin(po) * Math.sin(az), Math.cos(po), Math.sin(po) * Math.cos(az));
  }

  private computeFit(): number {
    if (!this.spec) return 1;
    const c = this.spec.camera;
    const vfov = THREE.MathUtils.degToRad(c.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dv = c.frame[1] / 2 / Math.tan(vfov / 2);
    const dh = c.frame[0] / 2 / Math.tan(hfov / 2);
    return Math.max(dv, dh);
  }

  configureCamera(reset: boolean) {
    if (!this.spec) return;
    const c = this.spec.camera;
    this.camera.fov = c.fov;
    this.camera.updateProjectionMatrix();
    this.fitDistance = this.computeFit();
    const ctl = this.controls;
    ctl.target.set(...c.target);
    ctl.minDistance = this.fitDistance * c.zoom[0];
    ctl.maxDistance = this.fitDistance * c.zoom[1];
    const az = THREE.MathUtils.degToRad(c.azimuth);
    const range = THREE.MathUtils.degToRad(c.azimuthRange);
    ctl.minAzimuthAngle = az - range;
    ctl.maxAzimuthAngle = az + range;
    ctl.minPolarAngle = THREE.MathUtils.degToRad(c.polarRange[0]);
    ctl.maxPolarAngle = THREE.MathUtils.degToRad(c.polarRange[1]);
    if (reset) {
      this.camera.position.copy(ctl.target).addScaledVector(this.cameraDirection(c), this.fitDistance);
      this.camAnim = null;
    }
    ctl.update();
  }

  /** Sanfte Rückkehr zur Ausgangsperspektive. */
  resetView() {
    if (!this.spec) return;
    this.lastInteraction = performance.now();
    const to = this.controls.target.clone().addScaledVector(this.cameraDirection(this.spec.camera), this.fitDistance);
    this.camAnim = { from: this.camera.position.clone(), to, t: 0 };
  }

  // ---------------------------------------------------------------- Rendering

  private setupComposer() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (this.quality === 'high') {
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.updateGtaoMaterial({ radius: 0.035, distanceExponent: 1.4, thickness: 0.02, scale: 1.0, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      gtao.blendIntensity = 0.85;
      // Glas, Displays & Kontaktschatten nicht in die AO einbeziehen
      const g = gtao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[]; scene: THREE.Scene };
      g._overrideVisibility = function () {
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          const skip =
            !o.userData.forceAO &&
            (o.userData.noAO ||
            (o as THREE.Points).isPoints ||
            (o as THREE.Line).isLine ||
            (m && (m.transparent || (m as THREE.MeshPhysicalMaterial).transmission > 0)));
          if (skip && o.visible) {
            o.visible = false;
            this._visibilityCache.push(o);
          }
        });
      };
      this.gtao = gtao;
      this.composer.addPass(gtao);
    }
    if (this.quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.18, 6);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.lens = new ShaderPass(LensShader);
    if (this.quality === 'low') this.lens.uniforms.grain.value = 0.012;
    this.composer.addPass(this.lens);
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.composer.dispose();
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.gtao = null;
    this.bloom = null;
    this.setupComposer();
    this.resize();
    if (this.spec?.bloom && this.bloom) {
      const b = this.bloom as UnrealBloomPass;
      b.strength = this.spec.bloom.strength;
      b.radius = this.spec.bloom.radius;
      b.threshold = this.spec.bloom.threshold;
    }
  }

  private resize() {
    this.lastInteraction = performance.now();
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dprCap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.lens.uniforms.resolution.value.set(w * dpr, h * dpr);
    if (this.spec) {
      // Abstand an neues Seitenverhältnis anpassen, Blickrichtung behalten
      const old = this.fitDistance;
      this.configureCamera(false);
      const dir = this.camera.position.clone().sub(this.controls.target);
      dir.multiplyScalar(this.fitDistance / old);
      this.camera.position.copy(this.controls.target).add(dir);
      this.controls.update();
    }
  }

  onFrame(fn: (dt: number, t: number) => void): () => void {
    this.frameCallbacks.add(fn);
    return () => this.frameCallbacks.delete(fn);
  }

  markInteraction() {
    this.lastInteraction = performance.now();
  }

  /** Gleitender Mittelwert der Bildzeit in ms (für automatische Qualitätsanpassung). */
  frameMs = 16;
  /** Wenn true, darf bei Stillstand seltener gerendert werden (Energiesparen). */
  allowThrottle = false;
  private skipped = 0;
  private prevRendered = false;

  private frame(time?: number) {
    this.timer.update(time);
    const raw = this.timer.getDelta();
    // Bildzeit nur messen, wenn das vorige Bild tatsächlich gerendert wurde
    if (this.prevRendered && raw > 0 && raw < 0.5) this.frameMs += (raw * 1000 - this.frameMs) * 0.05;
    // Energiesparen: bei Stillstand nur ~2 Bilder pro Sekunde rendern
    if (this.allowThrottle && this.idleMs > 5000 && !this.camAnim && this.skipped < 30) {
      this.skipped++;
      this.prevRendered = false;
      return;
    }
    this.skipped = 0;
    this.prevRendered = true;
    const dt = Math.min(raw, 0.1);
    const t = this.timer.getElapsed();
    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dt / 0.9);
      const e = 1 - Math.pow(1 - a.t, 3);
      this.camera.position.lerpVectors(a.from, a.to, e);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update(dt);
    for (const fn of this.frameCallbacks) fn(dt, t);
    this.lens.uniforms.time.value = t;
    this.composer.render(dt);
  }

  get idleMs() {
    return performance.now() - this.lastInteraction;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
