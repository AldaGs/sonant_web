// Gaps on V1. The main sequence is a list of clips that play back to back; a gap is a clip with no media
// (assetId ''), shown black and silent. Its strip is always one lifted segment, so cuts, captions and export
// treat it like any other lifted (black) strip. Gaps let clips sit anywhere on V1, like an NLE:
// dropping or moving a clip past the end leaves empty time before it, moving a clip out leaves a gap behind.
// A trailing gap pads V1 so the sequence lasts until the last layer or audio item ends.
import { clipLen, clipStarts, remapProject, type Clip } from './project.ts';
import { nextKept, outDuration, toOutput, type Segment } from './cuts.ts';
import type { Caption } from './captions.ts';

type Durations = Map<string, number> | Record<string, number>;
const EPS = 1e-6;
const MIN_GAP = 0.05; // shorter gaps are dropped
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export const isGap = (c: Clip) => !c.assetId;
export const gapClip = (len: number): Clip => ({ id: crypto.randomUUID(), assetId: '', len: r3(len) });

/** Output span [start, end) of each clip: from the output time of its first kept moment to that of the next clip. */
export function clipSpans(clips: Clip[], d: Durations, segs: Segment[]): [number, number][] {
  const total = outDuration(segs);
  const outAt = (t: number) => {
    const k = nextKept(segs, t);
    return k === null ? total : toOutput(segs, k) ?? total;
  };
  const starts = clipStarts(clips, d);
  return clips.map((c, i) => [outAt(starts[i]), i + 1 < clips.length ? outAt(starts[i + 1]) : total]);
}

/**
 * Put `clip` (lasting `len` output seconds) on V1 so it starts at output time `out`.
 * Past the end: a gap fills the time before it. Inside a gap: it takes that part of the gap (what's left of
 * the gap stays on both sides; if the clip is longer than the gap, later clips move later).
 * Over a clip: it's inserted at that clip's nearest edge and later clips move later (insert edit).
 * `spans` are the output spans of `clips` (see clipSpans).
 */
export function placeClip(clips: Clip[], spans: [number, number][], clip: Clip, out: number, len: number): Clip[] {
  const last = clips.findLastIndex((c) => !isGap(c));
  const end = last < 0 ? 0 : spans[last][1];
  if (out >= end - MIN_GAP) {
    const g = out - end;
    return [...clips.slice(0, last + 1), ...(g >= MIN_GAP ? [gapClip(g)] : []), clip];
  }
  const j = spans.findIndex(([a, b]) => out >= a - EPS && out < b - EPS);
  if (j < 0) return [clip, ...clips];
  const [a, b] = spans[j];
  if (isGap(clips[j])) {
    const before = out - a, after = b - out - len;
    return clips.toSpliced(j, 1, ...(before >= MIN_GAP ? [gapClip(before)] : []), clip, ...(after >= MIN_GAP ? [gapClip(after)] : []));
  }
  return clips.toSpliced(out - a < b - out ? j : j + 1, 0, clip);
}

/**
 * Keep the gaps on V1 tidy, after any edit:
 * - a gap is as long as what's still kept of it (deleting a gap's strip closes it up), and empty gaps go;
 * - neighbouring gaps merge; each gap is exactly one lifted strip (it keeps a transition set on it);
 * - V1 ends with its last clip, or with a gap that lasts until `minEnd` (the end of the last layer / audio item).
 * Returns null when nothing changes.
 */
export function tidyGaps(clips: Clip[], d: Durations, segs: Segment[], caps: Caption[], minEnd: number):
  { clips: Clip[]; segments: Segment[]; captions: Caption[] } | null {
  const starts = clipStarts(clips, d);
  const kept = (a: number, b: number) => segs.reduce((n, g) => n + Math.max(0, Math.min(b, g.end) - Math.max(a, g.start)), 0);
  const fxOf = new Map<string, Segment['fx']>();
  let next: Clip[] = [];
  clips.forEach((c, i) => {
    if (!isGap(c)) return void next.push(c);
    const s0 = starts[i], s1 = s0 + clipLen(d, c), len = r3(kept(s0, s1));
    if (len < MIN_GAP) return;
    const prev = next.at(-1);
    const g = segs.find((x) => x.start >= s0 - EPS && x.start < s1 - EPS);
    if (prev && isGap(prev)) return void (next[next.length - 1] = { ...prev, len: r3((prev.len ?? 0) + len) });
    next.push(c.len === len ? c : { ...c, len });
    if (g?.fx?.trans) fxOf.set(c.id, { trans: g.fx.trans, transDur: g.fx.transDur });
  });
  while (next.length && isGap(next.at(-1)!)) next.pop();
  const rebuilt = (list: Clip[]) => {
    const r = remapProject(clips, list, d, segs, caps);
    const st = clipStarts(list, d), gaps = list.flatMap((c, i) => (isGap(c) ? [[st[i], st[i] + clipLen(d, c), c.id] as const] : []));
    const inGap = (g: Segment) => gaps.some(([a, b]) => g.start >= a - EPS && g.end <= b + EPS);
    const out = r.segments.filter((g) => !inGap(g));
    for (const [a, b, id] of gaps) out.push({ start: a, end: b, fx: { ...fxOf.get(id), lift: true } });
    out.sort((x, y) => x.start - y.start);
    return { clips: list, segments: out, captions: r.captions };
  };
  let res = rebuilt(next);
  const pad = r3(minEnd - outDuration(res.segments));
  if (pad >= MIN_GAP) {
    const tail = clips.at(-1);
    next = [...next, tail && isGap(tail) && !next.includes(tail) ? { ...tail, len: pad } : gapClip(pad)];
    res = rebuilt(next);
  }
  const same = res.clips.length === clips.length && res.clips.every((c, i) => c.id === clips[i].id && c.len === clips[i].len)
    && res.segments.length === segs.length && res.segments.every((g, i) => Math.abs(g.start - segs[i].start) < EPS && Math.abs(g.end - segs[i].end) < EPS && !!g.fx?.lift === !!segs[i].fx?.lift);
  return same ? null : res;
}
