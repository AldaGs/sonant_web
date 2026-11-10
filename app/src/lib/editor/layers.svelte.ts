// Layers over the video (text, titles, images, videos): adding, editing, keyframes, stacking, templates.
import { type Style } from '../render';
import { trim, outDuration, splitAt, toSource } from '../cuts';
import { itemLen, type Asset, type AudioItem } from '../project';
import { linkedAudio, unlink as unlinkPair } from '../links';
import { rippleTrim, rippleDelete, rollEdit, slip, type Span, type Patch } from '../tools';
import { moveToTrack, removeTrack, setFlag, trackOf, isLockedV, isLockedA, splitOverlay, splitAudio, byTrack, type TrackFlags } from '../tracks';
import { type ChromaKey } from '../layerfx';
import { placeLayers, fromProject, type Template } from '../templates';
import { newText, newTitle, DEFAULT_MOTION, newMedia, tfAt, setKey, keyAt, dropKey, punchKeys, ANIMATED, type Overlay, type Transform, type Motion } from '../overlay';
import * as store from '../store';
import { t } from '../i18n.svelte';
import { end } from '../crash';
import type { Ed } from './ed';

export function createLayers(ed: Ed) {
  function pushOverlay(o: Overlay) {
    ed.commit();
    ed.overlays = [...ed.overlays, o];
    ed.selectedOverlay = o.id;
  }
  // A video or image as a layer at the playhead (videos keep their length, capped by the timeline end).
  function addOverlay(a: Asset, at = ed.outNow()) {
    const end = outDuration(ed.segments) || a.duration;
    const len = a.kind === 'video' ? Math.min(a.duration, Math.max(1, end - at)) : Math.min(5, Math.max(1, end - at));
    const o = newMedia(a.kind === 'video' ? 'video' : 'image', a.id, at, len);
    if (a.kind !== 'video') return pushOverlay(o);
    // Video layers bring their sound as a linked audio item on an A track (see links.ts).
    o.link = crypto.randomUUID();
    pushOverlay(o);
    ed.audios = [...ed.audios, linkedAudio(o, ed.audios, (id) => ed.durations.get(id) ?? 0)];
  }
  // Give a video layer its own linked sound item (layers from older versions, or after unlinking and deleting it).
  function detachSound(o: Overlay) {
    if (o.kind !== 'video' || o.link) return;
    ed.commit();
    const x = { ...o, link: crypto.randomUUID(), volume: 0 };
    ed.overlays = ed.overlays.map((y) => (y.id === o.id ? x : y));
    ed.audios = [...ed.audios, linkedAudio(x, ed.audios, (id) => ed.durations.get(id) ?? 0, o.volume || 1)];
  }
  // Unlink a picture and its sound so they can be moved and trimmed apart.
  function unlinkSound(link: string) {
    ed.commit();
    const r = unlinkPair(ed.overlays, ed.audios, link);
    ((ed.overlays = r.overlays), (ed.audios = r.audios));
  }
  const addText = () => pushOverlay(newText(ed.outNow(), t('newText')));
  // Animated title: a text layer on top of the stack that animates in and out along an S curve.
  const addTitle = () => {
    const at = ed.outNow(), end = outDuration(ed.segments);
    pushOverlay(newTitle(at, t('newTitle'), end > at ? Math.min(4, Math.max(1, end - at)) : 4));
  };
  const setMotion = (o: Overlay, m: Partial<Motion> | null) =>
    setOverlay(o.id, { motion: m ? { ...(o.motion ?? DEFAULT_MOTION), ...m } : undefined });
  store.get<Template[]>('templates').then((l) => (ed.myTemplates = l ?? []));
  const saveTemplates = (l: Template[]) => ((ed.myTemplates = l), store.set('templates', $state.snapshot(l)).catch(() => {}));
  // Apply: caption look + its text layers (at the playhead, or stuck to the end).
  function applyTemplate(tp: Template) {
    ed.commit();
    if (!tp.keepStyle) ed.style = { ...structuredClone($state.snapshot(tp.style)), x: ed.style.x, y: tp.style.y };
    const added = placeLayers(tp, ed.outNow(), outDuration(ed.segments));
    ed.overlays = [...ed.overlays, ...added];
    if (added[0]) ed.selectedOverlay = added[0].id;
  }
  function saveTemplate() {
    const n = prompt(t('templateName'), ed.name ? `${ed.name} style` : t('myTemplate'));
    if (!n?.trim()) return;
    saveTemplates([...ed.myTemplates, fromProject(n.trim(), $state.snapshot(ed.style), $state.snapshot(ed.overlays), outDuration(ed.segments))]);
  }
  const deleteTemplate = (tp: Template) => confirm(t('confirmDelTemplate', { name: tp.name })) && saveTemplates(ed.myTemplates.filter((x) => x.id !== tp.id));
  // Live edits (sliders, drags) take one undo step: snapshot on the first change, until the next 'change' event.
  let ovEditing = false;
  function setOverlay(id: string, patch: Partial<Overlay>, snapshot = true) {
    if (snapshot && !ovEditing) ((ovEditing = true), ed.commit());
    ed.overlays = ed.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o));
  }
  // Transform edits. Once a layer has keyframes, changes to animated values go into the keyframe at the
  // playhead (added if there isn't one), like CapCut; flip and crop always change the base transform.
  const setTf = (id: string, tf: Partial<Transform>, snapshot = true) => {
    const o = ed.overlays.find((x) => x.id === id);
    if (!o) return;
    const animated = !!o.kf?.length && ANIMATED.some((k) => k in tf);
    if (!animated) return setOverlay(id, { tf: { ...o.tf, ...tf } }, snapshot);
    const out = ed.outNow(), base = { ...o.tf, ...Object.fromEntries(Object.entries(tf).filter(([k]) => !(ANIMATED as readonly string[]).includes(k))) };
    setOverlay(id, { tf: base, kf: setKey(o.kf, out - o.at, { ...tfAt(o, out), ...tf }) }, snapshot);
  };
  // Keyframe controls for the selected layer, at the playhead.
  const layerT = (o: Overlay) => Math.min(o.len, Math.max(0, ed.outNow() - o.at));
  function toggleKey(o: Overlay) {
    const t0 = layerT(o);
    if (keyAt(o.kf, t0)) setOverlay(o.id, { kf: dropKey(o.kf!, t0) });
    else setOverlay(o.id, { kf: setKey(o.kf, t0, tfAt(o, ed.outNow())) });
    doneEditing();
  }
  function jumpKey(o: Overlay, dir: -1 | 1) {
    const t0 = layerT(o), ks = (o.kf ?? []).map((k) => k.t);
    const t1 = dir > 0 ? ks.find((t) => t > t0 + 1e-3) : ks.findLast((t) => t < t0 - 1e-3);
    if (t1 !== undefined) ed.seekOut(o.at + t1);
  }
  const punchIn = (o: Overlay) => (setOverlay(o.id, { kf: punchKeys(o, layerT(o)) }), doneEditing());
  // Clearing keeps the look at the playhead as the layer's fixed transform.
  const clearKeys = (o: Overlay) => (setOverlay(o.id, { tf: tfAt(o, ed.outNow()), kf: undefined }), doneEditing());
  const doneEditing = () => (ovEditing = false);
  // Closing a layer's settings closes the Style sheet too (on phones), instead of leaving the caption styles behind.
  const closeLayer = () => {
    ed.selectedOverlay = '';
    if (ed.sheet === 'style') ed.sheet = null;
  };
  function removeOverlay() {
    const sel = ed.overlays.find((o) => o.id === ed.selectedOverlay);
    if (!sel || isLockedV(ed.tracks, sel)) return false;
    ed.commit();
    ed.overlays = ed.overlays.filter((o) => o.id !== ed.selectedOverlay);
    ed.selectedOverlay = '';
    return true;
  }
  // Stacking: higher tracks draw on top. Bring forward / send backward moves the layer one track up or down;
  // if something is in the way there, a new track opens for it (see moveToTrack).
  function restack(dir: -1 | 1) {
    const o = ed.overlays.find((x) => x.id === ed.selectedOverlay);
    if (!o || isLockedV(ed.tracks, o) || (dir < 0 && trackOf(o) === 0)) return;
    retrack('v', o.id, trackOf(o) + dir);
  }
  // Move a layer ('v') or audio item ('a') to another track, as one undo step.
  function retrack(kind: 'v' | 'a', id: string, track: number, snapshot = true) {
    if (snapshot) ed.commit();
    if (kind === 'v') {
      const r = moveToTrack(ed.overlays, (o) => o.len, id, track, ed.tracks.v);
      ((ed.overlays = r.items), (ed.tracks = { ...ed.tracks, v: r.flags }));
    } else {
      const r = moveToTrack(ed.audios, (a) => itemLen(a, ed.durations.get(a.assetId) ?? 0), id, track, ed.tracks.a);
      ((ed.audios = r.items), (ed.tracks = { ...ed.tracks, a: r.flags }));
    }
  }
  // Razor on every track: split the main strip and every unlocked layer and audio item under the playhead,
  // as one undo step. Returns how many items were cut.
  function splitAll(): number {
    const t = ed.outNow(), src = toSource(ed.segments, t);
    const segs = src === null ? ed.segments : splitAt(ed.segments, src);
    let n = segs.length - ed.segments.length;
    const ovs = ed.overlays.flatMap((o) => {
      const r = isLockedV(ed.tracks, o) ? null : splitOverlay(o, t, crypto.randomUUID());
      return r ? (n++, r) : [o];
    });
    const auds = ed.audios.flatMap((a) => {
      const r = isLockedA(ed.tracks, a) ? null : splitAudio(a, t, ed.durations.get(a.assetId) ?? 0, crypto.randomUUID());
      return r ? (n++, r) : [a];
    });
    if (!n) return 0;
    ed.commit();
    if (segs !== ed.segments) ed.segments = segs;
    ((ed.overlays = byTrack(ovs)), (ed.audios = auds));
    return n;
  }
  // ---- Timeline tools (ripple / roll / slip / razor) on layers ('v') and audio items ('a') ----
  const ovSpan = (o: Overlay): Span => ({ id: o.id, track: trackOf(o), at: o.at, len: o.len,
    offset: o.kind === 'video' ? o.offset ?? 0 : undefined, max: o.kind === 'video' ? ed.durations.get(o.assetId ?? '') ?? Infinity : Infinity });
  const audSpan = (a: AudioItem): Span => {
    const max = ed.durations.get(a.assetId) ?? 0;
    return { id: a.id, track: trackOf(a), at: a.at, len: itemLen(a, max), offset: a.offset ?? 0, max };
  };
  // Live drags are measured from the state when the drag began (reset by toolDone at the next drag start).
  let toolFrom: { overlays: Overlay[]; audios: AudioItem[] } | null = null;
  const toolDone = () => (toolFrom = null);
  function toolEdit(kind: 'v' | 'a', id: string, op: 'ripple' | 'roll' | 'slip', side: 'start' | 'end', d: number) {
    toolFrom ??= $state.snapshot({ overlays: ed.overlays, audios: ed.audios }) as { overlays: Overlay[]; audios: AudioItem[] };
    const spans = kind === 'v' ? toolFrom.overlays.map(ovSpan) : toolFrom.audios.map(audSpan);
    const s = spans.find((x) => x.id === id);
    if (!s || (kind === 'v' ? ed.tracks.v : ed.tracks.a)[s.track]?.locked) return;
    let m: Map<string, Patch> | null;
    if (op === 'slip') {
      const p = slip(s, d);
      m = p && new Map([[id, p]]);
    } else m = op === 'ripple' ? rippleTrim(spans, id, side, d) : rollEdit(spans, id, side, d);
    if (!m) return;
    if (kind === 'v') ed.overlays = toolFrom.overlays.map((o) => (m.has(o.id) ? { ...o, ...m.get(o.id) } : o));
    else ed.audios = toolFrom.audios.map((a) => (m.has(a.id) ? { ...a, ...m.get(a.id) } : a));
  }
  // Razor: cut one layer / audio item at output time t.
  function razor(kind: 'v' | 'a', id: string, t: number) {
    if (kind === 'v') {
      const o = ed.overlays.find((x) => x.id === id), r = o && !isLockedV(ed.tracks, o) && splitOverlay(o, t, crypto.randomUUID());
      if (!r) return false;
      ed.commit();
      ed.overlays = byTrack(ed.overlays.flatMap((x) => (x.id === id ? r : [x])));
    } else {
      const a = ed.audios.find((x) => x.id === id), r = a && !isLockedA(ed.tracks, a) && splitAudio(a, t, ed.durations.get(a.assetId) ?? 0, crypto.randomUUID());
      if (!r) return false;
      ed.commit();
      ed.audios = ed.audios.flatMap((x) => (x.id === id ? r : [x]));
    }
    // A linked partner is cut at the same place, so both halves stay paired.
    const link = (kind === 'v' ? ed.overlays : ed.audios).find((x) => x.id === id)?.link;
    if (link) {
      const po = kind === 'a' && ed.overlays.find((x) => x.link === link), pa = kind === 'v' && ed.audios.find((x) => x.link === link);
      if (po) ed.overlays = byTrack(ed.overlays.flatMap((x) => (x === po ? splitOverlay(po, t, crypto.randomUUID()) ?? [x] : [x])));
      if (pa) ed.audios = ed.audios.flatMap((x) => (x === pa ? splitAudio(pa, t, ed.durations.get(pa.assetId) ?? 0, crypto.randomUUID()) ?? [x] : [x]));
    }
    return true;
  }
  // Ripple delete the selected layer or audio item: later items on its track close the gap.
  function rippleDeleteSel(): boolean {
    const o = ed.overlays.find((x) => x.id === ed.selectedOverlay), a = ed.audios.find((x) => x.id === ed.selectedAudio);
    if (o && !isLockedV(ed.tracks, o)) {
      const m = rippleDelete(ed.overlays.map(ovSpan), o.id);
      ed.commit();
      ed.overlays = ed.overlays.flatMap((x) => (x.id === o.id ? [] : [m.has(x.id) ? { ...x, ...m.get(x.id) } : x]));
      ed.selectedOverlay = '';
      return true;
    }
    if (a && !isLockedA(ed.tracks, a)) {
      const m = rippleDelete(ed.audios.map(audSpan), a.id);
      ed.commit();
      ed.audios = ed.audios.flatMap((x) => (x.id === a.id ? [] : [m.has(x.id) ? { ...x, ...m.get(x.id) } : x]));
      ed.selectedAudio = '';
      return true;
    }
    return false;
  }
  // Track header switches: hide (V) / mute (A) and lock.
  const setTrack = (kind: 'v' | 'a', track: number, patch: TrackFlags) => (ed.tracks = { ...ed.tracks, [kind]: setFlag(ed.tracks[kind], track, patch) });
  // An extra empty track on top, to drop things onto.
  const addTrack = (kind: 'v' | 'a') => {
    const n = Math.max(ed.tracks[kind].length, ...(kind === 'v' ? ed.overlays : ed.audios).map((x) => trackOf(x) + 1));
    setTrack(kind, n, {});
  };
  // Delete an empty track (the ones above move down).
  function dropTrack(kind: 'v' | 'a', track: number) {
    const r = removeTrack<{ track?: number }>(kind === 'v' ? ed.overlays : ed.audios, ed.tracks[kind], track);
    if (!r) return false;
    ed.commit();
    if (kind === 'v') ed.overlays = r.items as typeof ed.overlays;
    else ed.audios = r.items as typeof ed.audios;
    ed.tracks = { ...ed.tracks, [kind]: r.flags };
    return true;
  }
  // Strip chroma key: live while dragging a slider, one undo step per gesture.
  let stripKeyEditing = false;
  function setStripKey(k: ChromaKey | undefined, final: boolean) {
    if (ed.selected < 0) return;
    if (!stripKeyEditing) ((stripKeyEditing = true), ed.commit());
    ed.segments = ed.segments.with(ed.selected, { ...ed.segments[ed.selected], fx: { ...ed.segments[ed.selected].fx, key: k } });
    if (final) stripKeyEditing = false;
  }

  return { addOverlay, addText, addTitle, setMotion, applyTemplate, saveTemplate, deleteTemplate, setOverlay, setTf, layerT, toggleKey, jumpKey, punchIn, clearKeys, doneEditing, closeLayer, removeOverlay, restack, retrack, splitAll, detachSound, unlinkSound, toolEdit, toolDone, razor, rippleDeleteSel, setTrack, addTrack, dropTrack, setStripKey };
}
