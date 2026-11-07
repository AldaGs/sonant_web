// Run: node src/lib/project.test.ts
import assert from 'node:assert/strict';
import { clipStarts, seqDuration, clipAt, splitAtBoundaries, remapProject, move } from './project.ts';

const d = { A: 10, B: 5, C: 3 };
const a = { id: 'a', assetId: 'A' }, b = { id: 'b', assetId: 'B' }, c = { id: 'c', assetId: 'C' };

assert.deepEqual(clipStarts([a, b, c], d), [0, 10, 15]);
assert.equal(seqDuration([a, b, c], d), 18);
assert.deepEqual(clipAt([a, b], d, 12), { index: 1, local: 2 });
assert.deepEqual(clipAt([a, b], d, 10), { index: 1, local: 0 });
assert.deepEqual(clipAt([a, b], d, 15), { index: 1, local: 5 }); // end of the last clip
assert.equal(clipAt([a, b], d, 16), null);
assert.equal(clipAt([], d, 0), null);

assert.deepEqual(splitAtBoundaries([{ start: 8, end: 12 }], [0, 10]), [{ start: 8, end: 10 }, { start: 10, end: 12 }]);

// Adding clip C at the end: existing content stays, C is fully kept.
const w = (text: string, start: number) => ({ text, start, end: start + 0.5 });
const caps = [{ id: '1', words: [w('hi', 1)] }, { id: '2', words: [w('there', 11)] }];
let r = remapProject([a, b], [a, b, c], d, [{ start: 0, end: 15 }], caps);
assert.deepEqual(r.segments, [{ start: 0, end: 10 }, { start: 10, end: 15 }, { start: 15, end: 18 }]);
assert.deepEqual(r.captions.map((x) => x.words[0].start), [1, 11]);

// Swapping A and B: B's word moves from 11 to 1, A's from 1 to 6. A cut inside A moves with it.
r = remapProject([a, b], [b, a], d, [{ start: 0, end: 2 }, { start: 4, end: 15 }], caps);
assert.deepEqual(r.segments, [{ start: 0, end: 5 }, { start: 5, end: 7 }, { start: 9, end: 15 }]);
assert.deepEqual(r.captions.map((x) => [x.words[0].text, x.words[0].start]), [['there', 1], ['hi', 6]]);

// Removing A: its words and segments go; B shifts to 0.
r = remapProject([a, b], [b], d, [{ start: 0, end: 15 }], caps);
assert.deepEqual(r.segments, [{ start: 0, end: 5 }]);
assert.deepEqual(r.captions.map((x) => [x.words[0].text, x.words[0].start]), [['there', 1]]);

assert.deepEqual(move([1, 2, 3], 0, 1), [2, 1, 3]);
assert.deepEqual(move([1, 2, 3], 0, -1), [1, 2, 3]);
console.log('project ok');
