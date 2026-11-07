// Run: node src/lib/reframe.test.ts
import assert from 'node:assert/strict';
import { coverPlace, median } from './reframe.ts';

// 1920×1080 into 1080×1920: scaled to 3413×1920, centred by default.
const [x, y, w, h] = coverPlace(1080, 1920, 1920, 1080);
assert.ok(Math.abs(w - 3413.33) < 0.01 && h === 1920 && y === 0);
assert.ok(Math.abs(x - (1080 - w) / 2) < 1e-9);
// Focus on the left third: picture slides right; clamped so no black edge shows.
assert.ok(Math.abs(coverPlace(1080, 1920, 1920, 1080, { x: 1 / 3, y: 0.5 })[0] - (540 - w / 3)) < 1e-9);
assert.equal(coverPlace(1080, 1920, 1920, 1080, { x: 0, y: 0.5 })[0], 0);
assert.ok(Math.abs(coverPlace(1080, 1920, 1920, 1080, { x: 1, y: 0.5 })[0] - (1080 - w)) < 1e-9);
// Same shape: nothing to move.
assert.deepEqual(coverPlace(1280, 720, 1920, 1080, { x: 0, y: 0 }), [0, 0, 1280, 720]);
assert.equal(median([0.9, 0.2, 0.3]), 0.3);
console.log('reframe ok');
