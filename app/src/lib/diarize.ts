// Automatic speaker detection: a voice fingerprint (WeSpeaker ResNet34 embedding) per caption, then the
// captions are grouped by how alike their voices sound. Runs on the device, in a worker.
// The grouping is pure and lives here; the model lives in diarize.worker.ts.
import type { Caption } from './captions.ts';

export const MIN_SPAN = 1.0; // s of audio per caption at least (short ones are widened around their middle)

export const cosine = (a: Float32Array, b: Float32Array) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) ((d += a[i] * b[i]), (x += a[i] * a[i]), (y += b[i] * b[i]));
  return d / (Math.sqrt(x * y) || 1);
};

// Average-linkage agglomerative clustering on cosine similarity.
// k: wanted number of speakers; without it, merging stops when the closest groups are less alike than `threshold`.
// weights: how much each item counts (e.g. seconds of speech), so long captions shape the groups more.
// Returns a group per item, numbered in order of first appearance.
export function cluster(emb: Float32Array[], { k, threshold = 0.5, weights }: { k?: number; threshold?: number; weights?: number[] } = {}): number[] {
  const n = emb.length;
  if (!n) return [];
  const w = weights ?? emb.map(() => 1);
  let groups = emb.map((_, i) => [i]);
  // Pairwise similarities between groups (average linkage, weighted).
  const sim = emb.map((a) => emb.map((b) => cosine(a, b)));
  const gsim = (g: number[], h: number[]) => {
    let s = 0, t = 0;
    for (const i of g) for (const j of h) ((s += sim[i][j] * w[i] * w[j]), (t += w[i] * w[j]));
    return s / (t || 1);
  };
  while (groups.length > 1) {
    let best = -Infinity, bi = 0, bj = 1;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const s = gsim(groups[i], groups[j]);
        if (s > best) ((best = s), (bi = i), (bj = j));
      }
    if (k ? groups.length <= k : best < threshold) break;
    groups = groups.filter((_, i) => i !== bj).map((g, i) => (i === bi ? [...g, ...groups[bj]] : g));
  }
  const label = new Array<number>(n);
  groups.sort((a, b) => Math.min(...a) - Math.min(...b)).forEach((g, gi) => g.forEach((i) => (label[i] = gi)));
  return label;
}

// Very short captions ("Yes.") have unreliable fingerprints: after clustering, a caption under `min` seconds
// takes the speaker of its neighbours when both neighbours agree.
export function smooth(labels: number[], spans: number[], min = 0.8): number[] {
  return labels.map((l, i) => (spans[i] < min && i > 0 && i < labels.length - 1 && labels[i - 1] === labels[i + 1] ? labels[i - 1] : l));
}

// Audio window (sequence time) to fingerprint for a caption.
export function spanOf(c: Caption): [number, number] {
  const a = c.words[0].start, b = c.words[c.words.length - 1].end;
  if (b - a >= MIN_SPAN) return [a, b];
  const m = (a + b) / 2;
  return [Math.max(0, m - MIN_SPAN / 2), m + MIN_SPAN / 2];
}

// Captions with speakers from the labels; the speaker list grows to fit, keeping names already given.
export function applySpeakers(caps: Caption[], ids: string[], labels: number[], names: string[]): { captions: Caption[]; speakers: string[] } {
  const by = new Map(ids.map((id, i) => [id, labels[i]]));
  const n = labels.length ? Math.max(...labels) + 1 : 0;
  return {
    captions: caps.map((c) => (by.has(c.id) ? { ...c, speaker: by.get(c.id) } : c)),
    speakers: Array.from({ length: Math.max(n, names.length) }, (_, i) => names[i] ?? ''),
  };
}

// ---- Browser side ----
import type { In, Out } from './diarize.worker.ts';
let worker: Worker | null = null;

// Fingerprints for audio pieces (16 kHz mono).
export function embed(pieces: Float32Array[], gpu: boolean, onStatus: (s: string, pct: number) => void): Promise<Float32Array[]> {
  worker ??= new Worker(new URL('./diarize.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker!.onmessage = ({ data }: MessageEvent<Out>) => {
      if (data.type === 'loading') onStatus('st.spkDownload', data.progress);
      else if (data.type === 'progress') onStatus('st.spkListening', data.progress);
      else if (data.type === 'done') resolve(data.embeddings);
      else reject(new Error(data.message));
    };
    worker!.postMessage({ pieces, gpu } satisfies In, pieces.map((p) => p.buffer));
  });
}
