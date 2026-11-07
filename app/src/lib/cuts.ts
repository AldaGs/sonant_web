import type { Caption } from './captions';

// Kept ranges of the source video, in source seconds, sorted and non-overlapping.
export type Segment = { start: number; end: number };

const MIN = 0.1; // shortest segment allowed

export const outDuration = (segs: Segment[]) => segs.reduce((a, s) => a + s.end - s.start, 0);

// Remove [a, b) from the kept ranges. Slivers under 20ms are dropped. Keeps at least one segment.
export function cutRange(segs: Segment[], a: number, b: number): Segment[] {
  if (!(b > a)) return segs;
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.end <= a || s.start >= b) out.push(s);
    else {
      if (a - s.start > 0.02) out.push({ start: s.start, end: a });
      if (s.end - b > 0.02) out.push({ start: b, end: s.end });
    }
  }
  return out.length ? out : segs;
}

// Add [a, b) back. Segments it overlaps or touches are merged with it; others stay as they are.
export function keepRange(segs: Segment[], a: number, b: number): Segment[] {
  if (!(b > a)) return segs;
  let start = a, end = b;
  const rest: Segment[] = [];
  for (const s of segs) {
    if (s.end >= a - 0.02 && s.start <= b + 0.02) ((start = Math.min(start, s.start)), (end = Math.max(end, s.end)));
    else rest.push(s);
  }
  return [...rest, { start, end }].sort((x, y) => x.start - y.start);
}

// A word counts as cut when its middle falls outside every kept range.
export const isCut = (segs: Segment[], w: { start: number; end: number }) =>
  toOutput(segs, (w.start + w.end) / 2) === null;

// Captions without their cut words (source time), for drawing.
export function keptCaptions(caps: Caption[], segs: Segment[]): Caption[] {
  return caps.flatMap((c) => {
    const words = c.words.filter((w) => !isCut(segs, w));
    return words.length ? [words.length === c.words.length ? c : { ...c, words }] : [];
  });
}

export function splitAt(segs: Segment[], t: number): Segment[] {
  const i = segs.findIndex((s) => t > s.start + MIN && t < s.end - MIN);
  if (i < 0) return segs;
  const s = segs[i];
  return segs.toSpliced(i, 1, { start: s.start, end: t }, { start: t, end: s.end });
}

export const remove = (segs: Segment[], i: number) => (segs.length > 1 ? segs.toSpliced(i, 1) : segs);

// Trim a segment's edges, never past its neighbours or the source bounds.
export function trim(segs: Segment[], i: number, start: number, end: number, duration: number): Segment[] {
  const lo = i > 0 ? segs[i - 1].end : 0;
  const hi = i < segs.length - 1 ? segs[i + 1].start : duration;
  start = Math.max(lo, start);
  end = Math.min(hi, end);
  if (end - start < MIN) return segs;
  return segs.with(i, { start, end });
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
