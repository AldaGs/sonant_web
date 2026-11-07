import type { Caption } from './captions.ts';
import { startOf, endOf } from './captions.ts';
import { keptCaptions, type Segment } from './cuts.ts';
import { drawCaption, type Style } from './render.ts';

export type Aspect = 'source' | '16:9' | '9:16' | '1:1';
export type Res = 'source' | 1080 | 720 | 540 | 480;
export type Quality = 'draft' | 'standard' | 'high';
export type ExportOptions = { res: Res; aspect: Aspect; fps: number; quality: Quality };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// Output frame size. `res` sets the short side (like "1080p" means 1080 on the short side).
export function outputSize(srcW: number, srcH: number, res: Res, aspect: Aspect) {
  const ratio = aspect === 'source' ? srcW / srcH : aspect === '16:9' ? 16 / 9 : aspect === '9:16' ? 9 / 16 : 1;
  const short = res === 'source' ? Math.min(srcW, srcH) : res;
  return ratio >= 1 ? { width: even(short * ratio), height: even(short) } : { width: even(short), height: even(short / ratio) };
}

// Source timestamps of every output frame at a fixed fps, walking the kept segments in order.
export function* frameTimes(segs: Segment[], fps: number) {
  for (const s of segs) for (let t = s.start; t < s.end - 1e-6; t += 1 / fps) yield t;
}
export const frameCount = (segs: Segment[], fps: number) =>
  segs.reduce((n, s) => n + Math.ceil((s.end - s.start - 1e-6) * fps), 0);

// Copy the part of `b` (which starts at source time t0) that lies inside [from, to).
function sliceAudio(b: AudioBuffer, t0: number, from: number, to: number): AudioBuffer | null {
  const a = Math.max(0, Math.round((from - t0) * b.sampleRate));
  const z = Math.min(b.length, Math.round((to - t0) * b.sampleRate));
  if (z <= a) return null;
  if (a === 0 && z === b.length) return b;
  const out = new AudioBuffer({ length: z - a, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, z), c);
  return out;
}

export async function exportVideo(
  file: File, segs: Segment[], captions: Caption[], style: Style, opts: ExportOptions,
  onProgress: (p: number) => void, signal: AbortSignal,
): Promise<Blob> {
  // Loaded on demand so the encoder library doesn't slow down the first page load.
  const {
    Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS,
    CanvasSink, CanvasSource, AudioBufferSink, AudioBufferSource,
    canEncodeVideo, canEncodeAudio, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH,
  } = await import('mediabunny');
  const input =new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const vIn = await input.getPrimaryVideoTrack();
  if (!vIn) throw new Error('err.noVideo');
  const aIn = await input.getPrimaryAudioTrack();

  const { width, height } = outputSize(vIn.displayWidth, vIn.displayHeight, opts.res, opts.aspect);
  if (!(await canEncodeVideo('avc', { width, height })))
    throw new Error('err.noH264');
  const aCodec = (await canEncodeAudio('aac')) ? 'aac' : 'opus';

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')! as unknown as CanvasRenderingContext2D;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const bitrate = { draft: QUALITY_LOW, standard: QUALITY_MEDIUM, high: QUALITY_HIGH }[opts.quality];
  const vOut = new CanvasSource(canvas, { codec: 'avc', bitrate });
  output.addVideoTrack(vOut, { frameRate: opts.fps });
  const aOut = aIn ? new AudioBufferSource({ codec: aCodec, bitrate }) : null;
  if (aOut) output.addAudioTrack(aOut);
  await output.start();

  const total = frameCount(segs, opts.fps);
  const sorted = keptCaptions(captions, segs).sort((a, b) => startOf(a) - startOf(b)); // cut words never appear

  // Video: walk output frames, draw source frame + caption, encode.
  const videoTask = (async () => {
    const sink = new CanvasSink(vIn, { width, height, fit: 'cover', poolSize: 2 });
    const times = frameTimes(segs, opts.fps);
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(frameTimes(segs, opts.fps))) {
      const t = times.next().value as number;
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      if (frame) ctx.drawImage(frame.canvas, 0, 0);
      const cap = sorted.find((c) => t >= startOf(c) && t < endOf(c));
      if (cap) drawCaption(ctx, cap, t, style);
      await vOut.add(i / opts.fps, 1 / opts.fps);
      onProgress(++i / total);
    }
  })();

  // Audio: copy only the kept ranges, back to back.
  const audioTask = (async () => {
    if (!aIn || !aOut) return;
    const sink = new AudioBufferSink(aIn);
    const sr = aIn.sampleRate, chans = aIn.numberOfChannels;
    // Silence keeps audio aligned with video when the source audio has gaps or ends early.
    const pad = (seconds: number) => {
      const n = Math.round(seconds * sr);
      return n > 0 ? aOut.add(new AudioBuffer({ length: n, numberOfChannels: chans, sampleRate: sr })) : undefined;
    };
    for (const s of segs) {
      let cursor = s.start; // source time written so far in this segment
      for await (const { buffer, timestamp } of sink.buffers(s.start, s.end)) {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const from = Math.max(cursor, timestamp); // skip overlap with what's already written
        const part = sliceAudio(buffer, timestamp, from, s.end);
        if (!part) continue;
        await pad(from - cursor);
        await aOut.add(part);
        cursor = from + part.duration;
      }
      await pad(Math.ceil((s.end - s.start) * opts.fps) / opts.fps - (cursor - s.start)); // match video frame count
    }
  })();

  try {
    await Promise.all([videoTask, audioTask]);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}
