// Run: node src/lib/gaps.test.ts
import assert from 'node:assert/strict';
import { isGap, gapClip, clipSpans, placeClip, tidyGaps } from './gaps.ts';
import { clipStarts, seqDuration, type Clip } from './project.ts';
import { outDuration, type Segment } from './cuts.ts';

const d = new Map([['a', 10], ['b', 4]]);
const A: Clip = { id: 'A', assetId: 'a' }, B: Clip = { id: 'B', assetId: 'b' };
const full = (clips: Clip[]): Segment[] => {
  const st = clipStarts(clips, d);
  return clips.map((c, i) => ({ start: st[i], end: st[i] + (c.len ?? d.get(c.assetId)!), ...(isGap(c) && { fx: { lift: true } }) }));
};

// Dropping past the end leaves a gap before the clip.
let clips = [A];
let segs = full(clips);
let next = placeClip(clips, clipSpans(clips, d, segs), B, 13, 4);
assert.equal(next.length, 3);
assert.ok(isGap(next[1]) && next[1].len === 3);
assert.equal(next[2], B);
assert.equal(seqDuration(next, d), 17);

// Dropping inside a gap takes that part of it.
clips = next;
segs = full(clips);
const C: Clip = { id: 'C', assetId: 'b', len: 1 };
next = placeClip(clips, clipSpans(clips, d, segs), C, 11, 1);
assert.deepEqual(next.map((c) => (isGap(c) ? `gap${c.len}` : c.id)), ['A', 'gap1', 'C', 'gap1', 'B']);
assert.equal(seqDuration(next, d), 17); // B didn't move

// Dropping over a clip inserts at its nearest edge.
next = placeClip(clips, clipSpans(clips, d, segs), C, 2, 1);
assert.deepEqual(next.map((c) => c.id).slice(0, 2), ['C', 'A']);
next = placeClip(clips, clipSpans(clips, d, segs), C, 8, 1);
assert.deepEqual(next.map((c) => c.id).slice(0, 2), ['A', 'C']);

// On an empty V1 a clip can start later.
next = placeClip([], [], A, 5, 10);
assert.ok(isGap(next[0]) && next[0].len === 5 && next[1] === A);

// tidyGaps: gaps become one lifted strip each; neighbours merge; trailing gaps go.
clips = [A, gapClip(2), gapClip(1), B, gapClip(3)];
segs = full(clips).map(({ start, end }) => ({ start, end })); // not lifted yet
let r = tidyGaps(clips, d, segs, [], 0)!;
assert.deepEqual(r.clips.map((c) => (isGap(c) ? `gap${c.len}` : c.id)), ['A', 'gap3', 'B']);
assert.deepEqual(r.segments, [{ start: 0, end: 10 }, { start: 10, end: 13, fx: { lift: true } }, { start: 13, end: 17 }]);
assert.equal(tidyGaps(r.clips, d, r.segments, [], 0), null); // stable

// Deleting a gap's strip closes it up (later clips move earlier, their cuts and words with them).
const caps = [{ id: 'w', words: [{ text: 'hi', start: 14, end: 15 }] }];
const cut = r.segments.toSpliced(1, 1);
const closed = tidyGaps(r.clips, d, cut, caps, 0)!;
assert.deepEqual(closed.clips.map((c) => c.id), ['A', 'B']);
assert.deepEqual(closed.segments, [{ start: 0, end: 10 }, { start: 10, end: 14 }]);
assert.deepEqual(closed.captions[0].words[0], { text: 'hi', start: 11, end: 12 });

// A trailing gap pads V1 to the end of the last layer, and shrinks back when that moves earlier.
r = tidyGaps([A], d, full([A]), [], 15)!;
assert.ok(isGap(r.clips[1]) && r.clips[1].len === 5);
assert.equal(outDuration(r.segments), 15);
const padId = r.clips[1].id;
const r2 = tidyGaps(r.clips, d, r.segments, [], 12)!;
assert.equal(r2.clips[1].id, padId);
assert.equal(r2.clips[1].len, 2);
const r3 = tidyGaps(r2.clips, d, r2.segments, [], 5)!;
assert.deepEqual(r3.clips.map((c) => c.id), ['A']);
// Only layers: V1 is a single gap.
const only = tidyGaps([], d, [], [], 6)!;
assert.equal(only.clips.length, 1);
assert.deepEqual(only.segments, [{ start: 0, end: 6, fx: { lift: true } }]);

console.log('gaps ok');
