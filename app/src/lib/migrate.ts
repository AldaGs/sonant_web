// Projects saved before every track worked the same (doc version 1): V1 was a sequence of clips cut into kept
// strips (`segments`), captions were timed in that sequence, layers sat on V2… (`track` 0 = V2) and music on
// A2… (`track` 0 = A2). This turns one into the current model (model.ts): each kept strip becomes an item on
// V1 with its effects, a video strip's sound becomes a linked item on A1, captions move to source time, and
// layers and music move up one track. Lifted strips (gaps) become empty time.
import { clipStarts, clipLen, type Asset, type AudioItem } from './project.ts';
import { outLen, type Fx, type Segment } from './cuts.ts';
import type { Caption } from './captions.ts';
import type { Overlay } from './overlay.ts';
import type { AutoZoom } from './autozoom.ts';
import { zoomKey } from './autozoom.ts';
import { assignBases, sharedFx } from './model.ts';
import { newMedia } from './overlay.ts';

export const DOC_VERSION = 2;
type OldClip = { id: string; assetId: string; len?: number; in?: number };
export type OldDoc = {
  v?: number; assets?: Asset[]; clips?: OldClip[]; segments?: Segment[]; captions?: Caption[]; overlays?: Overlay[]; audios?: AudioItem[];
  tracks?: { v: object[]; a: object[] }; autoZoom?: AutoZoom | null; clipVolume?: number;
};

/** Upgrade a saved doc in place of its old fields. Docs already at the current version come back unchanged. */
export function migrateDoc<D extends OldDoc>(doc: D): D {
  if ((doc.v ?? 1) >= DOC_VERSION) return { ...doc, assets: assignBases(doc.assets ?? []) };
  const assets = assignBases(doc.assets ?? []);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const dur = new Map(assets.map((a) => [a.id, a.duration]));
  const clips = doc.clips ?? [], segs = doc.segments ?? [];
  const starts = clipStarts(clips, dur);
  // Sequence time → the clip under it.
  const clipAtT = (t: number) => {
    for (let i = 0; i < clips.length; i++) if (t >= starts[i] - 1e-6 && t < starts[i] + clipLen(dur, clips[i]) - 1e-6) return i;
    return clips.length && t >= starts.at(-1)! ? clips.length - 1 : -1;
  };
  const fileOf = (i: number, t: number) => t - starts[i] + (clips[i].in ?? 0);
  // Sequence time → source time (for words, zoom moments), or null in a gap.
  const toSrc = (t: number) => {
    const i = clipAtT(t), a = i >= 0 ? byId.get(clips[i].assetId) : undefined;
    return a?.base !== undefined ? a.base + fileOf(i, t) : null;
  };

  const v1: Overlay[] = [], a1: AudioItem[] = [];
  let out = 0;
  for (const s of segs) {
    const len = outLen(s), i = clipAtT((s.start + s.end) / 2), asset = i >= 0 ? byId.get(clips[i].assetId) : undefined;
    if (asset && !s.fx?.lift && asset.kind !== 'audio') {
      const { lift: _l, vol, ...fxRest } = s.fx ?? {};
      const fx: Fx = { ...fxRest };
      const off = fileOf(i, s.start);
      if (fx.rev) fx.rev = { ...fx.rev, start: fileOf(i, fx.rev.start), end: fileOf(i, fx.rev.end) };
      if (fx.stab) fx.stab = { ...fx.stab, t0: fileOf(i, fx.stab.t0) };
      if (fx.hold) delete fx.hold; // the item's own length is the freeze time
      const o: Overlay = { ...newMedia(asset.kind === 'image' ? 'image' : 'video', asset.id, out, len, 1), fill: true, track: 0,
        ...(asset.kind === 'video' && { offset: off }), ...(s.fx?.hold && { fx: { ...fx, hold: s.fx.hold } }) };
      if (!s.fx?.hold && Object.keys(fx).length) o.fx = fx;
      if (asset.kind === 'video') {
        o.volume = 0;
        if (!s.fx?.hold) {
          o.link = crypto.randomUUID();
          const shared = sharedFx(o.fx);
          a1.push({ id: crypto.randomUUID(), assetId: asset.id, at: out, offset: off, len, volume: vol ?? 1, link: o.link, track: 0, ...(shared && { fx: shared }) });
        }
      }
      v1.push(o);
    }
    out += len;
  }
  // Captions: each word to source time (words in gaps or on stills go).
  const captions = (doc.captions ?? []).flatMap((c) => {
    const words = c.words.flatMap((w) => {
      const s = toSrc((w.start + w.end) / 2);
      if (s === null) return [];
      const k = s - (w.start + w.end) / 2;
      return [{ ...w, start: w.start + k, end: w.end + k }];
    });
    return words.length ? [{ ...c, words }] : [];
  });
  // Auto-zoom hand edits and aims are keyed by the moment's start: re-key them in source time.
  let autoZoom = doc.autoZoom;
  if (autoZoom) {
    const rekey = <V>(rec: Record<string, V> | undefined, val: (v: V) => V) => rec && Object.fromEntries(Object.entries(rec).flatMap(([k, v]) => {
      const s = toSrc(+k + 1e-3);
      return s === null ? [] : [[zoomKey(s - 1e-3), val(v)]];
    }));
    autoZoom = { ...autoZoom, edits: rekey(autoZoom.edits, (v) => (v === null ? null : toSrc(v) ?? null)), aim: rekey(autoZoom.aim, (v) => v) };
  }
  const up = <T extends { track?: number }>(x: T): T => ({ ...x, track: (x.track ?? 0) + 1 });
  return {
    ...doc, v: DOC_VERSION, assets, captions, autoZoom,
    overlays: [...v1, ...(doc.overlays ?? []).map(up)],
    audios: [...a1, ...(doc.audios ?? []).map(up)],
    tracks: doc.tracks ? { v: [{}, ...doc.tracks.v], a: [{}, ...doc.tracks.a] } : undefined,
    clips: undefined, segments: undefined,
  };
}
