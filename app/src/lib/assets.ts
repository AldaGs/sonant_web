import type { Asset } from './project';
import * as store from './store';

// Read duration/size of a media file. Browser-recorded WebM often reports Infinity until you seek far.
export async function probe(file: File): Promise<Omit<Asset, 'id' | 'name'>> {
  const kind = file.type.startsWith('audio/') ? 'audio' : 'video';
  const el = document.createElement(kind);
  el.preload = 'metadata';
  el.muted = true;
  const url = URL.createObjectURL(file);
  el.src = url;
  try {
    await new Promise((resolve, reject) => ((el.onloadedmetadata = resolve), (el.onerror = () => reject(new Error('err.badMedia')))));
    if (!Number.isFinite(el.duration)) {
      el.currentTime = 1e9;
      await new Promise((r) => el.addEventListener('durationchange', r, { once: true }));
    }
    const v = el as HTMLVideoElement;
    return kind === 'video' ? { kind, duration: el.duration, width: v.videoWidth, height: v.videoHeight } : { kind, duration: el.duration };
  } finally {
    el.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

export async function importFile(file: File): Promise<{ asset: Asset; saved: boolean }> {
  const asset: Asset = { id: crypto.randomUUID(), name: file.name, ...(await probe(file)) };
  // ponytail: whole file copied into IndexedDB; huge files may hit the quota (then: reopen after reload)
  const saved = await store.set('asset:' + asset.id, file).then(() => true, () => false);
  return { asset, saved };
}

export const loadFile = (id: string) => store.get<File>('asset:' + id);
export const deleteFile = (id: string) => store.del('asset:' + id);
