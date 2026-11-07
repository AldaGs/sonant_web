// Run: node src/lib/tts.test.ts
import assert from 'node:assert/strict';
import { VOICES, voiceById, defaultVoice, chunks, joinAudio } from './tts.ts';

// catalogue: unique ids, both languages, every voice has one engine; Kokoro is English only
assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length);
assert.ok(VOICES.some((v) => v.lang === 'es') && VOICES.some((v) => v.lang === 'en'));
assert.ok(VOICES.filter((v) => v.engine === 'kokoro').every((v) => v.lang === 'en'));
assert.ok(VOICES.filter((v) => v.lang === 'es').every((v) => v.engine === 'piper'));
assert.equal(voiceById('nope'), undefined);
// defaults: Spanish → Piper; English → Kokoro with a fast GPU, Piper without
assert.equal(defaultVoice('es', true).engine, 'piper');
assert.equal(defaultVoice('en', true).engine, 'kokoro');
assert.equal(defaultVoice('en', false).engine, 'piper');

// chunks: sentences grouped up to max, long sentences broken at spaces, nothing lost
assert.deepEqual(chunks('Hola. ¿Qué tal?  Bien!'), ['Hola. ¿Qué tal? Bien!']);
assert.deepEqual(chunks('One two. Three four. Five.', 12), ['One two.', 'Three four.', 'Five.']);
const long = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ');
const c = chunks(long, 50);
assert.ok(c.every((x) => x.length <= 50));
assert.equal(c.join(' '), long);
assert.deepEqual(chunks('   '), []);

// joinAudio: parts with gaps between them (none at the ends)
const j = joinAudio([new Float32Array([1, 1]), new Float32Array([2])], 10, 0.2);
assert.deepEqual([...j], [1, 1, 0, 0, 2]);
console.log('tts ok');
