import type { ImageSegmenter } from '@mediapipe/tasks-vision';

// Person segmentation (MediaPipe selfie segmenter) for "captions behind the subject".
// Wasm + model come from CDNs on first use, so the app doesn't load them until a clip needs them.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let seg: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;

export function loadSegmenter(): Promise<void> {
  return (loading ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    });
    seg = await make('GPU').catch(() => make('CPU'));
  })().catch((e) => ((loading = null), Promise.reject(e))));
}

// The model works at 256px anyway, so segment a small copy and let the upscale soften the edges.
const small = new OffscreenCanvas(1, 1), sctx = small.getContext('2d', { willReadFrequently: false })!;
const mask = new OffscreenCanvas(1, 1), mctx = mask.getContext('2d')!;
const person = new OffscreenCanvas(1, 1), pctx = person.getContext('2d')!;
let img: ImageData | null = null;

// Redraw only the person from `src` (placed at dx,dy,dw,dh) on top of whatever ctx already has.
// Returns false while the model is still loading (it starts loading on the first call).
export function drawSubject(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): boolean {
  if (!seg) {
    loadSegmenter().catch(() => {});
    return false;
  }
  const k = 256 / Math.max(sw, sh);
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  if (small.width !== w || small.height !== h) ((small.width = w), (small.height = h));
  sctx.drawImage(src, 0, 0, w, h);
  seg.segment(small, (r) => {
    const m = r.confidenceMasks?.[0];
    if (!m) return;
    const conf = m.getAsFloat32Array();
    if (mask.width !== m.width || mask.height !== m.height) ((mask.width = m.width), (mask.height = m.height), (img = null));
    img ??= mctx.createImageData(m.width, m.height);
    const px = img.data;
    // Remap confidence 0.3..0.7 → alpha 0..1: firmer edge, little halo.
    for (let i = 0; i < conf.length; i++) px[i * 4 + 3] = Math.max(0, Math.min(255, (conf[i] - 0.3) * 637.5));
    mctx.putImageData(img, 0, 0);
  });
  const W = ctx.canvas.width, H = ctx.canvas.height;
  if (person.width !== W || person.height !== H) ((person.width = W), (person.height = H));
  pctx.globalCompositeOperation = 'copy';
  pctx.drawImage(mask, dx, dy, dw, dh);
  pctx.globalCompositeOperation = 'source-in';
  pctx.drawImage(src, dx, dy, dw, dh);
  pctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(person, 0, 0);
  return true;
}
