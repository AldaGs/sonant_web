// Run: node src/lib/render.test.ts
import assert from 'node:assert/strict';
import { layout, wordState, migrateStyle, resolveStyle, EASINGS, fontString, DEFAULT_STYLE, inBox, type Animation, type Easing } from './render.ts';

// wrapping
assert.deepEqual(layout([40, 40, 40], 10, 100), [[0, 1], [2]]);
assert.deepEqual(layout([200], 10, 100), [[0]]); // too-wide word still gets its own line
assert.deepEqual(layout([], 10, 100), []);

const a = (animation: Animation, duration = 300, easing: Easing = 'ease-out') => ({ animation, duration, easing });
const w = { text: 'hola', start: 1, end: 1.5 };

// typewriter: hidden before spoken, then letter by letter
assert.equal(wordState(w, 0, 0.9, a('typewriter')).visible, false);
assert.equal(wordState(w, 0, 1.01, a('typewriter')).chars, 1);
assert.equal(wordState(w, 0, 1.2, a('typewriter', 300)).chars, 3); // 0.2/0.3 of 4 letters → 3
assert.equal(wordState(w, 0, 1.4, a('typewriter')).chars, 4);
// karaoke: highlight stays after spoken, active only during
assert.deepEqual([wordState(w, 0, 2, a('karaoke')).highlighted, wordState(w, 0, 2, a('karaoke')).active], [true, false]);
// pop: each word hidden until spoken, then grows to full size over `duration`
assert.equal(wordState(w, 0, 0.5, a('pop')).visible, false);
assert.ok(wordState(w, 0, 1.05, a('pop')).scale < 1);
assert.ok(Math.abs(wordState(w, 0, 1.4, a('pop')).scale - 1) < 1e-9);
// fade up: whole line fades and rises from caption start
const f0 = wordState(w, 1, 1, a('fade', 400, 'linear')), f1 = wordState(w, 1, 1.2, a('fade', 400, 'linear')), f2 = wordState(w, 1, 2, a('fade', 400, 'linear'));
assert.deepEqual([f0.alpha, f0.dy], [0, 0.5]);
assert.ok(Math.abs(f1.alpha - 0.5) < 1e-9 && Math.abs(f1.dy - 0.25) < 1e-9);
assert.deepEqual([f2.alpha, f2.dy], [1, 0]);
assert.equal(wordState(w, 1, 1.2, a('fade')).highlighted, false);
// bounce: lifts while active, rests after
assert.ok(wordState(w, 0, 1.1, a('bounce')).dy < 0);
assert.equal(wordState(w, 0, 1.6, a('bounce')).dy, 0);
// none: never highlighted
assert.equal(wordState(w, 0, 1.2, a('none')).highlighted, false);

// CapCut: elastic pop (hidden before spoken, overshoots > 1 during spring)
assert.equal(wordState(w, 0, 0.8, a('elastic')).visible, false);
assert.equal(wordState(w, 0, 1.0, a('elastic')).visible, true);
assert.ok(wordState(w, 0, 1.12, a('elastic', 300, 'spring')).scale > 1.0);

// CapCut: slide-up
assert.equal(wordState(w, 0, 0.8, a('slide-up')).visible, false);
assert.ok(wordState(w, 0, 1.05, a('slide-up')).dy > 0);
assert.equal(wordState(w, 0, 1.4, a('slide-up')).dy, 0);

// CapCut: wave
assert.ok(wordState(w, 0, 1.2, a('wave')).dy < 0);
assert.equal(wordState(w, 0, 1.6, a('wave')).dy, 0);

// CapCut: pill (active word sets pill=true)
assert.equal(wordState(w, 0, 1.2, a('pill')).pill, true);
assert.equal(wordState(w, 0, 1.6, a('pill')).pill, false);

// CapCut: neon (active word sets glowBlur > 0)
assert.ok(wordState(w, 0, 1.2, a('neon')).glowBlur > 0);
assert.equal(wordState(w, 0, 1.6, a('neon')).glowBlur, 0);

// easings start at 0 and end at 1; back & spring overshoot
for (const e of Object.values(EASINGS)) assert.ok(Math.abs(e(0)) < 1e-9 && Math.abs(e(1) - 1) < 1e-9);
assert.ok(EASINGS.back(0.7) > 1);
assert.ok(EASINGS.spring(0.4) > 1.1);

// resolveStyle: merges caption override cleanly
const baseStyle = DEFAULT_STYLE;
const customStyle = resolveStyle(baseStyle, { color: '#ff0000', animation: 'glitch' });
assert.equal(customStyle.color, '#ff0000');
assert.equal(customStyle.animation, 'glitch');
assert.equal(customStyle.family, baseStyle.family);
assert.equal(resolveStyle(baseStyle, undefined), baseStyle);

// old saved styles get new fields
const old = migrateStyle({ family: 'Anton', weight: 400, animation: 'bounce' });
assert.equal(old.family, 'Anton');
assert.equal(old.duration, 320);
assert.equal(old.box, '');
assert.equal(fontString({ italic: true, weight: 400, family: 'DM Serif Display' }, 40), 'italic 400 40px "DM Serif Display"');
// drag-box hit test, with extra margin for touch
const bx = { x: 100, y: 100, w: 50, h: 20 };
assert.ok(inBox(bx, 120, 110));
assert.ok(!inBox(bx, 90, 110));
assert.ok(inBox(bx, 90, 110, 15));
assert.ok(!inBox(null, 120, 110));
console.log('render ok');
