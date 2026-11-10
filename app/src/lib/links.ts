// Linked video and audio: a video layer's sound lives as its own audio item on an A track, sharing a `link`
// id with the layer. While linked they keep the same timing (start, length, file offset): moving, trimming,
// slipping or rolling one moves the other, splitting cuts both, deleting removes both. Unlink to edit apart.
import type { Overlay } from './overlay.ts';
import { itemLen, type AudioItem } from './project.ts';
import { freeTrack } from './tracks.ts';

type Timing = { at: number; len: number; offset: number };
const EPS = 1e-4;
const same = (a: Timing, b: Timing) => Math.abs(a.at - b.at) < EPS && Math.abs(a.len - b.len) < EPS && Math.abs(a.offset - b.offset) < EPS;
const ovTiming = (o: Overlay): Timing => ({ at: o.at, len: o.len, offset: o.offset ?? 0 });
const audTiming = (a: AudioItem, dur: number): Timing => ({ at: a.at, len: itemLen(a, dur), offset: a.offset ?? 0 });

/** The link id of the right-hand half when a linked item is cut at t (the same on both sides, so halves pair up). */
export const splitLink = (link: string, t: number) => `${link}@${t.toFixed(3)}`;

/** A linked audio item for a video layer, on the lowest A track that's free over its time. */
export function linkedAudio(o: Overlay, audios: AudioItem[], durOf: (assetId: string) => number, volume = 1): AudioItem {
  const len = (a: AudioItem) => itemLen(a, durOf(a.assetId));
  const track = freeTrack(audios.filter((a) => a.track !== undefined), len, o.at, o.len);
  return { id: crypto.randomUUID(), assetId: o.assetId!, at: o.at, offset: o.offset ?? 0, len: o.len, volume, link: o.link, track };
}

/**
 * Older projects: a video layer that played its own sound (volume > 0) gets a linked audio item at that
 * volume, and the layer itself goes silent. Returns null when nothing needed linking.
 */
export function linkLegacy(overlays: Overlay[], audios: AudioItem[], durOf: (assetId: string) => number): { overlays: Overlay[]; audios: AudioItem[] } | null {
  const todo = overlays.filter((o) => o.kind === 'video' && o.assetId && !o.link && (o.volume ?? 0) > 0);
  if (!todo.length) return null;
  let auds = audios;
  const ovs = overlays.map((o) => {
    if (!todo.includes(o)) return o;
    const x = { ...o, link: crypto.randomUUID(), volume: 0 };
    auds = [...auds, linkedAudio(x, auds, durOf, o.volume)];
    return x;
  });
  return { overlays: ovs, audios: auds };
}

/**
 * Keep linked pairs together after an edit. `mem` remembers each pair's last agreed timing, which tells
 * which side was edited: that side wins and the other follows. A pair that lost one side (deleted) loses
 * the other too. Returns null when nothing changed.
 */
export function reconcile(overlays: Overlay[], audios: AudioItem[], durOf: (assetId: string) => number, mem: Map<string, Timing>):
  { overlays: Overlay[]; audios: AudioItem[] } | null {
  const ovBy = new Map(overlays.flatMap((o) => (o.link ? [[o.link, o] as const] : [])));
  const auBy = new Map(audios.flatMap((a) => (a.link ? [[a.link, a] as const] : [])));
  const ovPatch = new Map<string, Partial<Overlay>>(), auPatch = new Map<string, Partial<AudioItem>>();
  const drop = new Set<string>();
  for (const [link, o] of ovBy) {
    const a = auBy.get(link);
    if (!a) {
      if (mem.has(link)) drop.add(o.id); // its sound was deleted: the picture goes too
      continue;
    }
    const ot = ovTiming(o), at = audTiming(a, durOf(a.assetId)), m = mem.get(link);
    if (same(ot, at)) continue;
    if (!m || !same(ot, m)) auPatch.set(a.id, { at: ot.at, len: ot.len, offset: ot.offset }); // the layer was edited
    else ovPatch.set(o.id, { at: at.at, len: at.len, offset: at.offset }); // the audio was edited
  }
  for (const [link, a] of auBy) if (!ovBy.has(link) && mem.has(link)) drop.add(a.id);
  // Remember the agreed timings for next time (and forget pairs that are gone).
  mem.clear();
  for (const [link, o] of ovBy) if (auBy.has(link) && !drop.has(o.id)) mem.set(link, { ...ovTiming(o), ...ovPatch.get(o.id) } as Timing);
  if (!ovPatch.size && !auPatch.size && !drop.size) return null;
  return {
    overlays: overlays.flatMap((o) => (drop.has(o.id) ? [] : [ovPatch.has(o.id) ? { ...o, ...ovPatch.get(o.id) } : o])),
    audios: audios.flatMap((a) => (drop.has(a.id) ? [] : [auPatch.has(a.id) ? { ...a, ...auPatch.get(a.id) } : a])),
  };
}

/** Unlink a pair (either side's id): both keep their timing but edit independently from now on. */
export function unlink(overlays: Overlay[], audios: AudioItem[], link: string) {
  return {
    overlays: overlays.map((o) => (o.link === link ? { ...o, link: undefined } : o)),
    audios: audios.map((a) => (a.link === link ? { ...a, link: undefined } : a)),
  };
}
