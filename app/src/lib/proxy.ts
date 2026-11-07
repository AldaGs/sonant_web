import type { Asset } from './project';
import * as store from './store';

// Proxy media: a small copy of a video (540p, a keyframe every half second) used only for the preview,
// so seeking and scrubbing land instantly. Export always reads the original file.
const SHORT = 540;
export const proxyKey = (assetId: string) => 'proxy:' + assetId;

// Worth it for big or long footage (phone 4K, screen recordings, long interviews).
export const wantsProxy = (a: Asset) =>
  a.kind === 'video' && ((a.width ?? 0) * (a.height ?? 0) > 1920 * 1080 || a.duration > 180);

export async function makeProxy(file: File, onProgress: (p: number) => void): Promise<Blob> {
  const { Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, Conversion, QUALITY_LOW } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const conv = await Conversion.init({
    input, output,
    video: (track) => {
      const k = Math.min(1, SHORT / Math.min(track.displayWidth, track.displayHeight));
      return { width: even(track.displayWidth * k), height: even(track.displayHeight * k), fit: 'fill', codec: 'avc',
        bitrate: QUALITY_LOW, keyFrameInterval: 0.5, forceTranscode: true };
    },
  });
  if (!conv.isValid) throw new Error('err.proxy');
  conv.onProgress = (p) => onProgress(p);
  await conv.execute();
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}

export const loadProxy = (assetId: string) => store.get<Blob>(proxyKey(assetId));
export const saveProxy = (assetId: string, b: Blob) => store.set(proxyKey(assetId), b);
export const deleteProxy = (assetId: string) => store.del(proxyKey(assetId));
