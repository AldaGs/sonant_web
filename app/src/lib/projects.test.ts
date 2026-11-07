// Run: node src/lib/projects.test.ts
import assert from 'node:assert/strict';
import { packProject, unpackProject, reassignIds, type ProjectDoc } from './projects.ts';

const doc = {
  name: 'Demo', captions: [{ id: 'c', words: [{ text: 'hola', start: 0, end: 1 }] }], segments: [{ start: 0, end: 3 }],
  style: {}, language: 'spanish',
  assets: [{ id: 'v1', name: 'a.webm', kind: 'video', duration: 3 }, { id: 'm1', name: 'm.wav', kind: 'audio', duration: 5 }],
  clips: [{ id: 'k', assetId: 'v1' }], audios: [{ id: 'x', assetId: 'm1', at: 0, volume: 1 }],
  words: { 'v1|spanish': [{ text: 'hola', start: 0, end: 1 }] },
} as unknown as ProjectDoc;
const files = new Map([
  ['v1', new File(['VIDEO-BYTES'], 'a.webm', { type: 'video/webm' })],
  ['m1', new File(['AUDIO!'], 'm.wav', { type: 'audio/wav' })],
]);

// round trip: doc and every file come back byte for byte
const packed = packProject(doc, files);
const back = await unpackProject(packed);
assert.deepEqual(back.doc, doc);
assert.equal(await back.files.get('v1')!.text(), 'VIDEO-BYTES');
assert.equal(back.files.get('m1')!.type, 'audio/wav');
assert.equal(back.files.get('m1')!.name, 'm.wav');

// damaged or foreign files are rejected
await assert.rejects(unpackProject(new Blob(['not a project at all'])), /err.badProject/);
await assert.rejects(unpackProject(packed.slice(0, packed.size - 3)), /err.badProject/); // truncated
await assert.rejects(unpackProject(new Blob([packed, 'extra'])), /err.badProject/); // trailing junk

// fresh ids are applied everywhere a media id appears
const r = reassignIds(doc, new Map([['v1', 'V2'], ['m1', 'M2']]));
assert.deepEqual(r.assets!.map((a) => a.id), ['V2', 'M2']);
assert.equal(r.clips![0].assetId, 'V2');
assert.equal(r.audios![0].assetId, 'M2');
assert.deepEqual(Object.keys(r.words!), ['V2|spanish']);
// overlays and background images are remapped too
const r2 = reassignIds({ ...doc, overlays: [{ id: 'o', kind: 'image', assetId: 'v1' }, { id: 't', kind: 'text' }], segments: [{ start: 0, end: 1, fx: { bg: 'image', bgImage: 'm1' } }] } as unknown as ProjectDoc, new Map([['v1', 'V2'], ['m1', 'M2']]));
assert.deepEqual(r2.overlays!.map((o) => o.assetId), ['V2', undefined]);
assert.equal(r2.segments![0].fx!.bgImage, 'M2');

// LUTs travel inside the file and are checked on the way back
const lut = { id: 'L', name: 'Teal', size: 2, data: Uint8Array.from({ length: 32 }, (_, i) => i * 7) };
const withLut = await unpackProject(packProject(doc, files, [lut]));
assert.deepEqual(withLut.luts, [lut]);
assert.deepEqual((await unpackProject(packed)).luts, []);
// a LUT whose data doesn't match its size is rejected
const badHead = JSON.stringify({ version: 1, doc, files: [], luts: [{ id: 'L', name: 'x', size: 2, data: btoa('short') }] });
const enc = new TextEncoder().encode(badHead), len = new Uint8Array(4);
new DataView(len.buffer).setUint32(0, enc.length, true);
await assert.rejects(unpackProject(new Blob(['SONANT1\n', len, enc])), /err.badProject/);
console.log('projects ok');
