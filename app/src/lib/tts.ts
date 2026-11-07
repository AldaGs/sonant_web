// Text-to-speech voiceover, on the device. Two engines:
// - Kokoro (kokoro-js, Apache-2.0): best quality, English only, one ~90 MB model (q8) or ~330 MB (fp32 on WebGPU).
// - Piper (@mintplex-labs/piper-tts-web, MIT): English and Spanish, one 20–60 MB model per voice, fast on CPU.
// Both download on first use and are cached by the browser. Output is a WAV blob for the Music & VO track.
import { wav } from './denoise.ts';
import type { In, Out } from './tts.worker.ts';

export type Engine = 'kokoro' | 'piper';
export type Voice = { id: string; engine: Engine; name: string; lang: 'en' | 'es'; accent: string; gender: 'f' | 'm'; mb: number; best?: boolean };

// Kokoro voices with the best grades in its voice card (A to C), so every one sounds natural.
const K = (id: string, name: string, accent: string, gender: 'f' | 'm', best = false): Voice =>
  ({ id, engine: 'kokoro', name, lang: 'en', accent, gender, mb: 90, ...(best && { best }) });
// Piper: medium/high voices only (low / x_low sound robotic).
const P = (id: string, name: string, lang: 'en' | 'es', accent: string, gender: 'f' | 'm', mb: number, best = false): Voice =>
  ({ id, engine: 'piper', name, lang, accent, gender, mb, ...(best && { best }) });

export const VOICES: Voice[] = [
  K('af_heart', 'Heart', 'US', 'f', true), K('af_bella', 'Bella', 'US', 'f'), K('af_nicole', 'Nicole (whisper)', 'US', 'f'),
  K('af_sarah', 'Sarah', 'US', 'f'), K('am_michael', 'Michael', 'US', 'm', true), K('am_fenrir', 'Fenrir', 'US', 'm'), K('am_puck', 'Puck', 'US', 'm'),
  K('bf_emma', 'Emma', 'UK', 'f'), K('bm_george', 'George', 'UK', 'm'), K('bm_fable', 'Fable', 'UK', 'm'),
  P('en_US-hfc_female-medium', 'HFC female', 'en', 'US', 'f', 63), P('en_US-ryan-high', 'Ryan', 'en', 'US', 'm', 121),
  P('en_GB-alba-medium', 'Alba', 'en', 'UK', 'f', 63), P('en_GB-northern_english_male-medium', 'Northern English', 'en', 'UK', 'm', 63),
  P('es_MX-claude-high', 'Claude', 'es', 'MX', 'f', 63, true), P('es_MX-ald-medium', 'Ald', 'es', 'MX', 'm', 63),
  P('es_ES-sharvard-medium', 'Sharvard', 'es', 'ES', 'm', 77), P('es_ES-davefx-medium', 'Davefx', 'es', 'ES', 'm', 63),
];
export const voiceById = (id: string) => VOICES.find((v) => v.id === id);

// Default voice for a language: Kokoro for English when the device can run it fast (WebGPU), else Piper.
export function defaultVoice(lang: 'en' | 'es', fastGpu: boolean): Voice {
  if (lang === 'es') return voiceById('es_MX-claude-high')!;
  return fastGpu ? voiceById('af_heart')! : voiceById('en_US-hfc_female-medium')!;
}

// Text split for per-caption dubbing and long scripts: Kokoro reads up to ~500 characters well at a time.
export function chunks(text: string, max = 400): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?¡¿…])\s+/)) {
    if (cur && (cur + ' ' + s).length > max) (out.push(cur), (cur = ''));
    if (s.length > max) {
      // A very long sentence: break at commas or spaces.
      let rest = s;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max));
        const at = cut > max / 2 ? cut + 1 : max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      cur = rest;
    } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out;
}

// Join generated pieces with a short pause between them.
export function joinAudio(parts: Float32Array[], sr: number, gap = 0.12): Float32Array {
  const g = Math.round(gap * sr), n = parts.reduce((a, p) => a + p.length, 0) + g * Math.max(0, parts.length - 1);
  const out = new Float32Array(n);
  let o = 0;
  for (const [i, p] of parts.entries()) (out.set(p, o), (o += p.length + (i < parts.length - 1 ? g : 0)));
  return out;
}

// ---- Engines (browser only) ----
let kworker: Worker | null = null, kGpu: boolean | null = null, kid = 0;

async function kokoro(text: string, voice: string, speed: number, gpu: boolean, onStatus: (s: string, p: number) => void): Promise<{ audio: Float32Array; sr: number }> {
  if (kworker && kGpu !== gpu) (kworker.terminate(), (kworker = null)); // device setting changed
  kGpu = gpu;
  kworker ??= new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
  const id = ++kid;
  return new Promise((resolve, reject) => {
    const w = kworker!;
    const on = ({ data }: MessageEvent<Out>) => {
      if (data.id !== id) return;
      if (data.type === 'loading') onStatus('st.voiceDownload', data.progress);
      else if (data.type === 'done') (w.removeEventListener('message', on), resolve({ audio: data.audio, sr: data.sr }));
      else if (data.type === 'error') (w.removeEventListener('message', on), reject(new Error(data.message)));
    };
    w.addEventListener('message', on);
    w.postMessage({ id, text, voice, speed, gpu } satisfies In);
  });
}

async function piper(text: string, voice: string, onStatus: (s: string, p: number) => void): Promise<{ audio: Float32Array; sr: number }> {
  const tts = await import('@mintplex-labs/piper-tts-web');
  const blob = await tts.predict({ text, voiceId: voice }, (p) => p.total && onStatus('st.voiceDownload', (p.loaded / p.total) * 100));
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { audio: buf.getChannelData(0).slice(), sr: buf.sampleRate };
  } finally {
    ctx.close();
  }
}

// Speak `text` with a voice. speed: 0.5–2 (Kokoro only; Piper uses its natural pace).
export async function speak(text: string, voiceId: string, opts: { speed?: number; gpu: boolean },
  onStatus: (s: string, pct: number) => void): Promise<{ audio: Float32Array; sr: number }> {
  const v = voiceById(voiceId);
  if (!v) throw new Error('err.voice');
  const parts: Float32Array[] = [];
  let sr = 24000;
  const list = chunks(text);
  for (const [i, c] of list.entries()) {
    onStatus('st.speaking', (i / list.length) * 100);
    const r = v.engine === 'kokoro' ? await kokoro(c, v.id, opts.speed ?? 1, opts.gpu, onStatus) : await piper(c, v.id, onStatus);
    parts.push(r.audio);
    sr = r.sr;
  }
  return { audio: joinAudio(parts, sr), sr };
}

// Dubbing: how much faster a line must play to fit its slot (1 = fits already), capped so speech stays clear.
export const fitRate = (dur: number, slot: number, max = 1.5) => (slot > 0 && dur > slot ? Math.min(max, dur / slot) : 1);
// The time a caption's dub may take: until the next caption starts (or its own length plus a little).
export function dubSlots(starts: number[], ends: number[]): number[] {
  return starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1] - s : ends[i] - s + 0.5) - 0.05);
}

export const toWav = (audio: Float32Array, sr: number) => wav([audio], sr);
