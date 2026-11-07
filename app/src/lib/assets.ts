import type { Asset } from './project';
import * as store from './store';

// Some files arrive without a MIME type (often .mkv, .m4a, .mov); fall back to the extension.
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
export function mediaKind(f: File): 'video' | 'audio' | 'image' | null {
  if (f.type.startsWith('image/') || IMAGE_EXT.test(f.name)) return 'image';
  if (f.type.startsWith('video/')) return 'video';
  if (f.type.startsWith('audio/')) return 'audio';
  return VIDEO_EXT.test(f.name) ? 'video' : AUDIO_EXT.test(f.name) ? 'audio' : null;
}

// Read duration/size of a media file. Browser-recorded WebM often reports Infinity until you seek far.
export async function probe(file: File): Promise<Omit<Asset, 'id' | 'name'>> {
  const kind = mediaKind(file) ?? 'video';
  if (kind === 'image') {
    // Images have no length of their own; 5s is how long they stay on screen when added.
    const bmp = await createImageBitmap(file).catch(() => { throw new Error('err.badMedia'); });
    const out = { kind, duration: 5, width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  }
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
