// Timeline tools (like an NLE's tool palette) and the track edits behind them.
// They work on layers and audio items: anything with a start (`at`), a length and, for media, a file offset.
//   select  – move and trim (default)
//   razor   – click an item to cut it there
//   ripple  – trims and deletes push/pull the later items on the same track
//   roll    – drag the cut between two touching items: one grows, the other shrinks
//   slip    – drag inside a media item to change which part of its file plays, keeping position and length
export const TOOLS = ['select', 'razor', 'ripple', 'roll', 'slip'] as const;
export type Tool = (typeof TOOLS)[number];
export const TOOL_KEYS: Record<string, Tool> = { v: 'select', c: 'razor', b: 'ripple', r: 'roll', y: 'slip' };

/** An item as the tools see it. max: file length for media (offset + len can't pass it), Infinity otherwise. */
export type Span = { id: string; track: number; at: number; len: number; offset?: number; max: number };
export type Patch = { at?: number; len?: number; offset?: number };

const MIN = 0.2;
const EPS = 1e-6;
const media = (s: Span) => s.offset !== undefined;

/**
 * Ripple trim one edge by d seconds. End: the item gets longer/shorter and everything after it on the
 * track moves by the same amount. Start: the item stays where it is, its head is trimmed (media: the
 * file offset moves), and everything after it moves the other way. Returns patches by id.
 */
export function rippleTrim(spans: Span[], id: string, side: 'start' | 'end', d: number): Map<string, Patch> {
  const out = new Map<string, Patch>();
  const s = spans.find((x) => x.id === id);
  if (!s) return out;
  const off = s.offset ?? 0;
  let delta: number; // change in length
  if (side === 'end') {
    delta = Math.max(MIN - s.len, Math.min((media(s) ? s.max - off : Infinity) - s.len, d));
    out.set(id, { len: s.len + delta });
  } else {
    const dd = Math.max(media(s) ? -off : -Infinity, Math.min(s.len - MIN, d)); // >0 trims the head off
    delta = -dd;
    out.set(id, media(s) ? { len: s.len - dd, offset: off + dd } : { len: s.len - dd });
  }
  if (Math.abs(delta) < EPS) return new Map();
  const end = s.at + s.len;
  for (const x of spans) if (x.id !== id && x.track === s.track && x.at >= end - EPS) out.set(x.id, { at: Math.max(0, x.at + delta) });
  return out;
}

/** Delete an item and close the gap: later items on its track move back by its length. */
export function rippleDelete(spans: Span[], id: string): Map<string, Patch> {
  const out = new Map<string, Patch>();
  const s = spans.find((x) => x.id === id);
  if (!s) return out;
  // Don't pull later items over something that sits in the gap's way: only as far as the track allows.
  for (const x of spans) if (x.id !== id && x.track === s.track && x.at >= s.at + s.len - EPS) out.set(x.id, { at: Math.max(0, x.at - s.len) });
  return out;
}

/** The item that touches `id`'s given edge on the same track (its neighbour across that cut), if any. */
export function neighbour(spans: Span[], id: string, side: 'start' | 'end'): Span | null {
  const s = spans.find((x) => x.id === id);
  if (!s) return null;
  const t = side === 'end' ? s.at + s.len : s.at;
  return spans.find((x) => x.id !== id && x.track === s.track && Math.abs((side === 'end' ? x.at : x.at + x.len) - t) < 0.02) ?? null;
}

/**
 * Roll edit: move the cut at `id`'s edge by d. The item on the left of the cut gets longer by d, the one
 * on the right starts d later (media: its file offset moves too), so the total stays the same.
 * Returns null when there's no touching neighbour on that side.
 */
export function rollEdit(spans: Span[], id: string, side: 'start' | 'end', d: number): Map<string, Patch> | null {
  const s = spans.find((x) => x.id === id), n = neighbour(spans, id, side);
  if (!s || !n) return null;
  const [l, r] = side === 'end' ? [s, n] : [n, s];
  // Left can't shrink under MIN or run past its file; right can't shrink under MIN or start before its file.
  const lo = Math.max(MIN - l.len, media(r) ? -(r.offset ?? 0) : -Infinity);
  const hi = Math.min(r.len - MIN, media(l) ? l.max - (l.offset ?? 0) - l.len : Infinity);
  const dd = Math.max(lo, Math.min(hi, d));
  const rOff = media(r) ? (r.offset ?? 0) + dd : undefined;
  return new Map<string, Patch>([
    [l.id, { len: l.len + dd }],
    [r.id, { at: r.at + dd, len: r.len - dd, ...(rOff !== undefined && { offset: rOff }) }],
  ]);
}

/** Slip: change which part of the file plays (offset), keeping the item's place and length. Media only. */
export function slip(s: Span, d: number): Patch | null {
  if (!media(s)) return null;
  const off = Math.max(0, Math.min(s.max - s.len, (s.offset ?? 0) + d));
  return { offset: off };
}
