// Run: node src/lib/keywords.test.ts
import assert from 'node:assert/strict';
import { wordScore, pickEmphasis, autoEmphasis, clearEmphasis, hasEmphasis } from './keywords.ts';

const ws = (s: string) => s.split(' ').map((text, i) => ({ text, start: i, end: i + 0.5 }));

// stop words and fillers never score
assert.equal(wordScore({ text: 'the', start: 0, end: 1 }), 0);
assert.equal(wordScore({ text: 'um', start: 0, end: 1 }), 0);
assert.equal(wordScore({ text: 'pero', start: 0, end: 1 }), 0);
// numbers beat ordinary words
assert.ok(wordScore({ text: '$500', start: 0, end: 1 }) > wordScore({ text: 'money', start: 0, end: 1 }));

assert.deepEqual(pickEmphasis(ws('I made 500 dollars today')), [2]);
assert.deepEqual(pickEmphasis(ws('we went to Paris last week')), [3]); // proper noun mid-sentence
assert.deepEqual(pickEmphasis(ws('this is INCREDIBLE you know')), [2]);
assert.deepEqual(pickEmphasis(ws('esto es increíble')), [2]);
assert.deepEqual(pickEmphasis(ws('the and of')), []); // nothing worth it
assert.deepEqual(pickEmphasis(ws('I made 500 dollars in Paris'), { perCaption: 2 }), [2, 5]); // kept in reading order

const caps = [{ id: 'a', words: ws('I made 500 dollars') }, { id: 'b', words: ws('so um yeah') }];
const out = autoEmphasis(caps);
assert.deepEqual(out[0].words.map((w) => !!w.em), [false, false, true, false]);
assert.ok(out[1].words.every((w) => !w.em));
assert.ok(hasEmphasis(out) && !hasEmphasis(caps)); // input not mutated
const cleared = clearEmphasis(out);
assert.ok(!hasEmphasis(cleared) && !('em' in cleared[0].words[2]));

console.log('keywords ok');
