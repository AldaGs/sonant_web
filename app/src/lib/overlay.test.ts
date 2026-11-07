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
// mask keyframes: interpolated over the layer's time; wipe reveals left to right
import { maskAt, setMaskKey, maskReveal } from './overlay.ts';
import { maskAlpha } from './layerfx.ts';
const lay = { id: 'm', kind: 'image' as const, at: 10, len: 3, tf: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 }, ...maskReveal('wipe', 1) };
const mk = (t: number) => maskAt(lay, t)!;
assert.equal(maskAlpha(mk(10), 0.1, 0.5), 0); // hidden at the start
assert.ok(maskAlpha(mk(10.5), 0.1, 0.5) === 1 && maskAlpha(mk(10.5), 0.9, 0.5) === 0); // half way: left shown, right not yet
assert.equal(maskAlpha(mk(12), 0.9, 0.5), 1); // fully shown after
const spot = { ...lay, ...maskReveal('spot', 1) };
assert.ok(maskAt(spot, 10)!.w < 0.05 && maskAt(spot, 11.5)!.w > 1.5);
assert.equal(maskAt({ ...lay, maskKf: undefined }, 10.5), lay.mask); // no keys: the mask as set
assert.equal(setMaskKey(lay.maskKf, 1, { ...lay.mask, pos: 0.3 }).length, 2); // same time: replaced
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

// Every title path starts and ends on the travel line's edges; every style ends invisible or settled.
{
  const { newTitle, liveTf, sPoint, TITLE_PATHS, TITLE_STYLES } = await import('./overlay.ts');
  const ti = newTitle(0, 'Hi');
  for (const path of TITLE_PATHS) for (const style of TITLE_STYLES) {
    const o = { ...ti, motion: { ...ti.motion!, path, style } };
    for (let t = 0; t <= 4; t += 0.05) { const f = liveTf(o, t); for (const v of Object.values(f)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path}/${style} ${t}`); }
    const mid = liveTf(o, 2);
    assert.ok(Math.abs(mid.scale - ti.tf.scale) < 1e-6 && Math.abs((mid.sx ?? 1) - 1) < 1e-6, `${path}/${style} settled midway`);
  }
  const m = ti.motion!;
  for (const path of ['s', 'wave', 'loop'] as const) assert.ok(Math.abs(sPoint({ ...m, path }, 0).dx + m.span / 2) < 1e-9);
}
