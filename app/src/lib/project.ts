import type { Caption } from './captions';
import type { Segment } from './cuts';

// Media the user imported. Files live in IndexedDB under `asset:<id>`.
export type Asset = { id: string; name: string; kind: 'video' | 'audio'; duration: number; width?: number; height?: number };
// A video clip on the video track. Clips play back to back; together they form the "sequence".
// Sequence time is what segments, captions and words are measured in.
export type Clip = { id: string; assetId: string };
// An extra audio item (music, voiceover), placed in OUTPUT time so word cuts don't move it.
export type AudioItem = { id: string; assetId: string; at: number; volume: number };

type Durations = Record<string, number> | Map<string, number>;
const dur = (d: Durations, id: string) => (d instanceof Map ? d.get(id) : d[id]) ?? 0;

// Sequence start of each clip.
export function clipStarts(clips: Clip[], d: Durations): number[] {
  let acc = 0;
  return clips.map((c) => {
    const s = acc;
    acc += dur(d, c.assetId);
    return s;
  });
}

export const seqDuration = (clips: Clip[], d: Durations) => clips.reduce((a, c) => a + dur(d, c.assetId), 0);

// Which clip plays at sequence time t, and where inside its asset.
export function clipAt(clips: Clip[], d: Durations, t: number): { index: number; local: number } | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = dur(d, clips[i].assetId);
    if (t < acc + len || i === clips.length - 1) return t >= acc - 1e-9 && t <= acc + len + 1e-9 ? { index: i, local: Math.min(len, t - acc) } : null;
    acc += len;
  }
  return null;
}

// Split kept segments so none crosses a clip boundary.
export function splitAtBoundaries(segs: Segment[], starts: number[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    let a = s.start;
    for (const b of starts) if (b > a + 1e-6 && b < s.end - 1e-6) (out.push({ start: a, end: b }), (a = b));
    out.push({ start: a, end: s.end });
  }
  return out;
}

// After clips are added, removed or reordered: move every segment and word to its clip's new position.
// Clips that are new get a fully kept segment; content of removed clips is dropped.
export function remapProject(
  oldClips: Clip[], newClips: Clip[], d: Durations, segments: Segment[], captions: Caption[],
): { segments: Segment[]; captions: Caption[] } {
  const oldStarts = clipStarts(oldClips, d), newStarts = clipStarts(newClips, d);
  const newStartById = new Map(newClips.map((c, i) => [c.id, newStarts[i]]));
  // Shift for sequence time t under the old layout, or null if its clip is gone.
  const shift = (t: number) => {
    const at = clipAt(oldClips, d, t);
    if (!at) return null;
    const ns = newStartById.get(oldClips[at.index].id);
    return ns === undefined ? null : ns - oldStarts[at.index];
  };

  const segs: Segment[] = [];
  for (const s of splitAtBoundaries(segments, oldStarts)) {
    const k = shift((s.start + s.end) / 2);
    if (k !== null) segs.push({ start: s.start + k, end: s.end + k });
  }
  const oldIds = new Set(oldClips.map((c) => c.id));
  newClips.forEach((c, i) => {
    if (!oldIds.has(c.id)) segs.push({ start: newStarts[i], end: newStarts[i] + dur(d, c.assetId) });
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
