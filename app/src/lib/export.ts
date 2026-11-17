import { decodeFileAudio } from './audiodecode.ts';
import { envelopeAt, hasEnvelope } from './layertrans.ts';
import { audioCodec } from './aacenc.ts';
import type { Caption } from './captions.ts';
import { startOf, endOf } from './captions.ts';
import { type ZoomMoment } from './autozoom.ts';
import { outLen, srcIn, type Segment } from './cuts.ts';
import { stretch } from './stretch.ts';
import { Transitioner } from './transitions.ts';
import { Grader, type Lut } from './grade.ts';
import { type Style } from './render.ts';
import { loadSegmenter } from './segment.ts';
import { type Overlay } from './overlay.ts';
import { duckGain, normalizeGain } from './audio.ts';
import { DUCK_LEVEL, itemLen, type Asset, type AudioItem } from './project.ts';
import { fileAt, timelineEnd } from './model.ts';
import { byTrack } from './tracks.ts';
import { compose, type ComposeEnv } from './compose.ts';

export type Aspect = 'source' | '16:9' | '9:16' | '1:1' | '4:5';
export type Res = 'source' | 2160 | 1080 | 720 | 540 | 480;
export type Quality = 'draft' | 'standard' | 'high';
// loudness: normalize the mix to −14 LUFS (TikTok/YouTube/Spotify target). voice: clean up the clips' own sound
// (rumble filter + gentle compression), for speech recorded on a phone.
export type ExportOptions = { res: Res; aspect: Aspect; fps: number; quality: Quality; loudness?: boolean; voice?: boolean };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// Output frame size. `res` sets the short side (like "1080p" means 1080 on the short side).
export function outputSize(srcW: number, srcH: number, res: Res, aspect: Aspect) {
  const ratio = aspect === 'source' ? srcW / srcH : aspect === '16:9' ? 16 / 9 : aspect === '9:16' ? 9 / 16 : aspect === '4:5' ? 4 / 5 : 1;
  const short = res === 'source' ? Math.min(srcW, srcH) : res;
  return ratio >= 1 ? { width: even(short * ratio), height: even(short) } : { width: even(short), height: even(short / ratio) };
}

// Source timestamps of every output frame at a fixed fps, walking the kept segments in order.
// Speed changes how fast source time moves per output frame; a freeze frame repeats its first frame.
export function* frameTimes(segs: Segment[], fps: number) {
  for (const s of segs) {
    const n = Math.ceil(outLen(s) * fps - 1e-6);
    for (let i = 0; i < n; i++) yield Math.min(srcIn(s, i / fps), s.end - 1e-4);
  }
}
export const frameCount = (segs: Segment[], fps: number) =>
  segs.reduce((n, s) => n + Math.ceil(outLen(s) * fps - 1e-6), 0);

// Copy samples [a, z) of `b` into a new buffer.
function slice(b: AudioBuffer, a: number, z: number): AudioBuffer {
  const out = new AudioBuffer({ length: z - a, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(a, z), c);
  return out;
}

// What export needs to know about the project. Everything is in output time (captions too: pass them already
// placed on the timeline, without cut words).
export type ExportSource = {
  files: Map<string, File>; // assetId → file
  assets: Asset[];
  audios: AudioItem[];
  overlays: Overlay[]; // every visible video track
  luts?: Lut[];
  speech?: [number, number][]; // output time ranges where someone talks (music ducks under these)
  clipVolume: number; // extra volume for the sound of videos (linked audio items)
  clean?: Map<string, Blob>; // assetId → noise-reduced sound of a video (used for its linked audio instead of the file's)
  zooms?: ZoomMoment[]; // smart auto-zoom moments, output time
  zoomScale?: number;
  zoomShake?: boolean; // camera shake burst as each auto-zoom lands
};

// Mix every audio item into one buffer, `seconds` long.
// ponytail: renders the whole mix in memory (~23 MB per stereo minute); stream in chunks if long videos hit memory limits
async function mixAudio(src: ExportSource, seconds: number, opts: Partial<ExportOptions> = {}): Promise<AudioBuffer | null> {
  const sr = 48000;
  const durations = new Map(src.assets.map((a) => [a.id, a.duration]));
  // Older layers that still play their own sound (no linked audio item).
  const ovAudio = src.overlays.filter((o) => o.kind === 'video' && o.assetId && !o.link && (o.volume ?? 0) > 0);
  const fileOf = (a: { assetId: string; link?: string; fx?: AudioItem['fx'] }) => (a.fx?.rev ? a.fx.rev.assetId : a.assetId);
  const keyOf = (a: AudioItem) => fileOf(a) + (a.link && src.clean?.has(fileOf(a)) ? '|clean' : '');
  const decoded = new Map<string, AudioBuffer>();
  for (const a of [...src.audios.filter((x) => !x.fx?.hold).map((x) => ({ key: keyOf(x), id: fileOf(x) })), ...ovAudio.map((o) => ({ key: o.assetId!, id: o.assetId! }))]) {
    if (decoded.has(a.key)) continue;
    const f = a.key.endsWith('|clean') ? src.clean!.get(a.id) : src.files.get(a.id);
    if (!f) continue;
    try {
      // Streams the audio track only: a long phone video no longer has to fit in memory as a whole file.
      const b = await decodeFileAudio(f);
      if (b) decoded.set(a.key, b);
    } catch {} // no audio track in this file
  }
  if (!decoded.size || seconds <= 0) return null;

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sr), sampleRate: sr });
  // Voice bus: the sound of videos goes through a rumble filter and a gentle compressor.
  let voice: AudioNode = ctx.destination;
  if (opts.voice) {
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 85, Q: 0.7 });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -24, knee: 12, ratio: 3, attack: 0.005, release: 0.2 });
    const makeup = new GainNode(ctx, { gain: 1.4 });
    hp.connect(comp).connect(makeup).connect(ctx.destination);
    voice = hp;
  }
  // gain: a fixed volume, or a function of output time (ducking, volume points), sampled at 50 Hz.
  const play = (buf: AudioBuffer, when: number, offset: number, len: number, gain: number | ((t: number) => number), to: AudioNode = ctx.destination) => {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf;
    if (typeof gain === 'number') g.gain.value = gain;
    else {
      const n = Math.max(2, Math.ceil(len * 50));
      g.gain.setValueCurveAtTime(Float32Array.from({ length: n }, (_, i) => gain(when + (i / (n - 1)) * len)), when, len);
    }
    s.connect(g).connect(to);
    s.start(when, Math.max(0, offset), len);
  };
  const speech = src.speech ?? [];
  for (const item of src.audios) {
    const buf = decoded.get(keyOf(item));
    if (!buf || item.fx?.hold || item.at >= seconds) continue;
    const full = itemLen(item, durations.get(item.assetId) ?? buf.duration), len = Math.min(full, seconds - item.at);
    if (len <= 0) continue;
    const env = hasEnvelope(item), duck = item.duck && speech.length;
    const vol = item.volume * (item.link ? src.clipVolume : 1);
    const gain = duck || env ? (t: number) => vol * (duck ? duckGain(speech, t, DUCK_LEVEL) : 1) * (env ? envelopeAt(item, t - item.at, full) : 1) : vol;
    const to = item.link ? voice : ctx.destination; // a video's sound goes through the voice bus
    const m = { ...item, len: full }, rev = item.fx?.rev ? item.fx.rev.start : 0;
    if (!item.fx?.speed && !item.fx?.speedEnd) {
      play(buf, item.at, (item.offset ?? 0) - rev, len, gain, to);
      continue;
    }
    // Sped-up / slowed-down items: time-stretched so voices keep their pitch. A ramp is stretched in short
    // pieces, each at its own average speed.
    // ponytail: fixed 0.25 s pieces; crossfade them if seams ever become audible.
    const step = item.fx?.speedEnd ? 0.25 : len;
    for (let o = 0; o < len - 1e-6; o += step) {
      const d = Math.min(step, len - o), x0 = fileAt(m, item.at + o) - rev, x1 = fileAt(m, item.at + o + d) - rev;
      const a = Math.max(0, Math.floor(x0 * buf.sampleRate)), z = Math.min(buf.length, Math.ceil(x1 * buf.sampleRate));
      if (z <= a) continue;
      const ch = stretch(Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).subarray(a, z)), (x1 - x0) / d);
      const piece = new AudioBuffer({ length: ch[0].length, numberOfChannels: ch.length, sampleRate: buf.sampleRate });
      ch.forEach((dd, c) => piece.copyToChannel(dd as Float32Array<ArrayBuffer>, c));
      const g = typeof gain === 'number' ? gain : gain(item.at + o + d / 2);
      play(piece, item.at + o, 0, Math.min(piece.duration, d), g, to);
    }
  }
  for (const o of ovAudio) {
    const buf = decoded.get(o.assetId!);
    if (!buf || o.at >= seconds) continue;
    const len = Math.min(o.len, buf.duration - (o.offset ?? 0), seconds - o.at);
    if (len > 0) play(buf, o.at, o.offset ?? 0, len, o.volume ?? 0, voice);
  }
  const mix = await ctx.startRendering();
  if (opts.loudness) {
    const ch = Array.from({ length: mix.numberOfChannels }, (_, c) => mix.getChannelData(c));
    const g = normalizeGain(ch, sr);
    if (g !== 1) for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
  }
  return mix;
}

export async function exportVideo(
  src: ExportSource, captions: Caption[], style: Style, opts: ExportOptions,
  onProgress: (p: number) => void, signal: AbortSignal,
): Promise<Blob> {
  // Loaded on demand so the encoder library doesn't slow down the first page load.
  const {
    Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS,
    CanvasSink, CanvasSource, AudioBufferSource,
    canEncodeVideo, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH,
  } = await import('mediabunny');

  const assets = new Map(src.assets.map((a) => [a.id, a]));
  const durations = new Map(src.assets.map((a) => [a.id, a.duration]));
  // Frame size from the first video or picture on the lowest track (a timeline of only text: 1080p).
  const first = byTrack(src.overlays).map((o) => o.assetId && assets.get(o.assetId)).find((a) => a && a.width) || undefined;
  const { width, height } = outputSize(first?.width ?? 1920, first?.height ?? 1080, opts.res, opts.aspect);
  if (!(await canEncodeVideo('avc', { width, height })))
    throw new Error('err.noH264');
  const aCodec = await audioCodec();

  if (src.overlays.some((o) => o.behind || (o.fill && !o.fx?.key && (o.fx?.behind || o.fx?.bg)))) await loadSegmenter(); // frames must be segmented
  const seconds = timelineEnd(src, (id) => durations.get(id) ?? 0);
  const total = Math.max(1, Math.ceil(seconds * opts.fps - 1e-6));
  const mix = await mixAudio(src, total / opts.fps, opts);
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

  const sorted = [...captions].sort((a, b) => startOf(a) - startOf(b));

  // Items: pictures decoded once; each video item gets a decoder when it starts that yields its frames in
  // output order, and lets it go when it ends (a talk cut into many pieces never holds many decoders).
  type Layer = { o: Overlay; first: number; last: number; cur: CanvasImageSource | null; w: number; h: number;
    frames?: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null>; opened?: boolean; done?: boolean };
  const tracksOf = new Map<string, Promise<Awaited<ReturnType<InstanceType<typeof Input>['getPrimaryVideoTrack']>> | null>>();
  const trackFor = (id: string) => {
    if (!tracksOf.has(id)) {
      const f = src.files.get(id);
      tracksOf.set(id, f ? new Input({ source: new BlobSource(f), formats: ALL_FORMATS }).getPrimaryVideoTrack().catch(() => null) : Promise.resolve(null));
    }
    return tracksOf.get(id)!;
  };
  const pics = new Map<string, Promise<ImageBitmap | null>>();
  const picFor = (id: string) => {
    if (!pics.has(id)) {
      const f = src.files.get(id);
      pics.set(id, f ? createImageBitmap(f).catch(() => null) : Promise.resolve(null));
    }
    return pics.get(id)!;
  };
  const layers: Layer[] = [];
  for (const o of src.overlays) {
    const first = Math.ceil(o.at * opts.fps - 1e-6), last = Math.ceil((o.at + o.len) * opts.fps - 1e-6) - 1; // output frames it covers
    if (last < first) continue;
    const l: Layer = { o, first, last, cur: null, w: 0, h: 0 };
    if (o.kind === 'image' && o.assetId) {
      const img = await picFor(o.assetId);
      if (img) ((l.cur = img), (l.w = img.width), (l.h = img.height));
    }
    layers.push(l);
  }
  const open = async (l: Layer) => {
    l.opened = true;
    const o = l.o, id = o.fx?.rev ? o.fx.rev.assetId : o.assetId!;
    const track = await trackFor(id);
    if (!track) return;
    // Items that fill the frame decode at "cover" size (aspect kept); others at most 1280 on the long side.
    const k = o.fill ? Math.max(width / track.displayWidth, height / track.displayHeight) : Math.min(1, 1280 / Math.max(track.displayWidth, track.displayHeight));
    const w = even(track.displayWidth * k), h = even(track.displayHeight * k);
    const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
    const end = (durations.get(id) ?? Infinity) - 1e-3, rev = o.fx?.rev ? o.fx.rev.start : 0;
    const times = Array.from({ length: l.last - l.first + 1 }, (_, j) => Math.max(0, Math.min(end, fileAt(o, (l.first + j) / opts.fps) - rev)));
    ((l.frames = sink.canvasesAtTimestamps(times) as Layer['frames']), (l.w = w), (l.h = h));
  };
  // Pull each active video item's frame for output frame i (a missing frame keeps the previous one).
  const advance = async (i: number) => {
    for (const l of layers) {
      if (l.o.kind !== 'video' || l.done) continue;
      if (i > l.last) { l.done = true; await l.frames?.return(null); l.cur = null; continue; }
      if (i < l.first) continue;
      if (!l.opened) await open(l);
      if (l.frames) l.cur = (await l.frames.next()).value?.canvas ?? l.cur;
    }
  };
  const byId = new Map(layers.map((l) => [l.o.id, l]));
  const grader = new Grader(), lutOf = (id?: string) => src.luts?.find((l) => l.id === id);
  const bgPics = new Map<string, ImageBitmap | null>();
  for (const o of src.overlays) if (o.fx?.bg === 'image' && o.fx.bgImage && !bgPics.has(o.fx.bgImage)) bgPics.set(o.fx.bgImage, await picFor(o.fx.bgImage));
  const env: ComposeEnv = {
    mediaOf: (o) => {
      const l = byId.get(o.id);
      return l?.cur && l.w ? { src: l.cur, w: l.w, h: l.h } : null;
    },
    grade: (s, w, h, c, t) => grader.apply(s, w, h, c, lutOf(c.lut), t),
    bgImageOf: (fx) => {
      const b = fx?.bg === 'image' && fx.bgImage ? bgPics.get(fx.bgImage) : null;
      return b ? { src: b, w: b.width, h: b.height } : null;
    },
    zooms: src.zooms ?? [], zoomScale: src.zoomScale ?? 1, zoomShake: !!src.zoomShake,
    trans: new Transitioner(), all: src.overlays, style,
  };

  const videoTask = (async () => {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / opts.fps;
      await advance(i);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      const items = byTrack(layers.filter((l) => i >= l.first && i <= l.last).map((l) => l.o));
      const cap = sorted.find((c) => t >= startOf(c) && t < endOf(c)) ?? null;
      compose(ctx, items, t, cap, env);
      await vOut.add(t, 1 / opts.fps);
      onProgress((i + 1) / total);
    }
    for (const l of layers) await l.frames?.return(null);
    for (const p of pics.values()) (await p)?.close();
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
