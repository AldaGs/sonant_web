// Run: node src/lib/audio.test.ts
import assert from 'node:assert/strict';
import { speechRanges, duckGain, lufs, normalizeGain } from './audio.ts';

const w = (start: number, end: number) => ({ start, end });
assert.deepEqual(speechRanges([w(0, 1), w(1.2, 2), w(3, 4)]), [[0, 2], [3, 4]]);
const r = speechRanges([w(2, 4)]);
assert.equal(duckGain(r, 0, 0.3), 1);
assert.equal(duckGain(r, 3, 0.3), 0.3);
assert.ok(Math.abs(duckGain(r, 1.875, 0.3, 0.25) - 0.65) < 1e-9); // halfway down the fade-in
assert.ok(Math.abs(duckGain(r, 4.125, 0.3, 0.25) - 0.65) < 1e-9);
assert.equal(duckGain(r, 5, 0.3), 1);

// BS.1770 reference: a 0 dBFS 1 kHz sine on one channel reads −3.01 LUFS.
const sr = 48000, x = new Float32Array(sr * 3), silent = new Float32Array(sr * 3);
for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
const l = lufs([x, silent], sr);
assert.ok(Math.abs(l - -3.01) < 0.1, `got ${l}`);
assert.equal(lufs([silent], sr), -Infinity);
// Quiet sine (−30 dBFS) gets boosted towards −14 but its peak stays under −1 dBFS.
const q = x.map((v) => v * 10 ** (-30 / 20));
const g = normalizeGain([q, silent], sr);
assert.ok(g > 1 && g * 10 ** (-30 / 20) <= 0.8901, `gain ${g}`);
console.log('audio ok');
