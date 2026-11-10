// Layer transitions (in / out) and audio volume envelopes. Shared by the preview, the player and export.

// ---- Layer transitions ----
// in: how the layer appears over its first `d` seconds; out: how it leaves over its last `d` seconds.
export const LAYER_TRANS = ['fade', 'zoom', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'wipe'] as const;
export type LayerTransKind = (typeof LAYER_TRANS)[number];
export type LayerTrans = { kind: LayerTransKind; d: number };

const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const ease = (u: number) => 1 - (1 - clamp01(u)) ** 3; // ease-out cubic

/** 0 = not visible yet / gone, 1 = fully on: how far through a transition the layer is at output time t. */
export function transU(o: { at: number; len: number; trIn?: LayerTrans; trOut?: LayerTrans }, t: number): { inU: number; outU: number } {
  const r = t - o.at;
  return {
    inU: o.trIn && o.trIn.d > 0 ? ease(r / o.trIn.d) : 1,
    outU: o.trOut && o.trOut.d > 0 ? ease((o.len - r) / o.trOut.d) : 1,
  };
}

type Tf = { x: number; y: number; scale: number; opacity: number };
/**
 * Apply a layer's transitions to its transform at output time t. Returns the transform and, for wipes,
 * the visible horizontal band of the frame [x0, x1] as fractions (draw clipped to it).
 * Slides enter from (or leave towards) the named side: "slide-left" comes in from the left.
 */
export function applyTrans<T extends Tf>(o: { at: number; len: number; trIn?: LayerTrans; trOut?: LayerTrans }, t: number, tf: T): { tf: T; clip?: [number, number] } {
  const { inU, outU } = transU(o, t);
  const out = { ...tf };
  let clip: [number, number] | undefined;
  const one = (k: LayerTransKind | undefined, u: number, entering: boolean) => {
    if (!k || u >= 1) return;
    const off = 1 - u; // how far from resting
    switch (k) {
      case 'fade': out.opacity *= u; break;
      case 'zoom': out.scale *= 0.5 + 0.5 * u; out.opacity *= u; break;
      case 'slide-left': out.x -= off * (out.x + 0.6); break; // all the way off the left edge
      case 'slide-right': out.x += off * (1.6 - out.x); break;
      case 'slide-up': out.y -= off * (out.y + 0.6); break;
      case 'slide-down': out.y += off * (1.6 - out.y); break;
      case 'wipe': {
        // In: revealed left → right. Out: hidden left → right.
        const c: [number, number] = entering ? [0, u] : [1 - u, 1];
        clip = clip ? [Math.max(clip[0], c[0]), Math.min(clip[1], c[1])] : c;
        break;
      }
    }
  };
  one(o.trIn?.kind, inU, true);
  one(o.trOut?.kind, outU, false);
  return { tf: out, clip };
}

// ---- Audio volume envelope ----
// volKf: volume points (t: seconds from the item's start, v: gain 0..1.5 on top of the item's volume),
// joined by straight lines and held flat before the first / after the last. fadeIn / fadeOut: seconds.
export type VolKey = { t: number; v: number };
export type Envelope = { volKf?: VolKey[]; fadeIn?: number; fadeOut?: number };

/** Gain multiplier r seconds into an item of length len. */
export function envelopeAt(a: Envelope, r: number, len: number): number {
  let g = 1;
  const k = a.volKf;
  if (k?.length) {
    if (r <= k[0].t) g = k[0].v;
    else if (r >= k[k.length - 1].t) g = k[k.length - 1].v;
    else for (let i = 1; i < k.length; i++) if (r < k[i].t) {
      const p = k[i - 1], q = k[i];
      g = p.v + ((q.v - p.v) * (r - p.t)) / Math.max(1e-6, q.t - p.t);
      break;
    }
  }
  if (a.fadeIn && a.fadeIn > 0) g *= clamp01(r / a.fadeIn);
  if (a.fadeOut && a.fadeOut > 0) g *= clamp01((len - r) / a.fadeOut);
  return g;
}
export const hasEnvelope = (a: Envelope) => !!(a.volKf?.length || a.fadeIn || a.fadeOut);

/** Add (or replace, within 50 ms) a volume point, keeping them sorted. */
export function setVolKey(kf: VolKey[] = [], t: number, v: number): VolKey[] {
  const keep = kf.filter((k) => Math.abs(k.t - t) > 0.05);
  return [...keep, { t: Math.max(0, t), v: Math.max(0, Math.min(1.5, v)) }].sort((a, b) => a.t - b.t);
}
