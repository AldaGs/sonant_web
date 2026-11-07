// Silence detection straight from the audio, no transcript needed.
type Range = [number, number];

// Quiet stretches of `data` (mono samples at `sr`): 10 ms RMS windows below `thresholdDb` relative to
// the loudest window, lasting longer than `min` seconds, shrunk by `pad` on each side (none at the clip edges).
export function quietRanges(data: Float32Array, sr: number, thresholdDb = -35, min = 0.6, pad = 0.15): Range[] {
  const win = Math.max(1, Math.round(sr * 0.01));
  const n = Math.floor(data.length / win);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * win, e = j + win; j < e; j++) s += data[j] * data[j];
    rms[i] = Math.sqrt(s / win);
    if (rms[i] > peak) peak = rms[i];
  }
  if (peak === 0) return n ? [[0, data.length / sr]] : [];
  const floor = peak * 10 ** (thresholdDb / 20);
  const len = data.length / sr, out: Range[] = [];
  let from = -1;
  for (let i = 0; i <= n; i++) {
    const quiet = i < n && rms[i] < floor;
    if (quiet && from < 0) from = i;
    else if (!quiet && from >= 0) {
      const a = (from * win) / sr, b = i === n ? len : (i * win) / sr;
      const lo = a > 0 ? a + pad : 0, hi = b < len ? b - pad : len;
      if (b - a > min && hi - lo > 0.05) out.push([lo, hi]);
      from = -1;
    }
  }
  return out;
}

// Decode a file's audio (mono, 16 kHz is plenty for loudness) and find its quiet ranges.
export async function fileSilences(file: File, thresholdDb: number, min: number, pad: number): Promise<Range[]> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    return quietRanges(buf.getChannelData(0), buf.sampleRate, thresholdDb, min, pad);
  } finally {
    ctx.close();
  }
}
