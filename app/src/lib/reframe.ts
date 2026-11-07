// Fitting a video into a frame of another shape (e.g. 16:9 footage on a 9:16 canvas): scale to cover,
// then slide the picture so the focus point (0..1 of the source) sits as close to centre as the edges allow.
export type Focus = { x: number; y: number };

export function coverPlace(W: number, H: number, sw: number, sh: number, focus?: Focus): [number, number, number, number] {
  const k = Math.max(W / sw, H / sh), dw = sw * k, dh = sh * k;
  const fx = focus?.x ?? 0.5, fy = focus?.y ?? 0.5;
  const x = Math.min(0, Math.max(W - dw, W / 2 - fx * dw));
  const y = Math.min(0, Math.max(H - dh, H / 2 - fy * dh));
  return [x, y, dw, dh];
}

// Robust middle of a few samples (ignores a frame where the person was missed).
export const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0.5;
};
