import type { Caption } from './captions';

// Kept ranges of the source video, in source seconds, sorted and non-overlapping.
// fx: per-strip effects. behind = captions behind the person; bg = swap the background.
// zoom: punch-in factor (1 = none); zoomIn: ease into it over the strip's first ZOOM_IN seconds.
// lift: the strip keeps its time on the timeline but shows black, plays silent and hides captions (a gap).
export type Fx = { behind?: boolean; bg?: 'color' | 'blur'; bgColor?: string; zoom?: number; zoomIn?: boolean; lift?: boolean };

export const PUNCH_IN = 1.25;
export const ZOOM_IN = 0.4; // seconds
// Scale a draw rect [x, y, w, h] around the frame centre (W×H) for a strip's punch-in, `into` seconds into the strip.
export function zoomPlace(place: number[], W: number, H: number, fx: Fx | undefined, into: number): number[] {
  const z = fx?.zoom ?? 1;
  if (z === 1) return place;
  const u = fx?.zoomIn ? Math.min(1, Math.max(0, into / ZOOM_IN)) : 1;
  const k = 1 + (z - 1) * (1 - (1 - u) ** 3); // ease-out
  const [x, y, w, h] = place;
  return [W / 2 + (x - W / 2) * k, H / 2 + (y - H / 2) * k, w * k, h * k];
}
// The kept segment containing sequence time t.
export const segAt = (segs: Segment[], t: number) => segs.find((s) => t >= s.start && t < s.end);
export type Segment = { start: number; end: number; fx?: Fx };

const MIN = 0.1; // shortest segment allowed

export const outDuration = (segs: Segment[]) => segs.reduce((a, s) => a + s.end - s.start, 0);

// Remove [a, b) from the kept ranges. Slivers under 20ms are dropped. Keeps at least one segment.
export function cutRange(segs: Segment[], a: number, b: number): Segment[] {
  if (!(b > a)) return segs;
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.end <= a || s.start >= b) out.push(s);
    else {
      if (a - s.start > 0.02) out.push({ ...s, end: a });
      if (s.end - b > 0.02) out.push({ ...s, start: b });
    }
  }
  return out.length ? out : segs;
}

// Add [a, b) back. Segments it overlaps or touches are merged with it; others stay as they are.
export function keepRange(segs: Segment[], a: number, b: number): Segment[] {
  if (!(b > a)) return segs;
  let start = a, end = b, fx: Fx | undefined;
  const rest: Segment[] = [];
  for (const s of segs) {
    if (s.end >= a - 0.02 && s.start <= b + 0.02) ((start = Math.min(start, s.start)), (end = Math.max(end, s.end)), (fx ??= s.fx));
    else rest.push(s);
  }
  return [...rest, fx ? { start, end, fx } : { start, end }].sort((x, y) => x.start - y.start);
}

// A word counts as cut when its middle falls outside every kept range.
export const isCut = (segs: Segment[], w: { start: number; end: number }) =>
  toOutput(segs, (w.start + w.end) / 2) === null;

// Captions without their cut words (source time), for drawing.
export function keptCaptions(caps: Caption[], segs: Segment[]): Caption[] {
  segs = segs.filter((s) => !s.fx?.lift); // words in a lifted gap aren't shown either
  return caps.flatMap((c) => {
    const words = c.words.filter((w) => !isCut(segs, w));
    return words.length ? [words.length === c.words.length ? c : { ...c, words }] : [];
  });
}

export function splitAt(segs: Segment[], t: number): Segment[] {
  const i = segs.findIndex((s) => t > s.start + MIN && t < s.end - MIN);
  if (i < 0) return segs;
  const s = segs[i];
  return segs.toSpliced(i, 1, { ...s, end: t }, { ...s, start: t });
}

export const remove = (segs: Segment[], i: number) => (segs.length > 1 ? segs.toSpliced(i, 1) : segs);

// Trim a segment's edges, never past its neighbours or the source bounds.
export function trim(segs: Segment[], i: number, start: number, end: number, duration: number): Segment[] {
  const lo = i > 0 ? segs[i - 1].end : 0;
  const hi = i < segs.length - 1 ? segs[i + 1].start : duration;
  start = Math.max(lo, start);
  end = Math.min(hi, end);
  if (end - start < MIN) return segs;
  return segs.with(i, { ...segs[i], start, end });
}

export function toSource(segs: Segment[], out: number): number {
  for (const s of segs) {
    const len = s.end - s.start;
    if (out < len) return s.start + Math.max(0, out);
    out -= len;
  }
  return segs.length ? segs[segs.length - 1].end : 0;
}

// Output time for a source time, or null if that moment was cut.
export function toOutput(segs: Segment[], src: number): number | null {
  let acc = 0;
  for (const s of segs) {
    if (src >= s.start && src < s.end) return acc + src - s.start;
    acc += s.end - s.start;
  }
  return null;
}

// Where playback should be: t itself if kept, else the next kept start, else null (end).
export function nextKept(segs: Segment[], t: number): number | null {
  for (const s of segs) {
    if (t < s.start) return s.start;
    if (t < s.end) return t;
  }
  return null;
}

// Captions in output time; words that fall in cut ranges are dropped.
export function captionsForOutput(caps: Caption[], segs: Segment[]): Caption[] {
  const out: Caption[] = [];
  for (const c of caps) {
    const words = c.words.flatMap((w) => {
      const s = toOutput(segs, w.start);
      if (s === null) return [];
      const e = toOutput(segs, Math.max(w.start, w.end - 1e-6)) ?? s + 0.05;
      return [{ ...w, start: s, end: Math.max(e, s + 0.05) }];
    });
    if (words.length) out.push({ ...c, words });
  }
  return out;
}
