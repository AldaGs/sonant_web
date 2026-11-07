// Run: node src/lib/audiodecode.test.ts
import assert from 'node:assert/strict';
import { place } from './audiodecode.ts';

const out = [new Float32Array(6), new Float32Array(6)];
assert.equal(place(out, [Float32Array.from([1, 2]), Float32Array.from([3, 4])], 1), 2);
assert.deepEqual([...out[0]], [0, 1, 2, 0, 0, 0]);
assert.deepEqual([...out[1]], [0, 3, 4, 0, 0, 0]);
// mono chunk fills both channels; a chunk past the end is cut, not overflowed
assert.equal(place(out, [Float32Array.from([7, 8, 9])], 4), 2);
assert.deepEqual([...out[0]], [0, 1, 2, 0, 7, 8]);
assert.deepEqual([...out[1]], [0, 3, 4, 0, 7, 8]);
assert.equal(place(out, [Float32Array.from([1])], 9), 0);
console.log('audiodecode ok');
