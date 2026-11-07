import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { Word } from './captions';

export type In = {
  audio: Float32Array;
  language: 'english' | 'spanish' | null;
  gpu: boolean;
}; // gpu: run on WebGPU
export type Out =
  | { type: 'loading'; progress: number }
  | { type: 'progress'; progress: number }
  | { type: 'done'; words: Word[] }
  | { type: 'error'; message: string };

const MODEL = 'onnx-community/whisper-base_timestamped';
const SR = 16000;
const CHUNK = 30 * SR;
const post = (m: Out) => postMessage(m);

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

// q4 matmuls on Apple GPUs (Metal) give garbage: whisper then emits the same short token ("Y") over and over.
const apple = /Mac|iPhone|iPad/.test(navigator.userAgent);
let asrGpu: boolean | null = null;
function load(gpu: boolean) {
  if (asrGpu !== gpu) ((asr = null), (asrGpu = gpu)); // the setting changed: load the model for the other device
  return (asr ??= pipeline('automatic-speech-recognition', MODEL, {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: apple ? 'fp32' : 'q4' } : 'q8',
    progress_callback: (p: any) => p.status === 'progress_total' && post({ type: 'loading', progress: p.progress }),
  }) as Promise<AutomaticSpeechRecognitionPipeline>);
}

// GPU output that is clearly broken: almost no words for the audio's length, or one word repeated.
export function degenerate(words: Word[], seconds: number): boolean {
  if (seconds < 10) return false;
  if (words.length < seconds / 10) return true;
  const n = new Set(words.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))).size;
  return words.length >= 8 && n <= 2;
}

async function run(audio: Float32Array, language: In['language'], gpu: boolean): Promise<Word[]> {
  const model = await load(gpu);
  const words: Word[] = [];
  // ponytail: hard 30s windows, a word spanning a boundary can be split; use stride + merge if users notice
  for (let off = 0; off < audio.length; off += CHUNK) {
    post({ type: 'progress', progress: (off / audio.length) * 100 });
    const r: any = await model(audio.subarray(off, off + CHUNK), {
      return_timestamps: 'word',
      task: 'transcribe',
      ...(language && { language }),
    });
    const t0 = off / SR;
    for (const c of r.chunks ?? []) {
      const text = c.text.trim();
      if (text)
        words.push({
          text,
          start: t0 + c.timestamp[0],
          end: t0 + (c.timestamp[1] ?? c.timestamp[0]),
        });
    }
  }
  return words;
}

onmessage = async ({ data }: MessageEvent<In>) => {
  try {
    const gpu = data.gpu && 'gpu' in navigator;
    let words = await run(data.audio, data.language, gpu);
    // A GPU driver bug shouldn't cost the user their captions: redo it on the CPU (slower, but reliable).
    if (gpu && degenerate(words, data.audio.length / SR)) words = await run(data.audio, data.language, false);
    post({ type: 'done', words });
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
