// Run: node src/lib/diarize.test.ts
import assert from 'node:assert/strict';
import { cosine, cluster, smooth, spanOf, applySpeakers } from './diarize.ts';

// Fake voice fingerprints: two speakers around two directions, a bit of noise.
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const voice = (base: number[]) => Float32Array.from(base, (v) => v + rnd() * 0.25);
const A = [1, 0, 0, 0.5, 0, 0, 0, 0], B = [0, 1, 0.3, 0, 0, 1, 0, 0], C = [0, 0, 0, 0, 1, 0, 1, 0.4];

assert.ok(Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([2, 0])) - 1) < 1e-9);
assert.equal(cosine(new Float32Array([1, 0]), new Float32Array([0, 3])), 0);

// interview: A B A A B A
const order = [A, B, A, A, B, A];
assert.deepEqual(cluster(order.map(voice)), [0, 1, 0, 0, 1, 0]);
// asked for 2 speakers with a third voice present: merges into 2 groups
assert.equal(new Set(cluster([A, B, C, A, C].map(voice), { k: 2 })).size, 2);
// three voices found without a count
assert.deepEqual(cluster([A, B, C, B, A, C].map(voice)), [0, 1, 2, 1, 0, 2]);
// one speaker only
assert.deepEqual(cluster([A, A, A].map(voice)), [0, 0, 0]);
assert.deepEqual(cluster([]), []);

// smoothing: a short odd one between two agreeing neighbours follows them
assert.deepEqual(smooth([0, 1, 0, 1], [2, 0.4, 2, 2]), [0, 0, 0, 1]);
assert.deepEqual(smooth([0, 1, 0], [2, 1.5, 2]), [0, 1, 0]); // long enough: kept

// windows: short captions widened to 1s around their middle
const cap = (s: number, e: number) => ({ id: 'x', words: [{ text: 'a', start: s, end: e }] });
assert.deepEqual(spanOf(cap(2, 4)), [2, 4]);
assert.deepEqual(spanOf(cap(3, 3.2)), [2.6, 3.6]);

// applying: names kept, list grows
const caps = [{ id: 'a', words: [] }, { id: 'b', words: [] }, { id: 'c', words: [] }];
const r = applySpeakers(caps, ['a', 'b'], [0, 2], ['Ana']);
assert.deepEqual(r.captions.map((c) => c.speaker), [0, 2, undefined]);
assert.deepEqual(r.speakers, ['Ana', '', '']);
// pieces: ~1.2s of words, never across captions, short tails join the previous piece
import { units, splitBySpeaker } from './diarize.ts';
const W = (n: number, t0: number, step = 0.4) => Array.from({ length: n }, (_, i) => ({ text: 'w' + i, start: t0 + i * step, end: t0 + i * step + 0.35 }));
const capsU = [{ id: 'a', words: W(10, 0) }, { id: 'b', words: W(2, 10) }];
const us = units(capsU);
assert.deepEqual(us.map((u) => [u.capId, u.from, u.to]), [['a', 0, 4], ['a', 4, 8], ['a', 8, 10], ['b', 0, 2]]);
// a speaker change inside caption a (after its 8th word) splits it; b keeps its id
let n = 0;
const split = splitBySpeaker(capsU, us, [0, 0, 1, 1], () => 'new' + ++n);
assert.deepEqual(split.map((c) => [c.id, c.words.length, c.speaker]), [['a', 8, 0], ['new1', 2, 1], ['b', 2, 1]]);
assert.equal(split.reduce((k, c) => k + c.words.length, 0), 12); // no word lost
// agreeing pieces: no split
assert.deepEqual(splitBySpeaker(capsU, us, [1, 1, 1, 0], () => 'x').map((c) => [c.id, c.speaker]), [['a', 1], ['b', 0]]);
console.log('diarize ok');
