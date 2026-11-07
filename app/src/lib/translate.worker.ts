import { pipeline, type TranslationPipeline } from '@huggingface/transformers';

export type Dir = 'en-es' | 'es-en';
export type In = { texts: string[]; dir: Dir };
export type Out =
  | { type: 'loading'; progress: number }
  | { type: 'progress'; progress: number }
  | { type: 'done'; texts: string[] }
  | { type: 'error'; message: string };

// Opus-MT (Marian) models: small, local, free. One per direction, loaded on first use.
const MODELS: Record<Dir, string> = { 'en-es': 'Xenova/opus-mt-en-es', 'es-en': 'Xenova/opus-mt-es-en' };
const post = (m: Out) => postMessage(m);
const loaded = new Map<Dir, Promise<TranslationPipeline>>();
const load = (dir: Dir) => {
  if (!loaded.has(dir))
    loaded.set(dir, pipeline('translation', MODELS[dir], {
      dtype: 'q8',
      progress_callback: (p: any) => p.status === 'progress_total' && post({ type: 'loading', progress: p.progress }),
    }) as Promise<TranslationPipeline>);
  return loaded.get(dir)!;
};

onmessage = async ({ data }: MessageEvent<In>) => {
  try {
    const model = await load(data.dir);
    const out: string[] = [];
    const BATCH = 8;
    for (let i = 0; i < data.texts.length; i += BATCH) {
      post({ type: 'progress', progress: (i / data.texts.length) * 100 });
      const r: any = await model(data.texts.slice(i, i + BATCH));
      for (const x of Array.isArray(r) ? r : [r]) out.push(String(x.translation_text ?? '').trim());
    }
    post({ type: 'done', texts: out });
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
