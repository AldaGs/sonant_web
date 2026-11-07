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
console.log('projects ok');
