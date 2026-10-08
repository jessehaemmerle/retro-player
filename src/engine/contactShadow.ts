/**
 * Kontaktschatten wie in der Produktfotografie: Tiefenbild von unten,
 * zweifach weichgezeichnet (nach dem three.js-Beispiel "webgl_shadow_contact").
 * Wird einmalig pro Gerät gerendert.
 */
import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';

export class ContactShadow {
  readonly group = new THREE.Group();
  private rt: THREE.WebGLRenderTarget;
  private rtBlur: THREE.WebGLRenderTarget;
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private blurPlane: THREE.Mesh;
  private cam: THREE.OrthographicCamera;
  private depthMat: THREE.MeshDepthMaterial;
  private hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
  private vBlur = new THREE.ShaderMaterial(VerticalBlurShader);

  constructor(
    width: number,
    depth: number,
    private height: number,
    private blur = 2.5,
    darkness = 1.4,
    opacity = 0.9,
    res = 512,
  ) {
    const aspect = width / depth;
    const rw = aspect >= 1 ? res : Math.round(res * aspect);
    const rh = aspect >= 1 ? Math.round(res / aspect) : res;
    this.rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType });
    this.rt.texture.generateMipmaps = false;
    this.rtBlur = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType });
    this.rtBlur.texture.generateMipmaps = false;

    const geo = new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2);
    this.plane = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, opacity, depthWrite: false, color: 0x000000 }),
    );
    this.plane.material.map!.colorSpace = THREE.NoColorSpace;
    // Nur Alpha zählt – Farbe kommt aus color (schwarz) × map
    this.plane.material.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <map_fragment>',
        '#ifdef USE_MAP\n diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif',
      );
    };
    this.plane.renderOrder = 1;
    this.plane.scale.y = -1;
    this.plane.userData.noAO = true;
    this.group.add(this.plane);

    this.blurPlane = new THREE.Mesh(geo);
    this.blurPlane.visible = false;
    this.group.add(this.blurPlane);

    this.cam = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, height);
    this.cam.rotation.x = Math.PI / 2;
    this.group.add(this.cam);

    this.depthMat = new THREE.MeshDepthMaterial();
    const dark = { value: darkness };
    this.depthMat.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = dark;
      shader.fragmentShader =
        'uniform float darkness;\n' +
        shader.fragmentShader.replace(
          'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
          'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.6 ) * darkness );',
        );
    };
    this.depthMat.depthTest = false;
    this.depthMat.depthWrite = false;
    this.hBlur.depthTest = false;
    this.vBlur.depthTest = false;
  }

  private blurPass(renderer: THREE.WebGLRenderer, amount: number) {
    this.blurPlane.visible = true;
    this.blurPlane.material = this.hBlur;
    this.hBlur.uniforms.tDiffuse.value = this.rt.texture;
    this.hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(this.rtBlur);
    renderer.render(this.blurPlane, this.cam);
    this.blurPlane.material = this.vBlur;
    this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture;
    this.vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(this.rt);
    renderer.render(this.blurPlane, this.cam);
    this.blurPlane.visible = false;
  }

  /** Rendert den Schatten von `subject` (alle anderen Objekte werden ausgeblendet). */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, hide: THREE.Object3D[]) {
    const bg = scene.background;
    const prevVis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.plane.visible = false;
    scene.background = null;
    scene.overrideMaterial = this.depthMat;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    const prevTarget = renderer.getRenderTarget();
    this.cam.far = this.height;
    this.cam.updateProjectionMatrix();
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, this.cam);
    scene.overrideMaterial = null;
    this.blurPass(renderer, this.blur);
    this.blurPass(renderer, this.blur * 0.4);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.background = bg;
    hide.forEach((o, i) => (o.visible = prevVis[i]));
    this.plane.visible = true;
  }

  dispose() {
    this.rt.dispose();
    this.rtBlur.dispose();
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.depthMat.dispose();
    this.hBlur.dispose();
    this.vBlur.dispose();
  }
}
