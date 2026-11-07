// Beat tracking for music: onset envelope → tempo by autocorrelation → the beat grid that best fits the onsets.
// Good on music with a steady pulse (pop, hip-hop, EDM); free-tempo music gives a rougher grid.
const HOP = 512;

// Onset strength per hop: positive change of log energy (sharp attacks score high).
function onsets(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) s += x[j] * x[j];
    e[i] = Math.log1p(1000 * s / HOP);
  }
  const o = new Float32Array(n);
  for (let i = 1; i < n; i++) o[i] = Math.max(0, e[i] - e[i - 1]);
  return o;
}

export function detectBeats(x: Float32Array, sr: number, minBpm = 70, maxBpm = 180): { bpm: number; times: number[] } {
  const o = onsets(x), fps = sr / HOP;
  if (o.length < fps * 2) return { bpm: 0, times: [] };
  // Tempo: the lag (in hops) whose autocorrelation is strongest, mildly favouring ~120 BPM.
  let best = 0, lag = 0;
  for (let l = Math.floor((60 / maxBpm) * fps); l <= Math.ceil((60 / minBpm) * fps); l++) {
    let s = 0;
    for (let i = l; i < o.length; i++) s += o[i] * o[i - l];
    const bpm = (60 * fps) / l;
    s *= Math.exp(-0.5 * Math.log2(bpm / 120) ** 2); // prior
    if (s > best) ((best = s), (lag = l));
  }
  if (!lag) return { bpm: 0, times: [] };
  // Refine the period (fractional hops), then pick the phase whose grid lands on the most onset energy.
  let period = lag, top = -1;
  for (let p = lag - 1; p <= lag + 1; p += 0.05) {
    let s = 0;
    for (let k = 1; k * p < o.length; k++) s += o[Math.round(k * p)] ?? 0;
    if (s > top) ((top = s), (period = p));
  }
  let phase = 0;
  top = -1;
  for (let ph = 0; ph < period; ph += 0.25) {
    let s = 0;
    for (let t = ph; t < o.length; t += period) s += o[Math.round(t)] ?? 0;
    if (s > top) ((top = s), (phase = ph));
  }
  // Walk the grid, nudging each beat onto the strongest nearby onset so small tempo drift doesn't accumulate.
  const times: number[] = [];
  const w = Math.max(1, Math.round(period * 0.15));
  let mean = 0;
  for (const v of o) mean += v / o.length;
  for (let t = phase; t < o.length; ) {
    const c = Math.round(t);
    let at = c;
    for (let i = Math.max(0, c - w); i <= Math.min(o.length - 1, c + w); i++) if (o[i] > o[at]) at = i;
    const beatAt = o[at] > mean * 2 ? at : t; // weak onset: keep the grid position
    times.push((beatAt * HOP) / sr);
    t = beatAt + period;
  }
  return { bpm: Math.round(((60 * fps) / period) * 10) / 10, times };
}

// Decode a file and track its beats (mono mix-down). Times are in the file's own time.
export async function beatsOfFile(f: File): Promise<{ bpm: number; times: number[] }> {
  const ctx = new OfflineAudioContext(1, 1, 22050);
  const buf = await ctx.decodeAudioData(await f.arrayBuffer());
  const x = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < x.length; i++) x[i] += d[i] / buf.numberOfChannels;
  }
  return detectBeats(x, buf.sampleRate);
}
