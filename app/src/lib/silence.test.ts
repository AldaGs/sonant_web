// Run: node src/lib/silence.test.ts
import assert from 'node:assert/strict';
import { quietRanges } from './silence.ts';

const sr = 1000, x = new Float32Array(sr * 4);
for (let i = 0; i < x.length; i++) if (i < 1000 || i >= 3000) x[i] = Math.sin(i) * 0.5; // sound, 2 s quiet, sound
const r = quietRanges(x, sr, -35, 0.6, 0.1);
assert.equal(r.length, 1);
assert.ok(Math.abs(r[0][0] - 1.1) < 0.02 && Math.abs(r[0][1] - 2.9) < 0.02);
assert.deepEqual(quietRanges(x, sr, -35, 3, 0.1), []); // shorter than min
assert.deepEqual(quietRanges(new Float32Array(2000), sr), [[0, 2]]); // all silent
const lead = new Float32Array(sr * 2); for (let i = 1000; i < 2000; i++) lead[i] = Math.sin(i) * 0.5;
assert.deepEqual(quietRanges(lead, sr, -35, 0.6, 0.1), [[0, 0.9]]); // leading silence cut to the edge
console.log('silence ok');
