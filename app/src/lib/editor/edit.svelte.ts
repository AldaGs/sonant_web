// Everyday edits: caption selection and per-caption style, undo/redo, text-based cuts, item effects, assets, fonts.
import { setText, toSRT, toVTT, startOf, type Caption } from '../captions';
import { resolveStyle, type Style } from '../render';
import { localFonts, uploadFont } from '../fonts';
import { type Fx } from '../cuts';
import { type Asset, type AudioItem } from '../project';
import { cutSource, restoreSource, cutRanges as cutOut, tracksOf, rippleInsert, srcLen, lenFor, fileAt, outToSrc, type Lists, type Tracks } from '../model';
import { trackOf } from '../tracks';
import * as store from '../store';
import { t } from '../i18n.svelte';
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
  const snap = (): Snap => $state.snapshot({ captions: ed.captions, audios: ed.audios, overlays: ed.overlays });
  const restore = (s: Snap) => ((ed.captions = s.captions), (ed.audios = s.audios), (ed.overlays = s.overlays ?? []), (ed.selectedCapIds = []));
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
  const lists = (): Lists => ({ overlays: ed.overlays, audios: ed.audios });
  const assign = (l: Lists) => ((ed.overlays = l.overlays), (ed.audios = l.audios));

  // ---- Text-based editing (source time: the time captions are in) ----
  // Deleting words cuts them out of whatever plays them and closes the gap on that track (and its sound's).
  const cutRanges = (r: [number, number][]) => {
    if (!r.length) return false;
    const next = cutSource(lists(), ed.pieces, r);
    if (next.overlays === ed.overlays && next.audios === ed.audios) return false;
    commit();
    assign(next);
    return true;
  };
  // Restoring struck words puts their footage back next to the piece it came from.
  const keepRanges = (r: [number, number][]) => {
    let next = lists();
    for (const [a, b] of r) next = restoreSource(next, ed.assets, a, b);
    if (next.overlays === ed.overlays && next.audios === ed.audios) return false;
    commit();
    assign(next);
    return true;
  };
  // Ripple-cut an output range from every unlocked track (the I/O marks).
  function cutOutRange(a: number, b: number) {
    const all = (k: 'v' | 'a') => new Set(Array.from({ length: Math.max(ed.tracks[k].length, ...(k === 'v' ? ed.overlays : ed.audios).map((x) => trackOf(x) + 1)) }, (_, i) => i).filter((i) => !ed.tracks[k][i]?.locked));
    commit();
    assign(cutOut(lists(), [{ o0: a, o1: b, tracks: { v: all('v'), a: all('a') } }]));
  }

  // ---- Effects of the selected media item ----
  // Speed and freeze change how long the item lasts: what comes after it on its track (and its sound's) moves.
  let fxEditing = false;
  function setFx(p: Partial<Fx>, live = false) {
    const o = ed.selOverlay;
    if (!o || o.kind === 'text') return false;
    const fx = Object.fromEntries(Object.entries({ ...o.fx, ...p }).filter(([, v]) => v !== undefined)) as Fx;
    const timing = 'speed' in p || 'speedEnd' in p || 'hold' in p;
    if (!fxEditing) commit();
    fxEditing = live;
    if (!timing) return void (ed.overlays = ed.overlays.map((x) => (x.id === o.id ? { ...x, fx } : x))), true;
    const len = fx.hold ? fx.hold : lenFor(srcLen(o), fx), d = len - o.len;
    const tr: Tracks = tracksOf(lists(), new Set([o.id])), end = o.at + o.len;
    const moved = { overlays: rippleInsert(ed.overlays, tr.v, end, d), audios: rippleInsert(ed.audios, tr.a, end, d) };
    ed.overlays = moved.overlays.map((x) => (x.id === o.id ? { ...x, fx, len } : x));
    ed.audios = moved.audios;
    return true;
  }
  const fxDone = () => (fxEditing = false);
  // A sound file at output time `at` (its track is chosen afterwards: see dropAsset).
  function addAudio(assetId: string, at = ed.outNow()) {
    commit();
    const item = { id: crypto.randomUUID(), assetId, at: Math.max(0, at), volume: 1 };
    ed.audios = [...ed.audios, item];
    ed.selectedAudio = item.id;
  }
  // Freeze frame at the playhead: the video under it (the selected one, else the lowest) holds that frame for
  // `secs`; everything after it on its track and its sound's moves on.
  function freezeHere(secs = 1) {
    const at = ed.outNow();
    const v = [ed.selOverlay, ...ed.shownOverlays.filter((x) => x.kind === 'video').sort((a, b) => trackOf(a) - trackOf(b))]
      .find((x) => x && x.kind === 'video' && !x.fx?.hold && at > x.at + 0.05 && at < x.at + x.len - 0.05);
    if (!v) return false;
    commit();
    ed.splitItems([v.id], at, false);
    const tr = tracksOf(lists(), new Set([v.id]));
    const { speed: _a, speedEnd: _b, rev: _r, trans: _t, ...keep } = v.fx ?? {};
    const hold = { ...v, id: crypto.randomUUID(), at, len: secs, offset: fileAt(v, at), link: undefined, fx: { ...keep, hold: secs } };
    ed.overlays = [...rippleInsert(ed.overlays, tr.v, at, secs), hold];
    ed.audios = rippleInsert(ed.audios, tr.a, at, secs);
    ed.selectedOverlay = hold.id;
    return true;
  }

  async function removeAsset(a: Asset) {
    if (!confirm(t('confirmRemoveAsset', { name: a.name }))) return;
    ed.audios = ed.audios.filter((x) => x.assetId !== a.id);
    ed.overlays = ed.overlays.filter((x) => x.assetId !== a.id);
    ed.assets = ed.assets.filter((x) => x.id !== a.id);
    ed.past = ed.future = []; // the file is gone, so earlier states can't be restored
    ed.files.delete(a.id);
    URL.revokeObjectURL(ed.urls[a.id]);
    delete ed.urls[a.id];
    await deleteAssetIfUnused(a.id, ed.projectId); // duplicates of this project may share the file
  }

  const update = (i: number, c: Caption) => setCaps(ed.captions.with(i, c));

  function download(ext: 'srt' | 'vtt') {
    const caps = ed.displayCaps; // already on the timeline, without cut words
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

  // Add a 2-second line at the playhead. Over footage it belongs to that footage (source time, so it follows it);
  // over empty time it's a free line, timed on the timeline.
  function addLine() {
    const o = ed.outNow(), src = outToSrc(ed.pieces, o);
    const s = src ?? o, e = s + 2;
    const c = { ...setText({ id: crypto.randomUUID(), words: [{ text: '…', start: s, end: e }] }, t('newLine')), ...(src === null && { free: true }) };
    const i = ed.captions.findIndex((x) => startOf(x) > s);
    setCaps(i < 0 ? [...ed.captions, c] : ed.captions.toSpliced(i, 0, c));
    ed.tab = 'captions';
  }
  // Delete: the selected item goes and leaves a gap (Shift+Delete closes it up).
  const deleteSelected = () => ed.removeOverlay() || removeAudioItem();
  function removeAudioItem() {
    if (!ed.selectedAudio) return false;
    commit();
    ed.audios = ed.audios.filter((a) => a.id !== ed.selectedAudio);
    ed.selectedAudio = '';
    return true;
  }
  const setAudio = (id: string, patch: Partial<AudioItem>) => (ed.audios = ed.audios.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  // Drag an asset card onto the timeline (or drop files anywhere on it). Drops the Timeline didn't place on a
  // track (the header, empty space under the rows) go onto the lowest free track at the playhead.
  function dropOnTimeline(e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/x-asset');
    const a = id && ed.assets.find((x) => x.id === id);
    if (a) addToTimeline(a);
    else ed.importMedia(e.dataTransfer?.files);
  }
  // "+": at the playhead, on V1 (or the lowest track with room there) — audio on A1.
  function addToTimeline(a: Asset) {
    ed.dropAsset(a, a.kind === 'audio' ? 'a' : 'v', 0, ed.outNow());
  }

  return { selectCap, clearCapFields, updateCapStyle, applyAllCapStyle, resetCapStyle, snap, restore, commit, undo, redo, announce, setCaps,
    cutRanges, keepRanges, cutOutRange, setFx, fxDone, freezeHere, addAudio, addToTimeline, removeAsset, update, download,
    addLocalFonts, addUploadedFont, addLine, deleteSelected, removeAudioItem, setAudio, dropOnTimeline };
}
