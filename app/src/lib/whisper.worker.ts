import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { Word } from './captions';

export type In = { audio: Float32Array; language: 'english' | 'spanish' | null };
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

function load() {
  const gpu = 'gpu' in navigator;
  return (asr ??= pipeline('automatic-speech-recognition', MODEL, {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: any) => p.status === 'progress_total' && post({ type: 'loading', progress: p.progress }),
  }) as Promise<AutomaticSpeechRecognitionPipeline>);
}

onmessage = async ({ data }: MessageEvent<In>) => {
  try {
    const model = await load();
    const words: Word[] = [];
    // ponytail: hard 30s windows, a word spanning a boundary can be split; use stride + merge if users notice
    for (let off = 0; off < data.audio.length; off += CHUNK) {
      post({ type: 'progress', progress: (off / data.audio.length) * 100 });
      const r: any = await model(data.audio.subarray(off, off + CHUNK), {
        return_timestamps: 'word',
        task: 'transcribe',
        ...(data.language && { language: data.language }),
      });
      const t0 = off / SR;
      for (const c of r.chunks ?? []) {
        const text = c.text.trim();
        if (text) words.push({ text, start: t0 + c.timestamp[0], end: t0 + (c.timestamp[1] ?? c.timestamp[0]) });
      }
    }
    post({ type: 'done', words });
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
