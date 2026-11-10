// Everyday edits: caption selection and per-caption style, undo/redo, the clip list, assets, fonts.
import { setText, toSRT, toVTT, startOf, type Caption } from '../captions';
import { resolveStyle, type Style } from '../render';
import { localFonts, uploadFont } from '../fonts';
import { remove, trim, toOutput, nextKept, outDuration, captionsForOutput, type Segment, type Fx } from '../cuts';
import { clipAt, clipLen, resizeClip, isolateStrip, extendClip, STILL_LEN, clipStarts, remapProject, splitAtBoundaries, move, type Asset, type Clip, type AudioItem } from '../project';
import * as store from '../store';
import { t } from '../i18n.svelte';
import Timeline from '../Timeline.svelte';
import { end } from '../crash';
import { deleteAssetIfUnused } from '../projects';
import type { Ed, Snap } from './ed';

export function createEdit(ed: Ed) {
  // Click = select one; Ctrl/⌘+click = add or remove; Shift+click = range from the primary.
  function selectCap(id: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (e?.shiftKey && ed.selectedCapId) {
      const a = ed.captions.findIndex((c) => c.id === ed.selectedCapId), b = ed.captions.findIndex((c) => c.id === id);
      const range = ed.captions.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id).filter((x) => x !== id);
      ed.selectedCapIds = [...new Set([...ed.selectedCapIds, ...range]), id].filter((x, i, l) => l.lastIndexOf(x) === i);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      ed.selectedCapIds = ed.selectedSet.has(id) ? ed.selectedCapIds.filter((x) => x !== id) : [...ed.selectedCapIds, id];
    } else ed.selectedCapIds = [id];
  }

  // "Apply to all": remove these settings from every caption's override so the project style shows everywhere.
  function clearCapFields(keys: (keyof Style)[]) {
    if (!ed.captions.some((c) => c.style && keys.some((k) => k in c.style!))) return;
    ed.captions = ed.captions.map((c) => {
      if (!c.style) return c;
      const rest = Object.fromEntries(Object.entries(c.style).filter(([k]) => !keys.includes(k as keyof Style)));
      return Object.keys(rest).length ? { ...c, style: rest } : (({ style: _, ...r }) => r)(c);
    });
  }

  // Style edits go to every selected caption, as one undo step.
  // A drag (live = true) snapshots for undo only on its first change; its final change doesn't snapshot again.
  let liveEdit = false;
  function updateCapStyle(override: Partial<Style>, live = false) {
    if (!ed.selectedCapIds.length) return;
    if (!liveEdit) commit();
    liveEdit = live;
    ed.captions = ed.captions.map((c) => (ed.selectedSet.has(c.id) ? { ...c, style: { ...c.style, ...override } } : c));
  }

  function applyAllCapStyle() {
    if (!ed.selectedCap) return;
    commit();
    ed.style = resolveStyle(ed.style, ed.selectedCap.style);
    ed.captions = ed.captions.map((c) => {
      const { style: _, ...rest } = c;
      return rest;
    });
  }

  function resetCapStyle() {
    if (!ed.selectedCapIds.length) return;
    commit();
    ed.captions = ed.captions.map((c) => {
      if (!ed.selectedSet.has(c.id)) return c;
      const { style: _, ...rest } = c;
      return rest;
    });
  }
  const snap = (): Snap => $state.snapshot({ segments: ed.segments, captions: ed.captions, clips: ed.clips, audios: ed.audios, overlays: ed.overlays });
  const restore = (s: Snap) => ((ed.segments = s.segments), (ed.captions = s.captions), (ed.clips = s.clips), (ed.audios = s.audios), (ed.overlays = s.overlays ?? []), (ed.selected = -1), (ed.selectedCapIds = []));
  function commit() {
    ed.past = [...ed.past.slice(-99), snap()]; // ponytail: 100-step cap, full snapshots; fine at caption-list sizes
    ed.future = [];
  }
  function undo() {
    const s = ed.past.at(-1);
    if (s) ((ed.future = [snap(), ...ed.future]), (ed.past = ed.past.slice(0, -1)), restore(s), announce(t('a11y.undone')));
  }
  function redo() {
    const s = ed.future[0];
    if (s) ((ed.past = [...ed.past, snap()]), (ed.future = ed.future.slice(1)), restore(s), announce(t('a11y.redone')));
  }
  function announce(m: string) {
    ed.liveMsg = '';
    queueMicrotask(() => (ed.liveMsg = m));
  }
  const setCaps = (c: Caption[]) => (commit(), (ed.captions = c));
  // Kept segments never cross a clip boundary (so clips can be reordered and exported piece by piece).
  const normalize = (s: Segment[]) => splitAtBoundaries(s, clipStarts(ed.clips, ed.durations));
  const setSegs = (s: Segment[]) => s !== ed.segments && (commit(), (ed.segments = normalize(s)));

  // Change the clip list; cuts and captions follow their clips.
  function setClips(next: Clip[]) {
    commit();
    const r = remapProject(ed.clips, next, ed.durations, ed.segments, ed.captions);
    ed.clips = next;
    ed.segments = r.segments;
    ed.captions = r.captions;
    ed.selected = -1;
  }
  const addClip = (assetId: string) =>
    setClips([...ed.clips, { id: crypto.randomUUID(), assetId, ...(ed.kindOf(assetId) === 'image' ? { len: STILL_LEN } : {}) }]);
  // Set an image clip's length (seconds); cuts inside it are reset, later clips move.
  function setClipLen(i: number, len: number) {
    if (!(len > 0) || !ed.clips[i]) return;
    commit();
    const r = resizeClip(ed.clips, i, len, ed.durations, ed.segments, ed.captions);
    ((ed.clips = r.clips), (ed.segments = r.segments), (ed.captions = r.captions), (ed.selected = -1));
  }
  // Timeline edge drag. Inside a clip, an edge moves up to the neighbouring strip. On the clip's own edge,
  // dragging outward reveals more of the file (or makes a still longer), dragging inward hides it again and
  // the clips after it move. Each call is measured from the state when the drag began (`trimFrom`).
  let trimFrom: { clips: Clip[]; segments: Segment[]; captions: Caption[]; i: number } | null = null;
  const trimDone = () => (trimFrom = null);
  function trimStrip(i: number, s: number, e: number) {
    if (!trimFrom || trimFrom.i !== i) trimFrom = { ...$state.snapshot({ clips: ed.clips, segments: ed.segments, captions: ed.captions }), i };
    const o = trimFrom, seg = o.segments[i];
    const at = seg && clipAt(o.clips, ed.durations, (seg.start + seg.end) / 2);
    if (!at) return;
    const still = ed.kindOf(o.clips[at.index].assetId) === 'image';
    const c0 = clipStarts(o.clips, ed.durations)[at.index], c1 = c0 + clipLen(ed.durations, o.clips[at.index]);
    const atStart = Math.abs(seg.start - c0) < 1e-6, atEnd = Math.abs(seg.end - c1) < 1e-6;
    const side = Math.abs(s - seg.start) > 1e-9 ? 'start' : Math.abs(e - seg.end) > 1e-9 ? 'end' : null;
    if (side === 'end' && atEnd && (e > c1 || still) || side === 'start' && atStart && s < c0 && !still) {
      const r = extendClip(o.clips, at.index, side, side === 'end' ? e : s, ed.durations, o.segments, o.captions, still);
      if (r) ((ed.clips = r.clips), (ed.segments = normalize(r.segments)), (ed.captions = r.captions));
      return;
    }
    // Within the clip: never past its edges or the neighbouring strips.
    const segs = trim(o.segments, i, Math.max(c0, s), Math.min(c1, e), ed.duration);
    ((ed.clips = o.clips), (ed.captions = o.captions), (ed.segments = segs));
  }
  // Drag a V1 strip to another place in the sequence. The strip becomes its own clip (same file, its own
  // in/out) and is inserted at the clip boundary nearest `out` (output time); everything else closes up.
  function moveStrip(i: number, out: number) {
    const g = ed.segments[i];
    if (!g) return false;
    const iso = isolateStrip(ed.clips, ed.durations, g.start, g.end);
    if (!iso) return false;
    // Output time of each clip boundary (a boundary inside a cut counts from the next kept moment).
    const starts = clipStarts(iso.clips, ed.durations);
    const bounds = [...starts, ed.duration].map((t) => {
      const k = nextKept(ed.segments, t);
      return k === null ? outDuration(ed.segments) : toOutput(ed.segments, k) ?? 0;
    });
    let k = 0;
    bounds.forEach((p, j) => Math.abs(p - out) < Math.abs(bounds[k] - out) && (k = j));
    if (k === iso.index || k === iso.index + 1) return false;
    const order = iso.clips.filter((_, j) => j !== iso.index);
    order.splice(k > iso.index ? k - 1 : k, 0, iso.clips[iso.index]);
    commit();
    const r = remapProject(iso.clips, order, ed.durations, ed.segments, ed.captions);
    ((ed.clips = order), (ed.segments = normalize(r.segments)), (ed.captions = r.captions));
    ed.selected = r.segments.findIndex((x) => Math.abs(x.start - clipStarts(order, ed.durations)[k > iso.index ? k - 1 : k]) < 1e-6 && x.end - x.start > 0);
    return true;
  }
  function addAudio(assetId: string, at = toOutput(ed.segments, ed.time) ?? 0) {
    commit();
    const item = { id: crypto.randomUUID(), assetId, at, volume: 1 };
    ed.audios = [...ed.audios, item];
    ed.selectedAudio = item.id;
  }
  const hasVideoClip = () => ed.clips.some((c) => ed.kindOf(c.assetId) === 'video');
  // "+" puts videos and images on the main track (images play as stills); the layer button makes them overlays.
  const addToTimeline = (a: Asset) => (a.kind === 'audio' ? addAudio(a.id) : addClip(a.id));

  async function removeAsset(a: Asset) {
    if (!confirm(t('confirmRemoveAsset', { name: a.name }))) return;
    setClips(ed.clips.filter((c) => c.assetId !== a.id));
    ed.audios = ed.audios.filter((x) => x.assetId !== a.id);
    ed.overlays = ed.overlays.filter((x) => x.assetId !== a.id);
    ed.assets = ed.assets.filter((x) => x.id !== a.id);
    ed.past = ed.future = []; // the file is gone, so earlier states can't be restored
    ed.files.delete(a.id);
    URL.revokeObjectURL(ed.urls[a.id]);
    delete ed.urls[a.id];
    await deleteAssetIfUnused(a.id, ed.projectId); // duplicates of this project may share the file
  }

  // Register each <video>/<audio> with the player.
  function media(node: HTMLMediaElement, [kind, id]: ['v' | 'a' | 'o', string]) {
    const map = (kind === 'v' ? ed.player.videos : kind === 'o' ? ed.player.overlays : ed.player.audios) as Map<string, HTMLMediaElement>;
    map.set(id, node);
    return { destroy: () => map.get(id) === node && map.delete(id) };
  }
  const update = (i: number, c: Caption) => setCaps(ed.captions.with(i, c));

  function download(ext: 'srt' | 'vtt') {
    const caps = captionsForOutput(ed.displayCaps, ed.segments);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ext === 'srt' ? toSRT(caps) : toVTT(caps)], { type: 'text/plain' }));
    a.download = (ed.name || 'captions') + '.' + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function pickFont(family: string) {
    const f = ed.fonts.find((x) => x.family === family);
    if (f) ((ed.style.family = f.family), (ed.style.weight = f.weight));
  }

  async function addLocalFonts() {
    ed.fontError = '';
    try {
      const have = new Set(ed.fonts.map((f) => f.family));
      ed.fonts = [...ed.fonts, ...(await localFonts()).filter((f) => !have.has(f.family))];
    } catch (e) {
      ed.fontError = (e as Error).message;
    }
  }

  async function addUploadedFont(f: File | undefined) {
    if (!f) return;
    ed.fontError = '';
    try {
      const saved = await uploadFont(f);
      if (!ed.fonts.some((x) => x.family === saved.family)) ed.fonts = [...ed.fonts, { family: saved.family, weight: 400 }];
      ed.savedFonts = [...ed.savedFonts.filter((x) => x.family !== saved.family), saved];
      store.set('fonts', ed.savedFonts).catch(() => {});
      pickFont(saved.family);
    } catch {
      ed.fontError = 'badFont';
    }
  }

  // Add a 2-second line at the playhead, kept in time order.
  function addLine() {
    const s = ed.time, e = Math.min(ed.duration || s + 2, s + 2);
    const c = setText({ id: crypto.randomUUID(), words: [{ text: '…', start: s, end: e }] }, t('newLine'));
    const i = ed.captions.findIndex((x) => startOf(x) > s);
    setCaps(i < 0 ? [...ed.captions, c] : ed.captions.toSpliced(i, 0, c));
    ed.tab = 'captions';
  }
  const setFx = (p: Partial<Fx>) => ed.selected >= 0 && setSegs(ed.segments.with(ed.selected, { ...ed.segments[ed.selected], fx: { ...ed.segments[ed.selected].fx, ...p } }));
  const deleteSelected = () => ed.selected >= 0 && (setSegs(remove(ed.segments, ed.selected)), (ed.selected = -1), announce(t('a11y.deleted')), true);
  function removeAudioItem() {
    if (!ed.selectedAudio) return false;
    commit();
    ed.audios = ed.audios.filter((a) => a.id !== ed.selectedAudio);
    ed.selectedAudio = '';
    return true;
  }
  const setAudio = (id: string, patch: Partial<AudioItem>) => (ed.audios = ed.audios.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  // Drag an asset card onto the timeline (or drop files anywhere on it).
  function dropOnTimeline(e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/x-asset');
    const a = id && ed.assets.find((x) => x.id === id);
    if (a) addToTimeline(a);
    else ed.importMedia(e.dataTransfer?.files);
  }

  return { selectCap, clearCapFields, updateCapStyle, applyAllCapStyle, resetCapStyle, snap, restore, commit, undo, redo, announce, setCaps, setSegs, setClips, addClip, setClipLen, trimStrip, trimDone, moveStrip, addAudio, hasVideoClip, addToTimeline, removeAsset, media, update, download, addLocalFonts, addUploadedFont, addLine, setFx, deleteSelected, removeAudioItem, setAudio, dropOnTimeline };
}
