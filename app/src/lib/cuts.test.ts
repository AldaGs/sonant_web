// Run: node src/lib/cuts.test.ts
import assert from 'node:assert/strict';
import { splitAt, remove, trim, toSource, toOutput, nextKept, outDuration, captionsForOutput, cutRange, keepRange, isCut, keptCaptions } from './cuts.ts';

let s = [{ start: 0, end: 10 }];
s = splitAt(s, 4);
assert.deepEqual(s, [{ start: 0, end: 4 }, { start: 4, end: 10 }]);
assert.equal(splitAt(s, 4.05), s); // too close to an edge
s = splitAt(s, 6);
s = remove(s, 1); // cut 4..6 out
assert.deepEqual(s, [{ start: 0, end: 4 }, { start: 6, end: 10 }]);
assert.equal(outDuration(s), 8);
assert.deepEqual(remove([{ start: 0, end: 1 }], 0), [{ start: 0, end: 1 }]); // keep at least one

// time mapping
assert.equal(toSource(s, 5), 7);
assert.equal(toOutput(s, 7), 5);
assert.equal(toOutput(s, 5), null);
assert.equal(toSource(s, 99), 10);

// playback skipping
assert.equal(nextKept(s, 3), 3);
assert.equal(nextKept(s, 5), 6);
assert.equal(nextKept(s, 10), null);

// trimming stays within neighbours
assert.deepEqual(trim(s, 1, 2, 12, 10)[1], { start: 4, end: 10 });
assert.equal(trim(s, 0, 3.95, 4, 10), s); // too short

// captions follow the cut
const caps = [
  { id: 'a', words: [{ text: 'keep', start: 1, end: 2 }, { text: 'gone', start: 4.5, end: 5 }] },
  { id: 'b', words: [{ text: 'later', start: 7, end: 8 }] },
  { id: 'c', words: [{ text: 'cut', start: 5, end: 5.5 }] },
];
const out = captionsForOutput(caps, s);
assert.deepEqual(out.map((c) => c.words.map((w) => [w.text, w.start, +w.end.toFixed(3)])), [[['keep', 1, 2]], [['later', 5, 6]]]);
// cutting and restoring word ranges
let k = [{ start: 0, end: 10 }];
k = cutRange(k, 2, 3);
assert.deepEqual(k, [{ start: 0, end: 2 }, { start: 3, end: 10 }]);
k = cutRange(k, 2.5, 4); // overlaps an existing gap
assert.deepEqual(k, [{ start: 0, end: 2 }, { start: 4, end: 10 }]);
assert.deepEqual(cutRange([{ start: 0, end: 1 }], 0, 1), [{ start: 0, end: 1 }]); // never empty
assert.ok(isCut(k, { start: 2.2, end: 2.8 }));
assert.ok(!isCut(k, { start: 4.5, end: 5 }));
k = keepRange(k, 2, 3); // touches left segment only
assert.deepEqual(k, [{ start: 0, end: 3 }, { start: 4, end: 10 }]);
k = keepRange(k, 3, 4); // bridges both
assert.deepEqual(k, [{ start: 0, end: 10 }]);
// manual splits that don't touch the restored range are left alone
assert.deepEqual(keepRange([{ start: 0, end: 5 }, { start: 5, end: 8 }, { start: 9, end: 10 }], 8.5, 9),
  [{ start: 0, end: 5 }, { start: 5, end: 8 }, { start: 8.5, end: 10 }]);

const kc = keptCaptions([{ id: 'a', words: [{ text: 'um', start: 2.1, end: 2.5 }, { text: 'hi', start: 5, end: 5.4 }] }], [{ start: 0, end: 2 }, { start: 4, end: 10 }]);
assert.deepEqual(kc[0].words.map((w) => w.text), ['hi']);
console.log('cuts ok');
