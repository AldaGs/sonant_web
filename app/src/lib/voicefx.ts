// Voice changer for Music & VO items: rendered once into a new audio file, so preview and export match.
import { stretch } from './stretch.ts';

export const VOICE_FX = ['deep', 'high', 'chipmunk', 'robot', 'radio', 'phone'] as const;
export type VoiceFx = (typeof VOICE_FX)[number];

// Pitch shift by `semis` semitones, same length: time-stretch by the pitch ratio, then resample back.
export function pitchShift(x: Float32Array, semis: number): Float32Array {
  const r = 2 ** (semis / 12);
  if (Math.abs(r - 1) < 1e-3) return x.slice();
  const long = stretch([x], 1 / r)[0]; // r× longer, same pitch
  const out = new Float32Array(x.length);
  for (let i = 0; i < out.length; i++) {
    const p = i * r, j = Math.floor(p), f = p - j;
    out[i] = (long[j] ?? 0) * (1 - f) + (long[j + 1] ?? 0) * f; // linear resample: r× faster → pitch × r
  }
  return out;
}

// One-pole filters, enough for telephone/radio colouring.
function highpass(x: Float32Array, sr: number, hz: number) {
  const a = 1 / (1 + (2 * Math.PI * hz) / sr), y = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) y[i] = a * (y[i - 1] + x[i] - x[i - 1]);
  return y;
}
function lowpass(x: Float32Array, sr: number, hz: number) {
  const k = 1 - Math.exp((-2 * Math.PI * hz) / sr), y = new Float32Array(x.length);
  let v = 0;
  for (let i = 0; i < x.length; i++) y[i] = v += k * (x[i] - v);
  return y;
}
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// Keep the level about where it was.
function match(y: Float32Array, ref: Float32Array) {
  const p = peak(y), q = peak(ref);
  if (p > 0 && q > 0) for (let i = 0; i < y.length; i++) y[i] *= q / p;
  return y;
}

export function applyVoiceFx(x: Float32Array, sr: number, fx: VoiceFx): Float32Array {
  switch (fx) {
    case 'deep': return pitchShift(x, -4);
    case 'high': return pitchShift(x, 4);
    case 'chipmunk': return pitchShift(x, 9);
    case 'robot': {
      // Ring modulation at 60 Hz plus a little of the dry voice: the classic metallic robot.
      const y = new Float32Array(x.length);
      for (let i = 0; i < x.length; i++) y[i] = x[i] * (0.25 + 0.75 * Math.sin((2 * Math.PI * 60 * i) / sr));
      return match(y, x);
    }
    case 'radio': {
      const y = lowpass(highpass(x, sr, 400), sr, 3000);
      for (let i = 0; i < y.length; i++) y[i] = Math.tanh(y[i] * 4) / 2; // warm saturation
      return match(y, x);
    }
    case 'phone': return match(lowpass(lowpass(highpass(highpass(x, sr, 500), sr, 500), sr, 2800), sr, 2800), x);
  }
}
