// RNNoise in a worker: the WASM build (~5 MB) only loads when noise reduction is first used.
import { denoiseChannel } from './denoise.ts';

export type In = { channels: Float32Array[]; mix: number };
export type Out = { type: 'progress'; progress: number } | { type: 'done'; channels: Float32Array[] } | { type: 'error'; message: string };
const post = (m: Out, t: Transferable[] = []) => postMessage(m, { transfer: t });

let rn: Promise<import('@shiguredo/rnnoise-wasm').Rnnoise> | null = null;

onmessage = async ({ data }: MessageEvent<In>) => {
  try {
    const { Rnnoise } = await import('@shiguredo/rnnoise-wasm');
    const model = await (rn ??= Rnnoise.load());
    const out: Float32Array[] = [];
    for (const [c, x] of data.channels.entries()) {
      const st = model.createDenoiseState();
      let done = 0;
      try {
        out.push(denoiseChannel(x, model.frameSize, (f) => {
          st.processFrame(f);
          if ((done += f.length) % (48000 * 5) < f.length) post({ type: 'progress', progress: ((c + done / x.length) / data.channels.length) * 100 });
        }, data.mix));
      } finally {
        st.destroy();
      }
    }
    post({ type: 'done', channels: out }, out.map((c) => c.buffer));
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
