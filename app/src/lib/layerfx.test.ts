// Run: node src/lib/layerfx.test.ts
import assert from 'node:assert/strict';
import { keyPixels, maskAlpha, compositeOp, hexRgb, DEFAULT_KEY, DEFAULT_MASK } from './layerfx.ts';

assert.deepEqual(hexRgb('#00ff00'), [0, 255, 0]);
assert.equal(compositeOp(), 'source-over');
assert.equal(compositeOp('normal'), 'source-over');
assert.equal(compositeOp('screen'), 'screen');

// green screen: pure, dark and bright greens key out; skin, white, black and red stay
const px = (...c: number[][]) => new Uint8ClampedArray(c.flatMap((x) => [...x, 255]));
const d = px([0, 255, 0], [20, 120, 30], [120, 255, 120], [230, 180, 150], [255, 255, 255], [0, 0, 0], [255, 0, 0]);
keyPixels(d, { ...DEFAULT_KEY, spill: 0 });
const alpha = [3, 7, 11, 15, 19, 23, 27].map((i) => d[i]);
assert.deepEqual(alpha.slice(0, 2), [0, 0]);
assert.ok(alpha[2] < 255); // pale green at least partly keyed
assert.deepEqual(alpha.slice(3), [255, 255, 255, 255]);

// spill: a greenish edge pixel that survives loses some green, a neutral one is untouched
const e = px([140, 200, 140], [128, 128, 128]);
keyPixels(e, { ...DEFAULT_KEY, tol: 0.05, soft: 0.05, spill: 1 });
assert.ok(e[1] < 200 && e[3] > 0);
assert.deepEqual([...e.slice(4, 7)], [128, 128, 128]);

// masks
const el = { ...DEFAULT_MASK, feather: 0.02 };
assert.equal(maskAlpha(el, 0.5, 0.5), 1);
assert.equal(maskAlpha(el, 0.02, 0.02), 0);
assert.equal(maskAlpha({ ...el, invert: true }, 0.5, 0.5), 0);
const rect = { ...DEFAULT_MASK, shape: 'rect' as const, w: 0.5, h: 0.5, feather: 0.02 };
assert.equal(maskAlpha(rect, 0.5, 0.5), 1);
assert.equal(maskAlpha(rect, 0.8, 0.5), 0);
assert.ok(Math.abs(maskAlpha(rect, 0.75, 0.5) - 0.5) < 1e-9); // half on the edge
const lin = { ...DEFAULT_MASK, shape: 'linear' as const, angle: 0, pos: 0.5, feather: 0.2 };
assert.equal(maskAlpha(lin, 0.1, 0.5), 0); // left of the edge hidden
assert.equal(maskAlpha(lin, 0.9, 0.5), 1);
assert.ok(Math.abs(maskAlpha(lin, 0.5, 0.5) - 0.5) < 1e-9);

console.log('layerfx ok');
