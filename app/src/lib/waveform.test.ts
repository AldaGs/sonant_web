// Run: node src/lib/waveform.test.ts
import assert from 'node:assert/strict';
import { peaksOf, tickStep } from './waveform.ts';

const data = new Float32Array([0, 0.1, -0.5, 0.2, 0, 0, 0.25, -0.1]);
assert.deepEqual([...peaksOf(data, 4)].map((v) => +v.toFixed(4)), [0.2, 1, 0, 0.5]);
assert.deepEqual([...peaksOf(new Float32Array(8), 2)], [0, 0]); // silence stays 0, no NaN

assert.equal(tickStep(100, 1000), 10); // 10 px/s → 10s steps = 100px
assert.equal(tickStep(10, 1400), 0.5); // zoomed in
assert.equal(tickStep(3600, 800), 600); // very long video caps at 10 min
console.log('waveform ok');
