// Per-layer compositing: chroma key (green screen), shape masks and blend modes.
// Shared by preview and export (drawOverlay), so both look the same.

export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'lighter', 'darken', 'lighten', 'difference'] as const;
export type Blend = (typeof BLENDS)[number];
export const compositeOp = (b?: Blend): GlobalCompositeOperation => (!b || b === 'normal' ? 'source-over' : b);

// tol: colour distance (0..1) that becomes fully transparent; soft: extra distance faded out on top of that;
// spill: how much of the key colour's tint is removed from the edges that stay (0..1).
export type ChromaKey = { color: string; tol: number; soft: number; spill: number };
export const DEFAULT_KEY: ChromaKey = { color: '#00ff00', tol: 0.3, soft: 0.1, spill: 0.5 };

// rect / ellipse: centred box, w and h fractions of the layer; linear: alpha ramps across the layer at `angle` deg,
// `pos` 0..1 is where the edge sits. feather: fraction of the layer size; invert swaps inside and outside.
export type Mask = { shape: 'rect' | 'ellipse' | 'linear'; w: number; h: number; angle: number; pos: number; feather: number; invert?: boolean };
export const DEFAULT_MASK: Mask = { shape: 'ellipse', w: 0.8, h: 0.8, angle: 90, pos: 0.5, feather: 0.1 };

export const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Chroma key in place on RGBA pixels. Distance is measured in chroma (colour minus brightness), so
// shadows and highlights on a green screen key out too. tol and soft are in units of the key's chroma.
export function keyPixels(d: Uint8ClampedArray, k: ChromaKey): void {
  const [kr, kg, kb] = hexRgb(k.color);
  const ky = 0.299 * kr + 0.587 * kg + 0.114 * kb;
  const kcb = kb - ky, kcr = kr - ky;
  const kmag = Math.hypot(kcb, kcr) || 1;
  const ux = kcb / kmag, uy = kcr / kmag;
  const tol = k.tol, soft = Math.max(1e-3, k.soft);
  // The key's dominant channel, for spill: clamp it to the average of the other two.
  const dom = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    // Distance in units of the key's chroma: off-hue amount, plus a penalty for being too grey,
    // so dark and bright shades of the key colour still match but greys, whites and blacks don't.
    const cb = b - y, cr = r - y, along = cb * ux + cr * uy;
    const dist = Math.hypot(cb - along * ux, cr - along * uy) / kmag + Math.max(0, 0.35 - along / kmag) * 2;
    const a = dist <= tol ? 0 : dist >= tol + soft ? 1 : (dist - tol) / soft;
    if (a < 1) d[i + 3] = Math.round(d[i + 3] * a);
    if (k.spill > 0 && d[i + 3] > 0) {
      const c = d[i + dom], o1 = d[i + ((dom + 1) % 3)], o2 = d[i + ((dom + 2) % 3)], cap = (o1 + o2) / 2;
      // Only pixels tinted towards the key (and not already transparent) lose their tint.
      if (c > cap && (b - y) * kcb + (r - y) * kcr > 0.2 * kmag * Math.hypot(b - y, r - y)) d[i + dom] = c - (c - cap) * k.spill;
    }
  }
}

// Alpha of the mask at layer point (u, v) in 0..1. Used by tests and as the definition of the canvas version.
export function maskAlpha(m: Mask, u: number, v: number, aspect = 1): number {
  const f = Math.max(1e-3, m.feather);
  let a: number;
  if (m.shape === 'linear') {
    const r = (m.angle * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
    // Projection of the point on the gradient axis, 0..1 across the layer.
    const p = ((u - 0.5) * dx * aspect + (v - 0.5) * dy) / (Math.abs(dx) * aspect + Math.abs(dy)) + 0.5;
    a = ramp((p - m.pos) / f + 0.5);
  } else if (m.shape === 'ellipse') {
    const d = Math.hypot((u - 0.5) / (m.w / 2), (v - 0.5) / (m.h / 2)); // 1 on the edge
    a = ramp((1 - d) / (f / Math.min(m.w, m.h) * 2) + 0.5);
  } else {
    const ex = (m.w / 2 - Math.abs(u - 0.5)) / f + 0.5, ey = (m.h / 2 - Math.abs(v - 0.5)) / f + 0.5;
    a = ramp(ex) * ramp(ey);
  }
  return m.invert ? 1 - a : a;
}
const ramp = (x: number) => Math.min(1, Math.max(0, x));

// Apply the mask to a w×h canvas (keeps pixels inside, alpha multiplied).
export function applyMask(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: Mask, w: number, h: number): void {
  c.save();
  c.globalCompositeOperation = 'destination-in';
  const f = Math.max(1, m.feather * Math.min(w, h));
  const stops = (g: CanvasGradient, pairs: [number, number][]) => {
    for (const [at, a] of pairs) g.addColorStop(Math.min(1, Math.max(0, at)), `rgba(0,0,0,${m.invert ? 1 - a : a})`);
    return g;
  };
  if (m.shape === 'linear') {
    const r = (m.angle * Math.PI) / 180, dx = Math.cos(r), dy = Math.sin(r);
    const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    const g = c.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
    const fr = f / (2 * half);
    c.fillStyle = stops(g, [[m.pos - fr / 2, 0], [m.pos + fr / 2, 1]]);
    c.fillRect(0, 0, w, h);
  } else if (m.shape === 'ellipse') {
    const rx = (m.w * w) / 2, ry = (m.h * h) / 2, R = Math.max(1, Math.min(rx, ry));
    c.translate(w / 2, h / 2);
    c.scale(rx / R, ry / R);
    const fr = Math.min(1, f / R);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, R * (1 + fr / 2));
    c.fillStyle = stops(g, [[(1 - fr / 2) / (1 + fr / 2), 1], [1, 0]]);
    c.fillRect(-1e5, -1e5, 2e5, 2e5); // everything outside the gradient is past its last (transparent) stop
  } else {
    // Rectangle = horizontal ramp × vertical ramp (two destination-in passes).
    for (const [len, size] of [[w, m.w], [h, m.h]] as const) {
      const horiz = len === w;
      const g = horiz ? c.createLinearGradient(0, 0, w, 0) : c.createLinearGradient(0, 0, 0, h);
      const a = (1 - size) / 2, fr = f / len;
      // Invert of a rectangle isn't a product of ramps; draw it normally, then flip below.
      g.addColorStop(ramp(a - fr / 2), 'rgba(0,0,0,0)');
      g.addColorStop(ramp(a + fr / 2), 'rgba(0,0,0,1)');
      g.addColorStop(ramp(1 - a - fr / 2), 'rgba(0,0,0,1)');
      g.addColorStop(ramp(1 - a + fr / 2), 'rgba(0,0,0,0)');
      if (!m.invert) {
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
    }
    if (m.invert) {
      // Cut the feathered rectangle out instead.
      c.globalCompositeOperation = 'destination-out';
      c.filter = `blur(${(f / 2).toFixed(1)}px)`;
      c.fillStyle = '#000';
      c.fillRect(((1 - m.w) / 2) * w, ((1 - m.h) / 2) * h, m.w * w, m.h * h);
      c.filter = 'none';
    }
  }
  c.restore();
}

// Reused scratch canvas for keyed / masked layers.
let scratch: { c: OffscreenCanvas | HTMLCanvasElement; x: CanvasRenderingContext2D } | null = null;
function scratchCanvas(w: number, h: number) {
  if (!scratch) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    scratch = { c, x: c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D };
  }
  if (scratch.c.width !== w || scratch.c.height !== h) ((scratch.c.width = w), (scratch.c.height = h));
  return scratch;
}

const MAX_KEY_PX = 1280; // keying runs on the CPU: cap the work per frame

// Draw a cropped source region into a w×h box with key and mask applied; returns a canvas to draw, or null
// when neither is set (draw the source directly).
export function processed(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number,
  key?: ChromaKey, mask?: Mask): CanvasImageSource | null {
  if (!key && !mask) return null;
  const k = Math.min(1, MAX_KEY_PX / Math.max(w, h, 1));
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
  const { c, x } = scratchCanvas(cw, ch);
  x.clearRect(0, 0, cw, ch);
  x.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
  if (key) {
    const img = x.getImageData(0, 0, cw, ch);
    keyPixels(img.data, key);
    x.putImageData(img, 0, 0);
  }
  if (mask) applyMask(x, mask, cw, ch);
  return c;
}
