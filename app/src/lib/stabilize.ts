// Video stabilization (translation only): measure how the whole picture moves from frame to frame on small
// greyscale copies, smooth that camera path, and shift each frame by the difference so only the smooth
// motion is left. The frame is zoomed in a little so the shifted edges never show. Rotation isn't corrected.

// Per strip, in Fx: corrections sampled `fps` times a second from sequence time `t0`, as fractions of the
// frame (x of width, y of height), and the zoom that hides the edges.
export type Stab = { t0: number; fps: number; x: number[]; y: number[]; zoom: number };
export const STAB_FPS = 15;
export const STAB_W = 160; // analysis width in px

// How far the picture content moved from frame a to frame b, (dx, dy) in px: b(x + dx, y + dy) ≈ a(x, y). Coarse-to-fine block matching on
// the centre of the frame (mean absolute difference), so it's robust and cheap. a, b: greyscale w×h.
export function shiftOf(a: Uint8Array | Float32Array, b: Uint8Array | Float32Array, w: number, h: number, max = 16): [number, number] {
  // Half-size copies for the coarse search.
  const half = (src: Uint8Array | Float32Array, W: number, H: number) => {
    const w2 = W >> 1, h2 = H >> 1, out = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const i = 2 * y * W + 2 * x;
      out[y * w2 + x] = (src[i] + src[i + 1] + src[i + W] + src[i + W + 1]) / 4;
    }
    return out;
  };
  const cost = (A: ArrayLike<number>, B: ArrayLike<number>, W: number, H: number, dx: number, dy: number, m: number) => {
    let s = 0, n = 0;
    const step = W > 100 ? 2 : 1;
    for (let y = m; y < H - m; y += step) for (let x = m; x < W - m; x += step) {
      s += Math.abs(A[y * W + x] - B[(y + dy) * W + (x + dx)]);
      n++;
    }
    return s / (n || 1);
  };
  const search = (A: ArrayLike<number>, B: ArrayLike<number>, W: number, H: number, cx: number, cy: number, r: number, m: number): [number, number] => {
    let best = Infinity, bx = cx, by = cy;
    for (let dy = cy - r; dy <= cy + r; dy++) for (let dx = cx - r; dx <= cx + r; dx++) {
      if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
      const c = cost(A, B, W, H, dx, dy, m);
      if (c < best - 1e-9) ((best = c), (bx = dx), (by = dy));
    }
    return [bx, by];
  };
  const m2 = Math.ceil(max / 2) + 1;
  const [cx, cy] = search(half(a, w, h), half(b, w, h), w >> 1, h >> 1, 0, 0, Math.ceil(max / 2), m2);
  return search(a, b, w, h, cx * 2, cy * 2, 2, max + 2);
}

// Gaussian smoothing (sigma in samples). Past the ends the path is point-reflected (2·end − mirror), so a
// steady pan stays exactly a straight line instead of bending at the start and end of the strip.
export function smoothPath(p: number[], sigma: number): number[] {
  if (sigma <= 0 || p.length < 3) return p.slice();
  const r = Math.ceil(sigma * 3), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return p.map((_, i) => {
    let s = 0, t = 0;
    for (let j = -r; j <= r; j++) {
      const q = i + j, L = p.length - 1;
      const v = q < 0 ? 2 * p[0] - p[Math.min(L, -q)] : q > L ? 2 * p[L] - p[Math.max(0, 2 * L - q)] : p[q];
      s += v * k[j + r];
      t += k[j + r];
    }
    return s / t;
  });
}

// From frame-to-frame shifts (px at analysis size) to corrections. strength 0..1: how much of the shake goes
// (it sets the smoothing window: up to ~1.5 s). Corrections are capped at maxShift (fraction of the frame).
export function planStab(shifts: [number, number][], w: number, h: number, fps: number, t0: number, strength = 0.7, maxShift = 0.08): Stab {
  const px: number[] = [0], py: number[] = [0];
  for (const [dx, dy] of shifts) (px.push(px.at(-1)! + dx), py.push(py.at(-1)! + dy));
  const sigma = Math.max(1, strength * fps * 0.5);
  const sx = smoothPath(px, sigma), sy = smoothPath(py, sigma);
  const clamp = (v: number) => Math.max(-maxShift, Math.min(maxShift, v));
  // The frame moved by p; move it back by (p - smooth) so it follows the smooth path.
  const x = px.map((v, i) => clamp((sx[i] - v) / w)), y = py.map((v, i) => clamp((sy[i] - v) / h));
  const need = Math.max(0, ...x.map(Math.abs), ...y.map(Math.abs));
  return { t0, fps, x: x.map(round), y: y.map(round), zoom: round(1 + 2 * need + 0.01) };
}
const round = (v: number) => Math.round(v * 1e5) / 1e5;

// Correction at sequence time t (linear between samples).
export function stabAt(s: Stab, t: number): [number, number] {
  const f = Math.max(0, (t - s.t0) * s.fps), i = Math.floor(f), u = f - i;
  const at = (a: number[]) => (i >= a.length - 1 ? a[a.length - 1] ?? 0 : a[i] * (1 - u) + a[i + 1] * u);
  return [at(s.x), at(s.y)];
}

// Apply to a draw rect [x, y, w, h] on a W×H frame: zoom around the centre, then shift.
export function stabPlace(place: number[], W: number, H: number, s: Stab | undefined, t: number): number[] {
  if (!s) return place;
  const [cx, cy] = stabAt(s, t), k = s.zoom;
  const [x, y, w, h] = place;
  return [W / 2 + (x - W / 2) * k + cx * w * k, H / 2 + (y - H / 2) * k + cy * h * k, w * k, h * k];
}

// Greyscale copy of a frame at analysis size.
export function grey(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number): Uint8Array {
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  return g;
}
