import { decodeFileAudio } from './audiodecode.ts';
// Reverse a strip: a new MP4 of [a, b) (seconds in the file) played backwards, picture and sound.
// The browser can't play video backwards, so this copy is made once and then played forwards in its place.
// Frames are decoded half a second at a time from the end, so memory stays small.

export const REV_MAX = 1080; // short side cap for the reversed copy
export const REV_CHUNK = 0.5; // seconds decoded at a time

// Frame times of [a, b) at `fps`, grouped into chunks from the end backwards, each chunk in reverse order.
// Reading them in this order gives the reversed video while each decode still runs forwards inside its chunk.
export function reversedChunks(a: number, b: number, fps: number, chunk = REV_CHUNK): number[][] {
  const n = Math.max(1, Math.round((b - a) * fps)), per = Math.max(1, Math.round(chunk * fps));
  const times = Array.from({ length: n }, (_, i) => a + (i + 0.5) / fps); // mid-frame times
  const out: number[][] = [];
  for (let end = n; end > 0; end -= per) out.push(times.slice(Math.max(0, end - per), end));
  return out; // decode each chunk forwards, then emit it backwards
}

// Reverse a channel range in place order: out[i] = x[b - 1 - i].
export function reverseRange(x: Float32Array, a: number, b: number): Float32Array {
  const out = new Float32Array(Math.max(0, b - a));
  for (let i = 0; i < out.length; i++) out[i] = x[b - 1 - i];
  return out;
}

export async function makeReversed(file: File, a: number, b: number, onProgress: (p: number) => void): Promise<Blob> {
  const { Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, CanvasSink, CanvasSource, AudioBufferSource, QUALITY_HIGH, canEncodeAudio } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('err.noVideo');
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const k = Math.min(1, REV_MAX / Math.min(track.displayWidth, track.displayHeight));
  const w = even(track.displayWidth * k), h = even(track.displayHeight * k);
  const stats = await track.computePacketStats(120).catch(() => null);
  const fps = Math.min(60, Math.max(10, Math.round(stats?.averagePacketRate ?? 30)));

  const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d')!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vOut = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 0.5 });
  output.addVideoTrack(vOut, { frameRate: fps });

  // Sound: the same range, reversed sample by sample.
  let audio: AudioBuffer | null = null;
  try {
    {
      const buf = await decodeFileAudio(file); // streams the audio track only
      if (!buf) throw new Error('no audio');
      const i0 = Math.max(0, Math.floor(a * buf.sampleRate)), i1 = Math.min(buf.length, Math.ceil(b * buf.sampleRate));
      if (i1 > i0) {
        audio = new AudioBuffer({ length: i1 - i0, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
        for (let c = 0; c < buf.numberOfChannels; c++) audio.copyToChannel(reverseRange(buf.getChannelData(c), i0, i1) as Float32Array<ArrayBuffer>, c);
      }
    }
  } catch {} // no audio track
  const aCodec = (await canEncodeAudio('aac')) ? 'aac' : 'opus';
  const aOut = audio ? new AudioBufferSource({ codec: aCodec, bitrate: QUALITY_HIGH }) : null;
  if (aOut) output.addAudioTrack(aOut);
  await output.start();

  const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 0 });
  const chunks = reversedChunks(a, b, fps), total = chunks.reduce((n, c) => n + c.length, 0);
  let i = 0;
  for (const times of chunks) {
    const frames: ImageBitmap[] = [];
    for await (const f of sink.canvasesAtTimestamps(times)) if (f) frames.push(await createImageBitmap(f.canvas));
    for (const bmp of frames.reverse()) {
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      await vOut.add(i / fps, 1 / fps);
      onProgress((++i / total) * 100);
    }
  }
  if (aOut && audio) await aOut.add(audio);
  await output.finalize();
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}
