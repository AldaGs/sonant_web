// Run: node src/lib/autozoom.test.ts
import assert from 'node:assert/strict';
import { zoomMoments, autoZoomAt, scalePlace, ZOOM_EASE_IN } from './autozoom.ts';

const cap = (id: string, words: [string, number, boolean?][]) => ({ id, words: words.map(([text, start, em]) => ({ text, start, end: start + 0.4, ...(em ? { em } : {}) })) });
const caps = [
  cap('a', [['I', 0], ['made', 0.5], ['500', 1, true], ['dollars.', 1.5]]),
  cap('b', [['Then', 2], ['Paris', 2.5, true], ['happened', 3]]), // too close to the last zoom (gap 2.5)
  cap('c', [['Really', 5], ['AMAZING', 5.5, true]]),
];

const m = zoomMoments(caps, { gap: 2.5, sentences: false });
assert.deepEqual(m.map((z) => z.start), [1, 5.5]);
assert.ok(Math.abs(m[0].end - 2) < 1e-9); // word end + 0.6 hold
// sentence starts add the first word and the word after "dollars."
assert.deepEqual(zoomMoments(caps, { gap: 0.5, sentences: true }).map((z) => z.start), [0, 1, 2, 2.5, 5.5]);
// zooms never overlap
const tight = zoomMoments(caps, { gap: 0.5, sentences: true });
for (let i = 0; i + 1 < tight.length; i++) assert.ok(tight[i].end <= tight[i + 1].start);

// factor: 1 outside, eases in, holds at scale, eases out back to 1
assert.equal(autoZoomAt(m, 1.2, 0.5), 1);
assert.ok(autoZoomAt(m, 1.2, 1 + ZOOM_EASE_IN / 3) > 1 && autoZoomAt(m, 1.2, 1 + ZOOM_EASE_IN / 3) < 1.2);
assert.ok(Math.abs(autoZoomAt(m, 1.2, 1.5) - 1.2) < 1e-9);
assert.ok(autoZoomAt(m, 1.2, 2.1) < 1.2 && autoZoomAt(m, 1.2, 2.1) > 1);
assert.equal(autoZoomAt(m, 1.2, 3), 1);

assert.deepEqual(scalePlace([0, 0, 100, 100], 100, 100, 2), [-50, -50, 200, 200]);
assert.deepEqual(scalePlace([1, 2, 3, 4], 10, 10, 1), [1, 2, 3, 4]);

console.log('autozoom ok');

// camera shake
import { shakeAt, shakePlace, zoomShake, shakeScale } from './autozoom.ts';
assert.deepEqual(shakeAt(1, 0), [0, 0]);
for (let t = 0; t < 3; t += 0.013) { const [x, y] = shakeAt(t, 1); assert.ok(Math.abs(x) <= 0.0121 && Math.abs(y) <= 0.0121); }
// the enlargement always covers the offset, so no edge shows
assert.ok((shakeScale(1) - 1) / 2 >= 0.0121);
const sp = shakePlace([0, 0, 100, 100], 100, 100, 1, 0.7);
assert.ok(sp[0] <= 0 && sp[1] <= 0 && sp[0] + sp[2] >= 100 && sp[1] + sp[3] >= 100);
assert.deepEqual(shakePlace([1, 2, 3, 4], 10, 10, 0, 1), [1, 2, 3, 4]);
assert.ok(zoomShake(m, 1.01) > 0.8 && zoomShake(m, 1.5) === 0 && zoomShake(m, 0.5) === 0);
console.log('shake ok');
