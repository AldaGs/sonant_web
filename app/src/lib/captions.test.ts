// Run: node src/lib/captions.test.ts
import assert from 'node:assert/strict';
import { groupWords, captionText, setText, setRange, split, mergeNext, toSRT, toVTT, startOf, endOf, setSpeaker, replaceInRange, type Word } from './captions.ts';

const w = (text: string, start: number, end = start + 0.3): Word => ({ text, start, end });

// max 6 words per caption
let c = groupWords([0, 1, 2, 3, 4, 5, 6, 7].map((i) => w('a', i * 0.3)));
assert.deepEqual(c.map((x) => x.words.length), [6, 2]);

// sentence end splits
c = groupWords([w('Hola.', 0), w('¿Qué', 0.4), w('tal?', 0.8)]);
assert.deepEqual(c.map(captionText), ['Hola.', '¿Qué tal?']);

// long silence splits
c = groupWords([w('one', 0), w('two', 2)]);
assert.equal(c.length, 2);

// duration cap
c = groupWords([w('a', 0), w('b', 1), w('c', 2, 2.6)]);
assert.deepEqual(c.map((x) => x.words.length), [2, 1]);

assert.deepEqual(groupWords([]), []);

// editing
const cap = { id: 'x', words: [w('helo', 0, 1), w('wrld', 1, 2)] };
assert.deepEqual(setText(cap, 'hello world').words.map((x) => [x.text, x.start]), [['hello', 0], ['world', 1]]);
const re = setText(cap, 'a b c d');
assert.deepEqual([re.words.length, startOf(re), endOf(re)], [4, 0, 2]);
assert.equal(setText(cap, '   '), cap);
const r = setRange(cap, 10, 12);
assert.deepEqual([startOf(r), r.words[1].start, endOf(r)], [10, 11, 12]);
assert.equal(setRange(cap, 5, 4), cap);

const two = split([cap], 0);
assert.deepEqual(two.map(captionText), ['helo', 'wrld']);
assert.deepEqual(mergeNext(two, 0).map(captionText), ['helo wrld']);
assert.equal(mergeNext(two, 1), two);

// subtitle files
assert.equal(toSRT([{ id: 'a', words: [w('Hola', 61.5, 3723.042)] }]), '1\n00:01:01,500 --> 01:02:03,042\nHola\n');
assert.ok(toVTT(two).startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhelo\n'));
// speakers survive split, and can be set per caption
const sp = split([{ id: 's', words: [w('a', 0), w('b', 1)], speaker: 1 }], 0);
assert.deepEqual(sp.map((c) => c.speaker), [1, 1]);
assert.notEqual(sp[0].id, sp[1].id);
const tagged = setSpeaker(sp, new Set([sp[1].id]), 0);
assert.deepEqual(tagged.map((c) => c.speaker), [1, 0]);
assert.equal(setSpeaker(tagged, new Set([sp[0].id]), undefined)[0].speaker, undefined);
// re-transcribing one clip only replaces captions inside its range
const all = [{ id: 'k1', words: [w('keep', 1)], speaker: 0 }, { id: 'old', words: [w('old', 11)] }, { id: 'k2', words: [w('also', 21)] }];
const out = replaceInRange(all, [{ id: 'n', words: [w('new', 12)] }], 10, 20);
assert.deepEqual(out.map(captionText), ['keep', 'new', 'also']);
assert.equal(out[0], all[0]); // untouched captions are the same objects (speaker, style kept)
// a caption straddling the edge keeps only its words outside the range
assert.deepEqual(replaceInRange([{ id: 's', words: [w('a', 9.5), w('b', 10.5)] }], [], 10, 20).map(captionText), ['a']);
console.log('captions ok');
