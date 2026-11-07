// Speaker fingerprints (WeSpeaker ResNet34, trained on VoxCeleb; the embedding model pyannote uses), ~26 MB.
import { AutoModel, AutoProcessor, type PreTrainedModel, type Processor } from '@huggingface/transformers';

export type In = { pieces: Float32Array[]; gpu: boolean };
export type Out =
  | { type: 'loading'; progress: number }
  | { type: 'progress'; progress: number }
  | { type: 'done'; embeddings: Float32Array[] }
  | { type: 'error'; message: string };
const post = (m: Out, t: Transferable[] = []) => postMessage(m, { transfer: t });

const MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
let loaded: Promise<[Processor, PreTrainedModel]> | null = null, loadedGpu: boolean | null = null;

function load(gpu: boolean) {
  if (loadedGpu !== gpu) ((loaded = null), (loadedGpu = gpu));
  const progress_callback = (p: { status: string; progress?: number }) =>
    p.status === 'progress_total' && p.progress !== undefined && post({ type: 'loading', progress: p.progress });
  return (loaded ??= Promise.all([
    AutoProcessor.from_pretrained(MODEL, { progress_callback }),
    AutoModel.from_pretrained(MODEL, { device: gpu ? 'webgpu' : 'wasm', dtype: 'fp32', progress_callback }),
  ]));
}

onmessage = async ({ data }: MessageEvent<In>) => {
  try {
    const [processor, model] = await load(data.gpu && 'gpu' in navigator);
    const out: Float32Array[] = [];
    for (const [i, p] of data.pieces.entries()) {
      if (i % 10 === 0) post({ type: 'progress', progress: (i / data.pieces.length) * 100 });
      const inputs = await processor(p);
      const { embeddings } = await model(inputs);
      out.push(Float32Array.from(embeddings.data as Float32Array));
    }
    post({ type: 'done', embeddings: out }, out.map((e) => e.buffer));
  } catch (e) {
    loaded = null;
    post({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
