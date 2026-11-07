// Run: node src/lib/templates.test.ts
import assert from 'node:assert/strict';
import { BUILTIN, placeLayers, fromProject } from './templates.ts';
import { DEFAULT_TF, type Overlay } from './overlay.ts';

const cta = BUILTIN.find((t) => t.id === 'b-cta')!;
const [l] = placeLayers(cta, 3, 20);
assert.equal(l.at, 17.5); // sticks to the end
assert.equal(l.kind, 'text');
const [h] = placeLayers(BUILTIN[0], 3, 20);
assert.equal(h.at, 3); // at the playhead
assert.notEqual(h.id, placeLayers(BUILTIN[0], 3, 20)[0].id);

const o = (at: number, text: string): Overlay => ({ id: text, kind: 'text', at, len: 2, text, tf: DEFAULT_TF });
const t = fromProject('Mine', BUILTIN[0].style, [o(5, 'a'), o(6, 'b'), o(18.5, 'c'), { ...o(1, 'img'), kind: 'image' }], 20);
assert.deepEqual(t.layers.map((x) => [x.text, x.at]), [['a', 0], ['b', 1], ['c', -1.5]]);
const back = placeLayers(t, 2, 30);
assert.deepEqual(back.map((x) => x.at), [2, 3, 28.5]);
// progress bar: whole video, from 0, whatever the playhead; stickers keep the caption look
import { barProgress } from './overlay.ts';
const pb = BUILTIN.find((x) => x.id === 'b-progress')!;
const [bar] = placeLayers(pb, 7, 20);
assert.deepEqual([bar.at, bar.len, !!bar.bar], [0, 20, true]);
assert.equal(barProgress(bar, 0), 0);
assert.equal(barProgress(bar, 10), 0.5);
assert.equal(barProgress(bar, 25), 1);
assert.ok(pb.keepStyle && BUILTIN.filter((x) => x.id.startsWith('b-') && x.name.startsWith('Sticker')).every((x) => x.keepStyle));
console.log('templates ok');
