// Downloaded AI models and tools, and removing them to free space. They download again on next use.
// - transformers.js keeps Whisper, Kokoro, WeSpeaker and the translation models in Cache Storage.
// - Piper keeps its voices in the origin-private file system (OPFS), folder "piper".
// - RNNoise and the ONNX runtime ship with the app; MediaPipe's model sits in the browser's HTTP cache,
//   which a page can't clear (it's small).
// Project data (media, proxies, cleaned audio) lives in IndexedDB and is never touched here.

export type ModelStore = { kind: 'cache' | 'opfs'; name: string; bytes: number; items: number };

async function cacheSize(name: string): Promise<{ bytes: number; items: number }> {
  const c = await caches.open(name), reqs = await c.keys();
  let bytes = 0;
  for (const r of reqs) {
    const res = await c.match(r);
    const len = Number(res?.headers.get('content-length'));
    bytes += Number.isFinite(len) && len > 0 ? len : (await res?.clone().blob())?.size ?? 0;
  }
  return { bytes, items: reqs.length };
}

async function dirSize(dir: FileSystemDirectoryHandle): Promise<{ bytes: number; items: number }> {
  let bytes = 0, items = 0;
  for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
    if (h.kind === 'file') ((bytes += (await (h as FileSystemFileHandle).getFile()).size), items++);
    else {
      const s = await dirSize(h as FileSystemDirectoryHandle);
      ((bytes += s.bytes), (items += s.items));
    }
  }
  return { bytes, items };
}

export async function listModels(): Promise<ModelStore[]> {
  const out: ModelStore[] = [];
  if (typeof caches !== 'undefined') for (const name of await caches.keys()) out.push({ kind: 'cache', name, ...(await cacheSize(name)) });
  try {
    const root = await navigator.storage.getDirectory();
    for await (const h of (root as unknown as { values(): AsyncIterable<FileSystemHandle> }).values())
      if (h.kind === 'directory') out.push({ kind: 'opfs', name: h.name, ...(await dirSize(h as FileSystemDirectoryHandle)) });
  } catch {} // no OPFS in this browser
  return out.filter((s) => s.items > 0);
}

export async function clearModels(): Promise<number> {
  const list = await listModels();
  for (const s of list) {
    if (s.kind === 'cache') await caches.delete(s.name);
    else await (await navigator.storage.getDirectory()).removeEntry(s.name, { recursive: true }).catch(() => {});
  }
  return list.reduce((n, s) => n + s.bytes, 0);
}

export const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`);
