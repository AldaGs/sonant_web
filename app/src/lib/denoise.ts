// AI noise reduction (RNNoise) for the clips' own sound.
// Each video asset's audio is cleaned once, in a worker, and cached; the preview plays the cleaned
// track in sync with the (muted) video and export mixes it instead of the original.
// The pure parts live here so they can be tested without the model.

export const DENOISE_LEVELS = [0, 0.5, 0.8, 1] as const; // off, light, medium, strong (wet/dry mix)
export const RN_RATE = 48000; // RNNoise works at 48 kHz
export const RN_DELAY = 960; // samples the model's output lags its input (two frames; measured in Chromium by cross-correlation)

// Run `process` (in-place, 16-bit-scaled frames of `frame` samples) over a channel; returns the result
// aligned with the input (delay removed) and mixed with the original: mix 1 = fully cleaned.
export function denoiseChannel(x: Float32Array, frame: number, process: (f: Float32Array) => void, mix: number, delay = RN_DELAY): Float32Array {
  const n = x.length, total = n + delay, buf = new Float32Array(frame), wet = new Float32Array(Math.ceil(total / frame) * frame);
  for (let o = 0; o < total; o += frame) {
    for (let i = 0; i < frame; i++) buf[i] = (o + i < n ? x[o + i] : 0) * 32768;
    process(buf);
    for (let i = 0; i < frame; i++) wet[o + i] = buf[i] / 32768;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = wet[i + delay] * mix + x[i] * (1 - mix);
  return out;
}

// 16-bit PCM WAV, so the cleaned track can play in an <audio> element and be stored as a Blob.
export function wav(channels: Float32Array[], sr: number): Blob {
  const n = channels[0]?.length ?? 0, ch = channels.length, bytes = n * ch * 2;
  const v = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, p += 2) v.setInt16(p, Math.max(-1, Math.min(1, channels[c][i])) * 0x7fff, true);
  return new Blob([v.buffer], { type: 'audio/wav' });
}

export const cleanKey = (assetId: string, mix: number) => `clean:${assetId}:${mix}`;

// ---- Browser side ----
import type { In, Out } from './denoise.worker.ts';
let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

// Clean a file's audio. Returns a WAV blob at 48 kHz (stereo kept, at most 2 channels), or null without audio.
export function cleanAudio(file: Blob, mix: number, onProgress: (p: number) => void): Promise<Blob | null> {
  const run = async () => {
    const ctx = new AudioContext({ sampleRate: RN_RATE });
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      return null; // no audio track
    } finally {
      ctx.close();
    }
    const channels = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => buf.getChannelData(c).slice());
    worker ??= new Worker(new URL('./denoise.worker.ts', import.meta.url), { type: 'module' });
    const out = await new Promise<Float32Array[]>((resolve, reject) => {
      worker!.onmessage = ({ data }: MessageEvent<Out>) => {
        if (data.type === 'progress') onProgress(data.progress);
        else if (data.type === 'done') resolve(data.channels);
        else reject(new Error(data.message));
      };
      worker!.postMessage({ channels, mix } satisfies In, channels.map((c) => c.buffer));
    });
    return wav(out, RN_RATE);
  };
  const p = queue.then(run, run); // one file at a time
  queue = p.catch(() => {});
  return p;
}
