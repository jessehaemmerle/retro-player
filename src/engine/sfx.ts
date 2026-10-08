/**
 * Synthetisierte Geräusche für die Mechanik (WebAudio, keine Sample-Dateien):
 * Tastenklicks, Rastungen, Nadel-Aufsetzen und Vinyl-Knistern.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crackleNode: AudioBufferSourceNode | null = null;
  private crackleGain: GainNode | null = null;
  enabled = true;
  crackleEnabled = true;
  volume = 0.5;

  /** In einer Nutzergeste aufrufen. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private noiseBuffer(seconds: number, shape: (i: number, n: number) => number): AudioBuffer | null {
    if (!this.ctx) return null;
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * shape(i, n);
    return buf;
  }

  private burst(opts: { dur: number; freq: number; q: number; gain: number; decay: number; type?: BiquadFilterType; delay?: number }) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const buf = this.noiseBuffer(opts.dur, (i, n) => Math.exp((-i / n) * opts.decay));
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(this.ctx.currentTime + (opts.delay ?? 0));
  }

  private thump(freq: number, gain: number, dur = 0.12, delay = 0) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Kleine Taste / Mikroschalter */
  click() {
    this.burst({ dur: 0.025, freq: 3800, q: 2.5, gain: 0.5, decay: 9 });
    this.burst({ dur: 0.02, freq: 2200, q: 3, gain: 0.25, decay: 10, delay: 0.035 });
  }

  /** Rastung eines Drehschalters */
  detent() {
    this.burst({ dur: 0.012, freq: 5200, q: 4, gain: 0.22, decay: 12 });
  }

  /** Schwere Kassettentaste (Piano-Key) */
  clunk() {
    this.burst({ dur: 0.05, freq: 1500, q: 1.2, gain: 0.7, decay: 7 });
    this.thump(95, 0.35, 0.09);
    this.burst({ dur: 0.03, freq: 2600, q: 2, gain: 0.3, decay: 9, delay: 0.06 });
  }

  /** Nadel setzt auf */
  needleDrop() {
    this.thump(60, 0.45, 0.18);
    this.burst({ dur: 0.08, freq: 900, q: 0.8, gain: 0.35, decay: 5 });
  }

  /** CD-Laufwerk / Motor-Anlauf */
  whirr(dur = 0.6) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(520, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Dauerhaftes Vinyl-Knistern (sehr leise unter der Musik). */
  crackle(on: boolean) {
    if (!this.ctx || !this.master) return;
    const want = on && this.enabled && this.crackleEnabled;
    if (want && !this.crackleNode) {
      const sr = this.ctx.sampleRate;
      const n = sr * 4;
      const buf = this.ctx.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < n; i++) {
          lp = lp * 0.97 + (Math.random() * 2 - 1) * 0.03;
          let v = lp * 0.25; // Rauschen
          if (Math.random() < 0.00035) {
            // Knackser mit kurzem Ausschwingen
            const amp = (Math.random() * 0.8 + 0.2) * (Math.random() < 0.5 ? -1 : 1);
            const len = 20 + Math.floor(Math.random() * 80);
            for (let k = 0; k < len && i + k < n; k++) d[i + k] += amp * Math.exp(-k / (len / 4));
          }
          d[i] += v;
        }
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.09, this.ctx.currentTime + 0.4);
      src.connect(hp).connect(g).connect(this.master);
      src.start();
      this.crackleNode = src;
      this.crackleGain = g;
    } else if (!want && this.crackleNode) {
      const node = this.crackleNode;
      this.crackleGain!.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.25);
      setTimeout(() => node.stop(), 300);
      this.crackleNode = null;
      this.crackleGain = null;
    }
  }
}
