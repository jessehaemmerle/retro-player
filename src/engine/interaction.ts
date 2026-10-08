/**
 * Interaktion mit den 3D-Bedienelementen: Tasten, Drehknöpfe und frei ziehbare
 * Teile (z. B. Tonarm). Greift vor den OrbitControls zu, damit Ziehen an einem
 * Bedienelement nicht gleichzeitig die Kamera dreht.
 */
import * as THREE from 'three';
import type { Stage } from './stage';

interface Base {
  object: THREE.Object3D;
  label?: string | (() => string);
  enabled?: () => boolean;
}

export interface ButtonControl extends Base {
  kind: 'button';
  onPress: () => void;
  onRelease?: () => void;
}

export interface KnobControl extends Base {
  kind: 'knob';
  get: () => number; // 0..1
  set: (v: number) => void;
  /** Pixel Mausweg für den vollen Bereich */
  travel?: number;
  /** Schritte (z. B. Wahlschalter); 0 = stufenlos */
  steps?: number;
  /** Bei Rasterschaltern ohne Endanschlag umlaufen */
  wrap?: boolean;
  /** Ziehrichtung: vertikal (Standard) oder horizontal (Rändelrad seitlich) */
  axis?: 'vertical' | 'horizontal' | 'both';
  onEnd?: () => void;
}

export interface DragControl extends Base {
  kind: 'drag';
  onStart: (hit: THREE.Intersection, ray: THREE.Ray) => void;
  onMove: (ray: THREE.Ray, e: PointerEvent) => void;
  onEnd: () => void;
}

export type Control = ButtonControl | KnobControl | DragControl;

export class Interaction {
  private controls: Control[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private active: { control: Control; startX: number; startY: number; startValue: number; pointerId: number } | null = null;
  private hovered: Control | null = null;
  private hoverQueued = false;
  private lastMove: PointerEvent | null = null;
  private tooltip: HTMLElement;
  private canvas: HTMLCanvasElement;

  constructor(
    private stage: Stage,
    private surface: HTMLElement,
    tooltip: HTMLElement,
  ) {
    this.canvas = stage.renderer.domElement;
    this.tooltip = tooltip;
    // Capture-Phase auf dem Container → läuft vor den OrbitControls auf dem Canvas
    surface.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    surface.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    surface.addEventListener('pointerleave', () => this.setHover(null));
  }

  add(c: Control): Control {
    this.controls.push(c);
    c.object.userData.control = c;
    return c;
  }

  clear() {
    this.controls = [];
    this.active = null;
    this.setHover(null);
  }

  private raycast(e: { clientX: number; clientY: number }): { control: Control; hit: THREE.Intersection } | null {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    const active = new Set(this.controls.filter((c) => c.object.visible && (c.enabled?.() ?? true)));
    if (!active.size) return null;
    // Auch verdeckende Gerätegeometrie testen, damit man nicht "durch" Teile greift
    const hits = this.raycaster.intersectObjects([this.stage.deviceRoot], true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      if (o.userData.noPick) continue;
      // Das spezifischste (tiefste) aktive Bedienelement gewinnt
      while (o) {
        const c = o.userData.control as Control | undefined;
        if (c && active.has(c)) return { control: c, hit };
        o = o.parent;
      }
      // erster Treffer ist kein Bedienelement → Glas o. Ä. darf durchlassen
      if (!(hit.object.userData.passThrough ?? false)) return null;
    }
    return null;
  }

  ray(e: { clientX: number; clientY: number }): THREE.Ray {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    return this.raycaster.ray.clone();
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.stage.markInteraction();
    const r = this.raycast(e);
    if (!r) return;
    e.stopPropagation();
    e.preventDefault();
    this.stage.controls.enabled = false;
    const c = r.control;
    this.active = { control: c, startX: e.clientX, startY: e.clientY, startValue: c.kind === 'knob' ? c.get() : 0, pointerId: e.pointerId };
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (c.kind === 'button') c.onPress();
    if (c.kind === 'drag') c.onStart(r.hit, this.raycaster.ray.clone());
    this.surface.style.cursor = c.kind === 'button' ? 'pointer' : 'grabbing';
  };

  private onMove = (e: PointerEvent) => {
    const a = this.active;
    if (a && e.pointerId === a.pointerId) {
      this.stage.markInteraction();
      const c = a.control;
      if (c.kind === 'knob') {
        const travel = c.travel ?? 220;
        const dx = e.clientX - a.startX;
        const dy = a.startY - e.clientY;
        const axis = c.axis ?? 'both';
        const d = axis === 'vertical' ? dy : axis === 'horizontal' ? dx : Math.abs(dx) > Math.abs(dy) ? dx : dy;
        let v = a.startValue + d / travel;
        if (c.steps) {
          v = Math.round(v * (c.steps - 1)) / (c.steps - 1);
        }
        if (c.wrap) v = ((v % 1) + 1) % 1;
        else v = Math.max(0, Math.min(1, v));
        if (v !== c.get()) c.set(v);
      } else if (c.kind === 'drag') {
        c.onMove(this.ray(e), e);
      }
      this.showTooltip(c, e);
      return;
    }
    if (e.target !== this.canvas) {
      if (this.hovered) this.setHover(null);
      return;
    }
    this.lastMove = e;
    if (!this.hoverQueued) {
      this.hoverQueued = true;
      requestAnimationFrame(() => {
        this.hoverQueued = false;
        if (this.lastMove && !this.active) {
          const r = this.raycast(this.lastMove);
          this.setHover(r?.control ?? null, this.lastMove);
        }
      });
    }
  };

  private onUp = (e: PointerEvent) => {
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    const c = a.control;
    if (c.kind === 'button') c.onRelease?.();
    if (c.kind === 'drag') c.onEnd();
    if (c.kind === 'knob') c.onEnd?.();
    this.active = null;
    this.stage.controls.enabled = true;
    this.surface.style.cursor = '';
    this.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    const r = this.raycast(e);
    if (!r || r.control.kind !== 'knob') return;
    e.preventDefault();
    e.stopPropagation();
    const c = r.control;
    const step = c.steps ? 1 / (c.steps - 1) : 0.03;
    let v = c.get() + (e.deltaY < 0 ? step : -step);
    if (c.wrap) v = ((v % 1) + 1) % 1;
    else v = Math.max(0, Math.min(1, v));
    c.set(v);
    c.onEnd?.();
    this.showTooltip(c, e);
  };

  private setHover(c: Control | null, e?: { clientX: number; clientY: number }) {
    this.hovered = c;
    if (!this.active) this.surface.style.cursor = c ? (c.kind === 'button' ? 'pointer' : 'grab') : '';
    if (c && e) this.showTooltip(c, e);
    else this.tooltip.classList.remove('visible');
  }

  private showTooltip(c: Control, e: { clientX: number; clientY: number }) {
    const label = typeof c.label === 'function' ? c.label() : c.label;
    if (!label) {
      this.tooltip.classList.remove('visible');
      return;
    }
    this.tooltip.textContent = label;
    this.tooltip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`;
    this.tooltip.classList.add('visible');
  }

  get isDragging() {
    return !!this.active;
  }
}
