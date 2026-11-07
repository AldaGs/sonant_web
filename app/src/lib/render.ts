import type { Caption, Word } from './captions';

export type Animation =
  | 'none'
  | 'fade'
  | 'pop'
  | 'typewriter'
  | 'karaoke'
  | 'bounce'
  | 'elastic'
  | 'slide-up'
  | 'slide-in'
  | 'wave'
  | 'glitch'
  | 'pill'
  | 'neon'
  | 'zoom-in'
  | 'flip'
  | 'drop'
  | 'shake'
  | 'spin'
  | 'blur-in'
  | 'rise'
  | 'swipe-up';

export type AnimTarget = 'character' | 'word' | 'line' | 'all';
export type AnimationTarget = AnimTarget;

export type Easing = 'linear' | 'ease-out' | 'ease-in-out' | 'back' | 'spring' | 'quart-out';

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
  animTarget: AnimTarget; // whether animation affects per character, word, line, or all
  duration: number; // ms, length of the in-animation
  easing: Easing;
  x: number; // 0..1 center
  y: number;
  align: Align; // how lines line up inside the caption block
  lineHeight: number; // multiple of font size
  letterSpacing: number; // em (fraction of font size); 0 = normal
  opacity: number; // 0..1, whole caption
  radius: number; // background box corner radius, fraction of font size
};
export type Align = 'left' | 'center' | 'right';

const base = {
  italic: false, outline: 0.16, box: '', animTarget: 'word' as AnimTarget, duration: 320, easing: 'ease-out' as Easing, x: 0.5,
  align: 'center' as Align, lineHeight: 1.2, letterSpacing: 0, opacity: 1, radius: 0.22,
};

// Presets: Classic + CapCut / TikTok viral styles
export const PRESETS: Record<string, Style> = {
  'Viral pop': { ...base, family: 'Montserrat', weight: 800, size: 0.068, color: '#ffffff', highlight: '#ffe600', stroke: '#000000', outline: 0.18, uppercase: true, animation: 'elastic', duration: 320, easing: 'spring', y: 0.75 },
  'Active pill': { ...base, family: 'Inter', weight: 800, size: 0.058, color: '#ffffff', highlight: '#c8f560', stroke: '#000000', outline: 0.12, uppercase: true, animation: 'pill', duration: 250, y: 0.8 },
  'Smooth rise': { ...base, family: 'DM Serif Display', weight: 400, italic: true, size: 0.068, color: '#ffffff', highlight: '#ffd27a', stroke: '#111111', outline: 0.06, uppercase: false, animation: 'slide-up', duration: 400, easing: 'quart-out', y: 0.78 },
  'Cyber glitch': { ...base, family: 'Permanent Marker', weight: 400, size: 0.07, color: '#f0fdf4', highlight: '#00f0ff', stroke: '#052e16', outline: 0.15, uppercase: true, animation: 'glitch', duration: 280, y: 0.72 },
  'Neon pulse': { ...base, family: 'Anton', weight: 400, size: 0.08, color: '#ffffff', highlight: '#00f0ff', stroke: '#0b132b', outline: 0.12, uppercase: true, animation: 'neon', duration: 300, y: 0.74 },
  'Kinetic wave': { ...base, family: 'Montserrat', weight: 800, size: 0.064, color: '#ffffff', highlight: '#ff5470', stroke: '#000000', outline: 0.14, uppercase: true, animation: 'wave', duration: 300, y: 0.76 },
  'Bold pop': { ...base, family: 'Montserrat', weight: 800, size: 0.065, color: '#ffffff', highlight: '#c8f560', stroke: '#000000', uppercase: true, animation: 'karaoke', y: 0.75 },
  Boxed: { ...base, family: 'Inter', weight: 800, size: 0.055, color: '#ffffff', highlight: '#c8f560', stroke: '#000000', outline: 0, box: '#111111', uppercase: false, animation: 'fade', animTarget: 'all', y: 0.8 },
  Minimal: { ...base, family: 'Inter', weight: 800, size: 0.048, color: '#ffffff', highlight: '#ffffff', stroke: '#000000', outline: 0.08, uppercase: false, animation: 'none', y: 0.86 },
  Editorial: { ...base, family: 'DM Serif Display', weight: 400, italic: true, size: 0.07, color: '#fff8ec', highlight: '#ffd27a', stroke: '#000000', outline: 0.06, uppercase: false, animation: 'fade', animTarget: 'all', duration: 500, y: 0.78 },
  Tall: { ...base, family: 'Anton', weight: 400, size: 0.085, color: '#ffffff', highlight: '#ff4d6d', stroke: '#111111', uppercase: true, animation: 'bounce', y: 0.72 },
  Marker: { ...base, family: 'Permanent Marker', weight: 400, size: 0.07, color: '#fff6d6', highlight: '#ff9f1c', stroke: '#2b1a00', uppercase: false, animation: 'pop', easing: 'back', y: 0.7 },
  // New CapCut-inspired presets
  'Zoom burst': { ...base, family: 'Montserrat', weight: 900, size: 0.072, color: '#ffffff', highlight: '#ff6b35', stroke: '#000000', outline: 0.16, uppercase: true, animation: 'zoom-in', duration: 350, easing: 'ease-out', y: 0.75 },
  'Flip reveal': { ...base, family: 'Inter', weight: 800, size: 0.062, color: '#ffffff', highlight: '#a855f7', stroke: '#1a0030', outline: 0.14, uppercase: true, animation: 'flip', duration: 380, easing: 'ease-in-out', y: 0.78 },
  'Gravity drop': { ...base, family: 'Anton', weight: 400, size: 0.08, color: '#fff700', highlight: '#ff4500', stroke: '#1a0a00', outline: 0.18, uppercase: true, animation: 'drop', duration: 420, easing: 'spring', y: 0.73 },
  'Shake it': { ...base, family: 'Permanent Marker', weight: 400, size: 0.075, color: '#ff3860', highlight: '#ffdd57', stroke: '#1a0010', outline: 0.14, uppercase: false, animation: 'shake', duration: 300, easing: 'ease-out', y: 0.72 },
  'Spin in': { ...base, family: 'Bebas Neue', weight: 400, size: 0.084, color: '#ffffff', highlight: '#38d9f5', stroke: '#001f27', outline: 0.12, uppercase: true, animation: 'spin', duration: 400, easing: 'spring', y: 0.75 },
  'Focus blur': { ...base, family: 'DM Serif Display', weight: 400, italic: true, size: 0.068, color: '#f0f4ff', highlight: '#818cf8', stroke: '#0a0a1a', outline: 0.06, uppercase: false, animation: 'blur-in', duration: 450, easing: 'quart-out', y: 0.78 },
  'Float up': { ...base, family: 'Montserrat', weight: 700, size: 0.062, color: '#ffffff', highlight: '#34d399', stroke: '#001a0f', outline: 0.12, uppercase: false, animation: 'rise', duration: 400, easing: 'back', y: 0.76 },
  'Swipe reveal': { ...base, family: 'Inter', weight: 800, size: 0.058, color: '#ffffff', highlight: '#fb923c', stroke: '#1a0800', outline: 0.14, uppercase: true, animation: 'swipe-up', duration: 320, easing: 'quart-out', y: 0.8 },
};
export const DEFAULT_STYLE = PRESETS['Viral pop'];

// Saved projects from before a field existed get that field's default.
export function migrateStyle(s: Partial<Style> & Record<string, unknown>): Style {
  const animTarget = (s.animTarget as AnimTarget) ?? (s.animation === 'fade' ? 'all' : 'word');
  return { ...DEFAULT_STYLE, animTarget, ...s } as Style;
}

// Merge caption-level style override with base project style.
export function resolveStyle(baseStyle: Style, override?: Partial<Style>): Style {
  return override ? { ...baseStyle, ...override } : baseStyle;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export const EASINGS: Record<Easing, (p: number) => number> = {
  linear: (p) => p,
  'ease-out': (p) => 1 - (1 - p) ** 3,
  'ease-in-out': (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  spring: (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return 1 - Math.cos(p * Math.PI * 2.5) * Math.exp(-p * 4);
  },
  'quart-out': (p) => 1 - (1 - p) ** 4,
};

type Anim = Pick<Style, 'animation' | 'duration' | 'easing'> & { animTarget?: AnimTarget };

export type WordState = {
  visible: boolean;
  active: boolean;
  highlighted: boolean;
  scale: number;
  scaleX: number;
  scaleY: number;
  dx: number;
  dy: number;
  rotation: number;
  alpha: number;
  chars: number;
  glowBlur: number;
  pill: boolean;
  blur: number;      // px blur for blur-in
  skewX: number;     // radians skew on X axis
  clipY: number;     // 0..1 — fraction of the word height revealed from bottom (swipe-up)
};

// Animation state for any target unit (caption, line, word, or character).
export function computeAnimState(
  start: number,
  end: number,
  t: number,
  a: Anim,
  textLength: number = 1,
): WordState {
  const anim = a.animation;
  const d = Math.max(0.01, a.duration / 1000);
  const ease = EASINGS[a.easing] ?? EASINGS['ease-out'];
  const active = anim !== 'none' && anim !== 'fade' && t >= start && t < end;
  const spoken = t >= start;

  let visible = true;
  let scale = 1;
  let scaleX = 1;
  let scaleY = 1;
  let dx = 0;
  let dy = 0;
  let rotation = 0;
  let alpha = 1;
  let chars = Infinity;
  let glowBlur = 0;
  let pill = false;
  let blur = 0;
  let skewX = 0;
  let clipY = 1; // 1 = fully visible, 0 = hidden

  if (anim === 'fade') {
    const p = ease(clamp((t - start) / d));
    alpha = clamp(p);
    dy = (1 - p) * 0.5; // rises half a line height
  } else if (anim === 'pop') {
    visible = spoken;
    scale = 0.4 + 0.6 * ease(clamp((t - start) / d));
  } else if (anim === 'elastic') {
    visible = spoken;
    const p = clamp((t - start) / d);
    scale = EASINGS.spring(p);
    if (active) rotation = Math.sin((t - start) * 12) * 0.035;
  } else if (anim === 'slide-up') {
    visible = spoken;
    const p = (EASINGS['quart-out'] ?? EASINGS['ease-out'])(clamp((t - start) / d));
    alpha = clamp(p);
    dy = (1 - p) * 0.55;
  } else if (anim === 'slide-in') {
    visible = spoken;
    const p = ease(clamp((t - start) / d));
    alpha = clamp(p);
    dx = (1 - p) * -0.35;
  } else if (anim === 'wave') {
    visible = spoken;
    const span = Math.max(0.08, Math.min(d, end - start));
    if (active) {
      const phase = clamp((t - start) / span);
      dy = -Math.sin(phase * Math.PI) * 0.35;
      scale = 1 + 0.08 * Math.sin(phase * Math.PI);
    }
  } else if (anim === 'glitch') {
    visible = spoken;
    const p = clamp((t - start) / Math.min(d, 0.22));
    if (active && p < 1) {
      const seed = Math.sin((t - start) * 382.7);
      dx = seed * 0.07;
      dy = Math.cos((t - start) * 440.1) * 0.04;
      rotation = seed * 0.04;
      alpha = 0.85 + 0.15 * Math.abs(seed);
    }
  } else if (anim === 'pill') {
    visible = true;
    pill = active;
    if (active) scale = 1 + 0.05 * ease(clamp((t - start) / Math.min(d, 0.15)));
  } else if (anim === 'neon') {
    visible = true;
    if (active) {
      const span = Math.max(0.08, end - start);
      glowBlur = 14 * Math.sin(clamp((t - start) / span) * Math.PI);
      scale = 1 + 0.04 * ease(clamp((t - start) / Math.min(d, 0.15)));
    }
  } else if (anim === 'typewriter') {
    visible = spoken;
    // Letters are typed over the unit's spoken time, never slower than `duration`.
    const span = Math.min(d, Math.max(0.05, end - start));
    chars = Math.max(1, Math.ceil(textLength * clamp((t - start) / span)));
  } else if (anim === 'karaoke') {
    if (active) scale = 1 + 0.05 * ease(clamp((t - start) / Math.min(d, 0.15)));
  } else if (anim === 'bounce') {
    if (active) dy = -Math.sin(clamp((t - start) / Math.min(d, end - start)) * Math.PI) * 0.25;
  } else if (anim === 'zoom-in') {
    // CapCut "Zoom In": scales from large down to 1 on entry, with a slight alpha fade-in.
    visible = spoken;
    const p = ease(clamp((t - start) / d));
    scale = 1.6 - 0.6 * p;
    alpha = clamp(p);
  } else if (anim === 'flip') {
    // CapCut "Flip": horizontally squishes to 0 then expands back — simulates a Y-axis flip.
    visible = spoken;
    const p = ease(clamp((t - start) / d));
    // First half: collapse scaleX to 0; second half: expand back to 1
    scaleX = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
    alpha = p < 0.5 ? 1 - p : p;
    return { visible, active, highlighted: active, scale, scaleX, scaleY, dx, dy, rotation, alpha, chars, glowBlur, pill, blur, skewX, clipY };
  } else if (anim === 'drop') {
    // CapCut "Drop": falls from above with a gravity bounce.
    visible = spoken;
    const p = EASINGS.spring(clamp((t - start) / d));
    dy = -(1 - p) * 1.2;
    alpha = clamp(p * 2); // fades in quickly
    scale = 0.8 + 0.2 * p;
  } else if (anim === 'shake') {
    // CapCut "Shake": rapid position/rotation jitter while spoken.
    visible = spoken;
    if (active) {
      const freq = 28;
      const decay = Math.exp(-3 * clamp((t - start) / d));
      dx = Math.sin((t - start) * freq * 1.0) * 0.08 * decay;
      dy = Math.cos((t - start) * freq * 1.3) * 0.05 * decay;
      rotation = Math.sin((t - start) * freq * 0.9) * 0.07 * decay;
    }
  } else if (anim === 'spin') {
    // CapCut "Spin": rotates in from a quarter-turn, springs to rest.
    visible = spoken;
    const p = EASINGS.spring(clamp((t - start) / d));
    rotation = (1 - p) * Math.PI * 0.5;
    alpha = clamp(p * 1.5);
    scale = 0.5 + 0.5 * p;
  } else if (anim === 'blur-in') {
    // CapCut "Blur": enters blurred then sharpens.
    visible = spoken;
    const p = ease(clamp((t - start) / d));
    blur = (1 - p) * 18;
    alpha = clamp(p);
  } else if (anim === 'rise') {
    // CapCut "Rise": floats up smoothly, fades in with a slight overshoot.
    visible = spoken;
    const p = EASINGS.back(clamp((t - start) / d));
    dy = (1 - p) * 0.7;
    alpha = clamp(clamp((t - start) / d) * 1.4);
  } else if (anim === 'swipe-up') {
    // CapCut "Swipe": reveals the word from bottom like a wipe, clipping from below.
    visible = spoken;
    const p = ease(clamp((t - start) / d));
    clipY = p; // used by drawCaption to clip the word
    alpha = clamp(p);
  }

  scaleX = scaleX !== 1 ? scaleX : scale;
  scaleY = scaleY !== 1 ? scaleY : scale;

  const highlighted =
    anim === 'karaoke'
      ? spoken
      : anim === 'none' || anim === 'fade'
        ? false
        : active;

  return { visible, active, highlighted, scale, scaleX, scaleY, dx, dy, rotation, alpha, chars, glowBlur, pill, blur, skewX, clipY };
}

// Per-word animation state at time t (seconds). Pure, so preview and export match.
export function wordState(
  w: Word,
  capStart: number,
  t: number,
  a: Anim,
  range?: { start: number; end: number },
): WordState {
  const target = a.animTarget ?? (a.animation === 'fade' ? 'all' : 'word');
  let start = w.start;
  let end = w.end;
  if (range) {
    start = range.start;
    end = range.end;
  } else if (target === 'all') {
    start = capStart;
  }
  return computeAnimState(start, end, t, a, w.text.length);
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

export type Box = { x: number; y: number; w: number; h: number }; // canvas pixels

// Draws the caption at time t and returns its full laid-out box (all words, ignoring animation),
// which the preview uses for the drag box.
export function drawCaption(ctx: CanvasRenderingContext2D, c: Caption, t: number, s: Style): Box {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const px = Math.round(s.size * H);
  ctx.font = fontString(s, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(s.letterSpacing ?? 0) * px}px`;
  const op = s.opacity ?? 1;
  const texts = c.words.map((w) => (s.uppercase ? w.text.toUpperCase() : w.text));
  const widths = texts.map((x) => ctx.measureText(x).width);
  const space = ctx.measureText(' ').width;
  const lines = layout(widths, space, W * 0.86);
  const lh = px * (s.lineHeight ?? 1.2) * (s.box ? 1.2 : 1);
  let y = s.y * H - ((lines.length - 1) * lh) / 2;
  const maxW = Math.max(0, ...lines.map((line) => line.reduce((a, i) => a + widths[i], 0) + space * (line.length - 1)));
  const pad = px * (s.box ? 0.4 : 0.15);
  const bounds: Box = { x: s.x * W - maxW / 2 - pad, y: y - px / 2 - pad, w: maxW + pad * 2, h: (lines.length - 1) * lh + px + pad * 2 };
  const capStart = c.words[0].start;
  const capEnd = c.words[c.words.length - 1].end;
  const target: AnimTarget = s.animTarget ?? (s.animation === 'fade' ? 'all' : 'word');
  const d = Math.max(0.01, s.duration / 1000);

  // Precompute whole-caption typewriter progress if target === 'all'
  let allWordChars: number[] | null = null;
  if (s.animation === 'typewriter' && target === 'all') {
    const totalChars = texts.reduce((acc, str) => acc + str.length, 0);
    const span = Math.min(d, Math.max(0.05, capEnd - capStart));
    const typedChars = t < capStart ? 0 : Math.ceil(totalChars * clamp((t - capStart) / span));
    let soFar = 0;
    allWordChars = texts.map((txt) => {
      const cnt = Math.min(txt.length, Math.max(0, typedChars - soFar));
      soFar += txt.length;
      return cnt;
    });
  }

  for (const line of lines) {
    const lw = line.reduce((a, i) => a + widths[i], 0) + space * (line.length - 1);
    const align = s.align ?? 'center';
    let x = align === 'left' ? s.x * W - maxW / 2 : align === 'right' ? s.x * W + maxW / 2 - lw : s.x * W - lw / 2;

    const lineStart = c.words[line[0]].start;
    const lineEnd = c.words[line[line.length - 1]].end;

    // Typewriter line progress if target === 'line'
    let lineWordChars: Map<number, number> | null = null;
    if (s.animation === 'typewriter' && target === 'line') {
      const lineChars = line.reduce((acc, i) => acc + texts[i].length, 0);
      const span = Math.min(d, Math.max(0.05, lineEnd - lineStart));
      const typedChars = t < lineStart ? 0 : Math.ceil(lineChars * clamp((t - lineStart) / span));
      let soFar = 0;
      lineWordChars = new Map<number, number>();
      for (const i of line) {
        const cnt = Math.min(texts[i].length, Math.max(0, typedChars - soFar));
        soFar += texts[i].length;
        lineWordChars.set(i, cnt);
      }
    }

    const range =
      target === 'all'
        ? { start: capStart, end: capEnd }
        : target === 'line'
          ? { start: lineStart, end: lineEnd }
          : undefined;

    const states = line.map((i) => {
      const st = wordState(c.words[i], capStart, t, s, range);
      if (allWordChars) {
        const cnt = allWordChars[i];
        return { ...st, visible: cnt > 0, chars: cnt };
      }
      if (lineWordChars) {
        const cnt = lineWordChars.get(i) ?? 0;
        return { ...st, visible: cnt > 0, chars: cnt };
      }
      return st;
    });

    // Background box behind the visible words of this line.
    if (s.box && (states.some((st) => st.visible) || (target === 'character' && t >= lineStart))) {
      const padX = px * 0.35, padY = px * 0.22;
      ctx.save();
      ctx.globalAlpha = 0.88 * op * Math.min(...states.map((st) => st.alpha));
      ctx.fillStyle = s.box;
      ctx.beginPath();
      ctx.roundRect(x - padX, y + states[0].dy * px - px / 2 - padY, lw + padX * 2, px + padY * 2, px * (s.radius ?? 0.22));
      ctx.fill();
      ctx.restore();
    }

    if (target === 'character' && s.animation !== 'none') {
      line.forEach((i) => {
        const text = texts[i];
        const wordW = widths[i];
        const chars = [...text];
        const numChars = chars.length;
        if (numChars === 0) {
          x += wordW + space;
          return;
        }
        const w = c.words[i];
        const wordDur = Math.max(0.01, w.end - w.start);
        const charSpan = wordDur / numChars;

        chars.forEach((ch, j) => {
          const charStart = w.start + j * charSpan;
          const charEnd = charStart + charSpan;
          const cst = computeAnimState(charStart, charEnd, t, s, 1);
          if (!cst.visible) return;

          const prefix = chars.slice(0, j).join('');
          const charX0 = ctx.measureText(prefix).width;
          const charW = ctx.measureText(ch).width;
          const charCenterX = charX0 + charW / 2;

          ctx.save();
          ctx.globalAlpha = cst.alpha * op;
          // swipe-up: clip so only the bottom portion is revealed
          if (cst.clipY < 1) {
            const revealH = px * cst.clipY;
            ctx.beginPath();
            ctx.rect(x + charCenterX - charW, y - px / 2 + (px - revealH), charW * 2, revealH + px * 0.1);
            ctx.clip();
          }
          ctx.translate(x + charCenterX + cst.dx * px, y + cst.dy * px);
          if (cst.rotation) ctx.rotate(cst.rotation);
          ctx.scale(cst.scaleX, cst.scaleY);
          if (cst.blur > 0) ctx.filter = `blur(${cst.blur.toFixed(1)}px)`;

          // Character-level pill background
          if (cst.pill) {
            ctx.save();
            const pillPadX = px * 0.12, pillPadY = px * 0.14;
            ctx.fillStyle = s.highlight;
            ctx.beginPath();
            ctx.roundRect(-charW / 2 - pillPadX, -px / 2 - pillPadY, charW + pillPadX * 2, px + pillPadY * 2, px * 0.15);
            ctx.fill();
            ctx.restore();
          }

          if (cst.glowBlur > 0) {
            ctx.shadowColor = s.highlight;
            ctx.shadowBlur = cst.glowBlur;
          }

          if (s.outline > 0) {
            ctx.lineWidth = px * s.outline;
            ctx.strokeStyle = s.stroke;
            ctx.strokeText(ch, -charW / 2, 0);
          }

          const textColor = cst.pill ? (s.box || '#111111') : (cst.highlighted ? s.highlight : s.color);
          ctx.fillStyle = textColor;
          ctx.fillText(ch, -charW / 2, 0);
          ctx.restore();
        });

        x += wordW + space;
      });
    } else {
      line.forEach((i, k) => {
        const st = states[k];
        if (st.visible) {
          const text = st.chars === Infinity ? texts[i] : texts[i].slice(0, st.chars);
          const wordW = widths[i];
          ctx.save();
          ctx.globalAlpha = st.alpha * op;
          // swipe-up: clip so only the bottom portion of the word is revealed
          if (st.clipY < 1) {
            const revealH = px * st.clipY;
            ctx.beginPath();
            ctx.rect(x, y - px / 2 + (px - revealH), wordW + space, revealH + px * 0.1);
            ctx.clip();
          }
          ctx.translate(x + wordW / 2 + st.dx * px, y + st.dy * px);
          if (st.rotation) ctx.rotate(st.rotation);
          ctx.scale(st.scaleX, st.scaleY);
          if (st.blur > 0) ctx.filter = `blur(${st.blur.toFixed(1)}px)`;

          // Word-level pill background (CapCut viral pill style)
          if (st.pill) {
            ctx.save();
            const pillPadX = px * 0.22, pillPadY = px * 0.14;
            ctx.fillStyle = s.highlight;
            ctx.beginPath();
            ctx.roundRect(-wordW / 2 - pillPadX, -px / 2 - pillPadY, wordW + pillPadX * 2, px + pillPadY * 2, px * 0.2);
            ctx.fill();
            ctx.restore();
          }

          // Glow blur for neon pulse
          if (st.glowBlur > 0) {
            ctx.shadowColor = s.highlight;
            ctx.shadowBlur = st.glowBlur;
          }

          if (s.outline > 0) {
            ctx.lineWidth = px * s.outline;
            ctx.strokeStyle = s.stroke;
            ctx.strokeText(text, -wordW / 2, 0);
          }

          // Contrast text on active pill
          const textColor = st.pill ? (s.box || '#111111') : (st.highlighted ? s.highlight : s.color);
          ctx.fillStyle = textColor;
          ctx.fillText(text, -wordW / 2, 0);
          ctx.restore();
        }
        x += widths[i] + space;
      });
    }
    y += lh;
  }
  return bounds;
}

// Is point (px, py) inside box b grown by `grow` on every side?
export const inBox = (b: Box | null, px: number, py: number, grow = 0) =>
  !!b && px >= b.x - grow && px <= b.x + b.w + grow && py >= b.y - grow && py <= b.y + b.h + grow;
