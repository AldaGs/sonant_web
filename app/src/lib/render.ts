import type { Caption, Word } from './captions';

export type Animation = 'none' | 'fade' | 'pop' | 'typewriter' | 'karaoke' | 'bounce';
export type Easing = 'linear' | 'ease-out' | 'ease-in-out' | 'back';
export type Style = {
  family: string;
  weight: number;
  italic: boolean;
  size: number; // fraction of frame height
  color: string;
  highlight: string;
  stroke: string;
  outline: number; // outline width as a fraction of font size; 0 = none
  box: string; // background box color behind each line; '' = none
  uppercase: boolean;
  animation: Animation;
  duration: number; // ms, length of the in-animation
  easing: Easing;
  x: number; // 0..1 center
  y: number;
};

const base = { italic: false, outline: 0.16, box: '', duration: 320, easing: 'ease-out' as Easing, x: 0.5 };

// Our own presets. The first four follow the design (Bold pop, Boxed, Minimal, Editorial).
export const PRESETS: Record<string, Style> = {
  'Bold pop': { ...base, family: 'Montserrat', weight: 800, size: 0.065, color: '#ffffff', highlight: '#c8f560', stroke: '#000000', uppercase: true, animation: 'karaoke', y: 0.75 },
  Boxed: { ...base, family: 'Inter', weight: 800, size: 0.055, color: '#ffffff', highlight: '#c8f560', stroke: '#000000', outline: 0, box: '#111111', uppercase: false, animation: 'fade', y: 0.8 },
  Minimal: { ...base, family: 'Inter', weight: 800, size: 0.048, color: '#ffffff', highlight: '#ffffff', stroke: '#000000', outline: 0.08, uppercase: false, animation: 'none', y: 0.86 },
  Editorial: { ...base, family: 'DM Serif Display', weight: 400, italic: true, size: 0.07, color: '#fff8ec', highlight: '#ffd27a', stroke: '#000000', outline: 0.06, uppercase: false, animation: 'fade', duration: 500, y: 0.78 },
  Tall: { ...base, family: 'Anton', weight: 400, size: 0.085, color: '#ffffff', highlight: '#ff4d6d', stroke: '#111111', uppercase: true, animation: 'bounce', y: 0.72 },
  Marker: { ...base, family: 'Permanent Marker', weight: 400, size: 0.07, color: '#fff6d6', highlight: '#ff9f1c', stroke: '#2b1a00', uppercase: false, animation: 'pop', easing: 'back', y: 0.7 },
};
export const DEFAULT_STYLE = PRESETS['Bold pop'];

// Saved projects from before a field existed get that field's default.
export function migrateStyle(s: Partial<Style> & Record<string, unknown>): Style {
  return { ...DEFAULT_STYLE, ...s } as Style;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
export const EASINGS: Record<Easing, (p: number) => number> = {
  linear: (p) => p,
  'ease-out': (p) => 1 - (1 - p) ** 3,
  'ease-in-out': (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};

type Anim = Pick<Style, 'animation' | 'duration' | 'easing'>;

// Per-word animation state at time t (seconds). Pure, so preview and export match.
// chars: how many letters to draw (Infinity = whole word).
export function wordState(w: Word, capStart: number, t: number, a: Anim) {
  const anim = a.animation;
  const d = Math.max(0.01, a.duration / 1000);
  const ease = EASINGS[a.easing] ?? EASINGS['ease-out'];
  const active = anim !== 'none' && anim !== 'fade' && t >= w.start && t < w.end;
  const spoken = t >= w.start;
  let visible = true, scale = 1, dy = 0, alpha = 1, chars = Infinity;
  if (anim === 'fade') {
    const p = ease(clamp((t - capStart) / d));
    alpha = clamp(p);
    dy = (1 - p) * 0.5; // rises half a line height
  }
  if (anim === 'pop') {
    visible = spoken;
    scale = 0.4 + 0.6 * ease(clamp((t - w.start) / d));
  }
  if (anim === 'typewriter') {
    visible = spoken;
    // Letters are typed over the word's spoken time, never slower than `duration`.
    const span = Math.min(d, Math.max(0.05, w.end - w.start));
    chars = Math.max(1, Math.ceil(w.text.length * clamp((t - w.start) / span)));
  }
  if (anim === 'karaoke' && active) scale = 1 + 0.05 * ease(clamp((t - w.start) / Math.min(d, 0.15)));
  if (anim === 'bounce' && active) dy = -Math.sin(clamp((t - w.start) / Math.min(d, w.end - w.start)) * Math.PI) * 0.25;
  return { visible, active, highlighted: anim === 'karaoke' ? spoken : active, scale, dy, alpha, chars };
}

// Wrap words into lines no wider than maxW.
export function layout(widths: number[], space: number, maxW: number): number[][] {
  const lines: number[][] = [];
  let line: number[] = [], w = 0;
  widths.forEach((ww, i) => {
    if (line.length && w + space + ww > maxW) { lines.push(line); line = []; w = 0; }
    w += (line.length ? space : 0) + ww;
    line.push(i);
  });
  if (line.length) lines.push(line);
  return lines;
}

export const fontString = (s: Pick<Style, 'italic' | 'weight' | 'family'>, px: number) =>
  `${s.italic ? 'italic ' : ''}${s.weight} ${px}px "${s.family}"`;

export function drawCaption(ctx: CanvasRenderingContext2D, c: Caption, t: number, s: Style) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const px = Math.round(s.size * H);
  ctx.font = fontString(s, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const texts = c.words.map((w) => (s.uppercase ? w.text.toUpperCase() : w.text));
  const widths = texts.map((x) => ctx.measureText(x).width);
  const space = ctx.measureText(' ').width;
  const lines = layout(widths, space, W * 0.86);
  const lh = px * (s.box ? 1.45 : 1.2);
  let y = s.y * H - ((lines.length - 1) * lh) / 2;
  const capStart = c.words[0].start;
  for (const line of lines) {
    const lw = line.reduce((a, i) => a + widths[i], 0) + space * (line.length - 1);
    let x = s.x * W - lw / 2;
    const states = line.map((i) => wordState(c.words[i], capStart, t, s));

    // Background box behind the visible words of this line.
    if (s.box && states.some((st) => st.visible)) {
      const padX = px * 0.35, padY = px * 0.22;
      ctx.save();
      ctx.globalAlpha = 0.88 * Math.min(...states.map((st) => st.alpha));
      ctx.fillStyle = s.box;
      ctx.beginPath();
      ctx.roundRect(x - padX, y + states[0].dy * px - px / 2 - padY, lw + padX * 2, px + padY * 2, px * 0.22);
      ctx.fill();
      ctx.restore();
    }

    line.forEach((i, k) => {
      const st = states[k];
      if (st.visible) {
        const text = st.chars === Infinity ? texts[i] : texts[i].slice(0, st.chars);
        ctx.save();
        ctx.globalAlpha = st.alpha;
        ctx.translate(x + widths[i] / 2, y + st.dy * px);
        ctx.scale(st.scale, st.scale);
        if (s.outline > 0) {
          ctx.lineWidth = px * s.outline;
          ctx.strokeStyle = s.stroke;
          ctx.strokeText(text, -widths[i] / 2, 0);
        }
        ctx.fillStyle = st.highlighted ? s.highlight : s.color;
        ctx.fillText(text, -widths[i] / 2, 0);
        ctx.restore();
      }
      x += widths[i] + space;
    });
    y += lh;
  }
}
