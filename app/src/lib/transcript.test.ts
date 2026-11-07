// Run: node src/lib/transcript.test.ts
import assert from 'node:assert/strict';
import { isFiller, silenceRanges, search } from './transcript.ts';

const w = (text: string, start: number, end = start + 0.3) => ({ text, start, end });

assert.ok(isFiller(w('Um,', 0)));
assert.ok(isFiller(w('uh...', 0)));
assert.ok(isFiller(w('Eh', 0)));
assert.ok(!isFiller(w('like', 0)));
assert.ok(!isFiller(w('este', 0)));
assert.ok(!isFiller(w('umbrella', 0)));

const words = [w('a', 1, 1.5), w('b', 1.6, 2), w('c', 4, 4.5)];
assert.deepEqual(silenceRanges(words, 6), [[0, 0.85], [2.15, 3.85], [4.65, 6]]);
assert.deepEqual(silenceRanges([], 6), []);
assert.deepEqual(silenceRanges([w('a', 0.1, 5.8)], 6), []); // nothing long enough

assert.deepEqual(search([w('Café', 0), w('cafe', 1), w('tea', 2)], 'CAFE'), [0, 1]);
assert.deepEqual(search(words, '  '), []);
console.log('transcript ok');
