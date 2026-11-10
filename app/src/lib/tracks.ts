// Numbered tracks, like a classic NLE. The main sequence is V1 (video) and A1 (its own sound).
// Layers (picture-in-picture video, images, text) sit on V2, V3, … — `track` 0 is V2, and higher tracks draw on top.
// Music and voiceover sit on A2, A3, … — `track` 0 is A2.
// Items on one track never overlap in time. Tracks can be hidden/muted and locked.

export type TrackFlags = { hidden?: boolean; muted?: boolean; locked?: boolean };
export type Tracks = { v: TrackFlags[]; a: TrackFlags[] };
export const NO_TRACKS: Tracks = { v: [], a: [] };

type Timed = { id: string; at: number; track?: number };
const EPS = 1e-6;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - EPS && b0 < a1 - EPS;

/** The track an item is on (items saved before tracks existed count as track 0 until `assignTracks` runs). */
export const trackOf = (x: { track?: number }) => x.track ?? 0;

/** Whether [at, at+len) is free on `track`, ignoring item `id`. */
export function fits<T extends Timed>(items: T[], lenOf: (x: T) => number, id: string, track: number, at: number, len: number): boolean {
  return !items.some((x) => x.id !== id && trackOf(x) === track && overlaps(at, at + len, x.at, x.at + lenOf(x)));
}

/** Lowest track (from `from` up) where [at, at+len) is free. */
export function freeTrack<T extends Timed>(items: T[], lenOf: (x: T) => number, at: number, len: number, from = 0, id = ''): number {
  let k = Math.max(0, from);
  while (!fits(items, lenOf, id, k, at, len)) k++;
  return k;
}

/**
 * Give every item a track. Items without one (older projects) are placed so stacking stays as it was:
 * array order is drawing order, so each goes above every earlier item it overlaps.
 * Items that already have a track keep it, unless it clashes with another, then they move up.
 */
export function assignTracks<T extends Timed>(items: T[], lenOf: (x: T) => number): T[] {
  const out: T[] = [];
  for (const x of items) {
    const len = lenOf(x);
    let from = x.track ?? 0;
    if (x.track === undefined)
      for (const y of out) if (overlaps(x.at, x.at + len, y.at, y.at + lenOf(y))) from = Math.max(from, trackOf(y) + 1);
    out.push({ ...x, track: freeTrack(out, lenOf, x.at, len, from) });
  }
  return out;
}

/** Drawing order: by track (stable within a track). Renderers draw the array in order, so higher tracks end on top. */
export const byTrack = <T extends { track?: number }>(items: T[]): T[] =>
  items.every((x, i) => i === 0 || trackOf(items[i - 1]) <= trackOf(x)) ? items : items.map((x, i) => [x, i] as const)
    .sort((p, q) => trackOf(p[0]) - trackOf(q[0]) || p[1] - q[1]).map((p) => p[0]);

/** How many tracks to show: enough for every item and every track that has settings, at least one. */
export const trackCount = (items: { track?: number }[], flags: TrackFlags[]) =>
  Math.max(1, flags.length, ...items.map((x) => trackOf(x) + 1));

/**
 * Move an item to `track`. If it doesn't fit there, a new empty track is inserted at that position
 * (everything on it and above moves up one), so the item always lands where it was dropped.
 */
export function moveToTrack<T extends Timed>(items: T[], lenOf: (x: T) => number, id: string, track: number, flags: TrackFlags[] = []):
  { items: T[]; flags: TrackFlags[] } {
  const x = items.find((y) => y.id === id);
  if (!x) return { items, flags };
  const k = Math.max(0, track);
  if (fits(items, lenOf, id, k, x.at, lenOf(x))) return { items: byTrack(items.map((y) => (y.id === id ? { ...y, track: k } : y))), flags };
  const moved = items.map((y) => (y.id === id ? { ...y, track: k } : trackOf(y) >= k ? { ...y, track: trackOf(y) + 1 } : y));
  return { items: byTrack(moved), flags: flags.length > k ? [...flags.slice(0, k), {}, ...flags.slice(k)] : flags };
}

/** Delete an empty track; tracks above it move down. Returns null when the track still has items. */
export function removeTrack<T extends { track?: number }>(items: T[], flags: TrackFlags[], track: number): { items: T[]; flags: TrackFlags[] } | null {
  if (items.some((x) => trackOf(x) === track)) return null;
  return { items: items.map((x) => (trackOf(x) > track ? { ...x, track: trackOf(x) - 1 } : x)), flags: flags.filter((_, i) => i !== track) };
}

/** Change one track's settings, growing the list as needed. */
export const setFlag = (flags: TrackFlags[], track: number, patch: TrackFlags): TrackFlags[] => {
  const out = [...flags];
  while (out.length <= track) out.push({});
  out[track] = { ...out[track], ...patch };
  return out;
};

export const isHidden = (t: Tracks, x: { track?: number }) => !!t.v[trackOf(x)]?.hidden;
export const isMuted = (t: Tracks, x: { track?: number }) => !!t.a[trackOf(x)]?.muted;
export const isLockedV = (t: Tracks, x: { track?: number }) => !!t.v[trackOf(x)]?.locked;
export const isLockedA = (t: Tracks, x: { track?: number }) => !!t.a[trackOf(x)]?.locked;
