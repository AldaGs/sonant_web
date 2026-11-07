// Projects: each one is a doc in IndexedDB (`doc:<id>`) plus media files (`asset:<assetId>`),
// listed in `projects`. A project can also be packed into a single `.sonant` file and opened anywhere.
import * as store from './store.ts';
import type { Caption, Word } from './captions';
import type { Segment } from './cuts';
import type { Style } from './render';
import type { Asset, AudioItem, Clip } from './project';

export type ProjectDoc = {
  name: string; captions: Caption[]; segments: Segment[]; style: Style; language: 'english' | 'spanish' | null;
  speakers?: string[]; assets?: Asset[]; clips?: Clip[]; audios?: AudioItem[]; clipVolume?: number; words?: Record<string, Word[]>;
};
export type ProjectMeta = { id: string; name: string; created: number; updated: number; duration: number; clips: number; thumb?: string };

const LIST = 'projects';
export const listProjects = async () =>
  ((await store.get<ProjectMeta[]>(LIST)) ?? []).sort((a, b) => b.updated - a.updated);
const putList = (l: ProjectMeta[]) => store.set(LIST, l);

export const loadDoc = (id: string) => store.get<ProjectDoc>('doc:' + id);

// Save a project's doc and refresh its card on the home page.
export async function saveDoc(id: string, doc: ProjectDoc, meta: Partial<ProjectMeta> = {}) {
  await store.set('doc:' + id, doc);
  const list = await listProjects();
  const i = list.findIndex((p) => p.id === id);
  const base = i >= 0 ? list[i] : { id, created: Date.now(), duration: 0, clips: 0, name: '' };
  const next = { ...base, ...meta, name: doc.name, updated: Date.now() };
  await putList(i >= 0 ? list.with(i, next) : [...list, next]);
}

export async function createProject(name = ''): Promise<ProjectMeta> {
  const meta: ProjectMeta = { id: crypto.randomUUID(), name, created: Date.now(), updated: Date.now(), duration: 0, clips: 0 };
  await store.set('doc:' + meta.id, { name, captions: [], segments: [], language: null } as unknown as ProjectDoc);
  await putList([...(await listProjects()), meta]);
  return meta;
}

export async function renameProject(id: string, name: string) {
  const doc = await loadDoc(id);
  if (doc) await saveDoc(id, { ...doc, name });
}

// Duplicates share media files with the original (files are only deleted when no project uses them).
export async function duplicateProject(id: string, suffix: string): Promise<ProjectMeta | null> {
  const doc = await loadDoc(id);
  const meta = (await listProjects()).find((p) => p.id === id);
  if (!doc || !meta) return null;
  const copy: ProjectMeta = { ...meta, id: crypto.randomUUID(), name: `${doc.name || meta.name} ${suffix}`.trim(), created: Date.now(), updated: Date.now() };
  await store.set('doc:' + copy.id, { ...doc, name: copy.name });
  await putList([...(await listProjects()), copy]);
  return copy;
}

// Media ids used by any project except `skip`.
async function assetsInUse(skip?: string): Promise<Set<string>> {
  const used = new Set<string>();
  for (const p of await listProjects()) {
    if (p.id === skip) continue;
    for (const a of (await loadDoc(p.id))?.assets ?? []) used.add(a.id);
  }
  return used;
}

// Remove a media file from storage unless another project (e.g. a duplicate) still uses it.
export async function deleteAssetIfUnused(assetId: string, projectId: string) {
  if (!(await assetsInUse(projectId)).has(assetId)) await store.del('asset:' + assetId);
}

export async function deleteProject(id: string) {
  const doc = await loadDoc(id);
  const keep = await assetsInUse(id);
  await Promise.all((doc?.assets ?? []).filter((a) => !keep.has(a.id)).map((a) => store.del('asset:' + a.id)));
  await store.del('doc:' + id);
  await putList((await listProjects()).filter((p) => p.id !== id));
}

// ---- One-time upgrade from the single-project storage ('doc' / 'video' keys) ----
export async function migrateLegacy(probe: (f: File) => Promise<Omit<Asset, 'id' | 'name'>>): Promise<void> {
  if (await store.get(LIST)) return;
  const [doc, video, keys] = await Promise.all([store.get<ProjectDoc>('doc'), store.get<File>('video'), store.keys()]);
  const listed = new Set((doc?.assets ?? []).map((a) => a.id));
  const assets: Asset[] = [...(doc?.assets ?? [])];
  const clips: Clip[] = [...(doc?.clips ?? [])];
  // Media stored without being listed (very old projects, or an outdated tab that overwrote the doc) becomes clips.
  const extra: File[] = [];
  if (video) extra.push(video);
  for (const k of keys.map(String)) if (k.startsWith('asset:') && !listed.has(k.slice(6))) {
    const f = await store.get<File>(k);
    if (f) (await store.del(k), extra.push(f));
  }
  for (const f of extra) {
    if (assets.some((a) => a.name === f.name)) continue; // duplicate copies of the same file
    try {
      const asset: Asset = { id: crypto.randomUUID(), name: f.name, ...(await probe(f)) };
      await store.set('asset:' + asset.id, f);
      assets.push(asset);
      if (asset.kind === 'video') clips.push({ id: crypto.randomUUID(), assetId: asset.id });
    } catch {}
  }
  if (!doc && !assets.length) return void (await putList([]));
  const dur = assets.reduce((n, a) => n + (clips.some((c) => c.assetId === a.id) ? a.duration : 0), 0);
  const merged = { ...(doc ?? { name: '', captions: [], language: null }), assets, clips } as ProjectDoc;
  if (!merged.segments?.length) merged.segments = [{ start: 0, end: dur }];
  const meta = await createProject(merged.name);
  await saveDoc(meta.id, merged, { duration: dur, clips: clips.length });
  await Promise.all([store.del('doc'), store.del('video')]);
}

// ---- .sonant project files ----
// Layout: "SONANT1\n" (8 bytes) · header length (uint32 LE) · header JSON · media bytes back to back.
// The header holds the doc and the list of media files (id, name, type, size) in the order they follow.
const MAGIC = 'SONANT1\n';
type Header = { version: 1; doc: ProjectDoc; files: { id: string; name: string; type: string; size: number }[] };

export function packProject(doc: ProjectDoc, files: Map<string, Blob & { name?: string }>): Blob {
  const list = (doc.assets ?? []).filter((a) => files.has(a.id)).map((a) => {
    const f = files.get(a.id)!;
    return { id: a.id, name: f.name ?? a.name, type: f.type, size: f.size };
  });
  const head = new TextEncoder().encode(JSON.stringify({ version: 1, doc, files: list } satisfies Header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length, true);
  return new Blob([MAGIC, len, head, ...list.map((f) => files.get(f.id)!)], { type: 'application/octet-stream' });
}

// Read a .sonant file. Everything in it is untrusted: shapes and sizes are checked before use.
export async function unpackProject(file: Blob): Promise<{ doc: ProjectDoc; files: Map<string, File> }> {
  const bad = () => new Error('err.badProject');
  if (file.size < 12 || (await file.slice(0, 8).text()) !== MAGIC) throw bad();
  const n = new DataView(await file.slice(8, 12).arrayBuffer()).getUint32(0, true);
  if (n > 64 * 1024 * 1024 || 12 + n > file.size) throw bad();
  let h: Header;
  try {
    h = JSON.parse(await file.slice(12, 12 + n).text());
  } catch {
    throw bad();
  }
  if (h?.version !== 1 || typeof h.doc !== 'object' || !Array.isArray(h.files) || !Array.isArray(h.doc.captions ?? [])) throw bad();
  const total = h.files.reduce((s, f) => s + (Number.isSafeInteger(f?.size) && f.size >= 0 ? f.size : NaN), 0);
  if (!(12 + n + total === file.size)) throw bad();
  const files = new Map<string, File>();
  let at = 12 + n;
  for (const f of h.files) {
    if (typeof f.id !== 'string' || typeof f.name !== 'string') throw bad();
    files.set(f.id, new File([file.slice(at, at + f.size)], f.name, { type: typeof f.type === 'string' ? f.type : '' }));
    at += f.size;
  }
  return { doc: h.doc, files };
}

// Give every media file a fresh id (so an opened project never clashes with existing ones) and update references.
export function reassignIds(doc: ProjectDoc, map: Map<string, string>): ProjectDoc {
  const id = (x: string) => map.get(x) ?? x;
  return {
    ...doc,
    assets: (doc.assets ?? []).map((a) => ({ ...a, id: id(a.id) })),
    clips: (doc.clips ?? []).map((c) => ({ ...c, assetId: id(c.assetId) })),
    audios: (doc.audios ?? []).map((a) => ({ ...a, assetId: id(a.assetId) })),
    words: Object.fromEntries(Object.entries(doc.words ?? {}).map(([k, v]) => {
      const [aid, lang] = k.split('|');
      return [`${id(aid)}|${lang}`, v];
    })),
  };
}

export async function exportProjectFile(id: string): Promise<Blob> {
  const doc = await loadDoc(id);
  if (!doc) throw new Error('err.badProject');
  const files = new Map<string, File>();
  for (const a of doc.assets ?? []) {
    const f = await store.get<File>('asset:' + a.id);
    if (f) files.set(a.id, f);
  }
  return packProject(doc, files);
}

export async function importProjectFile(file: Blob): Promise<ProjectMeta> {
  const { doc, files } = await unpackProject(file);
  const map = new Map([...files.keys()].map((k) => [k, crypto.randomUUID()]));
  const fresh = reassignIds(doc, map);
  // Drop media the file didn't include, so nothing points at a missing file.
  const included = new Set<string>(map.values());
  fresh.assets = (fresh.assets ?? []).filter((a) => included.has(a.id));
  for (const [old, f] of files) await store.set('asset:' + map.get(old), f);
  const meta = await createProject(fresh.name ?? '');
  const ids = new Set(fresh.assets.map((a) => a.id));
  const dur = (fresh.clips ?? []).reduce((n, c) => n + (fresh.assets!.find((a) => a.id === c.assetId)?.duration ?? 0), 0);
  await saveDoc(meta.id, { ...fresh, clips: (fresh.clips ?? []).filter((c) => ids.has(c.assetId)) }, { duration: dur, clips: fresh.clips?.length ?? 0 });
  return meta;
}

// Save a .sonant file: Chrome/Edge write straight to disk (and reuse the same file next time); others download.
const handles = new Map<string, FileSystemFileHandle>();
export async function saveProjectFile(id: string, name: string, again = true): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const blob = await exportProjectFile(id);
  const fname = `${(name || 'project').replace(/[\\/:*?"<>|]+/g, '-')}.sonant`;
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      let h = again ? handles.get(id) : undefined;
      h ??= await picker({ suggestedName: fname, types: [{ description: 'Sonant project', accept: { 'application/octet-stream': ['.sonant'] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      handles.set(id, h);
      return 'saved';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}

// ---- Storage: ask the browser not to evict our data, and report usage ----
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}
export async function storageInfo(): Promise<{ used: number; quota: number; persisted: boolean }> {
  try {
    const [e, p] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted()]);
    return { used: e.usage ?? 0, quota: e.quota ?? 0, persisted: p };
  } catch {
    return { used: 0, quota: 0, persisted: false };
  }
}
