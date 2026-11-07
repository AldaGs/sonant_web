// Run: node src/lib/crash.test.ts
import assert from 'node:assert/strict';
// A tiny localStorage for Node.
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const C = await import('./crash.ts');

// finished work leaves nothing behind
await C.guard('export', { res: 1080 }, async () => 1);
assert.equal(C.checkLastRun(), null);

// a note left over (the tab died during export) becomes the last crash, once
C.begin('export', { res: 2160, fps: 60 }, 'p1');
const c = C.checkLastRun();
assert.equal(c?.op, 'export');
assert.deepEqual(c?.info, { res: 2160, fps: 60 });
assert.equal(c?.project, 'p1');
assert.equal(C.checkLastRun()?.op, 'export'); // still shown until dismissed
C.dismissCrash();
assert.equal(C.checkLastRun(), null);

// nested work keeps the outer note; errors are logged (not aborts), capped at 10
C.begin('export'); C.begin('reverse'); C.end();
assert.equal(C.checkLastRun()?.op, 'export');
C.dismissCrash();
await assert.rejects(C.guard('stabilize', undefined, async () => { throw new Error('boom'); }));
assert.equal(C.errors().at(-1)?.message, 'boom');
C.logError(new DOMException('x', 'AbortError'), 'export');
assert.equal(C.errors().length, 1);
for (let i = 0; i < 15; i++) C.logError(new Error('e' + i), 'page');
assert.equal(C.errors().length, 10);

// advice and report
assert.ok(C.advice('export').includes('crash.tryLower'));
const r = C.report({ op: 'export', info: { res: 2160 }, at: 0, found: 1 }, { Project: 'Demo' });
assert.ok(r.includes('Crash during: export') && r.includes('"res":2160') && r.includes('Project: Demo') && r.includes('e14'));
console.log('crash ok');
