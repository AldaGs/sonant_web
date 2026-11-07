// Run: node src/lib/highlights.test.ts
import assert from 'node:assert/strict';
import { sentences, scoreSentence, findHighlights, clipSegments, shortOf } from './highlights.ts';
import type { Word } from './captions.ts';

// Words from a script: one word every 0.4s, sentences as written.
function script(text: string, t0 = 0): Word[] {
  return text.split(' ').map((w, i) => ({ text: w, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.3 }));
}

// sentences: split at punctuation and long pauses, fillers dropped
const s = sentences([...script('Hello there. um How are you?'), { text: 'Fine', start: 5, end: 5.3 }]);
assert.deepEqual(s.map((x) => x.text), ['Hello there.', 'How are you?', 'Fine']);

// hooks and questions beat plain lines
const plain = scoreSentence(sentences(script('We went to the shop and bought some bread.'))[0], 2.5);
const hook = scoreSentence(sentences(script('Why does nobody tell you this secret?'))[0], 2.5);
const es = scoreSentence(sentences(script('¿Por qué nadie te dice este secreto?'))[0], 2.5);
assert.ok(hook.hook > plain.hook && hook.score > plain.score);
assert.ok(es.hook >= 4);

// highlights: a 100-word filler talk with one strong passage in the middle
const boring = 'Then we walked along the road for a while and talked about the weather today.';
const strong = 'Why does nobody talk about this? The secret is simple. You need 3 things! First, stop doing it wrong.';
let text = '';
for (let i = 0; i < 12; i++) text += (i === 6 ? strong : boring) + ' ';
const words = script(text.trim());
const caps = [{ id: 'c', words }];
const hl = findHighlights(caps, { min: 15, max: 30, count: 3 });
assert.ok(hl.length >= 1 && hl.length <= 3);
const strongStart = words.find((w, i) => w.text === 'Why' && words[i + 1].text === 'does')!.start;
assert.equal(hl[0].start, strongStart); // the best clip opens on the hook
assert.ok(hl[0].reasons.includes('hook') && hl[0].reasons.includes('question'));
for (const h of hl) assert.ok(h.end - h.start >= 15 && h.end - h.start <= 30);
for (let i = 0; i < hl.length; i++) for (let j = i + 1; j < hl.length; j++) assert.ok(hl[i].end <= hl[j].start || hl[j].end <= hl[i].start);
assert.deepEqual(findHighlights([{ id: 'x', words: script('Too short.') }]), []);

// clipping a project to [a, b)
const segs = [{ start: 0, end: 10 }, { start: 12, end: 20, fx: { speed: 2 } }];
assert.deepEqual(clipSegments(segs, 5, 15), [{ start: 5, end: 10 }, { start: 12, end: 15, fx: { speed: 2 } }]);
// output time: [5,10) → out 5..10, [12,15) at 2× → out 10..11.5; short covers out 5..11.5
const music = { id: 'm', assetId: 'a', at: 2, volume: 1 }; // plays 2..32 (30s file)
const late = { id: 'l', assetId: 'a', at: 40, volume: 1 };
const title = { id: 't', kind: 'text' as const, at: 9, len: 5, text: 'Hi', tf: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 } };
const capsIn = [{ id: 'a', words: [{ text: 'x', start: 1, end: 2 }] }, { id: 'b', words: [{ text: 'y', start: 4, end: 4.8 }, { text: 'z', start: 6, end: 7 }] }];
const r = shortOf({ segments: segs, overlays: [title], audios: [music, late], captions: capsIn }, 5, 15, () => 30);
assert.deepEqual(r.captions.map((c) => [c.id, c.words.map((w) => w.text)]), [['b', ['z']]]);
assert.deepEqual(r.audios, [{ ...music, at: 0, offset: 3, len: 6.5 }]);
assert.equal(r.overlays.length, 1);
assert.equal(r.overlays[0].at, 4);
assert.ok(Math.abs(r.overlays[0].len - 2.5) < 1e-9);
assert.equal(r.overlays[0].offset, undefined);
console.log('highlights ok');
