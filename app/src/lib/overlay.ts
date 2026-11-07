import type { Caption } from './captions.ts';
import { drawCaption, resolveStyle, PRESETS, type Style } from './render.ts';

// A layer drawn over the main video: picture-in-picture video, an image, or a text/sticker.
// Placed in OUTPUT time (like music), so word cuts on the main video don't move it.
// Array order is stacking order: later items draw on top.
export type Transform = {
  x: number; y: number; // centre, 0..1 of the frame
  scale: number; // media: width as a fraction of frame width; text: font size multiplier
  rotation: number; // degrees, clockwise
  opacity: number; // 0..1
  flipX?: boolean;
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
};
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
// Set (or add) the keyframe at layer time t to the given transform.
export function setKey(kf: Keyframe[] = [], t: number, tf: Transform): Keyframe[] {
  const key: Keyframe = { t, x: tf.x, y: tf.y, scale: tf.scale, rotation: tf.rotation, opacity: tf.opacity };
  const i = kf.findIndex((k) => Math.abs(k.t - t) <= KEY_TOL);
  return (i >= 0 ? kf.with(i, { ...key, t: kf[i].t }) : [...kf, key]).sort((x, y) => x.t - y.t);
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
  const W = ctx.canvas.width, H = ctx.canvas.height, tf = tfAt(o, t);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, tf.opacity));
  let placed: Placed | null = null;
  if (o.kind === 'text') {
    const s = textStyle(o);
    // drawCaption centres on (x·W, y·H); move the origin to the layer's centre and draw at 0,0.
    ctx.translate(tf.x * W, tf.y * H);
    ctx.rotate((tf.rotation * Math.PI) / 180);
    if (tf.flipX) ctx.scale(-1, 1);
    const box = drawCaption(ctx, textCaption(o), t, { ...s, x: 0, y: 0, size: s.size * tf.scale });
    placed = { id: o.id, cx: tf.x * W + box.x + box.w / 2, cy: tf.y * H + box.y + box.h / 2, w: box.w, h: box.h, rot: tf.rotation };
  } else if (src && sw && sh) {
    const p = placeMedia(tf, sw, sh, W, H);
    ctx.translate(p.cx, p.cy);
    ctx.rotate((tf.rotation * Math.PI) / 180);
    if (tf.flipX) ctx.scale(-1, 1);
    ctx.drawImage(src, p.src[0], p.src[1], p.src[2], p.src[3], -p.w / 2, -p.h / 2, p.w, p.h);
    placed = { id: o.id, cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: tf.rotation };
  }
  ctx.restore();
  return placed;
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
