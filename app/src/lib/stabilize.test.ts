// Run: node src/lib/stabilize.test.ts
import assert from 'node:assert/strict';
import { shiftOf, smoothPath, planStab, stabAt, stabPlace } from './stabilize.ts';

// A textured scene, and frames that look at it from shifted positions (a camera moving by ox, oy).
const W = 160, H = 90;
const scene = (x: number, y: number) => 128 + 60 * Math.sin(x * 0.21) * Math.cos(y * 0.17) + 40 * Math.sin((x + 2 * y) * 0.07) + ((x * 7 + y * 13) % 11) * 2;
const frame = (ox: number, oy: number) => Uint8Array.from({ length: W * H }, (_, i) => scene((i % W) + ox, Math.floor(i / W) + oy));

// camera moves right by 3 → the picture content moves left by 3
assert.deepEqual(shiftOf(frame(0, 0), frame(3, 0), W, H), [-3, 0]);
assert.deepEqual(shiftOf(frame(0, 0), frame(-5, 4), W, H), [5, -4]);
assert.deepEqual(shiftOf(frame(2, 2), frame(2, 2), W, H), [0, 0]);
assert.deepEqual(shiftOf(frame(0, 0), frame(11, -9), W, H), [-11, 9]);

// smoothing keeps a constant and a straight line, and flattens a zigzag
assert.ok(smoothPath([5, 5, 5, 5], 2).every((v) => Math.abs(v - 5) < 1e-9));
// a steady pan stays a straight line, ends included (no false corrections at the start or end)
const line = Array.from({ length: 30 }, (_, i) => 3.3 * i);
assert.ok(smoothPath(line, 5).every((v, i) => Math.abs(v - line[i]) < 1e-9));
const pan = planStab(Array.from({ length: 59 }, () => [0, 3.3] as [number, number]), 160, 90, 15, 0);
assert.ok(pan.y.every((v) => Math.abs(v) < 1e-4) && pan.zoom < 1.02);
const zig = Array.from({ length: 40 }, (_, i) => (i % 2 ? 4 : -4));
assert.ok(smoothPath(zig, 3).slice(5, 35).every((v) => Math.abs(v) < 1));

// a shaky pan: steady drift right (+2 px/frame) plus jitter; corrections remove the jitter, keep the pan
const jitter = [0, 3, -2, 4, -3, 2, -4, 3, -1, 2, -3, 4, -2, 1, -3, 2, -4, 3, 0, -2, 3, -3, 2, -1, 4, -4, 1, -2, 3, -3];
let cam = 0;
const pos = jitter.map((j, i) => i * 2 + j);
const shifts = pos.slice(1).map((p, i) => [p - pos[i], 0] as [number, number]);
const st = planStab(shifts, W, H, 15, 10, 0.7);
assert.equal(st.x.length, pos.length);
const fixed = pos.map((p, i) => p + st.x[i] * W);
const rough = (a: number[]) => a.slice(2).reduce((s, v, i) => s + Math.abs(v - 2 * a[i + 1] + a[i]), 0); // 2nd differences = shake
assert.ok(rough(fixed) < rough(pos) * 0.35, `${rough(fixed)} vs ${rough(pos)}`);
assert.ok(st.zoom > 1 && st.zoom < 1.2);
void cam;

// sampling and placing
assert.deepEqual(stabAt({ t0: 2, fps: 10, x: [0, 0.1], y: [0, -0.1], zoom: 1.1 }, 2.05).map((v) => +v.toFixed(3)), [0.05, -0.05]);
assert.deepEqual(stabAt({ t0: 0, fps: 10, x: [0.02], y: [0.01], zoom: 1 }, 99), [0.02, 0.01]);
const p = stabPlace([0, 0, 100, 100], 100, 100, { t0: 0, fps: 1, x: [0], y: [0], zoom: 1.2 }, 0);
assert.deepEqual(p.map((v) => +v.toFixed(6)), [-10, -10, 120, 120]);
assert.deepEqual(stabPlace([1, 2, 3, 4], 10, 10, undefined, 0), [1, 2, 3, 4]);
console.log('stabilize ok');
