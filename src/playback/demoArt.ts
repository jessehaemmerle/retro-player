/**
 * Erzeugt Cover-Art für den Demo-Modus (ohne Spotify-Login), damit alle Geräte
 * sofort ausprobiert werden können. Alles prozedural – keine fremden Bildrechte.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function grain(ctx: CanvasRenderingContext2D, size: number, amount: number, seed: number) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

type Painter = (ctx: CanvasRenderingContext2D, s: number) => void;

const painters: Painter[] = [
  // 1 – Synthwave-Sonnenuntergang
  (ctx, s) => {
    const sky = ctx.createLinearGradient(0, 0, 0, s);
    sky.addColorStop(0, '#120a2a');
    sky.addColorStop(0.55, '#5b1a6b');
    sky.addColorStop(0.62, '#f2597f');
    sky.addColorStop(1, '#0d0618');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, s, s);
    const sun = ctx.createLinearGradient(0, s * 0.25, 0, s * 0.62);
    sun.addColorStop(0, '#ffd56b');
    sun.addColorStop(1, '#ff3d7f');
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s * 0.55, s * 0.26, Math.PI, 0);
    ctx.clip();
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#5b1a6b';
    for (let i = 0; i < 7; i++) ctx.fillRect(0, s * (0.42 + i * 0.022), s, s * 0.004 * (i + 1));
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,90,200,0.75)';
    ctx.lineWidth = s * 0.003;
    for (let i = 0; i < 14; i++) {
      const y = s * 0.62 + Math.pow(i / 14, 2) * s * 0.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(s / 2 + i * s * 0.02, s * 0.62);
      ctx.lineTo(s / 2 + i * s * 0.16, s);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff2f8';
    ctx.font = `700 ${s * 0.085}px Jost, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('NEON BOULEVARD', s / 2, s * 0.15);
  },
  // 2 – Jazz-Cover im Blue-Note-Stil
  (ctx, s) => {
    ctx.fillStyle = '#1d4e89';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#f0e6d2';
    ctx.fillRect(s * 0.06, s * 0.06, s * 0.88, s * 0.5);
    ctx.fillStyle = '#111';
    for (let i = 0; i < 9; i++) ctx.fillRect(s * (0.1 + i * 0.09), s * 0.12, s * 0.05, s * (0.2 + ((i * 37) % 7) * 0.035));
    ctx.fillStyle = '#e8b33c';
    ctx.font = `600 ${s * 0.12}px "Barlow Condensed", sans-serif`;
    ctx.fillText('MIDNIGHT', s * 0.07, s * 0.72);
    ctx.fillStyle = '#f0e6d2';
    ctx.fillText('LOUNGE', s * 0.07, s * 0.84);
    ctx.font = `400 ${s * 0.04}px Jost, sans-serif`;
    ctx.fillText('THE ELLA MORROW QUARTET', s * 0.07, s * 0.92);
  },
  // 3 – Abstrakte Bauhaus-Formen
  (ctx, s) => {
    ctx.fillStyle = '#ece4d4';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#d6452f';
    ctx.beginPath();
    ctx.arc(s * 0.36, s * 0.4, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f3c88';
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.36, s * 0.36);
    ctx.fillStyle = '#f2c230';
    ctx.beginPath();
    ctx.moveTo(s * 0.15, s * 0.88);
    ctx.lineTo(s * 0.5, s * 0.55);
    ctx.lineTo(s * 0.85, s * 0.88);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `500 ${s * 0.05}px Jost, sans-serif`;
    ctx.fillText('analog dreams', s * 0.08, s * 0.12);
  },
  // 4 – Fotografischer Farbverlauf / Dämmerung
  (ctx, s) => {
    const g = ctx.createRadialGradient(s * 0.7, s * 0.3, 0, s * 0.7, s * 0.3, s * 0.9);
    g.addColorStop(0, '#ffb36b');
    g.addColorStop(0.35, '#c85a54');
    g.addColorStop(0.7, '#2e2a4f');
    g.addColorStop(1, '#0e0f1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(10,10,18,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, s * 0.78);
    for (let x = 0; x <= s; x += s / 40) ctx.lineTo(x, s * (0.72 + 0.06 * Math.sin(x / s * 9) + 0.03 * Math.sin(x / s * 23)));
    ctx.lineTo(s, s);
    ctx.lineTo(0, s);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `300 ${s * 0.06}px Jost, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('S U N D A Y   V I N Y L', s * 0.93, s * 0.93);
  },
  // 5 – Kassettenkultur, grobe Typografie
  (ctx, s) => {
    ctx.fillStyle = '#f4d03f';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#121212';
    ctx.font = `700 ${s * 0.3}px "Barlow Condensed", sans-serif`;
    ctx.fillText('TAPE', s * 0.05, s * 0.36);
    ctx.fillText('LOOP', s * 0.05, s * 0.66);
    ctx.fillStyle = '#e4572e';
    ctx.fillRect(s * 0.05, s * 0.74, s * 0.9, s * 0.05);
    ctx.fillStyle = '#121212';
    ctx.font = `500 ${s * 0.045}px Jost, sans-serif`;
    ctx.fillText('SIDE A · 1984', s * 0.05, s * 0.9);
  },
];

export function paintDemoCover(index: number, size = 640): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  painters[index % painters.length](ctx, size);
  grain(ctx, size, 14, index + 7);
  return c.toDataURL('image/jpeg', 0.9);
}
