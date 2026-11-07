// Audio helpers: auto-ducking under speech, and loudness measurement (ITU-R BS.1770 / EBU R128).
type Range = [number, number];

// Speech as time ranges: words merged when the gap between them is under `join` seconds.
export function speechRanges(words: { start: number; end: number }[], join = 0.4): Range[] {
  const out: Range[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && w.start - last[1] <= join) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

// Gain for ducked music at time t: `level` during speech, 1 elsewhere, with linear fades of `fade`
// seconds that finish as speech starts and begin as it ends.
export function duckGain(ranges: Range[], t: number, level: number, fade = 0.25): number {
  let g = 1;
  for (const [a, b] of ranges) {
    if (t < a - fade) break; // sorted: nothing later can affect t
    if (t > b + fade) continue;
    const k = t < a ? (a - t) / fade : t > b ? (t - b) / fade : 0; // 0 = fully ducked, 1 = not
    g = Math.min(g, level + (1 - level) * k);
  }
  return g;
}

// ---- Loudness ----
// Biquad (direct form I) applied in place.
function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
// K-weighting filter coefficients for any sample rate (from the BS.1770 reference design).
function kWeight(x: Float32Array, sr: number): Float32Array {
  // Stage 1: high shelf (+4 dB above ~1.7 kHz).
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // Stage 2: high pass (~38 Hz).
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

// Integrated loudness in LUFS of 1–2 channels (gated, 400 ms blocks, 75% overlap). -Infinity for silence.
export function lufs(channels: Float32Array[], sr: number): number {
  const block = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const w = channels.map((c) => kWeight(c, sr));
  const n = w[0].length;
  const z: number[] = [];
  for (let s = 0; s + block <= n; s += hop) {
    let sum = 0;
    for (const c of w) {
      let m = 0;
      for (let i = s; i < s + block; i++) m += c[i] * c[i];
      sum += m / block;
    }
    z.push(sum);
  }
  const L = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = z.filter((p) => L(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => L(p) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

// Gain that brings `channels` to `target` LUFS without letting peaks pass `ceiling` (linear, ~-1 dBFS).
export function normalizeGain(channels: Float32Array[], sr: number, target = -14, ceiling = 0.89): number {
  const l = lufs(channels, sr);
  if (!Number.isFinite(l)) return 1;
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  return Math.min(10 ** ((target - l) / 20), peak ? ceiling / peak : 1);
}
