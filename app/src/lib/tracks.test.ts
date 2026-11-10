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

{
  const { splitOverlay, splitAudio } = await import('./tracks.ts');
  const o = { id: 'o', kind: 'video' as const, at: 2, len: 4, offset: 1, track: 1, tf: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
    kf: [{ t: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, { t: 3, x: 1, y: 0, scale: 1, rotation: 0, opacity: 1 }] };
  const [l, r] = splitOverlay(o, 3, 'o2')!;
  assert.deepEqual([l.at, l.len, l.offset, r.at, r.len, r.offset, r.id, r.track], [2, 1, 1, 3, 3, 2, 'o2', 1]);
  assert.deepEqual(l.kf!.map((k) => k.t), [0, 1]);
  assert.deepEqual(r.kf!.map((k) => k.t), [0, 2]);
  assert.equal(splitOverlay(o, 2.01, 'x'), null);
  assert.equal(splitOverlay(o, 7, 'x'), null);
  const t = { ...o, kind: 'text' as const, offset: undefined };
  assert.equal(splitOverlay(t, 4, 'y')![1].offset, undefined);
  const a: import('./project.ts').AudioItem = { id: 'a', assetId: 'A', at: 1, volume: 1, offset: 2 };
  const [al, ar] = splitAudio(a, 4, 10, 'b')!; // plays file 2..10 from 1..9
  assert.deepEqual([al.len, ar.at, ar.offset, ar.len], [3, 4, 5, 5]);
  assert.equal(splitAudio(a, 9.5, 10, 'b'), null);
  console.log('split ok');
}
