import type { Caption } from './captions.ts';

// Smart auto-zoom: a quick punch-in on emphasized words (and optionally at sentence starts).
// Moments are in sequence time, like captions, so word cuts drop them with the words.
export type AutoZoom = { scale: number; gap: number; sentences: boolean }; // gap: shortest time between two zoom starts (s)
export const DEFAULT_AUTOZOOM: AutoZoom = { scale: 1.15, gap: 2.5, sentences: false };
export type ZoomMoment = { start: number; end: number };

export const ZOOM_EASE_IN = 0.18; // s
export const ZOOM_EASE_OUT = 0.35;
const HOLD = 0.6; // s kept zoomed after the word ends

// Pass captions that are already filtered to kept words (keptCaptions).
export function zoomMoments(caps: Caption[], o: Pick<AutoZoom, 'gap' | 'sentences'>): ZoomMoment[] {
  const words = caps.flatMap((c) => c.words).sort((a, b) => a.start - b.start);
  const out: ZoomMoment[] = [];
  let last = -Infinity;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const sentence = o.sentences && (!prev || /[.!?]$/.test(prev.text.trim()));
    if (!w.em && !sentence) return;
    if (w.start - last < o.gap) return;
    last = w.start;
    out.push({ start: w.start, end: w.end + HOLD });
  });
  // A zoom ends before the next one starts, so they never stack.
  for (let i = 0; i + 1 < out.length; i++) out[i].end = Math.min(out[i].end, out[i + 1].start - ZOOM_EASE_OUT);
  return out;
}

const easeOut = (u: number) => 1 - (1 - u) ** 3;
const clamp = (u: number) => Math.min(1, Math.max(0, u));

// Zoom factor at sequence time t (1 = none).
export function autoZoomAt(m: ZoomMoment[], scale: number, t: number): number {
  const z = m.find((x) => t >= x.start && t < x.end + ZOOM_EASE_OUT);
  if (!z) return 1;
  const u = t < z.end ? easeOut(clamp((t - z.start) / ZOOM_EASE_IN)) : 1 - easeOut(clamp((t - z.end) / ZOOM_EASE_OUT));
  return 1 + (scale - 1) * u;
}

// Scale a draw rect [x, y, w, h] around the frame centre.
export function scalePlace(place: number[], W: number, H: number, k: number): number[] {
  if (k === 1) return place;
  const [x, y, w, h] = place;
  return [W / 2 + (x - W / 2) * k, H / 2 + (y - H / 2) * k, w * k, h * k];
}
