// Run: node src/lib/stretch.test.ts
import assert from 'node:assert/strict';
import { stretch } from './stretch.ts';

const sr = 48000, x = Float32Array.from({ length: sr * 2 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr));
const crossings = (a: Float32Array) => { let n = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) n++; return n; };
for (const rate of [0.5, 2]) {
  const [y] = stretch([x], rate);
  assert.equal(y.length, Math.round(x.length / rate));
  const hz = crossings(y.subarray(4096, y.length - 4096)) / ((y.length - 8192) / sr);
  assert.ok(Math.abs(hz - 440) < 5, `rate ${rate}: ${hz} Hz`); // same pitch
  let peak = 0; for (let i = 4096; i < y.length - 4096; i++) peak = Math.max(peak, Math.abs(y[i]));
  assert.ok(peak > 0.4 && peak < 0.6, `rate ${rate}: peak ${peak}`); // same level
}
console.log('stretch ok');
