// Run: node src/lib/tools.test.ts
import assert from 'node:assert/strict';
import { rippleTrim, rippleDelete, rollEdit, slip, neighbour, type Span } from './tools.ts';

const sp = (id: string, at: number, len: number, offset?: number, max = Infinity, track = 0): Span => ({ id, at, len, offset, max, track });
const A = sp('a', 0, 4, 1, 10), B = sp('b', 4, 3, 0, 5), C = sp('c', 9, 2), X = sp('x', 5, 2, undefined, Infinity, 1);
const all = [A, B, C, X];
const obj = (m: Map<string, unknown> | null) => (m ? Object.fromEntries(m) : null);

// Ripple end +1: a grows, b and c move right, x (other track) stays.
assert.deepEqual(obj(rippleTrim(all, 'a', 'end', 1)), { a: { len: 5 }, b: { at: 5 }, c: { at: 10 } });
// Clamped by the file: a plays 1..5 of 10, can grow by at most 5.
assert.deepEqual(obj(rippleTrim(all, 'a', 'end', 9))!.a, { len: 9 });
// Ripple start +1: a keeps its place, head trimmed, followers move back.
assert.deepEqual(obj(rippleTrim(all, 'a', 'start', 1)), { a: { len: 3, offset: 2 }, b: { at: 3 }, c: { at: 8 } });
// Start can bring back at most the offset.
assert.deepEqual(obj(rippleTrim(all, 'a', 'start', -3))!.a, { len: 5, offset: 0 });
assert.deepEqual(obj(rippleDelete(all, 'b')), { c: { at: 6 } });

assert.equal(neighbour(all, 'a', 'end')!.id, 'b');
assert.equal(neighbour(all, 'b', 'end'), null);
// Roll the a|b cut right by 1: a longer, b starts later, its offset moves.
assert.deepEqual(obj(rollEdit(all, 'a', 'end', 1)), { a: { len: 5 }, b: { at: 5, len: 2, offset: 1 } });
// Same cut from b's start side.
assert.deepEqual(obj(rollEdit(all, 'b', 'start', 1)), obj(rollEdit(all, 'a', 'end', 1)));
// Rolling left needs b's offset room: b starts at file 0, so it can't.
assert.deepEqual(obj(rollEdit(all, 'a', 'end', -1)), { a: { len: 4 }, b: { at: 4, len: 3, offset: 0 } });
assert.equal(rollEdit(all, 'b', 'end', 1), null);

assert.deepEqual(slip(A, 2), { offset: 3 });
assert.deepEqual(slip(A, 20), { offset: 6 }); // file 10, len 4
assert.deepEqual(slip(A, -5), { offset: 0 });
assert.equal(slip(C, 1), null);
console.log('tools ok');
