import * as THREE from 'three';
import type { Stage, SceneSpec } from '../engine/stage';
import type { Interaction } from '../engine/interaction';
import type { AudioSim } from '../engine/audioSim';
import type { Sfx } from '../engine/sfx';
import type { PlaybackController, TrackInfo } from '../playback/types';

export interface FrameState {
  dt: number;
  time: number;
  /** Musik läuft (nicht pausiert und ein Titel ist geladen) */
  playing: boolean;
  positionMs: number;
  durationMs: number;
  progress: number; // 0..1
  volume: number; // 0..1
  track: TrackInfo | null;
  audio: AudioSim;
}

export interface DesignContext {
  stage: Stage;
  interaction: Interaction;
  sfx: Sfx;
  playback: () => PlaybackController;
}

export abstract class Design {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly scene: SceneSpec;
  readonly root = new THREE.Group();
  protected ctx!: DesignContext;
  private built = false;

  async mount(ctx: DesignContext): Promise<void> {
    this.ctx = ctx;
    if (!this.built) {
      await this.build();
      this.built = true;
    }
  }

  protected get pb(): PlaybackController {
    return this.ctx.playback();
  }

  /** Geometrie & Materialien erzeugen (einmalig). */
  protected abstract build(): Promise<void>;

  /** Bedienelemente bei der Interaktion registrieren (bei jedem Aktivieren). */
  abstract registerControls(): void;

  /** Pro Frame aufgerufen. */
  abstract update(f: FrameState): void;

  /** Neuer Titel inkl. Cover-Textur (oder null). */
  onTrack(_track: TrackInfo | null, _art: THREE.Texture | null): void {}

  /** Zustand nach Wechsel auf dieses Gerät sofort übernehmen (ohne Animation). */
  syncImmediately(_f: FrameState): void {}
}

/** Kritisch gedämpfte Annäherung (framerate-unabhängig). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Feder-Masse-System für Zeiger (VU-Meter) mit Überschwingen. */
export class Needle {
  value = 0;
  private vel = 0;
  constructor(
    private stiffness = 120,
    private damping = 14,
  ) {}
  update(target: number, dt: number) {
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.stiffness * (target - this.value) - this.damping * this.vel;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

export function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
