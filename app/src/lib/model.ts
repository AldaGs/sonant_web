// The timeline model. Every track works the same way, V1 included:
// - Video tracks (V1, V2, …) hold items (Overlay): video, pictures and text, placed in output time (`at`, `len`).
//   `track` 0 is V1; higher tracks draw on top. Media items can fill the frame (`fill`, cropped to cover it like
//   a classic main video) or sit where their transform puts them (picture-in-picture, logos…).
// - Audio tracks (A1, A2, …) hold audio items (AudioItem), also in output time. A video's sound is its own
//   audio item, linked to the picture (links.ts), so the two move, trim and cut together.
// - Media items carry per-item effects (`fx`: speed, freeze, colour, reframing, punch-in, background…).
//   `offset` is the file time at the item's start; speed decides how fast file time runs (see fileAt).
//
// Captions live in SOURCE time: every asset has a fixed `base`, and a word at file time f of that asset sits at
// base + f. That way captions follow the footage wherever it is placed: a word shows wherever an item plays that
// moment of the file, and is "cut" (struck out in the transcript) when no item does. Deleting words cuts that
// moment out of the item that plays it and closes the gap on its track (a ripple cut); restoring them puts it back.
import { outIn, outLen, rateAt, srcIn, FREEZE_SRC, type Fx, type Segment } from './cuts.ts';
import type { Caption, Word } from './captions.ts';
import type { Overlay } from './overlay.ts';
import type { Asset, AudioItem } from './project.ts';

const EPS = 1e-6;
const MIN = 0.05; // shortest piece a cut leaves behind
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ---- Source space ----
export const BASE_GAP = 10; // seconds between two assets in source space
/** Give every asset a fixed place in source space (assets that already have one keep it). */
export function assignBases(assets: Asset[]): Asset[] {
  if (assets.every((a) => a.base !== undefined)) return assets;
  let next = Math.max(0, ...assets.filter((a) => a.base !== undefined).map((a) => Math.ceil(a.base! + a.duration) + BASE_GAP));
  return assets.map((a) => {
    if (a.base !== undefined) return a;
    const b = next;
    next = Math.ceil(b + a.duration) + BASE_GAP;
    return { ...a, base: b };
  });
}
/** Which asset a source time belongs to, and the file time in it. */
export function assetAtSrc(assets: Asset[], s: number): { asset: Asset; file: number } | null {
  for (const a of assets) if (a.base !== undefined && s >= a.base - EPS && s <= a.base + a.duration + EPS) return { asset: a, file: s - a.base };
  return null;
}

// ---- One media item's time ----
// len: output seconds (audio items saved without one play the rest of their file; the editor fills it in).
export type Media = { at: number; len?: number; offset?: number; fx?: Fx };
const L = (m: { len?: number }) => m.len ?? 0;
const sp = (fx?: Fx) => fx?.speed ?? 1, spEnd = (fx?: Fx) => fx?.speedEnd ?? sp(fx);
/** File seconds an item plays (a freeze frame shows a single frame). */
export const srcLen = (m: Media) => (m.fx?.hold ? FREEZE_SRC : (L(m) * (sp(m.fx) + spEnd(m.fx))) / 2);
/** The item as a kept segment of its file (the speed and freeze maths in cuts.ts work on these). */
export const segOf = (m: Media, base = 0): Segment => {
  const s = base + (m.offset ?? 0);
  return { start: s, end: s + srcLen(m), fx: m.fx?.hold ? { ...m.fx, hold: L(m) } : m.fx };
};
/** File time an item shows at output time t. */
export const fileAt = (m: Media, t: number) => srcIn(segOf(m), Math.max(0, Math.min(L(m), t - m.at)));
/** Output time at which an item shows file time f. */
export const outAtFile = (m: Media, f: number) => m.at + outIn(segOf(m), f);
/** Output length for a file range at a speed (used when speed changes). */
export const lenFor = (src: number, fx?: Fx) => (fx?.hold ? fx.hold : (2 * src) / (sp(fx) + spEnd(fx)));

/**
 * Cut an item in two at output time t: [left, right]. Media keep their file position (the right half starts
 * where the left one stopped), a speed ramp splits into two ramps meeting at the speed it had there, and a
 * linked pair gets the same new link on both right halves. Returns null when t isn't inside (with some room).
 */
export function splitMedia<T extends Media & { id: string; link?: string }>(m: T, t: number, newId: string, minPart = MIN): [T, T] | null {
  const d = t - m.at;
  if (d < minPart || L(m) - d < minPart) return null;
  const left = { ...m, len: d } as T, right = { ...m, id: newId, at: t, len: L(m) - d } as T;
  if (m.offset !== undefined || m.fx?.speed !== undefined || m.fx?.speedEnd !== undefined) {
    const seg = segOf(m), f = srcIn(seg, d);
    if (!m.fx?.hold) right.offset = r6(f);
    if (m.fx?.speedEnd !== undefined) {
      const v = rateAt(seg, f);
      left.fx = { ...m.fx, speedEnd: v };
      right.fx = { ...m.fx, speed: v };
    }
  }
  if (m.link) right.link = `${m.link}@${t.toFixed(3)}`;
  return [left, right];
}

// ---- Captions: source time → output time ----
// A piece: the part of a file one item plays, in source time, and where it plays.
export type Piece = { start: number; end: number; at: number; fx?: Fx; id: string; track: number; audio: boolean };
type HasMedia = Media & { id: string; assetId?: string; track?: number; link?: string };
/**
 * Pieces of every item that can carry words: audio items first (the sound is what was transcribed), then video
 * items that have no linked sound. Freeze frames and reversed items carry none. Lower tracks win ties.
 */
export function piecesOf(overlays: (HasMedia & { kind: string })[], audios: HasMedia[], bases: Map<string, number>): Piece[] {
  const linked = new Set(audios.flatMap((a) => (a.link ? [a.link] : [])));
  const one = (m: HasMedia, audio: boolean): Piece[] => {
    const b = m.assetId ? bases.get(m.assetId) : undefined;
    if (b === undefined || m.fx?.hold || m.fx?.rev) return [];
    const s = segOf(m, b);
    return [{ start: s.start, end: s.end, at: m.at, fx: m.fx, id: m.id, track: m.track ?? 0, audio }];
  };
  const prio = (p: Piece, q: Piece) => Number(q.audio) - Number(p.audio) || p.track - q.track || p.at - q.at;
  return [...audios.flatMap((a) => one(a, true)), ...overlays.filter((o) => o.kind === 'video' && !(o.link && linked.has(o.link))).flatMap((o) => one(o, false))].sort(prio);
}
/** The piece that plays source time s (the highest-priority one), or null when no item does. */
export const pieceAt = (pieces: Piece[], s: number) => pieces.find((p) => s >= p.start - EPS && s < p.end - EPS) ?? null;
/** Output time of source time s, or null when it's cut (no item plays it). */
export function srcToOut(pieces: Piece[], s: number): number | null {
  const p = pieceAt(pieces, s);
  return p ? p.at + outIn(p, s) : null;
}
/** Source time playing at output time o on the piece's track (audio first), or null. */
export function outToSrc(pieces: Piece[], o: number): number | null {
  const p = pieces.find((x) => o >= x.at - EPS && o < x.at + outLen(x) - EPS);
  return p ? srcIn(p, o - p.at) : null;
}
/** A word is cut when its middle isn't played by any item. */
export const isCutW = (pieces: Piece[], w: { start: number; end: number }) => pieceAt(pieces, (w.start + w.end) / 2) === null;

// Captions can also be "free": typed lines that belong to no footage, timed in output time directly.
export type Cap = Caption & { free?: boolean };
/** Captions in output time, without cut words, sorted. */
export function captionsOut(caps: Cap[], pieces: Piece[]): Caption[] {
  const out: Caption[] = [];
  for (const c of caps) {
    if (c.free) { out.push(c); continue; }
    const words = c.words.flatMap((w): Word[] => {
      const p = pieceAt(pieces, (w.start + w.end) / 2);
      if (!p) return [];
      const s = p.at + outIn(p, Math.max(p.start, w.start)), e = p.at + outIn(p, Math.min(p.end - 1e-6, Math.max(w.start, w.end - 1e-6)));
      return [{ ...w, start: s, end: Math.max(e, s + 0.05) }];
    });
    if (words.length) out.push(words.length === c.words.length && words.every((w, i) => w.start === c.words[i].start && w.end === c.words[i].end) ? c : { ...c, words });
  }
  return out.sort((a, b) => a.words[0].start - b.words[0].start);
}
/** Captions in source time without their cut words (free lines stay as they are). */
export const keptCaps = (caps: Cap[], pieces: Piece[]): Cap[] =>
  caps.flatMap((c) => {
    if (c.free) return [c];
    const words = c.words.filter((w) => !isCutW(pieces, w));
    return words.length ? [words.length === c.words.length ? c : { ...c, words }] : [];
  });
/** Output ranges a source range [a, b) plays at (one per piece it touches), with the item that plays it. */
export function srcRangeOut(pieces: Piece[], a: number, b: number): { o0: number; o1: number; id: string }[] {
  const out: { o0: number; o1: number; id: string }[] = [];
  const seen: [number, number][] = [];
  for (const p of pieces) {
    let x = Math.max(a, p.start), y = Math.min(b, p.end);
    if (y - x < 1e-4) continue;
    for (const [s, e] of seen) { // a higher-priority piece already plays part of it
      if (s <= x + EPS && e >= y - EPS) x = y;
      else if (s <= x + EPS && e > x) x = e;
      else if (e >= y - EPS && s < y) y = s;
    }
    if (y - x < 1e-4) continue;
    seen.push([p.start, p.end]);
    out.push({ o0: p.at + outIn(p, x), o1: p.at + outIn(p, y), id: p.id });
  }
  return out;
}

// ---- Ripple edits on tracks ----
export type Item = Media & { id: string; track?: number; link?: string; assetId?: string };
export type Lists = { overlays: Overlay[]; audios: AudioItem[] };
export type Tracks = { v: Set<number>; a: Set<number> };
const trackOf = (x: { track?: number }) => x.track ?? 0;
const media = (x: Item) => x.offset !== undefined || !!x.assetId;

/**
 * Remove output range [o0, o1) from some tracks and close it up: items inside go, items across it are cut
 * (the part after it slides back to o0), items after it move back by its length. Other tracks don't move.
 */
export function rippleCut<T extends Item>(items: T[], tracks: Set<number>, o0: number, o1: number): T[] {
  const d = o1 - o0;
  if (!(d > 1e-4)) return items;
  return items.flatMap((x): T[] => {
    if (!tracks.has(trackOf(x))) return [x];
    const end = x.at + L(x);
    if (end <= o0 + EPS) return [x];
    if (x.at >= o1 - EPS) return [{ ...x, at: r6(x.at - d) }];
    const parts: T[] = [];
    if (o0 - x.at >= MIN) parts.push({ ...x, len: r6(o0 - x.at), ...(x.fx?.speedEnd !== undefined && { fx: { ...x.fx, speedEnd: rateAt(segOf(x), fileAt(x, o0)) } }) });
    if (end - o1 >= MIN) {
      const f = fileAt(x, o1);
      const right = { ...x, at: r6(o0), len: r6(end - o1),
        ...(parts.length && { id: crypto.randomUUID(), ...(x.link && { link: `${x.link}@${o1.toFixed(3)}` }) }),
        ...(media(x) && !x.fx?.hold && { offset: r6(f) }),
        ...(x.fx?.speedEnd !== undefined && { fx: { ...x.fx, speed: rateAt(segOf(x), f) } }) } as T;
      parts.push(right);
    }
    return parts;
  });
}
/** Make room: everything on these tracks that starts at or after t moves later by d. */
export const rippleInsert = <T extends Item>(items: T[], tracks: Set<number>, t: number, d: number): T[] =>
  items.map((x) => (tracks.has(trackOf(x)) && x.at >= t - EPS ? { ...x, at: r6(x.at + d) } : x));

/** The tracks an edit of these items must ripple: their own and their linked partners'. */
export function tracksOf(l: Lists, ids: Set<string>): Tracks {
  const links = new Set<string>();
  const v = new Set<number>(), a = new Set<number>();
  for (const o of l.overlays) if (ids.has(o.id)) (v.add(trackOf(o)), o.link && links.add(o.link));
  for (const x of l.audios) if (ids.has(x.id)) (a.add(trackOf(x)), x.link && links.add(x.link));
  for (const o of l.overlays) if (o.link && links.has(o.link)) v.add(trackOf(o));
  for (const x of l.audios) if (x.link && links.has(x.link)) a.add(trackOf(x));
  return { v, a };
}
/** Ripple-cut output ranges out of the given tracks (latest first, so earlier ranges stay put). */
export function cutRanges(l: Lists, ranges: { o0: number; o1: number; tracks: Tracks }[]): Lists {
  let { overlays, audios } = l;
  for (const r of [...ranges].sort((p, q) => q.o0 - p.o0)) {
    overlays = rippleCut(overlays, r.tracks.v, r.o0, r.o1);
    audios = rippleCut(audios, r.tracks.a, r.o0, r.o1);
  }
  return { overlays, audios };
}
/** Ripple-cut source ranges (e.g. deleted words): each is cut from the items that play it, on their tracks. */
export function cutSource(l: Lists, pieces: Piece[], ranges: [number, number][]): Lists {
  const out: { o0: number; o1: number; tracks: Tracks }[] = [];
  for (const [a, b] of ranges) for (const r of srcRangeOut(pieces, a, b)) out.push({ ...r, tracks: tracksOf(l, new Set([r.id])) });
  // Overlapping ranges on the same tracks would double-cut: merge them first.
  out.sort((p, q) => p.o0 - q.o0);
  const merged: typeof out = [];
  for (const r of out) {
    const m = merged.at(-1);
    if (m && r.o0 <= m.o1 + 1e-4 && [...r.tracks.v].every((k) => m.tracks.v.has(k)) && [...r.tracks.a].every((k) => m.tracks.a.has(k))) m.o1 = Math.max(m.o1, r.o1);
    else merged.push({ ...r });
  }
  return cutRanges(l, merged);
}

/**
 * Put source range [a, b) back (restore struck words). It returns next to the item that plays the footage just
 * before it (or just after it): that item grows to cover it when they touch in the file, otherwise a new item
 * for it goes right after that one. Later items on its tracks (and its linked partner's) move on to make room.
 */
export function restoreSource(l: Lists, assets: Asset[], a: number, b: number): Lists {
  const hit = assetAtSrc(assets, (a + b) / 2);
  if (!hit || !(b > a)) return l;
  const asset = hit.asset, base = asset.base!, fa = Math.max(0, a - base), fb = Math.min(asset.duration, b - base);
  // Candidates: items playing this asset (audio first, so the sound decides).
  const all: (Item & { audio: boolean })[] = [...l.audios.map((x) => ({ ...x, audio: true })), ...l.overlays.filter((o) => o.kind === 'video').map((o) => ({ ...o, audio: false }))]
    .filter((x) => x.assetId === asset.id && !x.fx?.hold && !x.fx?.rev);
  const fileEnd = (x: Item) => (x.offset ?? 0) + srcLen(x);
  if (all.some((x) => (x.offset ?? 0) <= fa + 1e-3 && fileEnd(x) >= fb - 1e-3)) return l; // already plays
  const before = all.filter((x) => fileEnd(x) <= fa + 0.02).sort((x, y) => Number(y.audio) - Number(x.audio) || fileEnd(y) - fileEnd(x))[0];
  const after = all.filter((x) => (x.offset ?? 0) >= fb - 0.02).sort((x, y) => Number(y.audio) - Number(x.audio) || (x.offset ?? 0) - (y.offset ?? 0))[0];
  const anchor = before ?? after;
  if (!anchor) return l;
  const ids = new Set([anchor.id]);
  const tr = tracksOf(l, ids);
  const k = (sp(anchor.fx) + spEnd(anchor.fx)) / 2;
  const partnerOf = (x: Item) => (x.link ? [...l.overlays, ...l.audios].filter((y) => y.link === x.link).map((y) => y.id) : [x.id]);
  const group = new Set(partnerOf(anchor));
  if (before) {
    const from = fileEnd(before), grow = (fb - from) / k;
    if (fa - from < 0.02) {
      // Touches: the item just gets longer (and so does its sound / picture).
      const at = before.at + L(before);
      const ins = { overlays: rippleInsert(l.overlays, tr.v, at, grow), audios: rippleInsert(l.audios, tr.a, at, grow) };
      const g = (x: Overlay | AudioItem) => (group.has(x.id) ? { ...x, len: r6(L(x) + grow) } : x);
      return mergeTouching({ overlays: ins.overlays.map(g) as Overlay[], audios: ins.audios.map(g) as AudioItem[] }, group);
    }
    return insertCopy(l, before, group, tr, fa, fb, k);
  }
  // Only something after it: that item starts earlier in its file.
  const to = after!.offset ?? 0, grow = (to - fa) / k;
  if (to - fb < 0.02) {
    const ins = { overlays: rippleInsert(l.overlays, tr.v, after!.at + EPS * 2, grow), audios: rippleInsert(l.audios, tr.a, after!.at + EPS * 2, grow) };
    const g = (x: Overlay | AudioItem) => (group.has(x.id) ? { ...x, offset: r6(fa), len: r6(L(x) + grow) } : x);
    return { overlays: ins.overlays.map(g) as Overlay[], audios: ins.audios.map(g) as AudioItem[] };
  }
  return insertCopy(l, after!, group, tr, fa, fb, k, true);
}
// A new item (and partner) for file range [fa, fb), right after (or before) `x`, pushing later items on.
function insertCopy(l: Lists, x: Item, group: Set<string>, tr: Tracks, fa: number, fb: number, k: number, beforeIt = false): Lists {
  const len = (fb - fa) / k, at = beforeIt ? x.at : x.at + L(x), link = crypto.randomUUID();
  const ins = { overlays: rippleInsert(l.overlays, tr.v, at, len), audios: rippleInsert(l.audios, tr.a, at, len) };
  const copy = <T extends Item>(y: T): T => ({ ...y, id: crypto.randomUUID(), at: r6(at), len: r6(len), offset: r6(fa), ...(y.link && { link }) });
  return {
    overlays: [...ins.overlays, ...l.overlays.filter((y) => group.has(y.id)).map(copy)],
    audios: [...ins.audios, ...l.audios.filter((y) => group.has(y.id)).map(copy)],
  };
}
/** Join items of `group` with the next item on their track when that one carries straight on in the same file. */
function mergeTouching(l: Lists, group: Set<string>): Lists {
  const join = <T extends Item>(items: T[]): T[] => {
    let out = items;
    for (const x of items.filter((y) => group.has(y.id))) {
      const cur = out.find((y) => y.id === x.id)!;
      const n = out.find((y) => y.id !== cur.id && trackOf(y) === trackOf(cur) && y.assetId === cur.assetId && Math.abs(y.at - (cur.at + L(cur))) < 0.02
        && Math.abs((y.offset ?? 0) - ((cur.offset ?? 0) + srcLen(cur))) < 0.03 && JSON.stringify(y.fx ?? {}) === JSON.stringify(cur.fx ?? {}));
      if (n) out = out.flatMap((y) => (y.id === n.id ? [] : y.id === cur.id ? [{ ...y, len: r6(L(cur) + L(n)) }] : [y]));
    }
    return out;
  };
  return { overlays: join(l.overlays), audios: join(l.audios) };
}

/** Where the timeline ends: the end of the last item on any track. */
export const timelineEnd = (l: { overlays: { at: number; len: number }[]; audios: { at: number; len?: number; assetId: string; offset?: number; fx?: Fx }[] }, durOf: (id: string) => number) =>
  Math.max(0, ...l.overlays.map((o) => o.at + L(o)), ...l.audios.map((a) => a.at + audioLen(a, durOf(a.assetId))));
/** How long an audio item plays: its length, or the rest of its file at its speed. */
export const audioLen = (a: { len?: number; offset?: number; fx?: Fx }, assetDur: number) =>
  Math.max(0, Math.min(a.len ?? Infinity, (assetDur - (a.offset ?? 0)) / ((sp(a.fx) + spEnd(a.fx)) / 2)));

/** Fx that the sound of a picture shares with it (so a linked pair plays the same part of the file at the same pace). */
export const SHARED_FX = ['speed', 'speedEnd', 'hold', 'rev'] as const;
export const sharedFx = (fx?: Fx): Fx | undefined => {
  if (!fx) return undefined;
  const o: Fx = {};
  for (const k of SHARED_FX) if (fx[k] !== undefined) (o as Record<string, unknown>)[k] = fx[k];
  return Object.keys(o).length ? o : undefined;
};
export { outLen };
