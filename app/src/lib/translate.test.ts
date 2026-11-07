// Run: node src/lib/translate.test.ts
import assert from 'node:assert/strict';
import { spreadWords } from './translate.ts';

const w = (text: string, start: number, end: number) => ({ text, start, end });
// Two words of 1s with a cut gap between them; four translated words share the 2s of speech.
const r = spreadWords('uno dos tres cuatro', [w('one', 0, 1), w('two', 5, 6)]);
assert.deepEqual(r.map((x) => [x.text, x.start, x.end]), [['uno', 0, 0.5], ['dos', 0.5, 1], ['tres', 5, 5.5], ['cuatro', 5.5, 6]]);
// Nothing falls in the gap (1..5).
assert.ok(r.every((x) => x.end <= 1 + 1e-9 || x.start >= 5 - 1e-9));
// Fewer translated words than originals.
assert.deepEqual(spreadWords('hola', [w('hi', 0, 1), w('there', 1, 2)]).map((x) => [x.start, x.end]), [[0, 2]]); // one word covers both
assert.deepEqual(spreadWords('', [w('a', 0, 1)]), []);
// The new words cover the whole spoken span (no early end).
const three = spreadWords('Hola amigos', [w('Hello', 0.5, 0.9), w('um', 1.0, 1.3), w('friends', 1.4, 2.0)]);
assert.equal(three.at(-1)!.end, 2);
// A word straddling a long gap keeps its midpoint inside the word it starts in.
const st = spreadWords('a b c', [w('x', 0, 1), w('y', 10, 11)]);
assert.ok(st.every((x) => [[0, 1], [10, 11]].some(([s, e]) => (x.start + x.end) / 2 >= s && (x.start + x.end) / 2 < e)), JSON.stringify(st));
// emphasis carries over to the translation (same number of words, the key ones)
import { translated as tr2 } from './translate.ts';
const emCap = { id: 'e', tr: 'Gané 500 dólares hoy', words: [{ text: 'I', start: 0, end: 0.3 }, { text: 'made', start: 0.3, end: 0.6 }, { text: '500', start: 0.6, end: 1, em: true }, { text: 'dollars', start: 1, end: 1.4 }] };
const te = tr2([emCap])[0].words;
assert.deepEqual(te.filter((w) => w.em).map((w) => w.text), ['500']);
assert.ok(!tr2([{ ...emCap, words: emCap.words.map(({ em: _, ...w }) => w) }])[0].words.some((w) => w.em));
console.log('translate ok');
