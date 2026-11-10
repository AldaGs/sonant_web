// Run: node src/lib/tracks.test.ts
import assert from 'node:assert/strict';
import { assignTracks, byTrack, fits, freeTrack, moveToTrack, removeTrack, setFlag, trackCount } from './tracks.ts';

type I = { id: string; at: number; len: number; track?: number };
const L = (x: I) => x.len;
const it = (id: string, at: number, len: number, track?: number): I => ({ id, at, len, ...(track !== undefined && { track }) });

// Legacy items: array order is stacking order, so a later overlapping item goes above.
const legacy = assignTracks([it('a', 0, 5), it('b', 2, 5), it('c', 8, 2)], L);
assert.deepEqual(legacy.map((x) => x.track), [0, 1, 0]);
// An item that sits under an earlier one in time but was drawn later still goes above it.
assert.deepEqual(assignTracks([it('a', 0, 10), it('b', 1, 1), it('c', 3, 1)], L).map((x) => x.track), [0, 1, 1]);
// Clashing explicit tracks move up.
assert.deepEqual(assignTracks([it('a', 0, 5, 0), it('b', 1, 2, 0)], L).map((x) => x.track), [0, 1]);

assert.equal(fits(legacy, L, '', 0, 5, 3), true);
assert.equal(fits(legacy, L, '', 0, 4, 3), false);
assert.equal(fits(legacy, L, 'a', 0, 4, 3), true); // ignores itself
assert.equal(freeTrack(legacy, L, 3, 1), 2);

// Moving to a free track keeps track counts and sorts for drawing.
const m1 = moveToTrack(legacy, L, 'c', 3);
assert.deepEqual(m1.items.map((x) => [x.id, x.track]), [['a', 0], ['b', 1], ['c', 3]]);
// Dropping onto a busy track inserts a new one there: b moves up.
const m2 = moveToTrack(legacy, L, 'a', 1, [{}, { hidden: true }]);
assert.deepEqual(m2.items.map((x) => [x.id, x.track]), [['c', 0], ['a', 1], ['b', 2]]);
assert.deepEqual(m2.flags, [{}, {}, { hidden: true }]);

assert.deepEqual(byTrack([it('x', 0, 1, 2), it('y', 0, 1, 0), it('z', 0, 1, 2)]).map((x) => x.id), ['y', 'x', 'z']);
assert.equal(trackCount([it('x', 0, 1, 2)], []), 3);
assert.equal(trackCount([], []), 1);
assert.equal(removeTrack([it('x', 0, 1, 1)], [], 1), null);
assert.deepEqual(removeTrack([it('x', 0, 1, 2)], [{}, { locked: true }, { muted: true }], 1), { items: [it('x', 0, 1, 1)], flags: [{}, { muted: true }] });
assert.deepEqual(setFlag([], 1, { locked: true }), [{}, { locked: true }]);
console.log('tracks ok');
