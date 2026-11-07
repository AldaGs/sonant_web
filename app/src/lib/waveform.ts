// Audio peaks for the timeline waveform, plus ruler tick spacing.

// ponytail: decodes the audio a second time (transcribe decodes too); share the buffer if load time matters
export async function audioPeaks(file: File, bins = 4000): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 8000 });
  try {
    const data = (await ctx.decodeAudioData(await file.arrayBuffer())).getChannelData(0);
    return peaksOf(data, bins);
  } finally {
    ctx.close();
  }
}

// Max absolute sample per bin, normalised so the loudest bin is 1.
export function peaksOf(data: Float32Array, bins: number): Float32Array {
  const out = new Float32Array(bins);
  const per = data.length / bins;
  let max = 0;
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = Math.floor(b * per), end = Math.floor((b + 1) * per); i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > m) m = v;
    }
    out[b] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let b = 0; b < bins; b++) out[b] /= max;
  return out;
}

// Smallest "nice" tick step (seconds) that keeps labels at least `minPx` apart.
const STEPS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
export function tickStep(totalSeconds: number, widthPx: number, minPx = 70): number {
  const pxPerSec = widthPx / Math.max(totalSeconds, 0.001);
  return STEPS.find((s) => s * pxPerSec >= minPx) ?? STEPS[STEPS.length - 1];
}
