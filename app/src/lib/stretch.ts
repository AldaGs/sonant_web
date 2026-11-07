// Time-stretch audio without changing pitch (WSOLA: overlap-add of windowed grains, each one nudged to
// line up with the previous grain's waveform). rate 2 = twice as fast, half as long.
const FRAME = 2048, HOP = 512, SEEK = 256;

function hann(n: number) {
  return Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
}
const WIN = hann(FRAME);

// Stretch every channel the same way (alignment comes from the mix-down, so stereo stays coherent).
export function stretch(channels: Float32Array[], rate: number): Float32Array[] {
  if (Math.abs(rate - 1) < 1e-3) return channels.map((c) => c.slice());
  const n = channels[0].length, outLen = Math.max(1, Math.round(n / rate));
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  const out = channels.map(() => new Float32Array(outLen + FRAME));
  const norm = new Float32Array(outLen + FRAME);
  let prev = 0; // where the previous grain was taken from
  for (let o = 0; o < outLen; o += HOP) {
    const ideal = Math.round(o * rate);
    // Best offset near `ideal`: the grain that continues the previous one most smoothly.
    let pos = ideal;
    if (o > 0) {
      const want = prev + HOP;
      let best = -Infinity;
      for (let d = -SEEK; d <= SEEK; d += 4) {
        const p = ideal + d;
        if (p < 0 || p + FRAME > n) continue;
        let c = 0;
        for (let i = 0; i < FRAME; i += 8) c += mono[p + i] * (mono[want + i] ?? 0);
        if (c > best) ((best = c), (pos = p));
      }
    }
    pos = Math.max(0, Math.min(n - 1, pos));
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch], dst = out[ch];
      for (let i = 0; i < FRAME && pos + i < n; i++) dst[o + i] += src[pos + i] * WIN[i];
    }
    for (let i = 0; i < FRAME; i++) norm[o + i] += WIN[i];
    prev = pos;
  }
  return out.map((c) => {
    const r = c.subarray(0, outLen);
    for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) r[i] /= norm[i];
    return r.slice();
  });
}
