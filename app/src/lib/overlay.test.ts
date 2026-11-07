// Run: node src/lib/overlay.test.ts
import assert from 'node:assert/strict';
import { trimOverlay, lanes, overlaysAt, placeMedia, hitPlaced, corner, DEFAULT_TF, type Overlay } from './overlay.ts';

const tf = DEFAULT_TF;
const v: Overlay = { id: 'v', kind: 'video', at: 2, len: 4, assetId: 'A', offset: 1, tf };
const img: Overlay = { id: 'i', kind: 'image', at: 0, len: 3, assetId: 'B', tf };

// Video can't run past its file or before its start; trimming the start moves the file offset too.
assert.deepEqual(trimOverlay(v, 'end', 10, 6), { len: 5 });
assert.deepEqual(trimOverlay(v, 'start', -5, 6), { at: 1, offset: 0, len: 5 });
assert.deepEqual(trimOverlay(v, 'start', 1, 6), { at: 3, offset: 2, len: 3 });
{ const r = trimOverlay(v, 'start', 10, 6); assert.ok(Math.abs(r.len! - 0.2) < 1e-9 && Math.abs(r.at! - 5.8) < 1e-9); }
// Images stretch freely, but never before 0.
assert.deepEqual(trimOverlay(img, 'end', 10), { len: 13 });
assert.deepEqual(trimOverlay({ ...img, at: 1 }, 'start', -5), { at: 0, len: 4 });

assert.deepEqual([...lanes([img, v, { ...img, id: 'k', at: 3 }]).entries()].sort(), [['i', 0], ['k', 0], ['v', 1]]);
assert.deepEqual(overlaysAt([img, v], 2.5).map((o) => o.id), ['i', 'v']);
assert.deepEqual(overlaysAt([img, v], 6).map((o) => o.id), []);

// 1920×1080 source at 40% of a 1000×500 frame, with half the width cropped away.
const p = placeMedia({ ...tf, crop: [0.25, 0, 0.25, 0] }, 1920, 1080, 1000, 500);
assert.equal(p.w, 400);
assert.equal(p.h, 450); // 960×1080 visible → 400 wide, 450 tall
assert.deepEqual(p.src, [480, 0, 960, 1080]);

// Hit test respects rotation.
const box = { id: 'x', cx: 100, cy: 100, w: 100, h: 20, rot: 90 };
assert.ok(hitPlaced(box, 100, 145));
assert.ok(!hitPlaced(box, 145, 100));
const c = corner(box, 1, 1);
assert.ok(Math.abs(c.x - 90) < 1e-9 && Math.abs(c.y - 150) < 1e-9);
console.log('overlay ok');
