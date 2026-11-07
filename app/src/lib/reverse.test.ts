// Run: node src/lib/reverse.test.ts
import assert from 'node:assert/strict';
import { reversedChunks, reverseRange } from './reverse.ts';

// 1s at 10 fps in 0.3s chunks: every frame once, in reverse order overall, forwards inside each chunk
const ch = reversedChunks(2, 3, 10, 0.3);
const flat = ch.flatMap((c) => [...c].reverse());
assert.equal(flat.length, 10);
assert.ok(flat.every((t, i) => i === 0 || t < flat[i - 1])); // strictly backwards
assert.ok(Math.abs(flat[0] - 2.95) < 1e-9 && Math.abs(flat[9] - 2.05) < 1e-9);
assert.ok(ch.every((c) => c.every((t, i) => i === 0 || t > c[i - 1]))); // each chunk decodes forwards
assert.deepEqual(ch.map((c) => c.length), [3, 3, 3, 1]);
assert.equal(reversedChunks(0, 0.01, 30).flat().length, 1); // never empty

assert.deepEqual([...reverseRange(Float32Array.from([0, 1, 2, 3, 4, 5]), 1, 5)], [4, 3, 2, 1]);
console.log('reverse ok');
