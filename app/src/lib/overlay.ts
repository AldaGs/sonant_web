import type { Caption } from './captions.ts';
import { processed, keyOpts, compositeOp, type Blend, type ChromaKey, type Mask } from './layerfx.ts';
import { drawCaption, drawText, fontString, resolveStyle, PRESETS, type Style } from './render.ts';

// A layer drawn over the main video: picture-in-picture video, an image, or a text/sticker.
// Placed in OUTPUT time (like music), so word cuts on the main video don't move it.
// Array order is stacking order: later items draw on top.
export type Transform = {
  x: number; y: number; // centre, 0..1 of the frame
  scale: number; // media: width as a fraction of frame width; text: font size multiplier
  rotation: number; // degrees, clockwise
  opacity: number; // 0..1
  flipX?: boolean;
  sx?: number; // live only (title styles): extra horizontal stretch
  crop?: [number, number, number, number]; // media only: left, top, right, bottom, fractions of the source
};
export type Overlay = {
  id: string;
  kind: 'video' | 'image' | 'text';
  at: number; // output time
  len: number; // seconds on screen
  assetId?: string; // video / image
  offset?: number; // video: where in the file it starts
  volume?: number; // video: 0..1
  text?: string; // text
  style?: Partial<Style>; // text: look (on top of its preset)
  tf: Transform; // base transform; flipX and crop always come from here
  kf?: Keyframe[]; // animation: when present, x/y/scale/rotation/opacity come from these (sorted by t)
  motion?: Motion; // animated title: in/out animation and an optional path, layered on top of tf/kf
  behind?: boolean; // drawn behind the person (over the background, under the cutout subject)
  blend?: Blend; // how the layer mixes with what's under it (default normal)
  key?: ChromaKey; // media only: green screen
  mask?: Mask; // media only: shape mask
  maskKf?: MaskKey[]; // mask animation: size / angle / position / feather keyed over the layer's time (sorted by t)
  bar?: ProgressBar; // text layer drawn as a progress bar instead of text
  link?: string; // video: shared with its sound's audio item (see links.ts)
  track?: number; // 0 = V2 (just above the main video); higher tracks draw on top. See tracks.ts
};
// A bar that fills across the frame over the layer's time. h: thickness, fraction of frame height.
export type ProgressBar = { color: string; track: string; h: number; top?: boolean };
// Animated title. The layer animates in over `in` seconds and out over the last `out` seconds.
// With path 's' it travels left to right along a horizontal S curve centred on its transform's x/y.
export type Motion = {
  path: TitlePath;
  style?: TitleStyle; // how it enters and leaves (default 'pop')
  in: number; // seconds
  out: number; // seconds
  span: number; // horizontal travel, fraction of frame width
  amp: number; // height of the S bends, fraction of frame height
};
// Paths: s = sideways S, wave = three bends, arc = rainbow arc, loop = S with a loop-the-loop in the middle,
// zigzag = sharp diagonal switchbacks.
export const TITLE_PATHS = ['none', 's', 'wave', 'arc', 'loop', 'zigzag'] as const;
export type TitlePath = (typeof TITLE_PATHS)[number];
// Styles: pop = fade + grow, drop = falls in with a bounce, spin = spins in/out, swing = swings like a sign,
// stretch = squashes in from wide, flip = turns in edge-on.
export const TITLE_STYLES = ['pop', 'drop', 'spin', 'swing', 'stretch', 'flip'] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number];
export const DEFAULT_MOTION: Motion = { path: 's', in: 0.6, out: 0.6, span: 0.7, amp: 0.08 };
// t is seconds from the layer's start.
export type Keyframe = { t: number; x: number; y: number; scale: number; rotation: number; opacity: number };
export const ANIMATED = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
const KEY_TOL = 1 / 60; // edits this close to a keyframe change that keyframe

const smooth = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2); // ease in-out
// The layer's transform at output time t.
export function tfAt(o: Overlay, t: number): Transform {
  const k = o.kf;
  if (!k?.length) return o.tf;
  const r = t - o.at;
  let a = k[0], b = k[0];
  if (r >= k[k.length - 1].t) a = b = k[k.length - 1];
  else if (r > k[0].t) for (let i = 1; i < k.length; i++) if (r < k[i].t) { a = k[i - 1]; b = k[i]; break; }
  const u = b.t > a.t ? smooth((r - a.t) / (b.t - a.t)) : 0;
  const out = { ...o.tf };
  for (const p of ANIMATED) out[p] = a[p] + (b[p] - a[p]) * u;
  return out;
}
// Point on the S curve at u ∈ 0..1, as an offset from the centre in frame fractions.
// One full sine period across the span: down-bend then up-bend, a sideways S.
export function sPoint(m: Motion, u: number): { dx: number; dy: number } {
  const x = m.span * (u - 0.5), A = m.amp, T = 2 * Math.PI;
  switch (m.path) {
    case 'wave': return { dx: x, dy: -A * Math.sin(3 * T * u) * 0.7 };
    case 'arc': return { dx: x, dy: -A * 2 * Math.sin(Math.PI * u) + A };
    case 'zigzag': { const f = (u * 4) % 1, k = Math.floor(u * 4) % 2; return { dx: x, dy: A * ((k ? 1 - f : f) * 2 - 1) }; }
    case 'loop': {
      // The S, plus a full loop-the-loop in the middle third (x runs backwards briefly, y rises and returns).
      const a = T * Math.max(0, Math.min(1, (u - 1 / 3) * 3));
      return { dx: x + (m.span / 8) * Math.sin(a), dy: -A * Math.sin(T * u) * 0.5 - (1 - Math.cos(a)) * A * 1.5 };
    }
    case 'none': return { dx: 0, dy: 0 };
    default: return { dx: x, dy: -A * Math.sin(T * u) };
  }
}
export const hasPath = (m?: Motion) => !!m && m.path !== 'none';
// Falls and settles with two small bounces.
const bounce = (u: number) => { const n = 7.5625, d = 2.75;
  if (u < 1 / d) return n * u * u; if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375; return n * (u -= 2.625 / d) * u + 0.984375; };
const ease = (u: number) => 1 - (1 - Math.max(0, Math.min(1, u))) ** 3; // ease-out cubic
// Transform actually drawn at output time t: keyframes, then the title's motion on top.
export function liveTf(o: Overlay, t: number, aspect = 16 / 9): Transform {
  const out = styledTf(o, t), m = o.motion;
  if (!m || m.path === 'none') return out;
  const u = pathU(o, t), p = sPoint(m, u);
  out.x += p.dx;
  out.y += p.dy;
  // Tilted along the curve's tangent.
  const q = sPoint(m, Math.min(1, u + 1e-3)), q0 = sPoint(m, Math.max(0, u - 1e-3));
  const ang = Math.atan2((q.dy - q0.dy) / aspect, q.dx - q0.dx || 1e-9) * 180 / Math.PI; // tangent in px
  out.rotation += Math.max(-35, Math.min(35, ang * 0.5));
  return out;
}
// How far along its path (0..1) a title is at output time t: an even pace, easing at the ends.
export const pathU = (o: Overlay, t: number) =>
  0.5 - Math.cos((Math.PI * Math.max(0, Math.min(o.len, t - o.at))) / Math.max(1e-6, o.len)) / 2;
// Keyframes plus the title's in/out style, without the path.
export function styledTf(o: Overlay, t: number): Transform {
  const tf = tfAt(o, t), m = o.motion;
  if (!m) return tf;
  const r = Math.max(0, Math.min(o.len, t - o.at));
  const inU = m.in > 0 ? ease(r / m.in) : 1, outU = m.out > 0 ? ease((o.len - r) / m.out) : 1;
  const out = { ...tf, opacity: tf.opacity * Math.min(1, inU * 1.5) * Math.min(1, outU * 1.5) };
  const ri = m.in > 0 ? Math.min(1, r / m.in) : 1, ro = m.out > 0 ? Math.min(1, (o.len - r) / m.out) : 1; // 0→1 raw
  switch (m.style ?? 'pop') {
    case 'pop': out.opacity = tf.opacity * inU * outU; out.scale = tf.scale * (0.6 + 0.4 * inU) * (1 + 0.15 * (1 - outU)); break;
    case 'drop': out.y = tf.y - 0.3 * (1 - bounce(ri)) + 0.3 * (1 - ease(ro)) ** 2; break;
    case 'spin': out.rotation = tf.rotation - 360 * (1 - inU) + 360 * (1 - outU); out.scale = tf.scale * inU * Math.min(1, 0.2 + outU); break;
    case 'swing': out.rotation = tf.rotation + 40 * Math.exp(-5 * ri) * Math.cos(12 * ri) * (ri < 1 ? 1 : 0) - 30 * (1 - ease(ro)); break;
    case 'stretch': out.sx = 1 + 2 * (1 - inU) + 1.5 * (1 - outU); out.scale = tf.scale / Math.sqrt(out.sx); break;
    case 'flip': out.sx = Math.max(0.02, Math.min(Math.sin((Math.PI / 2) * ri), Math.sin((Math.PI / 2) * ro))); break;
  }
  return out;
}
// Set (or add) the keyframe at layer time t to the given transform.
export function setKey(kf: Keyframe[] = [], t: number, tf: Transform): Keyframe[] {
  const key: Keyframe = { t, x: tf.x, y: tf.y, scale: tf.scale, rotation: tf.rotation, opacity: tf.opacity };
  const i = kf.findIndex((k) => Math.abs(k.t - t) <= KEY_TOL);
  return (i >= 0 ? kf.with(i, { ...key, t: kf[i].t }) : [...kf, key]).sort((x, y) => x.t - y.t);
}
// ---- Mask keyframes (t: seconds from the layer's start). Shape and invert always come from o.mask. ----
export type MaskKey = { t: number; w: number; h: number; angle: number; pos: number; feather: number };
const MASK_NUM = ['w', 'h', 'angle', 'pos', 'feather'] as const;
export function maskAt(o: Overlay, t: number): Mask | undefined {
  const m = o.mask, k = o.maskKf;
  if (!m || !k?.length) return m;
  const r = t - o.at;
  let a = k[0], b = k[0];
  if (r >= k[k.length - 1].t) a = b = k[k.length - 1];
  else if (r > k[0].t) for (let i = 1; i < k.length; i++) if (r < k[i].t) { a = k[i - 1]; b = k[i]; break; }
  const u = b.t > a.t ? smooth((r - a.t) / (b.t - a.t)) : 0;
  const out = { ...m };
  for (const p of MASK_NUM) out[p] = a[p] + (b[p] - a[p]) * u;
  return out;
}
export function setMaskKey(kf: MaskKey[] = [], t: number, m: Mask): MaskKey[] {
  const key: MaskKey = { t, w: m.w, h: m.h, angle: m.angle, pos: m.pos, feather: m.feather };
  const i = kf.findIndex((k) => Math.abs(k.t - t) <= KEY_TOL);
  return (i >= 0 ? kf.with(i, { ...key, t: kf[i].t }) : [...kf, key]).sort((x, y) => x.t - y.t);
}
// Reveal presets over the first `d` seconds of the layer: a wipe (linear) or a growing spotlight (ellipse).
export function maskReveal(kind: 'wipe' | 'spot', d = 0.6): { mask: Mask; maskKf: MaskKey[] } {
  const base: Mask = kind === 'wipe' ? { shape: 'linear', w: 1, h: 1, angle: 180, pos: 1.1, feather: 0.08 } : { shape: 'ellipse', w: 0.02, h: 0.02, angle: 0, pos: 0.5, feather: 0.1 };
  const end = kind === 'wipe' ? { ...base, pos: -0.1 } /* left to right */ : { ...base, w: 1.6, h: 1.6 };
  return { mask: base, maskKf: [setMaskKey([], 0, base)[0], setMaskKey([], d, end)[0]] };
}
export const keyAt = (kf: Keyframe[] | undefined, t: number) => kf?.find((k) => Math.abs(k.t - t) <= KEY_TOL);
export const dropKey = (kf: Keyframe[], t: number) => kf.filter((k) => Math.abs(k.t - t) > KEY_TOL);
// Punch-in preset: grow 20% over half a second from wherever the playhead is.
export function punchKeys(o: Overlay, t: number): Keyframe[] {
  const base = tfAt(o, o.at + t), end = Math.min(o.len, t + 0.5);
  return setKey(setKey(o.kf, t, base), end, { ...base, scale: base.scale * 1.2 });
}

export const DEFAULT_TF: Transform = { x: 0.5, y: 0.5, scale: 0.4, rotation: 0, opacity: 1 };
export const TEXT_PRESET = 'Bold pop';
export const textStyle = (o: Overlay): Style => resolveStyle(PRESETS[TEXT_PRESET] ?? Object.values(PRESETS)[0], o.style);

// Overlays on screen at output time t, bottom first.
export const overlaysAt = (list: Overlay[], t: number) => list.filter((o) => t >= o.at && t < o.at + o.len);

// Stack items into display lanes so overlapping ones don't sit on top of each other. id → lane.
export function lanes(items: { id: string; at: number; len: number }[]): Map<string, number> {
  const ends: number[] = [];
  const out = new Map<string, number>();
  for (const a of [...items].sort((x, y) => x.at - y.at)) {
    let lane = ends.findIndex((e) => e <= a.at + 1e-6);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = a.at + a.len;
    out.set(a.id, lane);
  }
  return out;
}

// Trim one edge by d seconds. Video can't run past its file; everything keeps at least MIN on screen.
const MIN = 0.2;
export function trimOverlay(o: Overlay, side: 'start' | 'end', d: number, assetDur = Infinity): Partial<Overlay> {
  const off = o.offset ?? 0, video = o.kind === 'video';
  if (side === 'end') return { len: Math.max(MIN, Math.min(video ? assetDur - off : Infinity, o.len + d)) };
  const dd = Math.max(video ? -off : -Infinity, -o.at, Math.min(o.len - MIN, d));
  return video ? { at: o.at + dd, offset: off + dd, len: o.len - dd } : { at: o.at + dd, len: o.len - dd };
}

// Where a media overlay sits on a W×H frame (before rotation): centre and size in px.
export function placeMedia(tf: Transform, sw: number, sh: number, W: number, H: number) {
  const [l, t, r, b] = tf.crop ?? [0, 0, 0, 0];
  const cw = sw * Math.max(0.01, 1 - l - r), ch = sh * Math.max(0.01, 1 - t - b);
  const w = tf.scale * W;
  return { cx: tf.x * W, cy: tf.y * H, w, h: (w * ch) / cw, src: [l * sw, t * sh, cw, ch] as const };
}

// A drawn overlay: centre, unrotated size and rotation, in canvas px. Used for hit tests and handles.
export type Placed = { id: string; cx: number; cy: number; w: number; h: number; rot: number };

// Words of a text layer, spread evenly over its time so word animations play.
function textCaption(o: Overlay): Caption {
  const parts = (o.text ?? '').split(/\s+/).filter(Boolean);
  const n = Math.max(1, parts.length), step = o.len / n;
  const words = (parts.length ? parts : [' ']).map((text, i) => ({ text, start: o.at + i * step, end: o.at + (i + 1) * step }));
  return { id: o.id, words };
}

// Draw one overlay at output time t. `src` is the decoded frame/image (null for text or not ready).
export function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay, t: number, src: CanvasImageSource | null, sw: number, sh: number): Placed | null {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (o.bar) return drawBar(ctx, o, t);
  if (o.kind === 'text' && hasPath(o.motion)) return drawOnPath(ctx, o, t);
  const tf = liveTf(o, t, W / H);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, tf.opacity));
  if (o.blend) ctx.globalCompositeOperation = compositeOp(o.blend);
  let placed: Placed | null = null;
  if (o.kind === 'text') {
    const s = textStyle(o);
    // drawCaption centres on (x·W, y·H); move the origin to the layer's centre and draw at 0,0.
    ctx.translate(tf.x * W, tf.y * H);
    ctx.rotate((tf.rotation * Math.PI) / 180);
    if (tf.flipX || tf.sx) ctx.scale((tf.flipX ? -1 : 1) * (tf.sx ?? 1), 1);
    const box = drawCaption(ctx, textCaption(o), t, { ...s, x: 0, y: 0, size: s.size * tf.scale });
    placed = { id: o.id, cx: tf.x * W + (box.x + box.w / 2) * (tf.sx ?? 1), cy: tf.y * H + box.y + box.h / 2, w: box.w * (tf.sx ?? 1), h: box.h, rot: tf.rotation };
  } else if (src && sw && sh) {
    const p = placeMedia(tf, sw, sh, W, H);
    ctx.translate(p.cx, p.cy);
    ctx.rotate((tf.rotation * Math.PI) / 180);
    if (tf.flipX) ctx.scale(-1, 1);
    const fx = processed(src, p.src[0], p.src[1], p.src[2], p.src[3], p.w, p.h, o.key, maskAt(o, t), o.key ? keyOpts() : undefined);
    if (fx) ctx.drawImage(fx, -p.w / 2, -p.h / 2, p.w, p.h);
    else ctx.drawImage(src, p.src[0], p.src[1], p.src[2], p.src[3], -p.w / 2, -p.h / 2, p.w, p.h);
    placed = { id: o.id, cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: tf.rotation };
  }
  ctx.restore();
  return placed;
}

// Progress bar: the track across the whole frame, the fill growing with the layer's time.
export const barProgress = (o: Overlay, t: number) => Math.min(1, Math.max(0, (t - o.at) / Math.max(1e-3, o.len)));
function drawBar(ctx: CanvasRenderingContext2D, o: Overlay, t: number): Placed {
  const W = ctx.canvas.width, H = ctx.canvas.height, b = o.bar!, h = Math.max(2, Math.round(b.h * H));
  const y = b.top ? 0 : H - h;
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, o.tf.opacity));
  if (o.blend) ctx.globalCompositeOperation = compositeOp(o.blend);
  if (b.track) ((ctx.fillStyle = b.track), ctx.fillRect(0, y, W, h));
  ctx.fillStyle = b.color;
  ctx.fillRect(0, y, W * barProgress(o, t), h);
  ctx.restore();
  return { id: o.id, cx: W / 2, cy: y + h / 2, w: W, h: Math.max(h, 12), rot: 0 };
}

// Is canvas point (px, py) inside a placed overlay (rotation respected)? grow = extra margin in px.
export function hitPlaced(p: Placed, px: number, py: number, grow = 0): boolean {
  const a = (-p.rot * Math.PI) / 180, dx = px - p.cx, dy = py - p.cy;
  const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= p.w / 2 + grow && Math.abs(y) <= p.h / 2 + grow;
}

// Corner of a placed overlay in canvas px (sx, sy = ±1), with rotation.
export function corner(p: Placed, sx: number, sy: number, out = 0): { x: number; y: number } {
  const a = (p.rot * Math.PI) / 180, x = sx * (p.w / 2 + out), y = sy * (p.h / 2 + out);
  return { x: p.cx + x * Math.cos(a) - y * Math.sin(a), y: p.cy + x * Math.sin(a) + y * Math.cos(a) };
}

// New overlays.
export const newText = (at: number, text: string): Overlay =>
  ({ id: crypto.randomUUID(), kind: 'text', at, len: 3, text, tf: { ...DEFAULT_TF, y: 0.3, scale: 1 } });
export const newMedia = (kind: 'video' | 'image', assetId: string, at: number, len: number): Overlay =>
  ({ id: crypto.randomUUID(), kind, assetId, at, len, ...(kind === 'video' ? { offset: 0, volume: 0 } : {}),
    tf: { ...DEFAULT_TF, x: 0.72, y: 0.28, scale: 0.4 } });
export const newTitle = (at: number, text: string, len = 4): Overlay =>
  ({ ...newText(at, text), len, motion: { ...DEFAULT_MOTION }, tf: { ...DEFAULT_TF, y: 0.25, scale: 1.2 } });

// A title on a path: each letter sits on the curve, turned to its tangent, and the word slides along it.
// The in/out style (scale, spin, drop, stretch…) is applied to the whole word around its middle.
function drawOnPath(ctx: CanvasRenderingContext2D, o: Overlay, t: number): Placed {
  const W = ctx.canvas.width, H = ctx.canvas.height, m = o.motion!, base = tfAt(o, t), st = styledTf(o, t);
  const s = textStyle(o), px = Math.max(1, Math.round(s.size * H * base.scale));
  // The path in canvas px, measured by length.
  const N = 200, pts: { x: number; y: number }[] = [], len = [0];
  for (let i = 0; i <= N; i++) {
    const p = sPoint(m, i / N);
    pts.push({ x: (base.x + p.dx) * W, y: (base.y + p.dy) * H });
    if (i) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = len[N];
  // Point and angle at arc length d; past either end, carry on straight along the end's tangent.
  const at = (d: number) => {
    let i = 1;
    if (d >= total) i = N;
    else while (i < N && len[i] < d) i++;
    const a = pts[i - 1], b = pts[i], seg = len[i] - len[i - 1] || 1e-6, f = (d - len[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, a: Math.atan2(b.y - a.y, b.x - a.x) };
  };
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, st.opacity));
  ctx.font = fontString(s, px);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  const text = (o.text ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...(s.uppercase ? text.toUpperCase() : text)];
  const gap = (s.letterSpacing ?? 0) * px, widths = chars.map((c) => ctx.measureText(c).width + gap);
  const tw = widths.reduce((a, w) => a + w, 0);
  const mid = at(pathU(o, t) * total);
  // Style transform around the word's middle: drop offset, spin/swing, scale, stretch, flip.
  const k = base.scale ? st.scale / base.scale : 1;
  ctx.translate(mid.x + (st.x - base.x) * W, mid.y + (st.y - base.y) * H);
  ctx.rotate((st.rotation * Math.PI) / 180);
  ctx.scale(k * (st.sx ?? 1) * (st.flipX ? -1 : 1), k);
  ctx.translate(-mid.x, -mid.y);
  let d = pathU(o, t) * total - tw / 2, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [i, ch] of chars.entries()) {
    const w = widths[i], p = at(d + w / 2);
    d += w;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    if (ch === ' ') continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    drawText(ctx, s, px, ch, -(w - gap) / 2, s.color, 0);
    ctx.restore();
  }
  ctx.restore();
  // Hit box: the letters' bounds, unrotated, with the style transform's offset and scale.
  const kx = k * (st.sx ?? 1), pad = px * 0.6;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { id: o.id, cx: mid.x + (st.x - base.x) * W + (cx - mid.x) * kx, cy: mid.y + (st.y - base.y) * H + (cy - mid.y) * k,
    w: Math.max(px, (x1 - x0 + pad * 2) * Math.abs(kx)), h: Math.max(px, (y1 - y0 + pad * 2) * k), rot: 0 };
}
