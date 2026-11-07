import type { Caption } from './captions.ts';
import { startOf, endOf } from './captions.ts';
import { keptCaptions, type Segment } from './cuts.ts';
import { drawCaption, resolveStyle, type Style } from './render.ts';
import { drawFrame, loadSegmenter } from './segment.ts';
import { drawOverlay, type Overlay } from './overlay.ts';
import { clipAt, clipStarts, splitAtBoundaries, itemLen, type Asset, type AudioItem, type Clip } from './project.ts';

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

// Copy samples [a, z) of `b` into a new buffer.
function slice(b: AudioBuffer, a: number, z: number): AudioBuffer {
  const out = new AudioBuffer({ length: z - a, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, z), c);
  return out;
}

// What export needs to know about the project. Times: segments/captions in sequence time, audio items in output time.
export type ExportSource = {
  files: Map<string, File>; // assetId → file
  assets: Asset[];
  clips: Clip[];
  audios: AudioItem[];
  overlays?: Overlay[]; // output time
  clipVolume: number;
};

// Mix the kept parts of each clip's audio plus the extra audio items into one buffer, `seconds` long.
// ponytail: renders the whole mix in memory (~23 MB per stereo minute); stream in chunks if long videos hit memory limits
async function mixAudio(src: ExportSource, segs: Segment[], seconds: number): Promise<AudioBuffer | null> {
  const sr = 48000;
  const durations = new Map(src.assets.map((a) => [a.id, a.duration]));
  const ovAudio = (src.overlays ?? []).filter((o) => o.kind === 'video' && o.assetId && (o.volume ?? 0) > 0);
  const needed = new Set([...src.clips.map((c) => c.assetId), ...src.audios.map((a) => a.assetId), ...ovAudio.map((o) => o.assetId!)]);
  const decoder = new AudioContext({ sampleRate: sr });
  const decoded = new Map<string, AudioBuffer>();
  try {
    for (const id of needed) {
      const f = src.files.get(id);
      if (!f) continue;
      try {
        decoded.set(id, await decoder.decodeAudioData(await f.arrayBuffer()));
      } catch {} // no audio track in this file
    }
  } finally {
    decoder.close();
  }
  if (!decoded.size || seconds <= 0) return null;

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sr), sampleRate: sr });
  const play = (buf: AudioBuffer, when: number, offset: number, len: number, volume: number) => {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf;
    g.gain.value = volume;
    s.connect(g).connect(ctx.destination);
    s.start(when, offset, len);
  };

  // Clip audio: each kept piece, back to back in output time.
  const starts = clipStarts(src.clips, durations);
  let out = 0;
  for (const s of splitAtBoundaries(segs, starts)) {
    const at = clipAt(src.clips, durations, (s.start + s.end) / 2);
    const buf = at && decoded.get(src.clips[at.index].assetId);
    if (buf) play(buf, out, s.start - starts[at.index], s.end - s.start, src.clipVolume);
    out += s.end - s.start;
  }
  // Extra audio: placed in output time, cut off at the end of the video.
  for (const item of src.audios) {
    const buf = decoded.get(item.assetId);
    if (!buf || item.at >= seconds) continue;
    const len = Math.min(itemLen(item, buf.duration), seconds - item.at);
    if (len > 0) play(buf, item.at, item.offset ?? 0, len, item.volume);
  }
  // Sound of picture-in-picture layers that aren't muted.
  for (const o of ovAudio) {
    const buf = decoded.get(o.assetId!);
    if (!buf || o.at >= seconds) continue;
    const len = Math.min(o.len, buf.duration - (o.offset ?? 0), seconds - o.at);
    if (len > 0) play(buf, o.at, o.offset ?? 0, len, o.volume ?? 0);
  }
  return ctx.startRendering();
}

export async function exportVideo(
  src: ExportSource, segs: Segment[], captions: Caption[], style: Style, opts: ExportOptions,
  onProgress: (p: number) => void, signal: AbortSignal,
): Promise<Blob> {
  // Loaded on demand so the encoder library doesn't slow down the first page load.
  const {
    Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS,
    CanvasSink, CanvasSource, AudioBufferSource,
    canEncodeVideo, canEncodeAudio, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH,
  } = await import('mediabunny');

  const assets = new Map(src.assets.map((a) => [a.id, a]));
  const durations = new Map(src.assets.map((a) => [a.id, a.duration]));
  const first = src.clips.map((c) => assets.get(c.assetId)).find((a) => a?.width);
  if (!first) throw new Error('err.noVideo');
  const { width, height } = outputSize(first.width!, first.height!, opts.res, opts.aspect);
  if (!(await canEncodeVideo('avc', { width, height })))
    throw new Error('err.noH264');
  const aCodec = (await canEncodeAudio('aac')) ? 'aac' : 'opus';

  if (segs.some((s) => s.fx?.behind || s.fx?.bg)) await loadSegmenter(); // every exported frame must be segmented
  const total = frameCount(segs, opts.fps);
  const mix = await mixAudio(src, segs, total / opts.fps);
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')! as unknown as CanvasRenderingContext2D;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const bitrate = { draft: QUALITY_LOW, standard: QUALITY_MEDIUM, high: QUALITY_HIGH }[opts.quality];
  const vOut = new CanvasSource(canvas, { codec: 'avc', bitrate });
  output.addVideoTrack(vOut, { frameRate: opts.fps });
  const aOut = mix ? new AudioBufferSource({ codec: aCodec, bitrate }) : null;
  if (aOut) output.addAudioTrack(aOut);
  await output.start();

  const sorted = keptCaptions(captions, segs).sort((a, b) => startOf(a) - startOf(b)); // cut words never appear

  // Layers: images decoded once; each video layer gets one decoder that yields its frames in output order.
  type Layer = { o: Overlay; img?: ImageBitmap; frames?: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>; first: number; last: number;
    cur: CanvasImageSource | null; w: number; h: number };
  const layers: Layer[] = [];
  for (const o of src.overlays ?? []) {
    const first = Math.ceil(o.at * opts.fps - 1e-6), last = Math.ceil((o.at + o.len) * opts.fps - 1e-6) - 1; // output frames it covers
    const f = o.assetId ? src.files.get(o.assetId) : undefined;
    if (o.kind === 'text') layers.push({ o, first, last, cur: null, w: 0, h: 0 });
    else if (o.kind === 'image' && f) {
      const img = await createImageBitmap(f).catch(() => undefined);
      if (img) layers.push({ o, img, first, last, cur: img, w: img.width, h: img.height });
    } else if (o.kind === 'video' && f && last >= first) {
      const track = await new Input({ source: new BlobSource(f), formats: ALL_FORMATS }).getPrimaryVideoTrack();
      if (!track) continue;
      // Decode at most 1280 on the long side; a layer rarely fills the frame.
      const k = Math.min(1, 1280 / Math.max(track.displayWidth, track.displayHeight));
      const w = Math.max(2, Math.round(track.displayWidth * k)), h = Math.max(2, Math.round(track.displayHeight * k));
      const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
      const times = Array.from({ length: last - first + 1 }, (_, j) => (o.offset ?? 0) + (first + j) / opts.fps - o.at);
      layers.push({ o, frames: sink.canvasesAtTimestamps(times) as Layer['frames'], first, last, cur: null, w, h });
    }
  }
  // Pull each active video layer's frame for output frame i (a missing frame keeps the previous one).
  const advance = async (i: number) => {
    for (const l of layers) if (l.frames && i >= l.first && i <= l.last) l.cur = (await l.frames.next()).value?.canvas ?? l.cur;
  };
  const paintLayers = (i: number) => {
    for (const l of layers) if (i >= l.first && i <= l.last) drawOverlay(ctx, l.o, i / opts.fps, l.cur, l.w, l.h);
  };

  // Video: for each kept piece, pull its clip's frames (one decoder per asset), draw + caption, encode.
  const videoTask = (async () => {
    const sinks = new Map<string, InstanceType<typeof CanvasSink>>();
    const sinkFor = async (assetId: string) => {
      if (!sinks.has(assetId)) {
        const f = src.files.get(assetId);
        const track = f && (await new Input({ source: new BlobSource(f), formats: ALL_FORMATS }).getPrimaryVideoTrack());
        if (track) sinks.set(assetId, new CanvasSink(track, { width, height, fit: 'cover', poolSize: 2 }));
      }
      return sinks.get(assetId);
    };
    const starts = clipStarts(src.clips, durations);
    let i = 0;
    for (const piece of splitAtBoundaries(segs, starts)) {
      const at = clipAt(src.clips, durations, (piece.start + piece.end) / 2);
      const offset = at ? starts[at.index] : 0;
      const sink = at ? await sinkFor(src.clips[at.index].assetId) : undefined;      const times = [...frameTimes([piece], opts.fps)];
      const frames = sink ? sink.canvasesAtTimestamps(times.map((t) => t - offset)) : null;
      for (const t of times) {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const frame = frames ? (await frames.next()).value : null;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        const cap = sorted.find((c) => t >= startOf(c) && t < endOf(c));
        await advance(i);
        // Same order as the preview: video, layers, caption (and the person over both with "text behind").
        drawFrame(ctx, frame?.canvas ?? null, width, height, [0, 0, width, height], piece.fx, !!cap, () => {
          paintLayers(i);
          if (cap) drawCaption(ctx, cap, t, resolveStyle(style, cap.style));
        });
        await vOut.add(i / opts.fps, 1 / opts.fps);
        onProgress(++i / total);
      }
      await frames?.return(undefined);
    }
    for (const l of layers) (await l.frames?.return(null), l.img?.close());
  })();

  // Audio: the pre-rendered mix, fed in 1-second chunks.
  const audioTask = (async () => {
    if (!mix || !aOut) return;
    for (let a = 0; a < mix.length; a += mix.sampleRate) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      await aOut.add(slice(mix, a, Math.min(mix.length, a + mix.sampleRate)));
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
