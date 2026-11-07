// Run: node src/lib/voicefx.test.ts
import assert from 'node:assert/strict';
import { pitchShift, applyVoiceFx, VOICE_FX } from './voicefx.ts';

const sr = 16000;
const tone = (hz: number, secs = 1) => Float32Array.from({ length: sr * secs }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sr));
// Dominant frequency by counting zero crossings in the middle (avoids edges).
function freq(x: Float32Array) {
  let n = 0;
  const a = Math.floor(x.length * 0.2), b = Math.floor(x.length * 0.8);
  for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
  return n / 2 / ((b - a) / sr);
}

const x = tone(200);
for (const [semis, want] of [[12, 400], [-12, 100], [4, 200 * 2 ** (4 / 12)]] as const) {
  const y = pitchShift(x, semis);
  assert.equal(y.length, x.length); // same length
  assert.ok(Math.abs(freq(y) - want) / want < 0.04, `${semis}: ${freq(y)} vs ${want}`);
}
// every effect keeps the length and gives finite, non-silent audio at a similar level
for (const fx of VOICE_FX) {
  const y = applyVoiceFx(tone(440), sr, fx);
  assert.equal(y.length, sr);
  assert.ok(y.every(Number.isFinite));
  const p = y.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(p > 0.1 && p < 1.01, `${fx}: peak ${p}`);
}
console.log('voicefx ok');
