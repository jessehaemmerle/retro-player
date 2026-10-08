/**
 * Spotify liefert (DRM-bedingt) keine Audiodaten an den Browser und die
 * Audio-Analyse-API ist für neue Apps abgeschaltet. Für VU-Meter, LED-Ketten und
 * schwingende Membranen wird daher ein musikalisch plausibler Pegel simuliert:
 * Tempo & Charakter werden aus der Track-ID abgeleitet, Strophe/Refrain aus der Position.
 */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class AudioSim {
  /** Kanalpegel 0..1 (geglättet wie ein RMS-Detektor) */
  readonly level: [number, number] = [0, 0];
  /** Spitzenwerte 0..1 mit langsamem Abfall */
  readonly peak: [number, number] = [0, 0];
  /** Spektrum (tief → hoch), 0..1 */
  readonly bands = new Float32Array(12);
  /** Basstrieb 0..1 für Membranauslenkung */
  bass = 0;

  private bpm = 120;
  private swing = 0;
  private density = 0.6;
  private brightness = 0.5;
  private bed = [0.5, 0.5];
  private kick = 0;
  private snare = 0;
  private hat = 0;
  private lastBeat = -1;
  private last8th = -1;
  private rnd = Math.random;

  setTrack(id: string | null) {
    const h = hashString(id ?? 'none');
    this.bpm = 82 + (h % 58);
    this.swing = ((h >> 8) % 100) / 400;
    this.density = 0.45 + ((h >> 12) % 100) / 220;
    this.brightness = 0.35 + ((h >> 20) % 100) / 200;
    this.lastBeat = -1;
  }

  update(dt: number, playing: boolean, volume: number, positionMs: number) {
    const gain = 0.35 + 0.65 * volume;
    if (playing) {
      const beats = (positionMs / 60000) * this.bpm;
      const beat = Math.floor(beats);
      const eighth = Math.floor(beats * 2 + this.swing);
      // Abschnittsdynamik: ruhigere Strophe, lauter Refrain, Intro/Outro
      const sec = positionMs / 1000;
      const section = 0.72 + 0.22 * Math.sin(sec / 19 + 1.3) + 0.08 * Math.sin(sec / 5.3);
      const intro = Math.min(1, sec / 6);
      if (beat !== this.lastBeat) {
        this.lastBeat = beat;
        this.kick = 0.75 + this.rnd() * 0.25;
        if (beat % 2 === 1) this.snare = 0.6 + this.rnd() * 0.3;
      }
      if (eighth !== this.last8th) {
        this.last8th = eighth;
        if (this.rnd() < this.density + 0.3) this.hat = 0.4 + this.rnd() * 0.4;
      }
      this.kick *= Math.exp(-dt / 0.11);
      this.snare *= Math.exp(-dt / 0.16);
      this.hat *= Math.exp(-dt / 0.05);
      for (let c = 0; c < 2; c++) {
        // Zufallsbewegung des Musik-"Teppichs"
        this.bed[c] += (this.rnd() - 0.5) * dt * 3;
        this.bed[c] += (0.55 - this.bed[c]) * dt * 1.5;
        this.bed[c] = Math.max(0.2, Math.min(0.9, this.bed[c]));
      }
      const music = intro * section * gain;
      for (let c = 0; c < 2; c++) {
        const inst = (0.45 * this.bed[c] + 0.45 * this.kick + 0.25 * this.snare * (c === 0 ? 0.9 : 1.1) + 0.12 * this.hat) * music;
        const target = Math.min(1, inst);
        // Ballistik: schneller Anstieg, langsamer Abfall
        const k = target > this.level[c] ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.25);
        this.level[c] += (target - this.level[c]) * k;
      }
      this.bass = Math.min(1, this.kick * music * 1.2);
      const n = this.bands.length;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const low = this.kick * (1 - f) * 1.1;
        const mid = this.bed[i % 2] * 0.7 * (1 - Math.abs(f - 0.45) * 1.2) + this.snare * 0.5 * (1 - Math.abs(f - 0.55));
        const high = this.hat * f * this.brightness * 1.4;
        const target = Math.min(1, (low + mid + high) * music * (0.85 + this.rnd() * 0.3));
        const k = target > this.bands[i] ? 1 - Math.exp(-dt / 0.02) : 1 - Math.exp(-dt / 0.18);
        this.bands[i] += (target - this.bands[i]) * k;
      }
    } else {
      const k = 1 - Math.exp(-dt / 0.2);
      this.level[0] -= this.level[0] * k;
      this.level[1] -= this.level[1] * k;
      this.bass -= this.bass * k;
      for (let i = 0; i < this.bands.length; i++) this.bands[i] -= this.bands[i] * k;
    }
    for (let c = 0; c < 2; c++) {
      if (this.level[c] > this.peak[c]) this.peak[c] = this.level[c];
      else this.peak[c] = Math.max(0, this.peak[c] - dt * 0.35);
    }
  }
}
