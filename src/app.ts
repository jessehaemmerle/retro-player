import * as THREE from 'three';
import { Stage, type Quality } from './engine/stage';
import { Interaction } from './engine/interaction';
import { Sfx } from './engine/sfx';
import { AudioSim } from './engine/audioSim';
import { loadFonts } from './engine/fonts';
import type { Design, DesignContext, FrameState } from './designs/base';
import { DESIGNS, type DesignEntry } from './designs/registry';
import { DemoController } from './playback/demoController';
import { SpotifyController } from './playback/spotifyController';
import type { PlaybackController, TrackInfo } from './playback/types';
import { handleRedirect, isLoggedIn, getClientId } from './spotify/auth';
import { Emitter } from './util/emitter';

export interface AppEvents extends Record<string, unknown> {
  design: string;
  playback: PlaybackController;
  loading: boolean;
  toast: { text: string; kind: 'info' | 'error' };
}

const LS_DESIGN = 'rp.design';
const LS_QUALITY = 'rp.quality';
const LS_SFX = 'rp.sfx';

export class App {
  readonly events = new Emitter<AppEvents>();
  stage!: Stage;
  interaction!: Interaction;
  readonly sfx = new Sfx();
  readonly audio = new AudioSim();
  playback: PlaybackController;
  private designs = new Map<string, Design>();
  current: Design | null = null;
  currentId = '';
  private art: THREE.Texture | null = null;
  private artFor = '';
  private switching: Promise<void> = Promise.resolve();
  private unsubs: Array<() => void> = [];
  quality: Quality;

  constructor(
    private stageEl: HTMLElement,
    private tooltipEl: HTMLElement,
    private fadeEl: HTMLElement,
  ) {
    const params = new URLSearchParams(location.search);
    const q = (params.get('quality') ?? localStorage.getItem(LS_QUALITY)) as Quality | null;
    this.quality = q ?? (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high');
    this.sfx.enabled = localStorage.getItem(LS_SFX) !== 'off';
    this.playback = new DemoController();
  }

  async start(): Promise<void> {
    this.events.emit('loading', true);
    await loadFonts();
    // Demo-Cover brauchen die Schriften → nach dem Laden neu erzeugen
    this.playback.dispose();
    this.playback = new DemoController();

    this.stage = new Stage(this.stageEl, this.quality);
    this.interaction = new Interaction(this.stage, this.stageEl, this.tooltipEl);
    this.stage.onFrame((dt, t) => this.frame(dt, t));
    this.stageEl.addEventListener('dblclick', (e) => {
      if (!this.interaction.isDragging && e.target === this.stage.renderer.domElement) this.stage.resetView();
    });
    // Audio & SDK müssen in einer Nutzergeste aktiviert werden
    const unlock = () => {
      this.sfx.unlock();
      this.playback.activate();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    // Rückkehr vom Spotify-Login
    try {
      if (await handleRedirect()) this.toast('Erfolgreich bei Spotify angemeldet.');
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
    const params = new URLSearchParams(location.search);
    if (isLoggedIn() && getClientId() && !params.has('demo')) await this.useSpotify();
    else this.bindPlayback();

    const initial = params.get('design') ?? localStorage.getItem(LS_DESIGN) ?? DESIGNS[0].id;
    await this.switchDesign(DESIGNS.some((d) => d.id === initial) ? initial : DESIGNS[0].id, true);
    if (params.has('autoplay')) this.playback.play();
    this.events.emit('loading', false);
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    this.events.emit('toast', { text, kind });
  }

  async useSpotify() {
    const sp = new SpotifyController();
    this.playback.dispose();
    this.playback = sp;
    this.bindPlayback();
    // Nicht blockieren: Das SDK lädt im Hintergrund, die Geräte erscheinen sofort
    sp.init().catch((e) => this.toast(`Spotify: ${(e as Error).message}`, 'error'));
  }

  useDemo() {
    this.playback.dispose();
    this.playback = new DemoController();
    this.bindPlayback();
  }

  private bindPlayback() {
    this.unsubs.forEach((u) => u());
    const pb = this.playback;
    this.unsubs = [
      pb.events.on('track', (t) => this.onTrack(t)),
      pb.events.on('state', () => this.stage?.markInteraction()),
      pb.events.on('error', (m) => this.toast(m, 'error')),
      pb.events.on('notice', (m) => this.toast(m)),
    ];
    this.onTrack(pb.state.track);
    this.events.emit('playback', pb);
  }

  private async onTrack(track: TrackInfo | null) {
    this.audio.setTrack(track?.id ?? null);
    const url = track?.artUrl ?? null;
    if (url !== this.artFor) {
      this.artFor = url ?? '';
      if (url) {
        try {
          const tex = await this.stage.loadTexture(url, true);
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          if (this.artFor !== url) return;
          this.art = tex;
        } catch {
          this.art = null;
        }
      } else this.art = null;
    }
    this.current?.onTrack(track, this.art);
  }

  get designList(): DesignEntry[] {
    return DESIGNS;
  }

  private context(): DesignContext {
    return { stage: this.stage, interaction: this.interaction, sfx: this.sfx, playback: () => this.playback };
  }

  switchDesign(id: string, initial = false): Promise<void> {
    this.switching = this.switching.then(() => this.doSwitch(id, initial));
    return this.switching;
  }

  private async doSwitch(id: string, initial: boolean) {
    if (id === this.currentId) return;
    const entry = DESIGNS.find((d) => d.id === id);
    if (!entry) return;
    this.events.emit('loading', true);
    if (!initial) {
      this.fadeEl.classList.add('visible');
      await new Promise((r) => setTimeout(r, 380));
    }
    let design = this.designs.get(id);
    if (!design) {
      design = entry.create();
      this.designs.set(id, design);
    }
    await design.mount(this.context());
    if (this.current) this.stage.deviceRoot.remove(this.current.root);
    this.interaction.clear();
    this.current = design;
    this.currentId = id;
    this.stage.deviceRoot.add(design.root);
    await this.stage.applyScene(design.scene);
    design.registerControls();
    design.onTrack(this.playback.state.track, this.art);
    design.syncImmediately(this.frameState(0, 0));
    this.stage.updateContactShadow();
    this.stage.markInteraction();
    localStorage.setItem(LS_DESIGN, id);
    this.events.emit('design', id);
    this.events.emit('loading', false);
    // Ein Frame rendern lassen, dann einblenden
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    this.fadeEl.classList.remove('visible');
  }

  setQuality(q: Quality) {
    this.quality = q;
    localStorage.setItem(LS_QUALITY, q);
    this.stage.setQuality(q);
  }

  setSfx(on: boolean) {
    this.sfx.enabled = on;
    if (!on) this.sfx.crackle(false);
    localStorage.setItem(LS_SFX, on ? 'on' : 'off');
  }

  private frameState(dt: number, t: number): FrameState {
    const pb = this.playback;
    const s = pb.state;
    const pos = pb.position();
    const dur = s.track?.durationMs ?? 0;
    return {
      dt,
      time: t,
      playing: !s.paused && !!s.track,
      positionMs: pos,
      durationMs: dur,
      progress: dur > 0 ? pos / dur : 0,
      volume: s.volume,
      track: s.track,
      audio: this.audio,
    };
  }

  private slowTime = 0;
  private autoQualityDone = false;

  private frame(dt: number, t: number) {
    const f = this.frameState(dt, t);
    this.audio.update(dt, f.playing, f.volume, f.positionMs);
    this.current?.update(f);
    // Stillstand → Rendering drosseln (Musik pausiert, keine Bedienung)
    this.stage.allowThrottle = !f.playing && !this.interaction.isDragging;
    this.autoQuality(dt);
  }

  /** Senkt die Qualität einmalig automatisch, wenn die GPU dauerhaft zu langsam ist. */
  private autoQuality(dt: number) {
    if (this.autoQualityDone || localStorage.getItem(LS_QUALITY) || new URLSearchParams(location.search).has('quality')) return;
    if (this.quality === 'low') return;
    if (this.stage.frameMs > 34) this.slowTime += dt;
    else this.slowTime = Math.max(0, this.slowTime - dt * 0.5);
    if (this.slowTime > 4) {
      this.slowTime = 0;
      const next: Quality = this.quality === 'high' ? 'medium' : 'low';
      this.quality = next;
      this.stage.setQuality(next);
      this.toast(`Darstellung automatisch auf „${next === 'medium' ? 'Mittel' : 'Niedrig'}“ reduziert (änderbar in den Einstellungen).`);
      if (next === 'low') this.autoQualityDone = true;
    }
  }
}
