// Kokoro TTS in a worker, so generating speech never freezes the editor.
export type In = { id: number; text: string; voice: string; speed: number; gpu: boolean };
export type Out =
  | { id: number; type: 'loading'; progress: number }
  | { id: number; type: 'done'; audio: Float32Array; sr: number }
  | { id: number; type: 'error'; message: string };

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
type Tts = Awaited<ReturnType<typeof import('kokoro-js').KokoroTTS.from_pretrained>>;
let tts: Promise<Tts> | null = null;

onmessage = async ({ data }: MessageEvent<In>) => {
  const post = (m: Out, t: Transferable[] = []) => postMessage(m, { transfer: t });
  try {
    const { KokoroTTS } = await import('kokoro-js');
    tts ??= KokoroTTS.from_pretrained(MODEL, {
      // WebGPU wants full precision; on the CPU the 8-bit model is ~4× smaller and faster.
      dtype: data.gpu ? 'fp32' : 'q8',
      device: data.gpu ? 'webgpu' : 'wasm',
      progress_callback: (p: { status: string; progress?: number }) =>
        p.status === 'progress' && p.progress !== undefined && post({ id: data.id, type: 'loading', progress: p.progress }),
    });
    const audio = await (await tts).generate(data.text, { voice: data.voice as never, speed: data.speed });
    const a = audio.audio as Float32Array;
    post({ id: data.id, type: 'done', audio: a, sr: audio.sampling_rate }, [a.buffer]);
  } catch (e) {
    tts = null; // let the next try load again (e.g. after the network comes back)
    post({ id: data.id, type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
