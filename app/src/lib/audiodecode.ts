// Decode a media file's sound without loading the whole file into memory.
// decodeAudioData needs the entire file as one ArrayBuffer: a 1 GB phone video then costs 1 GB plus the decoder's
// copies, which is enough to crash a phone tab. Here only the audio track is read and decoded, packet by packet
// (Mediabunny + WebCodecs), straight into one preallocated buffer. Falls back to decodeAudioData when needed.

// Copy decoded chunks (any channel count) into `out` channels starting at sample `at`; returns samples written.
export function place(out: Float32Array[], chunk: Float32Array[], at: number): number {
  const n = Math.max(0, Math.min(chunk[0]?.length ?? 0, (out[0]?.length ?? 0) - at));
  if (!n) return 0;
  for (let c = 0; c < out.length; c++) out[c].set((chunk[c] ?? chunk[0]).subarray(0, n), at); // mono → every channel
  return n;
}

async function fallback(file: Blob): Promise<AudioBuffer | null> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    ctx.close();
  }
}

// The whole sound of `file` at its own sample rate (at most 2 channels), or null if it has none.
export async function decodeFileAudio(file: Blob): Promise<AudioBuffer | null> {
  let mb: typeof import('mediabunny');
  try {
    mb = await import('mediabunny');
  } catch {
    return fallback(file);
  }
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack().catch(() => null);
    if (!track) return (await input.getPrimaryVideoTrack().catch(() => null)) ? null : fallback(file); // video without sound
    if (!(await track.canDecode())) return fallback(file);
    const sr = track.sampleRate, ch = Math.min(2, track.numberOfChannels);
    const dur = await track.computeDuration();
    const len = Math.ceil((dur + 0.5) * sr);
    const out = Array.from({ length: ch }, () => new Float32Array(len));
    let end = 0;
    for await (const { buffer, timestamp } of new mb.AudioBufferSink(track).buffers()) {
      const at = Math.max(0, Math.round(timestamp * sr));
      const chunk = Array.from({ length: Math.min(ch, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
      end = Math.max(end, at + place(out, chunk, at));
    }
    if (!end) return null;
    const res = new AudioBuffer({ length: end, numberOfChannels: ch, sampleRate: sr });
    out.forEach((d, c) => res.copyToChannel(d.subarray(0, end) as Float32Array<ArrayBuffer>, c));
    return res;
  } catch {
    return fallback(file);
  }
}

// Mono at `rate` (Whisper wants 16 kHz, RNNoise 48 kHz), resampled by the browser.
export async function decodeMono(file: Blob, rate: number): Promise<Float32Array | null> {
  const buf = await decodeFileAudio(file);
  if (!buf) return null;
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(ctx.destination); // stereo is mixed down to mono by the destination
  s.start();
  return (await ctx.startRendering()).getChannelData(0);
}
