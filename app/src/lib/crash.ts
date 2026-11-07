// Crash and error reports. A tab crash (out of memory: Chrome's "Aw, Snap!") can't be caught by the page,
// so heavy work leaves a note first ("busy") and removes it when it ends. A note still there on the next
// load means the tab died during that work; the app then says what happened and what to try.
// Script errors are kept too (last 10), so a report can say what went wrong.

export type Busy = { op: string; info?: Record<string, unknown>; at: number; project?: string };
export type Crash = Busy & { found: number };
export type LoggedError = { at: number; where: string; message: string; stack?: string };

const BUSY = 'sonant.busy', CRASH = 'sonant.lastCrash', ERRORS = 'sonant.errors';
const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);
const read = <T>(k: string): T | null => { try { const v = ls()?.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { v === null ? ls()?.removeItem(k) : ls()?.setItem(k, JSON.stringify(v)); } catch {} };

// Mark heavy work as started / finished. Nested work keeps the outermost note.
let depth = 0;
export function begin(op: string, info?: Record<string, unknown>, project?: string) {
  if (depth++ === 0) write(BUSY, { op, info, at: Date.now(), project } satisfies Busy);
}
export function end() {
  if (depth > 0 && --depth === 0) write(BUSY, null);
}
// Run `fn` with a note around it.
export async function guard<T>(op: string, info: Record<string, unknown> | undefined, fn: () => Promise<T>, project?: string): Promise<T> {
  begin(op, info, project);
  try {
    return await fn();
  } catch (e) {
    logError(e, op);
    throw e;
  } finally {
    end();
  }
}

// Call once at startup: a note left over from last time becomes the "last crash".
export function checkLastRun(): Crash | null {
  depth = 0; // a fresh page: nothing is running yet
  const b = read<Busy>(BUSY);
  if (b) (write(CRASH, { ...b, found: Date.now() } satisfies Crash), write(BUSY, null));
  return read<Crash>(CRASH);
}
export const lastCrash = () => read<Crash>(CRASH);
export const dismissCrash = () => write(CRASH, null);

export function logError(e: unknown, where: string) {
  const err = e as { message?: string; stack?: string; name?: string };
  if (err?.name === 'AbortError') return; // cancelled on purpose
  const list = read<LoggedError[]>(ERRORS) ?? [];
  list.push({ at: Date.now(), where, message: String(err?.message ?? e).slice(0, 500), stack: err?.stack?.slice(0, 1500) });
  write(ERRORS, list.slice(-10));
}
export const errors = () => read<LoggedError[]>(ERRORS) ?? [];
export const clearErrors = () => write(ERRORS, null);

export function installHandlers() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => logError(e.error ?? e.message, 'page'));
  window.addEventListener('unhandledrejection', (e) => logError(e.reason, 'promise'));
}

// What probably happened and what to try, as i18n keys.
export function advice(op: string): string[] {
  const mem = ['crash.mem'];
  if (op === 'export') return [...mem, 'crash.tryLower', 'crash.tryDraft', 'crash.tryClose'];
  if (op === 'open') return [...mem, 'crash.openSafe', 'crash.tryClose'];
  if (op === 'reverse' || op === 'stabilize' || op === 'proxy') return [...mem, 'crash.tryShorter', 'crash.tryClose'];
  return [...mem, 'crash.tryClose'];
}

// A plain-text report to copy into an issue or a message.
export function report(c: Crash | null, extra: Record<string, unknown> = {}): string {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { deviceMemory?: number });
  const lines = [
    'Sonant report',
    `When: ${new Date().toISOString()}`,
    `Browser: ${nav?.userAgent ?? '?'}`,
    `Device memory: ${nav?.deviceMemory ?? '?'} GB · CPU threads: ${nav?.hardwareConcurrency ?? '?'}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
  ];
  if (c) lines.push('', `Crash during: ${c.op} (started ${new Date(c.at).toISOString()})`, `Details: ${JSON.stringify(c.info ?? {})}`);
  const es = errors();
  if (es.length) lines.push('', 'Recent errors:', ...es.map((e) => `- ${new Date(e.at).toISOString()} [${e.where}] ${e.message}${e.stack ? '\n  ' + e.stack.split('\n').slice(0, 4).join('\n  ') : ''}`));
  return lines.join('\n');
}
