// Run: node src/lib/links.test.ts
import assert from 'node:assert/strict';
import { linkLegacy, reconcile, unlink, splitLink } from './links.ts';
import { splitOverlay, splitAudio } from './tracks.ts';
import type { Overlay } from './overlay.ts';
import type { AudioItem } from './project.ts';

const dur = () => 10;
const tf = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
const ov = (p: Partial<Overlay>): Overlay => ({ id: 'o', kind: 'video', assetId: 'V', at: 1, len: 4, offset: 2, tf, ...p });

// Legacy: a layer with sound gets a linked audio item at its volume and goes silent.
const lg = linkLegacy([ov({ volume: 0.6 }), ov({ id: 'q', volume: 0 })], [], dur)!;
assert.equal(lg.overlays[0].volume, 0);
assert.ok(lg.overlays[0].link);
assert.equal(lg.overlays[1].link, undefined);
assert.deepEqual([lg.audios[0].at, lg.audios[0].len, lg.audios[0].offset, lg.audios[0].volume, lg.audios[0].link, lg.audios[0].track],
  [1, 4, 2, 0.6, lg.overlays[0].link, 0]);
assert.equal(linkLegacy(lg.overlays, lg.audios, dur), null);

const mem = new Map();
let o = [ov({ link: 'L' })], a: AudioItem[] = [{ id: 'a', assetId: 'V', at: 1, len: 4, offset: 2, volume: 1, link: 'L' }];
assert.equal(reconcile(o, a, dur, mem), null); // in sync; remembered
// Move the layer: the audio follows.
let r = reconcile([{ ...o[0], at: 3 }], a, dur, mem)!;
assert.equal(r.audios[0].at, 3);
o = r.overlays; a = r.audios;
// Trim the audio: the layer follows.
r = reconcile(o, [{ ...a[0], len: 2, offset: 3 }], dur, mem)!;
assert.deepEqual([r.overlays[0].len, r.overlays[0].offset], [2, 3]);
o = r.overlays; a = r.audios;
// Delete the audio: the layer goes too.
r = reconcile(o, [], dur, mem)!;
assert.deepEqual(r.overlays, []);

// Splitting both at the same time keeps both halves paired.
const m2 = new Map();
const O = ov({ link: 'K' }), A: AudioItem = { id: 'a', assetId: 'V', at: 1, len: 4, offset: 2, volume: 1, link: 'K' };
reconcile([O], [A], dur, m2);
const [ol, or] = splitOverlay(O, 2, 'o2')!, [al, ar] = splitAudio(A, 2, 10, 'a2')!;
assert.equal(or.link, splitLink('K', 2));
assert.equal(ar.link, or.link);
assert.equal(reconcile([ol, or], [al, ar], dur, m2), null);

// Unlinked: edits no longer travel.
const u = unlink([O], [A], 'K');
assert.equal(reconcile([{ ...u.overlays[0], at: 5 }], u.audios, dur, new Map()), null);
console.log('links ok');
