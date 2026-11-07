// Run: node src/lib/beats.test.ts
import assert from 'node:assert/strict';
import { detectBeats } from './beats.ts';

// A 128 BPM kick (decaying 60 Hz bursts) with offbeat hats and noise, starting 0.3s in.
const sr = 22050, secs = 20, bpm = 128, beat = 60 / bpm;
const x = new Float32Array(sr * secs);
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
for (let i = 0; i < x.length; i++) x[i] = 0.02 * rnd();
for (let t = 0.3; t < secs; t += beat) {
  for (let i = 0; i < sr * 0.15; i++) x[Math.floor(t * sr) + i] += Math.exp(-i / (sr * 0.03)) * Math.sin((2 * Math.PI * 60 * i) / sr);
  for (let i = 0; i < sr * 0.03; i++) x[Math.floor((t + beat / 2) * sr) + i] += 0.15 * Math.exp(-i / (sr * 0.005)) * rnd();
}
const r = detectBeats(x, sr);
assert.ok(Math.abs(r.bpm - bpm) < 1.5, `bpm ${r.bpm}`);
// Beats land on the kicks (within 30 ms), not the hats.
const off = r.times.slice(2, -2).map((t) => Math.abs(((t - 0.3 + beat / 2) % beat) - beat / 2));
assert.ok(Math.max(...off) < 0.03, `max offset ${Math.max(...off)}`);
console.log('beats ok', r.bpm, 'BPM');
