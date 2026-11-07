// User-facing messages are i18n keys (see i18n.svelte.ts); the UI translates them.
import type { In, Out } from './whisper.worker';
import type { Word } from './captions';
import { gpuFor } from './perf';

let worker: Worker | null = null;

// Decode the video's audio track to 16 kHz mono, which Whisper expects.
// ponytail: decodes the whole file in memory; stream via WebCodecs if multi-GB files matter
async function decodeAudio(file: File): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    return buf.getChannelData(0);
  } finally {
    ctx.close();
  }
}

export async function transcribe(
  file: File,
  language: In['language'],
  onStatus: (s: string, pct: number) => void,
): Promise<Word[]> {
  onStatus('st.reading', 0);
  let audio: Float32Array;
  try {
    audio = await decodeAudio(file);
  } catch {
    throw new Error('err.noAudio');
  }
  worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker!.onmessage = ({ data }: MessageEvent<Out>) => {
      if (data.type === 'loading') onStatus('st.download', data.progress);
      else if (data.type === 'progress') onStatus('st.transcribing', data.progress);
      else if (data.type === 'done') resolve(data.words);
      else reject(new Error(data.message));
    };
    worker!.postMessage({ audio, language, gpu: gpuFor.whisper() } satisfies In, [audio.buffer]);
  });
}
