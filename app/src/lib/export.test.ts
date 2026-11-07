// Run: node src/lib/export.test.ts
import assert from 'node:assert/strict';
import { outputSize, frameTimes, frameCount } from './export.ts';

assert.deepEqual(outputSize(1920, 1080, 'source', 'source'), { width: 1920, height: 1080 });
assert.deepEqual(outputSize(1920, 1080, 720, 'source'), { width: 1280, height: 720 });
assert.deepEqual(outputSize(1920, 1080, 1080, '9:16'), { width: 1080, height: 1920 });
assert.deepEqual(outputSize(1080, 1920, 720, '1:1'), { width: 720, height: 720 });
assert.deepEqual(outputSize(641, 361, 'source', 'source'), { width: 642, height: 362 }); // encoders want even sizes

const segs = [{ start: 0, end: 1 }, { start: 3, end: 3.5 }];
const t = [...frameTimes(segs, 10)];
assert.equal(t.length, 15);
assert.equal(frameCount(segs, 10), 15);
assert.equal(t[10], 3); // second segment starts right after the first
assert.ok(t.every((x) => (x >= 0 && x < 1) || (x >= 3 && x < 3.5)));
console.log('export ok');
