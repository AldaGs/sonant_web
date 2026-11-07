// Run: node src/lib/grade.test.ts
import assert from 'node:assert/strict';
import { parseCube, isNeutral } from './grade.ts';

// A 2³ identity LUT with an inverted red channel.
const rows: string[] = [];
for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${1 - r} ${g} ${b}`);
const lut = parseCube(`# test\nTITLE "x"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n${rows.join('\n')}\n`, 'inv');
assert.equal(lut.size, 2);
assert.deepEqual([...lut.data.subarray(0, 8)], [255, 0, 0, 255, 0, 0, 0, 255]); // r=0 → 1, r=1 → 0
assert.throws(() => parseCube('LUT_3D_SIZE 4\n0 0 0\n', 'short'));
assert.ok(isNeutral(undefined) && isNeutral({ b: 0 }) && !isNeutral({ s: -1 }));
console.log('grade ok');
