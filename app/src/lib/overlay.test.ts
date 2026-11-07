// Run: node src/lib/overlay.test.ts
import assert from 'node:assert/strict';
import { tfAt, setKey, keyAt, dropKey, punchKeys, trimOverlay, lanes, overlaysAt, placeMedia, hitPlaced, corner, DEFAULT_TF, type Overlay } from './overlay.ts';

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
// Keyframes: eased in between, held outside, edits near a key replace it.
const k = setKey(setKey([], 0, { ...tf, x: 0 }), 2, { ...tf, x: 1 });
const ko: Overlay = { ...img, at: 1, len: 4, kf: k };
assert.equal(tfAt(ko, 0).x, 0);
assert.equal(tfAt(ko, 2).x, 0.5); // halfway, ease in-out is symmetric
assert.ok(tfAt(ko, 1.5).x < 0.25); // eased: slow start
assert.equal(tfAt(ko, 9).x, 1);
assert.equal(setKey(k, 2.01, { ...tf, x: 0.7 }).length, 2);
assert.equal(setKey(k, 2.01, { ...tf, x: 0.7 })[1].x, 0.7);
assert.ok(keyAt(k, 2) && !keyAt(k, 1));
assert.equal(dropKey(k, 0).length, 1);
const pk = punchKeys({ ...img, kf: undefined }, 1);
assert.deepEqual(pk.map((x) => x.t), [1, 1.5]);
assert.ok(Math.abs(pk[1].scale - tf.scale * 1.2) < 1e-9);
console.log('overlay ok');

// Animated title: invisible at its edges, full at its middle, and travels the S from left to right.
{
  const { newTitle, liveTf, sPoint } = await import('./overlay.ts');
  const ti = newTitle(1, 'Hi');
  assert.equal(liveTf(ti, 1).opacity, 0);
  assert.ok(Math.abs(liveTf(ti, 3).opacity - 1) < 1e-9);
  assert.ok(liveTf(ti, 5).opacity < 1e-9);
  const m = ti.motion!;
  assert.ok(Math.abs(liveTf(ti, 1).x - (ti.tf.x - m.span / 2)) < 1e-9);
  assert.ok(Math.abs(liveTf(ti, 5).x - (ti.tf.x + m.span / 2)) < 1e-9);
  assert.ok(Math.abs(liveTf(ti, 3).y - ti.tf.y) < 1e-9); // crosses the centre midway
  assert.ok(sPoint(m, 0.25).dy < 0 && sPoint(m, 0.75).dy > 0); // two opposite bends
  assert.deepEqual(liveTf({ ...ti, motion: undefined }, 3), ti.tf);
}
