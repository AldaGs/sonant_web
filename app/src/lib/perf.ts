// Device performance settings, shared by every project on this browser (localStorage).
// accel: 'auto' uses the GPU where the browser offers it, 'gpu' prefers it, 'cpu' never uses it
// (for weak or buggy graphics drivers, or to keep a laptop cool).
// keyRes: longest side, in px, chroma key works at per frame. 0 = full size.

export type Accel = 'auto' | 'gpu' | 'cpu';
export type Perf = { accel: Accel; keyRes: number };
const KEY = 'sonant.perf';
export const KEY_RES = [0, 1920, 1280, 720] as const;

function load(): Perf {
  const d: Perf = { accel: 'auto', keyRes: 0 };
  try {
    const s = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
    if (['auto', 'gpu', 'cpu'].includes(s.accel)) d.accel = s.accel;
    if (KEY_RES.includes(s.keyRes)) d.keyRes = s.keyRes;
  } catch {}
  return d;
}

export const perf: Perf = load();
const listeners = new Set<() => void>();
export function setPerf(p: Partial<Perf>) {
  Object.assign(perf, p);
  try { localStorage.setItem(KEY, JSON.stringify(perf)); } catch {}
  for (const f of listeners) f();
}
export const onPerf = (f: () => void) => (listeners.add(f), () => listeners.delete(f));

// What this device offers.
export const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator;
let gl2: boolean | null = null;
export function hasWebGL2(): boolean {
  if (gl2 === null) {
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      gl2 = !!c.getContext('webgl2');
    } catch { gl2 = false; }
  }
  return gl2;
}
// Name of the graphics chip, when the browser tells (it often only gives the vendor).
export function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return (ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER)) ?? '';
  } catch { return ''; }
}

// A "GPU" that is really the CPU (software rendering): slower than our CPU paths, so Auto skips it.
export const isSoftware = (name: string) => /swiftshader|llvmpipe|softpipe|basic render|software/i.test(name);
let soft: boolean | null = null;
const softwareGpu = () => (soft ??= typeof document !== 'undefined' && isSoftware(gpuName()));
// Use the GPU? 'gpu' always (where the API exists), 'cpu' never, 'auto' unless the GPU is software-only.
const useGpu = () => perf.accel === 'gpu' || (perf.accel === 'auto' && !softwareGpu());

// Decisions per feature.
export const gpuFor = {
  whisper: () => useGpu() && hasWebGPU(), // WebGPU; WASM otherwise
  segmenter: () => useGpu(), // MediaPipe GPU delegate (falls back to CPU by itself)
  key: () => useGpu() && hasWebGL2(), // chroma key shader; CPU otherwise
};
// Chroma key working size: the setting, or on Auto a cap that keeps the CPU path smooth.
export const keyCap = () => perf.keyRes || (gpuFor.key() ? Infinity : 1280);
