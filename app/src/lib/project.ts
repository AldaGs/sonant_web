import type { Caption } from './captions';
import type { Segment } from './cuts';

// Media the user imported. Files live in IndexedDB under `asset:<id>`.
// beats/bpm: detected beat times (file time) for music, once the user asks for them.
export type Asset = { id: string; name: string; kind: 'video' | 'audio' | 'image'; duration: number; width?: number; height?: number; beats?: number[]; bpm?: number; proxy?: boolean };
// A video clip on the video track. Clips play back to back; together they form the "sequence".
// Sequence time is what segments, captions and words are measured in.
// in: where in the file the clip starts (video; default 0). len: how long it plays (default: the rest of the file;
// image clips use it for their length). A clip shows file time [in, in + len).
export type Clip = { id: string; assetId: string; len?: number; in?: number };
export const STILL_LEN = 5; // default seconds for an image clip
// An extra audio item (music, voiceover), placed in OUTPUT time so word cuts don't move it.
// offset/len trim the file: it plays [offset, offset + len) of the asset, starting at `at`.
// duck: lower this item's volume while someone is speaking (see DUCK_LEVEL).
// vfx: voice changer applied (assetId then points at the rendered copy, src at the original file).
export type AudioItem = { id: string; assetId: string; at: number; volume: number; offset?: number; len?: number; duck?: boolean;
  vfx?: import('./voicefx').VoiceFx; dn?: number /* noise reduction level */; src?: string;
  link?: string /* shared with the video layer this is the sound of (links.ts) */;
  track?: number /* 0 = A2, the first track under the clips' own sound; see tracks.ts */ };
export const DUCK_LEVEL = 0.25; // ≈ −12 dB under speech

// How long an audio item plays (its trimmed length, or the rest of the file).
export const itemLen = (a: AudioItem, assetDur: number) => Math.max(0, Math.min(a.len ?? Infinity, assetDur - (a.offset ?? 0)));

// Stack audio items into lanes so overlapping ones don't sit on top of each other. Returns item id → lane.
export function audioLanes(items: AudioItem[], durOf: (assetId: string) => number): Map<string, number> {
  const ends: number[] = []; // end time of the last item in each lane
  const out = new Map<string, number>();
  for (const a of [...items].sort((x, y) => x.at - y.at)) {
    let lane = ends.findIndex((e) => e <= a.at + 1e-6);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = a.at + itemLen(a, durOf(a.assetId));
    out.set(a.id, lane);
  }
  return out;
}

// Trim an audio item from one edge by d seconds (output time), within the file and a 0.2s minimum.
export function trimAudio(a: AudioItem, assetDur: number, side: 'start' | 'end', d: number): Partial<AudioItem> {
  const off = a.offset ?? 0, len = itemLen(a, assetDur);
  if (side === 'end') return { len: Math.max(0.2, Math.min(assetDur - off, len + d)) };
  const dd = Math.max(-off, -a.at, Math.min(len - 0.2, d));
  return { at: a.at + dd, offset: off + dd, len: len - dd };
}

type Durations = Record<string, number> | Map<string, number>;
const dur = (d: Durations, id: string) => (d instanceof Map ? d.get(id) : d[id]) ?? 0;
// A clip's length in the sequence: its own len if set, otherwise the rest of its file from `in`.
export const clipLen = (d: Durations, c: Clip) => c.len ?? Math.max(0, dur(d, c.assetId) - (c.in ?? 0));
// Sequence time where each clip's file time 0 would be (start − in): file time = sequence time − base.
export const clipBases = (clips: Clip[], d: Durations) => clipStarts(clips, d).map((s, i) => s - (clips[i].in ?? 0));

// Sequence start of each clip.
export function clipStarts(clips: Clip[], d: Durations): number[] {
  let acc = 0;
  return clips.map((c) => {
    const s = acc;
    acc += clipLen(d, c);
    return s;
  });
}

export const seqDuration = (clips: Clip[], d: Durations) => clips.reduce((a, c) => a + clipLen(d, c), 0);

// Which clip plays at sequence time t: local = seconds into the clip, file = time in its asset (in + local).
export function clipAt(clips: Clip[], d: Durations, t: number): { index: number; local: number; file: number } | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = clipLen(d, clips[i]);
    if (t < acc + len || i === clips.length - 1) {
      if (!(t >= acc - 1e-9 && t <= acc + len + 1e-9)) return null;
      const local = Math.min(len, t - acc);
      return { index: i, local, file: (clips[i].in ?? 0) + local };
    }
    acc += len;
  }
  return null;
}

// Split kept segments so none crosses a clip boundary.
export function splitAtBoundaries(segs: Segment[], starts: number[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    let a = s.start;
    for (const b of starts) if (b > a + 1e-6 && b < s.end - 1e-6) (out.push({ ...s, start: a, end: b }), (a = b));
    out.push({ ...s, start: a });
  }
  return out;
}

// After clips are added, removed or reordered: move every segment and word to its clip's new position.
// Clips that are new get a fully kept segment; content of removed clips is dropped.
export function remapProject(
  oldClips: Clip[], newClips: Clip[], d: Durations, segments: Segment[], captions: Caption[],
): { segments: Segment[]; captions: Caption[] } {
  const oldStarts = clipStarts(oldClips, d), newStarts = clipStarts(newClips, d);
  const oldBases = clipBases(oldClips, d), newBases = clipBases(newClips, d);
  const newById = new Map(newClips.map((c, i) => [c.id, i]));
  // Shift for sequence time t under the old layout, or null if its clip is gone (or no longer shows that moment).
  // Content follows its file time, so changing a clip's `in` keeps every word on its frame.
  const shift = (t: number) => {
    const at = clipAt(oldClips, d, t);
    if (!at) return null;
    const j = newById.get(oldClips[at.index].id);
    if (j === undefined) return null;
    const k = newBases[j] - oldBases[at.index], nt = t + k;
    return nt >= newStarts[j] - 1e-6 && nt <= newStarts[j] + clipLen(d, newClips[j]) + 1e-6 ? k : null;
  };

  const segs: Segment[] = [];
  for (const s of splitAtBoundaries(segments, oldStarts)) {
    const k = shift((s.start + s.end) / 2);
    if (k !== null) segs.push({ ...s, start: s.start + k, end: s.end + k });
  }
  const oldIds = new Set(oldClips.map((c) => c.id));
  newClips.forEach((c, i) => {
    if (!oldIds.has(c.id)) segs.push({ start: newStarts[i], end: newStarts[i] + clipLen(d, c) });
  });
  segs.sort((a, b) => a.start - b.start);

  const caps = captions.flatMap((c) => {
    const words = c.words.flatMap((w) => {
      const k = shift((w.start + w.end) / 2);
      return k === null ? [] : [{ ...w, start: w.start + k, end: w.end + k }];
    });
    return words.length ? [{ ...c, words }] : [];
  });
  caps.sort((a, b) => a.words[0].start - b.words[0].start);
  return { segments: segs, captions: caps };
}

// Move an item one step in a list.
export const move = <T>(list: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

// Change one clip's length (image clips). The clip comes back as one fully kept strip (keeping its first
// strip's effects); everything after it moves with the new length.
export function resizeClip(
  clips: Clip[], i: number, len: number, d: Durations, segments: Segment[], captions: Caption[],
): { clips: Clip[]; segments: Segment[]; captions: Caption[] } {
  const next = clips.with(i, { ...clips[i], len: Math.max(0.5, Math.round(len * 10) / 10) });
  const old = clipStarts(clips, d), a = old[i], b = a + clipLen(d, clips[i]);
  const fx = segments.find((s) => s.start >= a - 1e-6 && s.start < b)?.fx;
  const r = remapProject(clips, next, d, segments, captions);
  const s0 = clipStarts(next, d)[i], s1 = s0 + clipLen(d, next[i]);
  const segs = r.segments.filter((s) => s.end <= s0 + 1e-6 || s.start >= s1 - 1e-6);
  segs.push(fx ? { start: s0, end: s1, fx } : { start: s0, end: s1 });
  segs.sort((x, y) => x.start - y.start);
  return { clips: next, segments: segs, captions: r.captions };
}

// Give strip [a, b) (sequence time, inside one clip) a clip of its own, so it can be moved on its own.
// The clip is cut at a and b into up to three clips over the same file; nothing moves in the sequence,
// so segments and captions stay as they are. Returns the new clips and the index of the strip's clip.
export function isolateStrip(clips: Clip[], d: Durations, a: number, b: number): { clips: Clip[]; index: number } | null {
  const at = clipAt(clips, d, (a + b) / 2);
  if (!at) return null;
  const c = clips[at.index], s0 = clipStarts(clips, d)[at.index], len = clipLen(d, c), in0 = c.in ?? 0;
  const pieces: Clip[] = [];
  let index = -1;
  const cuts = [s0, Math.max(s0, a), Math.min(s0 + len, b), s0 + len];
  for (let k = 0; k < 3; k++) {
    const x = cuts[k], y = cuts[k + 1];
    if (y - x < 1e-6) continue;
    if (k === 1) index = at.index + pieces.length;
    const keep = k === 1 && pieces.length === 0 ? c.id : crypto.randomUUID(); // the first piece keeps the id
    pieces.push({ ...c, id: pieces.length === 0 ? c.id : keep, in: in0 + x - s0, len: y - x });
  }
  if (index < 0) return null;
  return { clips: [...clips.slice(0, at.index), ...pieces, ...clips.slice(at.index + 1)], index };
}

// Extend or shorten clip i at one edge so that edge lands on sequence time `edge` (old layout),
// revealing more of the file (or hiding some). Clamped to the file (images: 0.5s–600s, start can't move).
// The revealed part comes back as kept footage joined to the edge strip; everything after moves with it.
export function extendClip(
  clips: Clip[], i: number, side: 'start' | 'end', edge: number, d: Durations, segments: Segment[], captions: Caption[], still = false,
): { clips: Clip[]; segments: Segment[]; captions: Caption[] } | null {
  const c = clips[i], s0 = clipStarts(clips, d)[i], len = clipLen(d, c), in0 = c.in ?? 0, fileDur = dur(d, c.assetId);
  let next: Clip;
  if (side === 'end') {
    const max = still ? 600 : fileDur - in0;
    const l = Math.min(max, Math.max(0.1, edge - s0));
    if (Math.abs(l - len) < 1e-6) return null;
    next = { ...c, len: l };
  } else {
    if (still) return null;
    const ni = Math.max(0, Math.min(in0 + len - 0.1, in0 + edge - s0));
    if (Math.abs(ni - in0) < 1e-6) return null;
    next = { ...c, in: ni, len: in0 + len - ni };
  }
  const nc = clips.with(i, next);
  const r = remapProject(clips, nc, d, segments, captions);
  const n0 = clipStarts(nc, d)[i], n1 = n0 + clipLen(d, next);
  // Kept footage inside the clip after the change, plus the revealed edge joined to its neighbouring strip.
  let segs = r.segments.flatMap((g) => {
    if (g.end <= n0 + 1e-6 || g.start >= n1 - 1e-6) return [g];
    const x = { ...g, start: Math.max(n0, g.start), end: Math.min(n1, g.end) };
    return x.end - x.start > 1e-6 ? [x] : [];
  });
  const inside = segs.filter((g) => g.start >= n0 - 1e-6 && g.end <= n1 + 1e-6);
  if (side === 'start') {
    const first = inside[0];
    if (first) segs = segs.map((g) => (g === first ? { ...g, start: n0 } : g));
    else segs.push({ start: n0, end: n1 });
  } else {
    const last = inside.at(-1);
    if (last) segs = segs.map((g) => (g === last ? { ...g, end: n1 } : g));
    else segs.push({ start: n0, end: n1 });
  }
  segs.sort((x, y) => x.start - y.start);
  return { clips: nc, segments: segs, captions: r.captions };
}
