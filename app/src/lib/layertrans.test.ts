// Run: node src/lib/layertrans.test.ts
import assert from 'node:assert/strict';
import { applyTrans, transU, envelopeAt, setVolKey } from './layertrans.ts';

const o = { at: 2, len: 4, trIn: { kind: 'fade' as const, d: 1 }, trOut: { kind: 'wipe' as const, d: 1 } };
const tf = { x: 0.5, y: 0.5, scale: 1, opacity: 1 };
assert.deepEqual(transU(o, 2), { inU: 0, outU: 1 });
assert.equal(transU(o, 4).inU, 1);
assert.equal(applyTrans(o, 2, tf).tf.opacity, 0);
assert.equal(applyTrans(o, 4, tf).tf.opacity, 1);
assert.equal(applyTrans(o, 4, tf).clip, undefined);
assert.deepEqual(applyTrans(o, 6, tf).clip, [1, 1]); // fully wiped away at the end
const s = { at: 0, len: 4, trIn: { kind: 'slide-left' as const, d: 1 } };
assert.ok(applyTrans(s, 0, tf).tf.x < -0.5); // off the left edge
assert.equal(applyTrans(s, 1, tf).tf.x, 0.5);

const env = { volKf: [{ t: 1, v: 1 }, { t: 3, v: 0 }], fadeIn: 0.5 };
assert.equal(envelopeAt(env, 0, 4), 0);
assert.equal(envelopeAt(env, 0.5, 4), 1);
assert.equal(envelopeAt(env, 2, 4), 0.5);
assert.equal(envelopeAt(env, 3.5, 4), 0);
assert.equal(envelopeAt({ fadeOut: 2 }, 3, 4), 0.5);
assert.deepEqual(setVolKey([{ t: 1, v: 1 }], 1.02, 0.3), [{ t: 1.02, v: 0.3 }]);
assert.deepEqual(setVolKey([{ t: 2, v: 1 }], 1, 9).map((k) => k.v), [1.5, 1]);
console.log('layertrans ok');
