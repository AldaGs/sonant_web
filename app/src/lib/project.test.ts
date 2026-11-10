// Run: node src/lib/project.test.ts
import assert from 'node:assert/strict';
import { clipStarts, seqDuration, clipAt, splitAtBoundaries, remapProject, move, itemLen, audioLanes, trimAudio } from './project.ts';

const d = { A: 10, B: 5, C: 3 };
const a = { id: 'a', assetId: 'A' }, b = { id: 'b', assetId: 'B' }, c = { id: 'c', assetId: 'C' };

assert.deepEqual(clipStarts([a, b, c], d), [0, 10, 15]);
assert.equal(seqDuration([a, b, c], d), 18);
assert.deepEqual(clipAt([a, b], d, 12), { index: 1, local: 2, file: 2 });
assert.deepEqual(clipAt([a, b], d, 10), { index: 1, local: 0, file: 0 });
assert.deepEqual(clipAt([a, b], d, 15), { index: 1, local: 5, file: 5 }); // end of the last clip
assert.equal(clipAt([a, b], d, 16), null);
assert.equal(clipAt([], d, 0), null);

assert.deepEqual(splitAtBoundaries([{ start: 8, end: 12 }], [0, 10]), [{ start: 8, end: 10 }, { start: 10, end: 12 }]);

// Adding clip C at the end: existing content stays, C is fully kept.
const w = (text: string, start: number) => ({ text, start, end: start + 0.5 });
const caps = [{ id: '1', words: [w('hi', 1)] }, { id: '2', words: [w('there', 11)] }];
let r = remapProject([a, b], [a, b, c], d, [{ start: 0, end: 15 }], caps);
assert.deepEqual(r.segments, [{ start: 0, end: 10 }, { start: 10, end: 15 }, { start: 15, end: 18 }]);
assert.deepEqual(r.captions.map((x) => x.words[0].start), [1, 11]);

// Swapping A and B: B's word moves from 11 to 1, A's from 1 to 6. A cut inside A moves with it.
r = remapProject([a, b], [b, a], d, [{ start: 0, end: 2 }, { start: 4, end: 15 }], caps);
assert.deepEqual(r.segments, [{ start: 0, end: 5 }, { start: 5, end: 7 }, { start: 9, end: 15 }]);
assert.deepEqual(r.captions.map((x) => [x.words[0].text, x.words[0].start]), [['there', 1], ['hi', 6]]);

// Removing A: its words and segments go; B shifts to 0.
r = remapProject([a, b], [b], d, [{ start: 0, end: 15 }], caps);
assert.deepEqual(r.segments, [{ start: 0, end: 5 }]);
assert.deepEqual(r.captions.map((x) => [x.words[0].text, x.words[0].start]), [['there', 1]]);

assert.deepEqual(move([1, 2, 3], 0, 1), [2, 1, 3]);
assert.deepEqual(move([1, 2, 3], 0, -1), [1, 2, 3]);
// audio items: trimmed length, lanes for overlaps, edge trimming
const music = { id: 'm', assetId: 'M', at: 2, volume: 1 };
assert.equal(itemLen(music, 10), 10);
assert.equal(itemLen({ ...music, offset: 3, len: 4 }, 10), 4);
assert.equal(itemLen({ ...music, offset: 8, len: 4 }, 10), 2); // can't run past the end of the file
const lanes = audioLanes([music, { id: 'v', assetId: 'V', at: 5, volume: 1 }, { id: 'w', assetId: 'V', at: 13, volume: 1 }], (id) => (id === 'M' ? 10 : 3));
assert.deepEqual([lanes.get('m'), lanes.get('v'), lanes.get('w')], [0, 1, 0]); // v overlaps m; w starts after m ends
assert.deepEqual(trimAudio(music, 10, 'end', -3), { len: 7 });
assert.deepEqual(trimAudio(music, 10, 'start', 1.5), { at: 3.5, offset: 1.5, len: 8.5 });
assert.deepEqual(trimAudio(music, 10, 'start', -5), { at: 2, offset: 0, len: 10 }); // can't extend before the file start
assert.deepEqual(trimAudio({ ...music, offset: 4, len: 6 }, 10, 'start', -3), { at: 0, offset: 2, len: 8 }); // nor before 0:00
assert.equal(trimAudio(music, 10, 'end', 99).len, 10);
console.log('project ok');

// Image clips: own length, and resizing moves later clips.
{
  const { clipLen, resizeClip, clipStarts: cs } = await import('./project.ts');
  const d = { img: 5, vid: 10 };
  const cl = [{ id: 'a', assetId: 'img', len: 3 }, { id: 'b', assetId: 'vid' }];
  assert.equal(clipLen(d, cl[0]), 3);
  assert.deepEqual(cs(cl, d), [0, 3]);
  const segs = [{ start: 0, end: 1, fx: { zoom: 1.2 } }, { start: 2, end: 3 }, { start: 3, end: 13 }];
  const r = resizeClip(cl, 0, 8, d, segs, []);
  assert.equal(r.clips[0].len, 8);
  assert.deepEqual(r.segments, [{ start: 0, end: 8, fx: { zoom: 1.2 } }, { start: 8, end: 18 }]);
}

// ---- Clip in/out ----
{
  const { clipBases, isolateStrip, extendClip, clipLen } = await import('./project.ts');
  const d2 = { A: 10, B: 5 };
  const ca = { id: 'a', assetId: 'A', in: 2, len: 4 }, cb = { id: 'b', assetId: 'B' };
  assert.equal(clipLen(d2, ca), 4);
  assert.equal(clipLen(d2, { id: 'x', assetId: 'A', in: 3 }), 7);
  assert.deepEqual(clipBases([ca, cb], d2), [-2, 4]);
  assert.deepEqual(clipAt([ca, cb], d2, 1), { index: 0, local: 1, file: 3 });

  // Isolate strip 3..7 of a 10s clip: three clips over the same file, sequence unchanged.
  const iso = isolateStrip([{ id: 'a', assetId: 'A' }, cb], d2, 3, 7)!;
  assert.equal(iso.index, 1);
  assert.deepEqual(iso.clips.map((c) => [c.in, c.len]), [[0, 3], [3, 4], [7, 3], [undefined, undefined]]);
  assert.equal(iso.clips[0].id, 'a');
  assert.equal(seqDuration(iso.clips, d2), 15);

  // Reordering keeps words on their frames: move the middle piece to the front.
  const words = [{ id: 'w', words: [{ text: 'hi', start: 4, end: 4.5 }] }];
  const r = remapProject(iso.clips, [iso.clips[1], iso.clips[0], iso.clips[2], iso.clips[3]], d2, [{ start: 0, end: 15 }], words);
  assert.deepEqual(r.captions[0].words[0], { text: 'hi', start: 1, end: 1.5 });

  // Extend a trimmed clip's start back into the file: content after it moves right, the first strip grows.
  const e = extendClip([ca, cb], 0, 'start', -1, d2, [{ start: 0.5, end: 4 }, { start: 4, end: 9 }], [{ id: 'q', words: [{ text: 'x', start: 1, end: 1.5 }] }])!;
  assert.deepEqual(e.clips[0], { id: 'a', assetId: 'A', in: 1, len: 5 });
  assert.deepEqual(e.segments, [{ start: 0, end: 5 }, { start: 5, end: 10 }]);
  assert.deepEqual(e.captions[0].words[0], { text: 'x', start: 2, end: 2.5 });
  // Can't go before the file's start, or past its end.
  assert.equal(extendClip([ca, cb], 0, 'start', -5, d2, [], [])!.clips[0].in, 0);
  assert.equal(extendClip([ca, cb], 0, 'end', 20, d2, [], [])!.clips[0].len, 8);
  // Shortening the end drops footage past the new edge.
  const sh = extendClip([ca, cb], 0, 'end', 3, d2, [{ start: 0, end: 4 }, { start: 4, end: 9 }], [])!;
  assert.deepEqual(sh.segments, [{ start: 0, end: 3 }, { start: 3, end: 8 }]);
  console.log('clip in/out ok');
}
