// Run: node src/lib/denoise.test.ts
import assert from 'node:assert/strict';
import { denoiseChannel, wav, cleanKey, RN_DELAY } from './denoise.ts';

// A fake model that only delays its input by RN_DELAY samples (like RNNoise) and halves it.
function fakeModel() {
  const hist: number[] = Array(RN_DELAY).fill(0);
  return (f: Float32Array) => {
    for (let i = 0; i < f.length; i++) {
      hist.push(f[i]);
      f[i] = hist.shift()! / 2;
    }
  };
}
const x = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7) * 0.5);

// delay is removed, so the output lines up with the input
const wet = denoiseChannel(x, 480, fakeModel(), 1);
assert.equal(wet.length, x.length);
for (const i of [0, 100, 2500, 4999]) assert.ok(Math.abs(wet[i] - x[i] / 2) < 1e-4, `sample ${i}`);
// mix 0 = original, 0.5 = halfway
const dry = denoiseChannel(x, 480, fakeModel(), 0);
assert.ok(dry.every((v, i) => Math.abs(v - x[i]) < 1e-6));
const half = denoiseChannel(x, 480, fakeModel(), 0.5);
assert.ok(Math.abs(half[300] - (x[300] * 0.75)) < 1e-4);
// the model gets 16-bit-scaled frames of the right size
let seen = 0, peak = 0;
denoiseChannel(x, 480, (f) => { assert.equal(f.length, 480); seen++; for (const v of f) peak = Math.max(peak, Math.abs(v)); }, 1);
assert.equal(seen, Math.ceil((x.length + RN_DELAY) / 480));
assert.ok(peak > 16000 && peak <= 16384);

// WAV header and size
const b = wav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 48000);
assert.equal(b.size, 44 + 3 * 2 * 2);
const v = new DataView(await b.arrayBuffer());
assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
assert.equal(v.getUint16(22, true), 2);
assert.equal(v.getUint32(24, true), 48000);
assert.equal(v.getInt16(46, true), 0x7fff >> 1); // 0.5 on channel 2, first sample
assert.equal(v.getInt16(48, true), 0x7fff);

assert.equal(cleanKey('a', 0.8), 'clean:a:0.8');
console.log('denoise ok');
