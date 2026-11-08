// Layers over the video (text, titles, images, videos): adding, editing, keyframes, stacking, templates.
import { type Style } from '../render';
import { trim, outDuration } from '../cuts';
import { move, type Asset } from '../project';
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
    pushOverlay(newMedia(a.kind === 'video' ? 'video' : 'image', a.id, at, len));
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
    if (!ed.selectedOverlay) return false;
    ed.commit();
    ed.overlays = ed.overlays.filter((o) => o.id !== ed.selectedOverlay);
    ed.selectedOverlay = '';
    return true;
  }
  // Stacking order: move the selected layer up (drawn later) or down.
  function restack(dir: -1 | 1) {
    const i = ed.overlays.findIndex((o) => o.id === ed.selectedOverlay);
    if (i < 0) return;
    ed.commit();
    ed.overlays = move(ed.overlays, i, dir);
  }
  // Strip chroma key: live while dragging a slider, one undo step per gesture.
  let stripKeyEditing = false;
  function setStripKey(k: ChromaKey | undefined, final: boolean) {
    if (ed.selected < 0) return;
    if (!stripKeyEditing) ((stripKeyEditing = true), ed.commit());
    ed.segments = ed.segments.with(ed.selected, { ...ed.segments[ed.selected], fx: { ...ed.segments[ed.selected].fx, key: k } });
    if (final) stripKeyEditing = false;
  }

  return { addOverlay, addText, addTitle, setMotion, applyTemplate, saveTemplate, deleteTemplate, setOverlay, setTf, layerT, toggleKey, jumpKey, punchIn, clearKeys, doneEditing, closeLayer, removeOverlay, restack, setStripKey };
}
