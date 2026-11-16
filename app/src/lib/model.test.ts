// Run: node src/lib/model.test.ts
import assert from 'node:assert/strict';
import { assignBases, assetAtSrc, fileAt, outAtFile, splitMedia, piecesOf, srcToOut, outToSrc, captionsOut, keptCaps, isCutW, rippleCut,
  cutSource, restoreSource, timelineEnd, srcLen, srcRangeOut } from './model.ts';
import { migrateDoc } from './migrate.ts';
import type { Overlay } from './overlay.ts';
import type { AudioItem, Asset } from './project.ts';

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
const tf = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };

// Source space: each asset gets a fixed base.
const assets = assignBases([{ id: 'A', name: 'a', kind: 'video', duration: 20 }, { id: 'B', name: 'b', kind: 'video', duration: 5.5 }] as Asset[]);
assert.equal(assets[0].base, 0);
assert.equal(assets[1].base, 30); // ceil(0 + 20) + 10
assert.equal(assignBases(assets), assets);
assert.deepEqual(assetAtSrc(assets, 32)!.file, 2);
const bases = new Map(assets.map((a) => [a.id, a.base!]));

// Item time with speed: 2× plays 4 file seconds in 2 output seconds.
const fast = { at: 10, len: 2, offset: 3, fx: { speed: 2 } };
near(fileAt(fast, 11), 5);
near(outAtFile(fast, 5), 11);
near(srcLen(fast), 4);
const hold = { at: 0, len: 3, offset: 4, fx: { hold: 3 } };
near(fileAt(hold, 2), 4);

// Splitting keeps file position, ramps meet in the middle, links stay paired.
const [l, r] = splitMedia({ id: 'x', at: 0, len: 4, offset: 1, link: 'k' }, 1.5, 'y')!;
assert.deepEqual([l.len, r.at, r.len, r.offset, r.link], [1.5, 1.5, 2.5, 2.5, 'k@1.500']);
const [rl, rr] = splitMedia({ id: 'x', at: 0, len: 2, offset: 0, fx: { speed: 1, speedEnd: 3 } }, 1, 'y')!;
near(rl.fx!.speedEnd!, rr.fx!.speed!);
assert.equal(splitMedia({ id: 'x', at: 0, len: 1 }, 0.01, 'y'), null);

// Two pieces of A on V1/A1, with a cut between them (file 4..6 missing).
const v = (id: string, at: number, len: number, offset: number, link: string, track = 0): Overlay => ({ id, kind: 'video', assetId: 'A', at, len, offset, link, track, tf, fill: true });
const a = (id: string, at: number, len: number, offset: number, link: string, track = 0): AudioItem => ({ id, assetId: 'A', at, len, offset, link, track, volume: 1 });
let L = { overlays: [v('v1', 0, 4, 0, 'p'), v('v2', 4, 6, 6, 'q')], audios: [a('a1', 0, 4, 0, 'p'), a('a2', 4, 6, 6, 'q')] };
let P = piecesOf(L.overlays, L.audios, bases);
assert.equal(P.length, 2); // pictures with linked sound don't count twice
assert.equal(srcToOut(P, 2), 2);
assert.equal(srcToOut(P, 5), null); // cut
assert.equal(srcToOut(P, 7), 5);
assert.equal(outToSrc(P, 5), 7);
assert.equal(srcToOut(P, 32), null); // B isn't on the timeline

const w = (text: string, s: number) => ({ text, start: s, end: s + 0.5 });
const caps = [{ id: 'c1', words: [w('one', 1), w('two', 4.5), w('three', 7)] }, { id: 'c2', free: true, words: [w('typed', 0.2)] }];
const out = captionsOut(caps, P);
assert.deepEqual(out.map((c) => c.words.map((x) => [x.text, x.start])), [[['typed', 0.2]], [['one', 1], ['three', 5]]]);
assert.ok(isCutW(P, caps[0].words[1]));
assert.deepEqual(keptCaps(caps, P)[0].words.map((x) => x.text), ['one', 'three']);
assert.deepEqual(srcRangeOut(P, 3, 7), [{ o0: 3, o1: 4, id: 'a1' }, { o0: 4, o1: 5, id: 'a2' }]);

// Ripple cut on V1 + A1 only: a layer on V2 stays put.
const layer: Overlay = { id: 't', kind: 'text', text: 'hi', at: 6, len: 2, track: 1, tf };
const cut = rippleCut([...L.overlays, layer], new Set([0]), 1, 2);
assert.deepEqual(cut.map((o) => [o.at, o.len, o.offset]), [[0, 1, 0], [1, 2, 2], [3, 6, 6], [6, 2, undefined]]);
assert.equal(cut[1].link, 'p@2.000');

// Deleting the word "one" (source 1..1.5) cuts it from the picture and the sound, which stay paired.
let D = cutSource(L, P, [[1, 1.5]]);
assert.deepEqual(D.overlays.map((o) => [o.at, o.len, o.offset]), [[0, 1, 0], [1, 2.5, 1.5], [3.5, 6, 6]]);
assert.deepEqual(D.audios.map((o) => [o.at, o.len, o.offset, o.link]), D.overlays.map((o) => [o.at, o.len, o.offset, o.link]));
P = piecesOf(D.overlays, D.audios, bases);
assert.ok(isCutW(P, caps[0].words[0]));
near(srcToOut(P, 7)!, 4.5);

// Restoring it: the left piece grows back and the halves merge; later items move on.
const R = restoreSource(D, assets, 1, 1.5);
assert.deepEqual(R.overlays.map((o) => [o.at, o.len, o.offset]), [[0, 4, 0], [4, 6, 6]]);
assert.deepEqual(R.audios.map((o) => [o.at, o.len, o.offset]), [[0, 4, 0], [4, 6, 6]]);
// Restoring the old gap 4..6 joins everything into one item again.
const R2 = restoreSource(R, assets, 4, 6);
assert.deepEqual(R2.overlays.map((o) => [o.at, o.len, o.offset]), [[0, 12, 0]]);
assert.deepEqual(R2.audios.map((o) => [o.at, o.len]), [[0, 12]]);
// Restoring something with nothing before it: the item after it starts earlier in its file.
const R3 = restoreSource({ overlays: [v('v', 2, 3, 5, 'z')], audios: [a('a', 2, 3, 5, 'z')] }, assets, 4, 5);
assert.deepEqual(R3.overlays.map((o) => [o.at, o.len, o.offset]), [[2, 4, 4]]);
// Not touching: a new item goes after the one before it.
const R4 = restoreSource({ overlays: [v('v', 0, 2, 0, 'z'), v('w', 2, 2, 10, 'y')], audios: [] }, assets, 5, 6);
assert.deepEqual(R4.overlays.map((o) => [o.at, o.len, o.offset ?? 0]).sort((x, y) => x[0] - y[0]), [[0, 2, 0], [2, 1, 5], [3, 2, 10]]);

assert.equal(timelineEnd(L, () => 20), 10);

// ---- Migration of a version 1 doc ----
const old = {
  assets: [{ id: 'A', name: 'a', kind: 'video', duration: 10 }, { id: 'I', name: 'i', kind: 'image', duration: 0 }, { id: 'M', name: 'm', kind: 'audio', duration: 30 }] as Asset[],
  // V1: A from file 2 (len 8, sequence 0..8), a 3s gap, then the image (5s, sequence 11..16).
  clips: [{ id: 'c', assetId: 'A', in: 2 }, { id: 'g', assetId: '', len: 3 }, { id: 'i', assetId: 'I', len: 5 }],
  segments: [{ start: 0, end: 2, fx: { color: { exposure: 1 } as never } }, { start: 3, end: 5, fx: { speed: 2, vol: 0.5 } }, { start: 5, end: 8, fx: { hold: 1.5 } }, { start: 8, end: 11, fx: { lift: true } }, { start: 11, end: 16 }],
  captions: [{ id: 'k', words: [w('hello', 0.5), w('cut', 2.2), w('fast', 3.5)] }],
  overlays: [{ id: 'o', kind: 'text', text: 'x', at: 1, len: 1, track: 0, tf } as Overlay],
  audios: [{ id: 'm', assetId: 'M', at: 0, volume: 1, track: 0 } as AudioItem],
  tracks: { v: [{ hidden: true }], a: [] },
  autoZoom: { scale: 1.2, gap: 2, sentences: false, edits: { '3.50': 4 } },
};
const m = migrateDoc(old as Parameters<typeof migrateDoc>[0]) as ReturnType<typeof migrateDoc> & { v: number };
assert.equal(m.v, 2);
const v1 = m.overlays!.filter((o) => o.track === 0);
// Strips: 0..2 (2s), 3..5 at 2× (1s), freeze 1.5s, gap 3s (skipped), image 5s.
assert.deepEqual(v1.map((o) => [o.kind, o.at, o.len, o.offset ?? null]), [['video', 0, 2, 2], ['video', 2, 1, 5], ['video', 3, 1.5, 7], ['image', 7.5, 5, null]]);
assert.ok(v1.every((o) => o.fill));
assert.deepEqual(v1[1].fx, { speed: 2 });
assert.equal(v1[2].fx!.hold, 1.5);
const a1 = m.audios!.filter((x) => x.track === 0);
assert.deepEqual(a1.map((x) => [x.at, x.len, x.offset, x.volume, x.fx?.speed]), [[0, 2, 2, 1, undefined], [2, 1, 5, 0.5, 2]]); // freeze and image have no sound
assert.equal(a1[0].link, v1[0].link);

assert.equal(m.overlays!.find((o) => o.id === 'o')!.track, 1); // the layer moved up to V2
assert.equal(m.audios!.find((x) => x.id === 'm')!.track, 1); // the music to A2
assert.deepEqual(m.tracks, { v: [{}, { hidden: true }], a: [{}] });
// Words move to source time (A's base is 0, so file time): sequence 0.5 is file 2.5.
assert.deepEqual(m.captions![0].words.map((x) => [x.text, x.start]), [['hello', 2.5], ['cut', 4.2], ['fast', 5.5]]);
assert.deepEqual(m.autoZoom!.edits, { '5.50': 6 });
// And they land where the strips play them.
const mp = piecesOf(m.overlays!, m.audios!, new Map(m.assets!.map((x) => [x.id, x.base!])));
assert.deepEqual(captionsOut(m.captions!, mp)[0].words.map((x) => [x.text, x.start]), [['hello', 0.5], ['fast', 2.25]]);
assert.equal(migrateDoc(m).overlays, m.overlays); // already current

console.log('model ok');
