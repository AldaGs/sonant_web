<script lang="ts">
  import { onMount } from 'svelte';
  import { transcribe } from './lib/transcribe';
  import { groupWords, captionText, setText, setRange, split, mergeNext, toSRT, toVTT, startOf, endOf, setSpeaker, replaceInRange, type Caption, type Word } from './lib/captions';
  import { drawCaption, fontString, DEFAULT_STYLE, migrateStyle, resolveStyle, inBox, type Style, type Box } from './lib/render';
  import { BUNDLED, localFonts, uploadFont, registerFont, type Font, type SavedFont } from './lib/fonts';
  import { zoomPlace, segAt, PUNCH_IN, freezeAt, splitAt, remove, trim, toSource, toOutput, outDuration, captionsForOutput, cutRange, keepRange, isCut, keptCaptions, type Segment, type Fx } from './lib/cuts';
  import { drawFrame } from './lib/segment';
  import { itemLen, clipAt, clipLen, resizeClip, STILL_LEN, clipStarts, seqDuration, remapProject, splitAtBoundaries, move, type Asset, type Clip, type AudioItem } from './lib/project';
  import { Player } from './lib/player';
  import { Transitioner, TRANSITIONS, TRANS_DUR } from './lib/transitions';
  import ColorGrader from './lib/ColorGrader.svelte';
  import { Grader, COLOR_PRESETS, COLOR_LOOKS, EFFECTS, parseCube, type Color, type Lut } from './lib/grade';
  import { coverPlace, median } from './lib/reframe';
  import { SAFE_ZONES, drawSafeZones, overlapsZone, type Platform } from './lib/safezones';
  import { outputSize, type Aspect } from './lib/export';
  import { subjectCenter } from './lib/segment';
  import { wantsProxy, makeProxy, loadProxy, saveProxy, deleteProxy } from './lib/proxy';
  import { cleanup, cleanupRanges } from './lib/cleanup.svelte';
  import { fileSilences } from './lib/silence';
  import { speechRanges } from './lib/audio';
  import { beatsOfFile } from './lib/beats';
  import { translateTexts, translated, type Dir } from './lib/translate';
  import { autoEmphasis, clearEmphasis, hasEmphasis } from './lib/keywords';
  import { BLENDS, DEFAULT_MASK, DEFAULT_KEY, keyBypass, type Blend, type ChromaKey } from './lib/layerfx';
  import KeyControls from './lib/KeyControls.svelte';
  import PerfDialog from './lib/PerfDialog.svelte';
  import VoiceoverPanel from './lib/VoiceoverPanel.svelte';
  import { embed, cluster, smooth, spanOf, applySpeakers } from './lib/diarize';
  import { decodeAudio } from './lib/transcribe';
  import { gpuFor } from './lib/perf';
  import { shiftOf, planStab, stabPlace, grey, STAB_FPS, STAB_W } from './lib/stabilize';
  import { applyVoiceFx, VOICE_FX, type VoiceFx } from './lib/voicefx';
  import { wav } from './lib/denoise';
  import { findHighlights, shortOf, DEFAULT_HL, type Highlight } from './lib/highlights';
  import { cleanAudio, cleanKey, DENOISE_LEVELS } from './lib/denoise';
  import { zoomMoments, autoZoomPlace, zoomKey, shakePlace, zoomShake, DEFAULT_AUTOZOOM, type AutoZoom } from './lib/autozoom';
  import { BUILTIN, placeLayers, fromProject, type Template } from './lib/templates';
  import { drawOverlay, overlaysAt, hitPlaced, corner, newText, newTitle, sPoint, hasPath, DEFAULT_MOTION, TITLE_PATHS, TITLE_STYLES, newMedia, trimOverlay, textStyle, TEXT_PRESET, tfAt, setKey, keyAt, dropKey, punchKeys, ANIMATED, type Overlay, type Placed, type Transform, type Motion } from './lib/overlay';
  import { importFile, loadFile, mediaKind } from './lib/assets';
  import { thumbnails, type Thumb } from './lib/thumbs';
  import { audioPeaks } from './lib/waveform';
  import * as store from './lib/store';
  import { t, ui, setLang } from './lib/i18n.svelte';
  import Timeline from './lib/Timeline.svelte';
  import Icon from './lib/Icon.svelte';
  import ExportDialog from './lib/ExportDialog.svelte';
  import StylePanel from './lib/StylePanel.svelte';
  import TranscriptView from './lib/TranscriptView.svelte';
  import { createProject, loadDoc, saveDoc, saveProjectFile, deleteAssetIfUnused, addVersion, listVersions, type ProjectDoc, type ProjectMeta, type Version } from './lib/projects';

  // The editor works on one project at a time; the home page (#/) lists them all.
  let { projectId }: { projectId: string } = $props();

  // ---- Project media ----
  let assets = $state<Asset[]>([]);
  let clips = $state<Clip[]>([]); // video track, in play order
  let audios = $state<AudioItem[]>([]); // music / voiceover, output time
  let clipVolume = $state(1); // volume of the clips' own sound
  let denoise = $state(0); // AI noise reduction on the clips' sound: wet mix, 0 = off
  let overlays = $state<Overlay[]>([]); // picture-in-picture video, images, text layers; output time, bottom first
  let selectedOverlay = $state('');
  const images = new Map<string, HTMLImageElement>(); // assetId → decoded image
  let urls = $state<Record<string, string>>({}); // assetId → object URL
  const files = new Map<string, File>(); // assetId → file
  let thumbs = $state<Record<string, Thumb[]>>({});
  let peaks = $state<Record<string, Float32Array>>({});
  let wordCache: Record<string, Word[]> = {}; // `${assetId}|${language}` → words in asset time

  const durations = $derived(new Map(assets.map((a) => [a.id, a.duration])));
  const names = $derived(new Map(assets.map((a) => [a.id, a.name])));
  const duration = $derived(seqDuration(clips, durations)); // whole sequence, before cuts
  const hasMedia = $derived(clips.length > 0);
  const videoIds = $derived([...new Set(clips.map((c) => c.assetId))]);
  const firstVideo = $derived(clips.map((c) => assets.find((a) => a.id === c.assetId)).find((a) => a?.width));
  const srcW = $derived(firstVideo?.width || 1280);
  const srcH = $derived(firstVideo?.height || 720);
  // Canvas shape for the whole project (Original, 9:16, 1:1, 4:5, 16:9); videos cover it around each strip's focus.
  let canvasAspect = $state<Aspect>('source');
  const canvasSize = $derived(outputSize(srcW, srcH, 'source', canvasAspect));
  const frameW = $derived(canvasSize.width);
  const frameH = $derived(canvasSize.height);

  // ---- Editing state ----
  let time = $state(0); // sequence time
  let paused = $state(true);
  let dragging = $state(false);
  let language = $state<'english' | 'spanish' | null>(null);
  let busy = $state(false);
  let status = $state('');
  let pct = $state(0);
  let error = $state('');
  let notice = $state('');
  let captions = $state<Caption[]>([]);
  let autoZoom = $state<AutoZoom | null>(null); // smart auto-zoom on emphasized words; null = off
  let canvas = $state<HTMLCanvasElement>();
  let style = $state<Style>({ ...DEFAULT_STYLE });
  let fonts = $state<Font[]>([...BUNDLED]);
  let fontError = $state('');
  let segments = $state<Segment[]>([]);
  let selected = $state(-1);
  // Selected captions for per-caption styling. The last one clicked is the "primary": the style panel shows its look.
  let selectedCapIds = $state<string[]>([]);
  let selectedAudio = $state('');
  let tlZoom = $state(1);
  let exporter = $state<ExportDialog>();

  const selectedCapId = $derived(selectedCapIds.at(-1) ?? null);
  const selectedSet = $derived(new Set(selectedCapIds));
  const selectedCapIndex = $derived(captions.findIndex((c) => c.id === selectedCapId));
  const selectedCap = $derived(selectedCapIndex >= 0 ? captions[selectedCapIndex] : null);

  // Click = select one; Ctrl/⌘+click = add or remove; Shift+click = range from the primary.
  function selectCap(id: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    if (e?.shiftKey && selectedCapId) {
      const a = captions.findIndex((c) => c.id === selectedCapId), b = captions.findIndex((c) => c.id === id);
      const range = captions.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id).filter((x) => x !== id);
      selectedCapIds = [...new Set([...selectedCapIds, ...range]), id].filter((x, i, l) => l.lastIndexOf(x) === i);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      selectedCapIds = selectedSet.has(id) ? selectedCapIds.filter((x) => x !== id) : [...selectedCapIds, id];
    } else selectedCapIds = [id];
  }
  const clearCapSelection = () => (selectedCapIds = []);

  // "Apply to all": remove these settings from every caption's override so the project style shows everywhere.
  function clearCapFields(keys: (keyof Style)[]) {
    if (!captions.some((c) => c.style && keys.some((k) => k in c.style!))) return;
    captions = captions.map((c) => {
      if (!c.style) return c;
      const rest = Object.fromEntries(Object.entries(c.style).filter(([k]) => !keys.includes(k as keyof Style)));
      return Object.keys(rest).length ? { ...c, style: rest } : (({ style: _, ...r }) => r)(c);
    });
  }

  // Style edits go to every selected caption, as one undo step.
  // A drag (live = true) snapshots for undo only on its first change; its final change doesn't snapshot again.
  let liveEdit = false;
  function updateCapStyle(override: Partial<Style>, live = false) {
    if (!selectedCapIds.length) return;
    if (!liveEdit) commit();
    liveEdit = live;
    captions = captions.map((c) => (selectedSet.has(c.id) ? { ...c, style: { ...c.style, ...override } } : c));
  }

  function applyAllCapStyle() {
    if (!selectedCap) return;
    commit();
    style = resolveStyle(style, selectedCap.style);
    captions = captions.map((c) => {
      const { style: _, ...rest } = c;
      return rest;
    });
  }

  function resetCapStyle() {
    if (!selectedCapIds.length) return;
    commit();
    captions = captions.map((c) => {
      if (!selectedSet.has(c.id)) return c;
      const { style: _, ...rest } = c;
      return rest;
    });
  }

  const player = new Player(() => ({ clips, audios, segments, durations, clipVolume, overlays, speech }));

  // Undo/redo: snapshots of the editable project.
  type Snap = { segments: Segment[]; captions: Caption[]; clips: Clip[]; audios: AudioItem[]; overlays: Overlay[] };
  let past = $state<Snap[]>([]);
  let future = $state<Snap[]>([]);
  const snap = (): Snap => $state.snapshot({ segments, captions, clips, audios, overlays });
  const restore = (s: Snap) => ((segments = s.segments), (captions = s.captions), (clips = s.clips), (audios = s.audios), (overlays = s.overlays ?? []), (selected = -1), (selectedCapIds = []));
  function commit() {
    past = [...past.slice(-99), snap()]; // ponytail: 100-step cap, full snapshots; fine at caption-list sizes
    future = [];
  }
  function undo() {
    const s = past.at(-1);
    if (s) ((future = [snap(), ...future]), (past = past.slice(0, -1)), restore(s), announce(t('a11y.undone')));
  }
  function redo() {
    const s = future[0];
    if (s) ((past = [...past, snap()]), (future = future.slice(1)), restore(s), announce(t('a11y.redone')));
  }
  // Screen-reader announcements for actions that only change the picture or the timeline.
  let liveMsg = $state('');
  function announce(m: string) {
    liveMsg = '';
    queueMicrotask(() => (liveMsg = m));
  }
  const setCaps = (c: Caption[]) => (commit(), (captions = c));
  // Kept segments never cross a clip boundary (so clips can be reordered and exported piece by piece).
  const normalize = (s: Segment[]) => splitAtBoundaries(s, clipStarts(clips, durations));
  const setSegs = (s: Segment[]) => s !== segments && (commit(), (segments = normalize(s)));

  // Change the clip list; cuts and captions follow their clips.
  function setClips(next: Clip[]) {
    commit();
    const r = remapProject(clips, next, durations, segments, captions);
    clips = next;
    segments = r.segments;
    captions = r.captions;
    selected = -1;
  }

  // ---- Persistence: this project's doc + media in IndexedDB (see lib/projects.ts) ----
  type Doc = ProjectDoc;
  let speakers = $state<string[]>([]);
  let name = $state('');
  let saving = $state(false);
  let ready = false; // no autosave until the saved project has been restored
  let savedFonts: SavedFont[] = [];

  // ---- AI noise reduction: a cleaned copy of each video clip's sound, made once per level and cached ----
  let cleanBlobs = new Map<string, Blob>(); // assetId → cleaned WAV at the current level
  const cleanLevel = new Map<string, number>(); // assetId → level of the copy in player.clean
  let cleanPct = $state<number | null>(null); // progress while cleaning
  let cleanRun = 0;
  $effect(() => {
    const level = denoise, ids = [...new Set(clips.map((c) => c.assetId))].filter((id) => assets.find((a) => a.id === id)?.kind === 'video');
    const run = ++cleanRun;
    const drop = (id: string) => {
      const el = player.clean.get(id);
      if (el) (el.pause(), URL.revokeObjectURL(el.src), player.clean.delete(id));
      cleanBlobs.delete(id);
      cleanLevel.delete(id);
    };
    for (const id of [...player.clean.keys()]) if (!level || !ids.includes(id) || cleanLevel.get(id) !== level) drop(id);
    if (!level) return void (cleanPct = null);
    (async () => {
      const todo = ids.filter((id) => files.get(id) && !player.clean.has(id)); // already cleaned at this level: keep
      for (const [k, id] of todo.entries()) {
        if (run !== cleanRun) return;
        let blob = await store.get<Blob>(cleanKey(id, level));
        if (!blob) {
          cleanPct = (k / todo.length) * 100;
          blob = (await cleanAudio(files.get(id)!, level, (p) => run === cleanRun && (cleanPct = ((k + p / 100) / todo.length) * 100)).catch(() => null)) ?? undefined;
          if (blob) store.set(cleanKey(id, level), blob).catch(() => {}); // over quota: still used this session
        }
        if (run !== cleanRun || !blob) continue;
        drop(id);
        cleanBlobs.set(id, blob);
        cleanLevel.set(id, level);
        const el = new Audio(URL.createObjectURL(blob));
        el.preload = 'auto';
        player.clean.set(id, el);
      }
      if (run === cleanRun) cleanPct = null;
    })();
  });

  // ---- Proxies: small fast-seeking copies for the preview (export uses the originals) ----
  let proxyUrls = $state<Record<string, string>>({});
  let proxyPct = $state<Record<string, number>>({}); // assetId → progress while building
  const previewUrl = (id: string) => proxyUrls[id] ?? urls[id];
  async function buildProxy(a: Asset) {
    const f = files.get(a.id);
    if (!f || a.id in proxyPct) return;
    proxyPct[a.id] = 0;
    try {
      const blob = await makeProxy(f, (p) => (proxyPct[a.id] = p));
      await saveProxy(a.id, blob).catch(() => {}); // over quota: still used this session
      proxyUrls[a.id] = URL.createObjectURL(blob);
      assets = assets.map((x) => (x.id === a.id ? { ...x, proxy: true } : x));
    } catch {
      notice = 'err.proxy';
    } finally {
      delete proxyPct[a.id];
    }
  }
  async function dropProxy(a: Asset) {
    if (proxyUrls[a.id]) URL.revokeObjectURL(proxyUrls[a.id]);
    delete proxyUrls[a.id];
    assets = assets.map((x) => (x.id === a.id ? { ...x, proxy: undefined } : x));
    await deleteProxy(a.id);
  }

  // Make a file usable: object URL, thumbnails, waveform.
  function register(a: Asset, f: File) {
    files.set(a.id, f);
    const url = URL.createObjectURL(f);
    urls[a.id] = url;
    if (a.kind === 'image') {
      const img = new Image();
      img.src = url;
      images.set(a.id, img);
      thumbs[a.id] = Array.from({ length: 120 }, (_, i) => ({ t: i * 5, url })); // a still looks the same all along (up to 10 min)
      return;
    }
    if (a.kind === 'video') thumbnails(url, a.duration).then((th) => (thumbs[a.id] = th)).catch(() => {});
    if (a.proxy) loadProxy(a.id).then((b) => b && (proxyUrls[a.id] = URL.createObjectURL(b)));
    audioPeaks(f).then((p) => (peaks[a.id] = p)).catch(() => {}); // no audio track: no waveform
  }

  onMount(async () => {
    document.documentElement.lang = ui.lang;
    const [doc, fts] = await Promise.all([loadDoc(projectId), store.get<SavedFont[]>('fonts')]);
    for (const f of fts ?? []) {
      try {
        fonts = [...fonts, await registerFont(f)];
        savedFonts.push(f);
      } catch {}
    }
    if (doc) {
      let missing = false;
      for (const a of doc.assets ?? []) {
        const f = await loadFile(a.id);
        if (f) register(a, f);
        else missing = true;
      }
      assets = doc.assets ?? [];
      clips = doc.clips ?? [];
      audios = doc.audios ?? [];
      overlays = doc.overlays ?? [];
      clipVolume = doc.clipVolume ?? 1;
      wordCache = doc.words ?? {};
      restoreDoc(doc);
      if (missing) notice = 'err.missingMedia';
    }
    if (clips.length && !segments.length) segments = [{ start: 0, end: duration }];
    ready = true;
  });

  function restoreDoc(doc: Doc) {
    name = doc.name ?? '';
    speakers = doc.speakers ?? [];
    captions = doc.captions ?? [];
    segments = doc.segments ?? [];
    style = migrateStyle(doc.style ?? {});
    language = doc.language ?? null;
    showTr = doc.showTr ?? false;
    autoZoom = doc.autoZoom ?? null;
    denoise = doc.denoise ?? 0;
    canvasAspect = doc.aspect ?? 'source';
    Promise.all((doc.luts ?? []).map((l) => store.get<Lut>('lut:' + l.id))).then((r) => (luts = r.filter((x): x is Lut => !!x)));
    // A local (installed) font isn't in the list until "Use my fonts" runs again; keep it selectable.
    if (!fonts.some((f) => f.family === style.family)) fonts = [...fonts, { family: style.family, weight: style.weight }];
  }

  // Autosave ~0.4s after any change. The home page card gets the name, length and (every ~10s) a thumbnail.
  let lastThumb = 0;
  // Card image for the home page: a frame from the first clip (its timeline thumbnails are real decoded frames).
  function thumbnail(): string | undefined {
    const th = clips.length ? thumbs[clips[0].assetId] : undefined;
    return th?.length ? th[Math.floor(th.length / 3)].url : undefined;
  }



  async function saveNow() {
    const doc: Doc = { ...$state.snapshot({ name, captions, segments, style, language, speakers, assets, clips, audios, clipVolume, overlays, showTr, autoZoom, denoise }), luts: luts.map((l) => ({ id: l.id, name: l.name })), aspect: canvasAspect, words: wordCache };
    const meta: Partial<ProjectMeta> = { duration: outDuration(segments), clips: clips.length };
    if (Date.now() - lastThumb > 10000) {
      const th = thumbnail();
      if (th) ((meta.thumb = th), (lastThumb = Date.now()));
    }
    await saveDoc(projectId, doc, meta);
    addVersion(projectId, doc).catch(() => {}); // a snapshot every ~2 minutes of editing
  }
  $effect(() => {
    $state.snapshot({ name, captions, segments, style, language, speakers, assets, clips, audios, clipVolume, overlays, showTr, autoZoom, denoise });
    void luts.length, canvasAspect;
    void (clips.length && thumbs[clips[0].assetId]?.length); // first-clip thumbnails ready → refresh the card
    if (!ready) return;
    saving = true;
    const id = setTimeout(() => saveNow().catch(() => {}).finally(() => (saving = false)), 400);
    return () => clearTimeout(id);
  });

  // ---- Version history ----
  let histDialog = $state<HTMLDialogElement>();
  let versions = $state<Version[]>([]);
  async function openHistory() {
    versions = (await listVersions(projectId)).toReversed();
    histDialog?.showModal();
  }
  async function restoreVersion(v: Version) {
    // Keep the current state as a version first, so restoring can itself be undone from here.
    await addVersion(projectId, { ...$state.snapshot({ name, captions, segments, style, language, speakers, assets, clips, audios, clipVolume, overlays, showTr, autoZoom, denoise }), aspect: canvasAspect } as Doc, { force: true, label: t('beforeRestore') });
    commit();
    const d = v.doc;
    const have = new Set(assets.map((a) => a.id)); // media deleted since then can't come back
    clips = (d.clips ?? []).filter((c) => have.has(c.assetId));
    audios = (d.audios ?? []).filter((a) => have.has(a.assetId));
    overlays = (d.overlays ?? []).filter((o) => !o.assetId || have.has(o.assetId));
    clipVolume = d.clipVolume ?? 1;
    restoreDoc({ ...d, assets } as Doc);
    histDialog?.close();
    announce(t('versionRestored'));
  }
  const ago = (ms: number) => {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? t('justNow') : m < 60 ? t('minAgo', { n: m }) : new Date(ms).toLocaleString(ui.lang);
  };

  // Save the project as a .sonant file (Ctrl/⌘+S). Chrome/Edge keep writing to the same file afterwards.
  let fileStatus = $state('');
  async function saveToFile(again = true) {
    await saveNow();
    const r = await saveProjectFile(projectId, name, again).catch(() => 'error' as const);
    fileStatus = r === 'saved' ? 'fileSaved' : r === 'downloaded' ? 'fileDownloaded' : r === 'error' ? 'err.saveFile' : '';
    setTimeout(() => (fileStatus = ''), 3000);
  }

  // ---- Media library ----
  // Import any number of files at once: probed in parallel, added in the order picked.
  // Videos join the end of the sequence; audio goes onto the Music & VO track at the playhead.
  async function importMedia(list: FileList | File[] | undefined | null) {
    const media = [...(list ?? [])].filter((f) => mediaKind(f));
    if (!media.length) return;
    error = notice = '';
    const at = toOutput(segments, time) ?? 0;
    const results = await Promise.all(media.map((f) => importFile(f).then((r) => ({ f, ...r }), () => null)));
    for (const r of results) {
      if (!r) {
        error = 'err.badMedia';
        continue;
      }
      if (!r.saved) notice = 'err.saveVideo';
      assets = [...assets, r.asset];
      register(r.asset, r.f);
      if (!name) name = r.f.name.replace(/\.[^.]+$/, '');
      if (wantsProxy(r.asset)) buildProxy(r.asset); // big or long footage: fast preview copy in the background
      // Images start a slideshow on the main track when there's no video yet; over video they're layers.
      if (r.asset.kind === 'video' || (r.asset.kind === 'image' && !hasVideoClip())) addClip(r.asset.id);
      else if (r.asset.kind === 'image') addOverlay(r.asset, at);
      else addAudio(r.asset.id, at);
    }
  }


  // Generated voiceover: each file becomes an audio asset on the Music & VO track (one undo step).
  async function addVoiceover(items: { file: File; at: number }[]) {
    const now = toOutput(segments, time) ?? 0;
    const added: AudioItem[] = [];
    for (const { file, at } of items) {
      const r = await importFile(file).catch(() => null);
      if (!r) { error = 'err.badMedia'; continue; }
      if (!r.saved) notice = 'err.saveVideo';
      assets = [...assets, r.asset];
      register(r.asset, file);
      added.push({ id: crypto.randomUUID(), assetId: r.asset.id, at: Number.isFinite(at) ? at : now, volume: 1 });
    }
    if (!added.length) return;
    commit();
    audios = [...audios, ...added];
    selectedAudio = added[0].id;
    announce(t('voAdded', { n: added.length }));
  }
  // ---- Auto-zoom aim: find the person in the frame at each zoom and zoom towards them ----
  let aimBusy = $state(false);
  async function aimZooms() {
    if (!autoZoom) return;
    aimBusy = true;
    const starts = clipStarts(clips, durations), aim: Record<string, [number, number]> = { ...autoZoom.aim };
    const els = new Map<string, HTMLVideoElement>();
    try {
      for (const m of zooms) {
        const at = clipAt(clips, durations, m.start + 0.2);
        if (!at || !m.key || kindOf(clips[at.index].assetId) !== 'video') continue;
        const id = clips[at.index].assetId;
        let v = els.get(id);
        if (!v) {
          v = document.createElement('video');
          v.muted = true;
          v.src = previewUrl(id);
          await new Promise((r, j) => ((v!.onloadeddata = r), (v!.onerror = j)));
          els.set(id, v);
        }
        v.currentTime = m.start + 0.2 - starts[at.index];
        await new Promise((r) => (v!.onseeked = r));
        const c = await subjectCenter(v, v.videoWidth, v.videoHeight).catch(() => null);
        // Aim a little above the body's centre: that's where the face is.
        if (c) aim[m.key] = [c.x, Math.max(0, c.y - 0.12)];
      }
      autoZoom.aim = aim;
      if (!Object.keys(aim).length) error = 'noPerson';
    } catch {
      error = 'noPerson';
    } finally {
      for (const v of els.values()) v.removeAttribute('src');
      aimBusy = false;
    }
  }

  // ---- Stabilization: measure the camera's shake on small greyscale frames, then shift it out ----
  let stabPct = $state<number | null>(null);
  async function stabilize(i: number) {
    const s = segments[i];
    if (!s || s.fx?.hold) return;
    if (s.fx?.stab) return setFx({ stab: undefined }); // toggle off
    const starts = clipStarts(clips, durations), at = clipAt(clips, durations, (s.start + s.end) / 2);
    if (!at || kindOf(clips[at.index].assetId) !== 'video') return;
    const off = starts[at.index];
    stabPct = 0;
    error = '';
    const v = document.createElement('video');
    v.muted = true;
    v.src = previewUrl(clips[at.index].assetId); // the proxy seeks much faster when there is one
    try {
      await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
      const w = STAB_W, h = Math.max(2, Math.round((STAB_W * v.videoHeight) / v.videoWidth / 2) * 2);
      const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
      const n = Math.max(2, Math.ceil((s.end - s.start) * STAB_FPS));
      const shifts: [number, number][] = [];
      let prev: Uint8Array | null = null;
      for (let k = 0; k < n; k++) {
        // A few ms past the sample time, so the seek lands inside a frame rather than on the boundary between two.
        v.currentTime = Math.min(s.end - 0.01, s.start + k / STAB_FPS + 0.008) - off;
        await new Promise((r) => (v.onseeked = r));
        const g = grey(c, v, w, h);
        if (prev) shifts.push(shiftOf(prev, g, w, h));
        prev = g;
        stabPct = ((k + 1) / n) * 100;
      }
      const stab = planStab(shifts, w, h, STAB_FPS, s.start);
      commit();
      segments = segments.with(i, { ...segments[i], fx: { ...segments[i].fx, stab } });
    } catch {
      error = 'err.stab';
    } finally {
      v.removeAttribute('src');
      stabPct = null;
    }
  }

  // ---- Voice changer on a Music & VO item: rendered into a new audio file (the original is kept) ----
  let vfxBusy = $state(false);
  async function setVoiceFx(item: AudioItem, fx: VoiceFx | '') {
    const orig = item.src ?? item.assetId;
    if (!fx) {
      if (item.src) (commit(), setAudio(item.id, { assetId: item.src, src: undefined, vfx: undefined }));
      return;
    }
    const f = files.get(orig);
    if (!f) return;
    vfxBusy = true;
    error = '';
    try {
      const ctx = new AudioContext();
      let buf: AudioBuffer;
      try { buf = await ctx.decodeAudioData(await f.arrayBuffer()); } finally { ctx.close(); }
      await new Promise((r) => setTimeout(r)); // let the "working" state paint
      const out = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, c) => applyVoiceFx(buf.getChannelData(c), buf.sampleRate, fx));
      const base = (names.get(orig) ?? 'audio').replace(/\.[^.]+$/, '');
      const file = new File([wav(out, buf.sampleRate)], `${base} · ${t('vfx.' + fx)}.wav`, { type: 'audio/wav' });
      const r = await importFile(file);
      assets = [...assets, r.asset];
      register(r.asset, file);
      commit();
      setAudio(item.id, { assetId: r.asset.id, src: orig, vfx: fx });
    } catch {
      error = 'err.badMedia';
    } finally {
      vfxBusy = false;
    }
  }

  // ---- Speaker detection: a voice fingerprint per caption, grouped by similarity ----
  let spkCount = $state(0); // 0 = auto
  let spkBusy = $state(false), spkStatus = $state(''), spkPct = $state(0), spkMsg = $state('');
  async function detectSpeakers() {
    spkBusy = true;
    spkMsg = error = '';
    try {
      const starts = clipStarts(clips, durations), pcm = new Map<string, Float32Array | null>();
      const ids: string[] = [], pieces: Float32Array[] = [], spans: number[] = [];
      spkStatus = 'st.reading';
      for (const c of captions) {
        if (!c.words.length) continue;
        const [a, b] = spanOf(c), at = clipAt(clips, durations, (a + b) / 2);
        if (!at) continue;
        const id = clips[at.index].assetId, f = files.get(id);
        if (!f || kindOf(id) !== 'video' && kindOf(id) !== 'audio') continue;
        if (!pcm.has(id)) pcm.set(id, await decodeAudio(f).catch(() => null));
        const x = pcm.get(id);
        if (!x) continue;
        const off = starts[at.index], i0 = Math.max(0, Math.floor((a - off) * 16000)), i1 = Math.min(x.length, Math.ceil((b - off) * 16000));
        if (i1 - i0 < 4000) continue; // under 0.25s of audio
        ids.push(c.id);
        pieces.push(x.slice(i0, i1));
        spans.push(c.words[c.words.length - 1].end - c.words[0].start);
      }
      if (ids.length < 2) return void (spkMsg = 'spkTooFew');
      const emb = await embed(pieces, gpuFor.whisper(), (s, p) => ((spkStatus = s), (spkPct = p)));
      const labels = smooth(cluster(emb, { k: spkCount || undefined, weights: spans.map((s) => Math.min(4, Math.max(0.5, s))) }), spans);
      const r = applySpeakers(captions, ids, labels, speakers);
      setCaps(r.captions);
      speakers = r.speakers;
      spkMsg = 'spkFound';
      spkPct = Math.max(...labels) + 1;
    } catch (e) {
      const m = (e as Error)?.message ?? '';
      error = m.startsWith('err.') ? m : 'err.speakers';
      console.warn('speaker detection:', m);
    } finally {
      spkBusy = false;
      spkStatus = '';
    }
  }

  // ---- Auto-clips: best 15–60s moments from the transcript, each can become its own 9:16 project ----
  let hlOpts = $state({ ...DEFAULT_HL });
  let highlights = $state<Highlight[] | null>(null);
  let shortsMade = $state<Record<number, string>>({}); // highlight start → new project id
  const findClips = () => ((highlights = findHighlights(keptCaptions(captions, segments), $state.snapshot(hlOpts))), (shortsMade = {}));
  function previewClip(h: Highlight) {
    seek(h.start);
    if (!player.playing) toggle();
  }
  async function makeShort(h: Highlight, n: number) {
    const durOf = (id: string) => durations.get(id) ?? 0;
    const cut = shortOf($state.snapshot({ segments, overlays, audios, captions }), h.start, h.end, (x) => itemLen(x, durOf(x.assetId)));
    const title = `${name || t('untitled')} · ${t('short')} ${n}`;
    const doc: Doc = {
      ...$state.snapshot({ style, language, speakers, assets, clips, clipVolume, showTr, autoZoom, denoise }),
      ...cut, name: title, luts: luts.map((l) => ({ id: l.id, name: l.name })), aspect: '9:16', words: wordCache,
    };
    const meta = await createProject(title);
    await saveDoc(meta.id, doc, { duration: h.end - h.start, clips: clips.length });
    shortsMade = { ...shortsMade, [h.start]: meta.id };
  }
  const addClip = (assetId: string) =>
    setClips([...clips, { id: crypto.randomUUID(), assetId, ...(kindOf(assetId) === 'image' ? { len: STILL_LEN } : {}) }]);
  // Set an image clip's length (seconds); cuts inside it are reset, later clips move.
  function setClipLen(i: number, len: number) {
    if (!(len > 0) || !clips[i]) return;
    commit();
    const r = resizeClip(clips, i, len, durations, segments, captions);
    ((clips = r.clips), (segments = r.segments), (captions = r.captions), (selected = -1));
  }
  function addAudio(assetId: string, at = toOutput(segments, time) ?? 0) {
    commit();
    const item = { id: crypto.randomUUID(), assetId, at, volume: 1 };
    audios = [...audios, item];
    selectedAudio = item.id;
  }
  const kindOf = (id: string) => assets.find((a) => a.id === id)?.kind;
  const imageAssets = $derived(assets.filter((a) => a.kind === 'image'));
  const hasVideoClip = () => clips.some((c) => kindOf(c.assetId) === 'video');
  // "+" puts videos and images on the main track (images play as stills); the layer button makes them overlays.
  const addToTimeline = (a: Asset) => (a.kind === 'audio' ? addAudio(a.id) : addClip(a.id));

  // ---- Overlays (layers over the main video) ----
  const outNow = () => player.o;
  function pushOverlay(o: Overlay) {
    commit();
    overlays = [...overlays, o];
    selectedOverlay = o.id;
  }
  // A video or image as a layer at the playhead (videos keep their length, capped by the timeline end).
  function addOverlay(a: Asset, at = outNow()) {
    const end = outDuration(segments) || a.duration;
    const len = a.kind === 'video' ? Math.min(a.duration, Math.max(1, end - at)) : Math.min(5, Math.max(1, end - at));
    pushOverlay(newMedia(a.kind === 'video' ? 'video' : 'image', a.id, at, len));
  }
  const addText = () => pushOverlay(newText(outNow(), t('newText')));
  // Animated title: a text layer on top of the stack that animates in and out along an S curve.
  const addTitle = () => {
    const at = outNow(), end = outDuration(segments);
    pushOverlay(newTitle(at, t('newTitle'), end > at ? Math.min(4, Math.max(1, end - at)) : 4));
  };
  const setMotion = (o: Overlay, m: Partial<Motion> | null) =>
    setOverlay(o.id, { motion: m ? { ...(o.motion ?? DEFAULT_MOTION), ...m } : undefined });

  // ---- Templates (shared by every project in this browser) ----
  let myTemplates = $state<Template[]>([]);
  store.get<Template[]>('templates').then((l) => (myTemplates = l ?? []));
  const saveTemplates = (l: Template[]) => ((myTemplates = l), store.set('templates', $state.snapshot(l)).catch(() => {}));
  // Apply: caption look + its text layers (at the playhead, or stuck to the end).
  function applyTemplate(tp: Template) {
    commit();
    if (!tp.keepStyle) style = { ...structuredClone($state.snapshot(tp.style)), x: style.x, y: tp.style.y };
    const added = placeLayers(tp, outNow(), outDuration(segments));
    overlays = [...overlays, ...added];
    if (added[0]) selectedOverlay = added[0].id;
  }
  function saveTemplate() {
    const n = prompt(t('templateName'), name ? `${name} style` : t('myTemplate'));
    if (!n?.trim()) return;
    saveTemplates([...myTemplates, fromProject(n.trim(), $state.snapshot(style), $state.snapshot(overlays), outDuration(segments))]);
  }
  const deleteTemplate = (tp: Template) => confirm(t('confirmDelTemplate', { name: tp.name })) && saveTemplates(myTemplates.filter((x) => x.id !== tp.id));
  const selOverlay = $derived(overlays.find((o) => o.id === selectedOverlay) ?? null);
  // Live edits (sliders, drags) take one undo step: snapshot on the first change, until the next 'change' event.
  let ovEditing = false;
  function setOverlay(id: string, patch: Partial<Overlay>, snapshot = true) {
    if (snapshot && !ovEditing) ((ovEditing = true), commit());
    overlays = overlays.map((o) => (o.id === id ? { ...o, ...patch } : o));
  }
  // Transform edits. Once a layer has keyframes, changes to animated values go into the keyframe at the
  // playhead (added if there isn't one), like CapCut; flip and crop always change the base transform.
  const setTf = (id: string, tf: Partial<Transform>, snapshot = true) => {
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    const animated = !!o.kf?.length && ANIMATED.some((k) => k in tf);
    if (!animated) return setOverlay(id, { tf: { ...o.tf, ...tf } }, snapshot);
    const out = outNow(), base = { ...o.tf, ...Object.fromEntries(Object.entries(tf).filter(([k]) => !(ANIMATED as readonly string[]).includes(k))) };
    setOverlay(id, { tf: base, kf: setKey(o.kf, out - o.at, { ...tfAt(o, out), ...tf }) }, snapshot);
  };
  // Keyframe controls for the selected layer, at the playhead.
  const layerT = (o: Overlay) => Math.min(o.len, Math.max(0, outNow() - o.at));
  function toggleKey(o: Overlay) {
    const t0 = layerT(o);
    if (keyAt(o.kf, t0)) setOverlay(o.id, { kf: dropKey(o.kf!, t0) });
    else setOverlay(o.id, { kf: setKey(o.kf, t0, tfAt(o, outNow())) });
    doneEditing();
  }
  function jumpKey(o: Overlay, dir: -1 | 1) {
    const t0 = layerT(o), ks = (o.kf ?? []).map((k) => k.t);
    const t1 = dir > 0 ? ks.find((t) => t > t0 + 1e-3) : ks.findLast((t) => t < t0 - 1e-3);
    if (t1 !== undefined) seekOut(o.at + t1);
  }
  const punchIn = (o: Overlay) => (setOverlay(o.id, { kf: punchKeys(o, layerT(o)) }), doneEditing());
  // Clearing keeps the look at the playhead as the layer's fixed transform.
  const clearKeys = (o: Overlay) => (setOverlay(o.id, { tf: tfAt(o, outNow()), kf: undefined }), doneEditing());
  const doneEditing = () => (ovEditing = false);
  // Closing a layer's settings closes the Style sheet too (on phones), instead of leaving the caption styles behind.
  const closeLayer = () => {
    selectedOverlay = '';
    if (sheet === 'style') sheet = null;
  };
  function removeOverlay() {
    if (!selectedOverlay) return false;
    commit();
    overlays = overlays.filter((o) => o.id !== selectedOverlay);
    selectedOverlay = '';
    return true;
  }
  // Stacking order: move the selected layer up (drawn later) or down.
  function restack(dir: -1 | 1) {
    const i = overlays.findIndex((o) => o.id === selectedOverlay);
    if (i < 0) return;
    commit();
    overlays = move(overlays, i, dir);
  }

  async function removeAsset(a: Asset) {
    if (!confirm(t('confirmRemoveAsset', { name: a.name }))) return;
    setClips(clips.filter((c) => c.assetId !== a.id));
    audios = audios.filter((x) => x.assetId !== a.id);
    overlays = overlays.filter((x) => x.assetId !== a.id);
    assets = assets.filter((x) => x.id !== a.id);
    past = future = []; // the file is gone, so earlier states can't be restored
    files.delete(a.id);
    URL.revokeObjectURL(urls[a.id]);
    delete urls[a.id];
    await deleteAssetIfUnused(a.id, projectId); // duplicates of this project may share the file
  }

  // Register each <video>/<audio> with the player.
  function media(node: HTMLMediaElement, [kind, id]: ['v' | 'a' | 'o', string]) {
    const map = (kind === 'v' ? player.videos : kind === 'o' ? player.overlays : player.audios) as Map<string, HTMLMediaElement>;
    map.set(id, node);
    return { destroy: () => map.get(id) === node && map.delete(id) };
  }

  // ---- Transcription: per asset (cached), then laid out along the sequence ----
  // Transcribe every clip, or just one (its captions are replaced; captions on other clips are kept).
  let transcribeTarget = $state<string>('all'); // 'all' or a clip id
  const targetClip = $derived(clips.find((c) => c.id === transcribeTarget) ?? null);
  async function run() {
    if (!hasMedia) return;
    busy = true;
    error = notice = '';
    const lang = language ?? 'auto';
    const chosen = targetClip ? [targetClip] : clips;
    try {
      const ids = [...new Set(chosen.map((c) => c.assetId))].filter((id) => kindOf(id) !== 'image'); // stills have no sound
      for (let k = 0; k < ids.length; k++) {
        const key = `${ids[k]}|${lang}`, f = files.get(ids[k]);
        if (wordCache[key] || !f) continue;
        try {
          wordCache[key] = await transcribe(f, language, (st, p) => ((status = st), (pct = ((k + p / 100) / ids.length) * 100)));
        } catch (e) {
          if ((e as Error).message !== 'err.noAudio') throw e;
          wordCache[key] = []; // a silent clip just has no words
        }
      }
      const starts = clipStarts(clips, durations);
      // Whisper can hallucinate timestamps past the end of short or silent clips; keep words inside their clip.
      const wordsOf = (c: Clip) => {
        const i = clips.indexOf(c), len = clipLen(durations, c);
        return (wordCache[`${c.assetId}|${lang}`] ?? [])
          .filter((w) => w.start < len)
          .map((w) => ({ ...w, start: w.start + starts[i], end: Math.min(w.end, len) + starts[i] }));
      };
      const fresh = groupWords(chosen.flatMap(wordsOf));
      if (targetClip) {
        const i = clips.indexOf(targetClip);
        setCaps(replaceInRange(captions, fresh, starts[i], starts[i] + clipLen(durations, targetClip)));
        if (!fresh.length) error = 'noSpeech';
      } else {
        setCaps(fresh);
        if (!captions.length) error = 'noSpeech';
      }
      // Auto clean-up: cut fillers and long pauses straight away (one more undo step, so it can be undone alone).
      if (cleanup.auto && captions.length) {
        const r = cleanupRanges(captions.flatMap((c) => c.words), duration, segments);
        if (r.fillers.length || r.silences.length) cutRanges([...r.fillers, ...r.silences]);
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }


  // Trim silences from the audio itself (no transcription): quiet stretches in every clip are cut.
  let silBusy = $state(false);
  async function cutAudioSilences() {
    if (!hasMedia || silBusy) return;
    silBusy = true;
    error = notice = '';
    try {
      const starts = clipStarts(clips, durations), byAsset = new Map<string, [number, number][]>();
      const ranges: [number, number][] = [];
      for (let i = 0; i < clips.length; i++) {
        const id = clips[i].assetId, f = files.get(id), len = clipLen(durations, clips[i]);
        if (!f || kindOf(id) === 'image') continue;
        if (!byAsset.has(id)) byAsset.set(id, await fileSilences(f, cleanup.db, cleanup.min, cleanup.pad).catch(() => []));
        for (const [a, b] of byAsset.get(id)!) if (a < len) ranges.push([starts[i] + a, starts[i] + Math.min(b, len)]);
      }
      const fresh = ranges.filter(([a, b]) => !isCut(segments, { start: a, end: b }));
      if (fresh.length) cutRanges(fresh);
      else error = 'noSilence';
    } finally {
      silBusy = false;
    }
  }

  // ---- Playback ----
  const active = (c: Caption) => time >= startOf(c) && time < endOf(c);
  const seek = (s: number) => (player.seek(Math.max(0, Math.min(s, duration))), (time = player.t), (outClock = player.o));
  // Seek by output time (exact inside freeze frames, where source time stands still).
  function seekOut(o: number) {
    seek(toSource(segments, o));
    player.o = Math.max(0, Math.min(o, outDuration(segments)));
    outClock = player.o;
  }
  const toggle = () => (player.playing ? player.pause() : player.play(), (paused = !player.playing));
  const update = (i: number, c: Caption) => setCaps(captions.with(i, c));
  let outClock = $state(0); // output time from the player (moves during freeze frames, unlike `time`)
  const outTime = $derived(outClock);

  function download(ext: 'srt' | 'vtt') {
    const caps = captionsForOutput(displayCaps, segments);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ext === 'srt' ? toSRT(caps) : toVTT(caps)], { type: 'text/plain' }));
    a.download = (name || 'captions') + '.' + ext;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Draw loop: advance the player, draw the current clip's frame (cover-fit) + active caption.
  $effect(() => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const cv = canvas;
    let id = 0;
    // Last good video frame (downscaled): shown while the element is seeking instead of black.
    const hold = document.createElement('canvas');
    const hctx = hold.getContext('2d')!;
    let held = false;
    const tick = () => {
      const w = frameW, h = frameH;
      if (cv.width !== w || cv.height !== h) ((cv.width = w), (cv.height = h));
      const tNow = player.tick();
      time = tNow;
      outClock = player.o;
      paused = !player.playing;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const p = player.frame();
      let f: CanvasImageSource | null = p && p.videoWidth ? p : null;
      let fw = p?.videoWidth ?? 0, fh = p?.videoHeight ?? 0;
      const still = !p ? stillAt() : null; // an image clip on the main track
      if (still) ((f = still), (fw = still.naturalWidth), (fh = still.naturalHeight));
      else if (p && f && !p.seeking) {
        const s = Math.min(1, 720 / Math.max(fw, fh));
        const hw = Math.round(fw * s), hh = Math.round(fh * s);
        if (hold.width !== hw || hold.height !== hh) ((hold.width = hw), (hold.height = hh));
        hctx.drawImage(p, 0, 0, hw, hh);
        held = true;
      } else if (held && player.clipsAt()) {
        f = hold; fw = hold.width; fh = hold.height;
      }
      const k = f ? Math.max(w / fw, h / fh) : 1;
      const dw = f ? fw * k : w, dh = f ? fh * k : h;
      const cap = displayCaps.find((c) => tNow >= startOf(c) && tNow < endOf(c));
      capOnScreen = cap ?? null;
      const strip = segAt(segments, tNow), fx = strip?.fx;
      if (fx?.lift) f = null; // a lifted strip is a gap: black
      else if (f && fx?.color) f = grader.apply(f, fw, fh, fx.color, lutMap.get(fx.color.lut ?? ''), tNow);
      capBox = null;
      let below: Placed[] = [];
      const anyBehind = overlaysAt(overlays, player.o).some((o) => o.behind);
      drawFrame(ctx, f, f ? fw : w, f ? fh : h, f ? shakePlace(autoZoomPlace(zoomPlace(stabPlace(coverPlace(w, h, fw, fh, fx?.focus), w, h, fx?.stab, tNow), w, h, fx, tNow - (strip?.start ?? 0)), w, h, zooms, autoZoom?.scale ?? 1, tNow), w, h, Math.max(fx?.shake ?? 0, autoZoom?.shake ? zoomShake(zooms, tNow) : 0), tNow) : [0, 0, w, h], fx, !!cap,
        () => {
          placed = [...below, ...drawLayers(ctx, tNow, false)];
          capBox = cap ? drawCaption(ctx, cap, tNow, resolveStyle(style, cap.style)) : null;
        },
        anyBehind ? () => (below = drawLayers(ctx, tNow, true)).length > 0 : undefined, bgImageOf(fx));
      // Transition into this strip (over the finished frame: video, layers, captions).
      const si = strip ? segments.indexOf(strip) : -1;
      if (si >= 0) {
        const segStartOut = toOutput(segments, strip!.start) ?? 0;
        trans.apply(ctx, strip!.fx?.trans, si, player.o - segStartOut, strip!.fx?.transDur ?? TRANS_DUR);
      }
      const sel = placed.find((p) => p.id === selectedOverlay);
      const selO = sel && overlays.find((o) => o.id === sel.id);
      if (selO && hasPath(selO.motion)) drawSPath(ctx, selO, cv.width / (cv.getBoundingClientRect().width || cv.width));
      if (sel) drawLayerBox(ctx, sel, cv.width / (cv.getBoundingClientRect().width || cv.width));
      // Drag box: preview only (export never draws it). Shown while paused, hovered or dragged.
      // Platform UI zones (preview only): captions under the app's buttons/description get a warning.
      capInZone = !!(safe && capBox && overlapsZone(safe, capBox, w, h));
      if (safe) drawSafeZones(ctx, safe, capInZone);
      if (capBox && (paused || hover || drag?.onBox)) drawDragBox(ctx, capBox, cv.width / (cv.getBoundingClientRect().width || cv.width));
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  });

  // Make sure the chosen font is downloaded before the canvas uses it.
  $effect(() => {
    document.fonts.load(fontString(style, 40)).catch(() => {});
  });

  // ---- Overlay layers on the preview ----
  let placed: Placed[] = []; // layers drawn this frame, bottom first (for hit tests)
  const trans = new Transitioner();
  let safe = $state<Platform | ''>('');
  let capInZone = $state(false);
  const grader = new Grader();

  // ---- Colour: per-strip grade; LUT files are kept per project (data under lut:<id>) ----
  let luts = $state<Lut[]>([]);
  const lutMap = $derived(new Map(luts.map((l) => [l.id, l])));
  async function importLut(file: File | undefined) {
    if (!file) return;
    try {
      const l = parseCube(await file.text(), file.name.replace(/\.cube$/i, ''));
      await store.set('lut:' + l.id, l);
      luts = [...luts, l];
      setColor({ lut: l.id, lutMix: 1 });
    } catch {
      error = 'err.badLut';
    }
  }
  const selColor = $derived<Color>(selected >= 0 ? segments[selected]?.fx?.color ?? {} : {});
  // Slider drags: one undo step per drag (like layer edits).
  let colorEditing = false;
  function setColor(patch: Partial<Color>, replace = false) {
    if (selected < 0 || !segments[selected]) return;
    if (!colorEditing) ((colorEditing = true), commit());
    const color = replace ? patch : { ...segments[selected].fx?.color, ...patch };
    segments = segments.with(selected, { ...segments[selected], fx: { ...segments[selected].fx, color } });
  }
  // Reframing only matters when the canvas shape differs from the footage.
  const reframes = $derived(Math.abs(frameW / frameH - srcW / srcH) > 0.01);
  function setFocus(focus: { x: number; y: number } | undefined) {
    if (selected < 0 || !segments[selected]) return;
    if (!colorEditing) ((colorEditing = true), commit());
    segments = segments.with(selected, { ...segments[selected], fx: { ...segments[selected].fx, focus } });
  }
  // Auto-reframe: find the person in a few frames of the strip and centre on them (median, so one miss doesn't matter).
  let reframing = $state(false);
  async function focusOf(i: number): Promise<{ x: number; y: number } | null> {
    const s = segments[i], starts = clipStarts(clips, durations);
    const ci = clips.findIndex((_, k) => s.start >= starts[k] - 1e-6 && s.start < starts[k] + clipLen(durations, clips[k]));
    if (ci < 0) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.src = urls[clips[ci].assetId];
    await new Promise((r, j) => ((v.onloadeddata = r), (v.onerror = j)));
    const xs: number[] = [], ys: number[] = [];
    for (let k = 0; k < 5; k++) {
      v.currentTime = s.start - starts[ci] + ((k + 0.5) / 5) * (s.end - s.start);
      await new Promise((r) => (v.onseeked = r));
      const c = await subjectCenter(v, v.videoWidth, v.videoHeight).catch(() => null);
      if (c) (xs.push(c.x), ys.push(c.y));
    }
    v.removeAttribute('src');
    return xs.length ? { x: median(xs), y: median(ys) } : null;
  }
  async function autoReframe(i: number) {
    reframing = true;
    error = '';
    try {
      const f = await focusOf(i);
      if (!f) return void (error = 'noPerson');
      commit();
      segments = segments.with(i, { ...segments[i], fx: { ...segments[i].fx, focus: f } });
    } catch {
      error = 'noPerson';
    } finally {
      reframing = false;
    }
  }
  async function autoReframeAll() {
    reframing = true;
    try {
      const fs: ({ x: number; y: number } | null)[] = [];
      for (let i = 0; i < segments.length; i++) fs.push(await focusOf(i).catch(() => null));
      commit();
      segments = segments.map((s, i) => (fs[i] ? { ...s, fx: { ...s.fx, focus: fs[i]! } } : s));
    } finally {
      reframing = false;
    }
  }
  function colorToAll() {
    commit();
    const color = $state.snapshot(selColor);
    segments = segments.map((s) => ({ ...s, fx: { ...s.fx, color } }));
  }
  // behind: draw only the layers marked "behind person" (true) or only the others (false).
  // The picture for an "image" background, once loaded.
  function bgImageOf(fx?: Fx) {
    const img = fx?.bg === 'image' && fx.bgImage ? images.get(fx.bgImage) : undefined;
    return img?.complete && img.naturalWidth ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null;
  }
  // The image of the image clip under the playhead, once it has loaded.
  function stillAt(): HTMLImageElement | null {
    const at = clipAt(clips, durations, time);
    const img = at ? images.get(clips[at.index].assetId) : undefined;
    return img?.complete && img.naturalWidth ? img : null;
  }
  function drawLayers(ctx: CanvasRenderingContext2D, t: number, behind: boolean): Placed[] {
    if (toOutput(segments, t) === null) return [];
    const out = player.o;
    const res: Placed[] = [];
    for (const o of overlaysAt(overlays, out)) {
      if (!!o.behind !== behind) continue;
      let src: CanvasImageSource | null = null, sw = 0, sh = 0;
      if (o.kind === 'video') {
        const v = player.overlayFrame(o.id);
        if (v) ((src = v), (sw = v.videoWidth), (sh = v.videoHeight));
      } else if (o.kind === 'image') {
        const img = images.get(o.assetId ?? '');
        if (img?.complete && img.naturalWidth) ((src = img), (sw = img.naturalWidth), (sh = img.naturalHeight));
      }
      const p = drawOverlay(ctx, o, out, src, sw, sh);
      if (p) res.push(p);
    }
    return res;
  }
  // Preview guide for a title's S path (export never draws it).
  function drawSPath(ctx: CanvasRenderingContext2D, o: Overlay, k: number) {
    const W = ctx.canvas.width, H = ctx.canvas.height, base = tfAt(o, player.o), m = o.motion!;
    ctx.save();
    ctx.strokeStyle = 'rgba(106,184,255,0.8)';
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([6 * k, 6 * k]);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const p = sPoint(m, i / 48), x = (base.x + p.dx) * W, y = (base.y + p.dy) * H;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  // Selection frame: rotated outline, corner squares to scale, a round knob above to rotate.
  const ROT_GAP = 26; // CSS px from the top edge to the rotate knob
  function drawLayerBox(ctx: CanvasRenderingContext2D, p: Placed, k: number) {
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.strokeStyle = '#6ab8ff';
    ctx.lineWidth = 2 * k;
    ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.beginPath();
    ctx.moveTo(0, -p.h / 2);
    ctx.lineTo(0, -p.h / 2 - ROT_GAP * k);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    const r = 5 * k;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.fillRect(sx * p.w / 2 - r, sy * p.h / 2 - r, r * 2, r * 2);
      ctx.strokeRect(sx * p.w / 2 - r, sy * p.h / 2 - r, r * 2, r * 2);
    }
    ctx.beginPath();
    ctx.arc(0, -p.h / 2 - ROT_GAP * k, 6 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  // Which part of the selected layer's frame is under a canvas point.
  function layerHandle(p: Placed, x: number, y: number, k: number, grow: number): 'scale' | 'rotate' | null {
    const g = (grow + 6) * k;
    const a = (p.rot * Math.PI) / 180, top = { x: p.cx + Math.sin(a) * (p.h / 2 + ROT_GAP * k), y: p.cy - Math.cos(a) * (p.h / 2 + ROT_GAP * k) };
    if (Math.hypot(x - top.x, y - top.y) <= g + 4 * k) return 'rotate';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const c = corner(p, sx, sy);
      if (Math.hypot(x - c.x, y - c.y) <= g) return 'scale';
    }
    return null;
  }
  type LayerDrag = { id: string; mode: 'move' | 'scale' | 'rotate'; x0: number; y0: number; tf: Transform; cx: number; cy: number; d0: number; a0: number; moved: boolean };
  let layerDrag: LayerDrag | null = null;

  // ---- Caption drag box ----
  // Drag inside the box (or its grab handle) to move the caption; a tap elsewhere plays/pauses.
  // Touch and pen get a much larger grab margin than a mouse.
  let capBox: Box | null = null; // canvas px, caption drawn this frame
  let capOnScreen: Caption | null = null;
  let hover = false;
  let drag: { moved: boolean; onBox: boolean; x0: number; y0: number; ox: number; oy: number; capId: string | null } | null = null;
  const GROW = { mouse: 8, touch: 28 }; // CSS px around the box that still grabs it
  const HANDLE = 14; // CSS px radius of the round grab handle under the box

  const handleAt = (b: Box, k: number) => ({ x: b.x + b.w / 2, y: b.y + b.h + HANDLE * 1.6 * k });

  function drawDragBox(ctx: CanvasRenderingContext2D, b: Box, k: number) {
    ctx.save();
    ctx.strokeStyle = '#c8f560';
    ctx.lineWidth = 2 * k;
    ctx.setLineDash([6 * k, 4 * k]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c8f560';
    const s = 8 * k;
    for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) ctx.fillRect(x - s / 2, y - s / 2, s, s);
    // Round grab handle with a four-way arrow, easy to hit with a thumb.
    const h = handleAt(b, k), r = HANDLE * k;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f0f0f';
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(h.x - r * 0.55, h.y); ctx.lineTo(h.x + r * 0.55, h.y);
    ctx.moveTo(h.x, h.y - r * 0.55); ctx.lineTo(h.x, h.y + r * 0.55);
    ctx.stroke();
    ctx.restore();
  }

  // Is this pointer on the caption box or its handle? Coordinates are canvas px.
  function onCaption(e: PointerEvent) {
    if (!capBox) return false;
    const r = canvas!.getBoundingClientRect(), k = canvas!.width / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const touch = e.pointerType !== 'mouse';
    const h = handleAt(capBox, k);
    return inBox(capBox, x, y, (touch ? GROW.touch : GROW.mouse) * k) || Math.hypot(x - h.x, y - h.y) <= (HANDLE + (touch ? 16 : 4)) * k;
  }

  // Captions with their own position override move by themselves; others move the project style.
  const ownPosition = (c: Caption | null) => !!c && (c.style?.x !== undefined || c.style?.y !== undefined || selectedSet.has(c.id));
  function moveCaption(capId: string | null, x: number, y: number) {
    const nx = Math.min(0.95, Math.max(0.05, x)), ny = Math.min(0.95, Math.max(0.05, y));
    if (capId) captions = captions.map((c) => (c.id === capId ? { ...c, style: { ...c.style, x: nx, y: ny } } : c));
    else ((style.x = nx), (style.y = ny));
  }

  function pointer(e: PointerEvent) {
    const r = canvas!.getBoundingClientRect();
    const k = canvas!.width / (r.width || canvas!.width);
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const grow = e.pointerType === 'mouse' ? 0 : 14;
    if (pickKey) {
      if (e.type === 'pointerdown') samplePick(x, y);
      else canvas!.style.cursor = 'crosshair';
      return;
    }
    if (layerPointer(e, x, y, k, grow)) return;
    if (e.type === 'pointerdown') {
      const onBox = onCaption(e);
      const capId = onBox && ownPosition(capOnScreen) ? capOnScreen!.id : null;
      const pos = capId ? resolveStyle(style, capOnScreen!.style) : style;
      drag = { moved: false, onBox, x0: e.clientX, y0: e.clientY, ox: pos.x, oy: pos.y, capId };
      canvas!.setPointerCapture(e.pointerId);
    } else if (e.type === 'pointermove') {
      if (!drag) {
        hover = onCaption(e);
        canvas!.style.cursor = hover ? 'move' : 'pointer';
        return;
      }
      if (!drag.onBox) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) ((drag.moved = true), drag.capId && commit()); // one undo step per drag of a caption override
      moveCaption(drag.capId, drag.ox + dx / r.width, drag.oy + dy / r.height);
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
      if (drag && !drag.moved && e.type === 'pointerup') toggle();
      drag = null;
    }
  }

  // Layers: the selected one's handles win, then the caption box, then the topmost layer under the pointer.
  // Returns true when the event was a layer action.
  function layerPointer(e: PointerEvent, x: number, y: number, k: number, grow: number): boolean {
    if (e.type === 'pointerdown') {
      const sel = placed.find((p) => p.id === selectedOverlay);
      let mode: LayerDrag['mode'] | null = sel ? layerHandle(sel, x, y, k, grow) : null;
      let hit = mode ? sel! : null;
      if (!hit && !onCaption(e)) {
        hit = [...placed].reverse().find((p) => hitPlaced(p, x, y, grow * k)) ?? null;
        if (hit) mode = 'move';
      }
      if (!hit || !mode) {
        if (selectedOverlay && !onCaption(e)) selectedOverlay = '';
        return false;
      }
      const o = overlays.find((v) => v.id === hit!.id);
      if (!o) return false;
      selectedOverlay = o.id;
      layerDrag = { id: o.id, mode, x0: x, y0: y, tf: { ...tfAt(o, outNow()) }, cx: hit.cx, cy: hit.cy,
        d0: Math.max(1, Math.hypot(x - hit.cx, y - hit.cy)), a0: Math.atan2(y - hit.cy, x - hit.cx), moved: false };
      canvas!.setPointerCapture(e.pointerId);
      return true;
    }
    if (e.type === 'pointermove') {
      if (!layerDrag) {
        const sel = placed.find((p) => p.id === selectedOverlay);
        const h = sel && layerHandle(sel, x, y, k, grow);
        if (h) return ((canvas!.style.cursor = h === 'rotate' ? 'grab' : 'nwse-resize'), true);
        if (!onCaption(e) && placed.some((p) => hitPlaced(p, x, y))) return ((canvas!.style.cursor = 'move'), (hover = false), true);
        return false;
      }
      const d = layerDrag, W = canvas!.width, H = canvas!.height;
      if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 4 * k) return true;
      if (!d.moved) ((d.moved = true), commit());
      if (d.mode === 'move') {
        // Snap the centre to the frame's centre lines (Alt to place freely).
        let nx = d.tf.x + (x - d.x0) / W, ny = d.tf.y + (y - d.y0) / H;
        if (!e.altKey && Math.abs(nx - 0.5) < 0.015) nx = 0.5;
        if (!e.altKey && Math.abs(ny - 0.5) < 0.015) ny = 0.5;
        setTf(d.id, { x: nx, y: ny }, false);
      } else if (d.mode === 'scale') {
        setTf(d.id, { scale: Math.max(0.05, Math.min(8, d.tf.scale * (Math.hypot(x - d.cx, y - d.cy) / d.d0))) }, false);
      } else {
        let deg = d.tf.rotation + ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
        deg = ((deg % 360) + 540) % 360 - 180; // -180..180
        if (!e.altKey) for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) < 5) deg = s;
        setTf(d.id, { rotation: Math.round(deg) }, false);
      }
      return true;
    }
    if (layerDrag && (e.type === 'pointerup' || e.type === 'pointercancel')) {
      layerDrag = null;
      return true;
    }
    return false;
  }

  // Keyboard: with the preview focused, arrow keys nudge the caption (Shift = bigger steps).
  function nudge(e: KeyboardEvent) {
    const d = e.shiftKey ? 0.05 : 0.01;
    const dir = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!dir) return;
    e.preventDefault();
    if (selOverlay) {
      const cur = tfAt(selOverlay, outNow());
      return (setTf(selOverlay.id, { x: cur.x + dir[0], y: cur.y + dir[1] }), doneEditing());
    }
    const capId = ownPosition(capOnScreen) ? capOnScreen!.id : null;
    const pos = capId ? resolveStyle(style, capOnScreen!.style) : style;
    moveCaption(capId, pos.x + dir[0], pos.y + dir[1]);
  }

  function pickFont(family: string) {
    const f = fonts.find((x) => x.family === family);
    if (f) ((style.family = f.family), (style.weight = f.weight));
  }

  async function addLocalFonts() {
    fontError = '';
    try {
      const have = new Set(fonts.map((f) => f.family));
      fonts = [...fonts, ...(await localFonts()).filter((f) => !have.has(f.family))];
    } catch (e) {
      fontError = (e as Error).message;
    }
  }

  async function addUploadedFont(f: File | undefined) {
    if (!f) return;
    fontError = '';
    try {
      const saved = await uploadFont(f);
      if (!fonts.some((x) => x.family === saved.family)) fonts = [...fonts, { family: saved.family, weight: 400 }];
      savedFonts = [...savedFonts.filter((x) => x.family !== saved.family), saved];
      store.set('fonts', savedFonts).catch(() => {});
      pickFont(saved.family);
    } catch {
      fontError = 'badFont';
    }
  }

  // ---- Layout state ----
  let tab = $state<'transcript' | 'captions'>('transcript');
  // Desktop panel visibility, remembered per project.
  const layoutKey = `sonant.layout.${projectId}`;
  const savedLayout = (() => { try { return JSON.parse(localStorage.getItem(layoutKey) ?? '{}'); } catch { return {}; } })();
  let assetsOpen = $state<boolean>(savedLayout.assets ?? true);
  let textOpen = $state<boolean>(savedLayout.text ?? true);
  let styleOpen = $state<boolean>(savedLayout.style ?? true);
  $effect(() => {
    const v = JSON.stringify({ assets: assetsOpen, text: textOpen, style: styleOpen });
    try { localStorage.setItem(layoutKey, v); } catch { /* storage unavailable */ }
  });
  const gridCols = $derived([assetsOpen && '270px', textOpen && '340px', 'minmax(0, 1fr)', styleOpen && '340px'].filter(Boolean).join(' '));
  const gridAreas = $derived.by(() => {
    const mid = [assetsOpen && 'assets', textOpen && 'text', 'center', styleOpen && 'style'].filter(Boolean) as string[];
    return [mid.map(() => 'top'), mid, mid.map(() => 'tl')].map((r) => `'${r.join(' ')}'`).join(' ');
  });
  // Phone layout: panels open one at a time as bottom sheets from the tool dock.
  let sheet = $state<'assets' | 'text' | 'style' | 'color' | null>(null);
  function openSheet(s: 'assets' | 'text' | 'style' | 'color', t?: 'transcript' | 'captions') {
    if (t) tab = t;
    sheet = sheet === s && (!t || tab === t) ? null : s;
  }
  // Phone: a video strip or video/image layer is selected → color & video styles get their own sheet.
  const hasVideoSel = $derived(selected >= 0 && !!segments[selected] && !selOverlay);
  $effect(() => { if (sheet === 'color' && !hasVideoSel) sheet = null; });
  let zoom = $state(1); // 1 = fit to the stage
  let filter = $state<'all' | 'video' | 'audio' | 'image'>('all');
  const shown = $derived(assets.filter((a) => filter === 'all' || a.kind === filter));
  const used = $derived(new Set([...clips.map((c) => c.assetId), ...audios.map((a) => a.assetId)]));
  const selAudio = $derived(audios.find((a) => a.id === selectedAudio));

  let transcriptView = $state<TranscriptView>();
  const cutRanges = (r: [number, number][]) => setSegs(r.reduce((s, [a, b]) => cutRange(s, a, b), segments));
  const keepRanges = (r: [number, number][]) => setSegs(r.reduce((s, [a, b]) => keepRange(s, a, b), segments));
  const visibleCaps = $derived(keptCaptions(captions, segments)); // kept words of the original captions
  // ---- Translation: a second language per caption (Caption.tr), shown instead of the original when on ----
  let showTr = $state(false);
  let trDir = $state<Dir>('en-es');
  $effect(() => { if (language) trDir = language === 'spanish' ? 'es-en' : 'en-es'; });
  let trBusy = $state(false);
  const hasTr = $derived(captions.some((c) => c.tr));
  // What the preview, SRT/VTT files and export show.
  // Zoom moments come from the original captions (translated ones don't carry emphasis).
  const zooms = $derived(autoZoom ? zoomMoments(keptCaptions(captions, segments), autoZoom) : []);
  const displayCaps = $derived(showTr ? translated(visibleCaps) : visibleCaps);
  async function translateAll() {
    if (!captions.length) return;
    trBusy = true;
    error = '';
    try {
      const texts = await translateTexts(captions.map(captionText), trDir, (st, p) => ((status = st), (pct = p)));
      const byId = new Map(captions.map((c, i) => [c.id, texts[i]]));
      setCaps(captions.map((c) => ({ ...c, tr: byId.get(c.id) || undefined })));
      showTr = true;
    } catch (e) {
      error = (e as Error).message || 'err.translate';
    } finally {
      trBusy = false;
      status = '';
    }
  }
  // Where someone is talking, in output time: music marked "duck" dips under it.
  const speech = $derived(speechRanges(captionsForOutput(visibleCaps, segments).flatMap((c) => c.words)));
  // Clean-up preview on the timeline: what "Apply" would cut.
  const pendingCuts = $derived.by(() => {
    if (!cleanup.preview) return [];
    const r = cleanupRanges(captions.flatMap((c) => c.words), duration, segments);
    return [...r.fillers, ...r.silences];
  });

  // Auto-select: follow the playhead. The caption under it becomes the selection (none in a gap),
  // and with more than one video strip the strip under it is selected too. Only acts when the
  // thing under the playhead changes, so a manual pick stays until the playhead moves on.
  const pref = (k: string) => { try { return localStorage.getItem('sonant.' + k) !== '0'; } catch { return true; } };
  let snapOn = $state(pref('snap'));
  $effect(() => { try { localStorage.setItem('sonant.snap', snapOn ? '1' : '0'); } catch {} });
  let marks = $state<[number | null, number | null]>([null, null]); // I/O range, sequence time
  let showKeys = $state(false);
  let autoSelect = $state((() => { try { return localStorage.getItem('sonant.autoSelect') !== '0'; } catch { return true; } })());
  $effect(() => { try { localStorage.setItem('sonant.autoSelect', autoSelect ? '1' : '0'); } catch {} });
  const capUnder = $derived(visibleCaps.find((c) => time >= startOf(c) && time < endOf(c))?.id ?? null);
  const stripUnder = $derived(segments.length > 1 ? segments.findIndex((g) => time >= g.start && time < g.end) : -2);
  // Paused while a pointer is down, so a drag's live preview seek can't swap the selection mid-drag.
  let pressing = $state(false);
  $effect(() => {
    const down = () => (pressing = true), up = () => (pressing = false);
    addEventListener('pointerdown', down, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
    return () => (removeEventListener('pointerdown', down, true), removeEventListener('pointerup', up, true), removeEventListener('pointercancel', up, true));
  });
  $effect(() => {
    const id = capUnder;
    if (!autoSelect || pressing) return;
    if (id) { if (selectedCapIds.length !== 1 || selectedCapIds[0] !== id) selectedCapIds = [id]; }
    else if (selectedCapIds.length) selectedCapIds = [];
  });
  $effect(() => {
    const i = stripUnder;
    if (autoSelect && !pressing && i !== -2 && selected !== i) selected = i;
  });

  // Add a 2-second line at the playhead, kept in time order.
  function addLine() {
    const s = time, e = Math.min(duration || s + 2, s + 2);
    const c = setText({ id: crypto.randomUUID(), words: [{ text: '…', start: s, end: e }] }, t('newLine'));
    const i = captions.findIndex((x) => startOf(x) > s);
    setCaps(i < 0 ? [...captions, c] : captions.toSpliced(i, 0, c));
    tab = 'captions';
  }

  const currentCap = $derived(visibleCaps.find((c) => time >= startOf(c) && time < endOf(c)) ?? selectedCap);
  const currentAnim = $derived(currentCap?.style?.animation ?? style.animation);
  const animName = $derived(t('anim.' + currentAnim));
  // The preview pill names the animation only when every caption uses the same one (no mixed overrides).
  const sharedAnim = $derived.by(() => {
    if (!captions.length) return null;
    const set = new Set(captions.map((c) => c.style?.animation ?? style.animation));
    return set.size === 1 ? [...set][0] : null;
  });
  const saveState = $derived(saving ? t('saving') : t('saved'));

  const cutHere = () => (setSegs(splitAt(segments, time)), announce(t('a11y.split', { t: tc(outTime) })));
  // Effects of the selected strip (captions behind the person, background swap).
  const selFx = $derived(selected >= 0 && segments[selected] ? (segments[selected].fx ?? {}) : null);
  // Strip chroma key: live while dragging a slider, one undo step per gesture.
  let stripKeyEditing = false;
  function setStripKey(k: ChromaKey | undefined, final: boolean) {
    if (selected < 0) return;
    if (!stripKeyEditing) ((stripKeyEditing = true), commit());
    segments = segments.with(selected, { ...segments[selected], fx: { ...segments[selected].fx, key: k } });
    if (final) stripKeyEditing = false;
  }
  // Key colour eyedropper: keys are switched off in the preview, the next click samples the frame there.
  let pickKey = $state<string | null>(null); // layer id, 'strip', or null
  let pickStrip = -1;
  function startPick(target: string) {
    if (pickKey === target) return endPick();
    pickKey = target;
    pickStrip = selected;
    keyBypass.on = true;
  }
  function endPick() {
    pickKey = null;
    keyBypass.on = false;
    if (canvas) canvas.style.cursor = '';
  }
  function samplePick(x: number, y: number) {
    const c = canvas!.getContext('2d')!, r = 3;
    const d = c.getImageData(Math.max(0, Math.round(x) - r), Math.max(0, Math.round(y) - r), r * 2 + 1, r * 2 + 1).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
    const hex = '#' + sum.map((v) => Math.round(v / (d.length / 4)).toString(16).padStart(2, '0')).join('');
    if (pickKey === 'strip') {
      const s = segments[pickStrip];
      if (s) (commit(), (segments = segments.with(pickStrip, { ...s, fx: { ...s.fx, key: { ...(s.fx?.key ?? DEFAULT_KEY), color: hex } } })));
    } else {
      const o = overlays.find((v) => v.id === pickKey);
      if (o) (setOverlay(o.id, { key: { ...(o.key ?? DEFAULT_KEY), color: hex } }), doneEditing());
    }
    endPick();
  }
  let showPerf = $state(false);
  const setFx = (p: Partial<Fx>) => selected >= 0 && setSegs(segments.with(selected, { ...segments[selected], fx: { ...segments[selected].fx, ...p } }));
  const deleteSelected = () => selected >= 0 && (setSegs(remove(segments, selected)), (selected = -1), announce(t('a11y.deleted')), true);
  function removeAudioItem() {
    if (!selectedAudio) return false;
    commit();
    audios = audios.filter((a) => a.id !== selectedAudio);
    selectedAudio = '';
    return true;
  }
  // Beats of the selected music: detected once per file and kept on the asset.
  let beatBusy = $state(false);
  async function detectBeatsFor(assetId: string) {
    const f = files.get(assetId);
    if (!f) return;
    beatBusy = true;
    try {
      const r = await beatsOfFile(f);
      assets = assets.map((a) => (a.id === assetId ? { ...a, beats: r.times, bpm: r.bpm } : a));
      if (!r.times.length) error = 'noBeats';
    } catch {
      error = 'noBeats';
    } finally {
      beatBusy = false;
    }
  }
  const beatMap = $derived(new Map(assets.flatMap((a) => (a.beats?.length ? [[a.id, a.beats] as [string, number[]]] : []))));
  // Split the main video on every beat of the selected music (every `every`-th beat).
  function cutOnBeats(item: AudioItem, every = 1) {
    const a = assets.find((x) => x.id === item.assetId);
    if (!a?.beats) return;
    const off = item.offset ?? 0, len = itemLen(item, a.duration), end = outDuration(segments);
    const outs = a.beats.filter((_, i) => i % every === 0).map((b) => item.at + b - off).filter((t) => t > item.at && t < Math.min(item.at + len, end));
    setSegs(outs.reduce((s, o) => splitAt(s, toSource(s, o)), segments));
  }
  const setAudio = (id: string, patch: Partial<AudioItem>) => (audios = audios.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const FRAME = 1 / 30;
  const step = (d: number) => (player.playing && player.pause(), (paused = true), seek(time + d));
  // Cut the I/O range (ripple: later material slides left).
  function cutMarks() {
    const [a, b] = marks;
    if (a === null || b === null) return false;
    setSegs(cutRange(segments, Math.min(a, b), Math.max(a, b)));
    marks = [null, null];
    announce(t('a11y.rangeCut'));
    return true;
  }

  function keys(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (showKeys && (e.key === 'Escape' || e.key === '?')) return (e.preventDefault(), (showKeys = false));
    // Ctrl/⌘+S saves the project file from anywhere (Shift = choose a new file).
    if (mod && e.key.toLowerCase() === 's') return (e.preventDefault(), void saveToFile(!e.shiftKey));
    if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
    if (mod && e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? redo() : undo());
    else if (mod && e.key.toLowerCase() === 'y') (e.preventDefault(), redo());
    else if (mod) return;
    else if (e.code === 'Space' && !(e.target as HTMLElement).closest?.('button')) (e.preventDefault(), toggle());
    else if (e.key === '?') showKeys = true;
    else if (e.altKey) return;
    else if (e.key.toLowerCase() === 's') cutHere();
    else if (e.key === 'Escape' && pickKey) endPick();
    else if (e.key === 'Escape') (clearCapSelection(), (marks = [null, null]), (selectedOverlay = ''));
    else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey && selFx) setFx({ lift: !selFx.lift || undefined });
    else if (e.key === 'Delete' || e.key === 'Backspace')
      cutMarks() || removeOverlay() || (tab === 'transcript' && transcriptView?.toggleSelection()) || removeAudioItem() || deleteSelected();
    // The timeline and the preview canvas handle their own arrows (seek / nudge caption).
    else if (e.key.startsWith('Arrow') && (e.target as HTMLElement).closest?.('.tl, canvas')) return;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      (e.preventDefault(), step((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : FRAME)));
    else if (e.key === 'Home') (e.preventDefault(), seek(0));
    else if (e.key === 'End') (e.preventDefault(), seek(duration));
    else if (e.key.toLowerCase() === 'k') (player.pause(), (paused = true));
    else if (e.key.toLowerCase() === 'l') (player.play(), (paused = !player.playing));
    else if (e.key.toLowerCase() === 'j') seek(time - (e.shiftKey ? 5 : 1));
    else if (e.key.toLowerCase() === 'i') ((marks = [time, marks[1]]), announce(t('a11y.markIn', { t: tc(outTime) })));
    else if (e.key.toLowerCase() === 'o') ((marks = [marks[0], time]), announce(t('a11y.markOut', { t: tc(outTime) })));
    else if (e.key.toLowerCase() === 'x') cutMarks();
    else if (e.key.toLowerCase() === 'n') ((snapOn = !snapOn), announce(t(snapOn ? 'a11y.on' : 'a11y.off', { what: t('snap') })));
    else if (e.key.toLowerCase() === 'a') ((autoSelect = !autoSelect), announce(t(autoSelect ? 'a11y.on' : 'a11y.off', { what: t('autoSelect') })));
    else if (e.key.toLowerCase() === 't') addText();
  }

  // Drag an asset card onto the timeline (or drop files anywhere on it).
  function dropOnTimeline(e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/x-asset');
    const a = id && assets.find((x) => x.id === id);
    if (a) addToTimeline(a);
    else importMedia(e.dataTransfer?.files);
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  // 00:00:08.12 (hh:mm:ss.cc)
  const tc = (s: number) => {
    const cs = Math.floor(s * 100), p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(cs / 360000))}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
  };
</script>

<svelte:window onkeydown={keys} />

<div class="app" class:hide-text={!textOpen} class:hide-style={!styleOpen} class:sheet-open={sheet !== null}
  style:--cols={gridCols} style:--areas={gridAreas}>
  <header class="top">
    <div class="brand">
      <!-- Sonant sound-ring mark (icon/sonant-mark.svg) -->
      <svg width="26" height="26" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="6" fill="#C8F560" />
        <g fill="none" stroke-linecap="round" stroke-width="5">
          <path d="M24 11A13 13 0 0 1 37 24M11 24A13 13 0 0 0 24 37" stroke="#C8F560" />
          <path d="M24 4A20 20 0 0 1 44 24M4 24A20 20 0 0 0 24 44" stroke="#707070" />
        </g>
      </svg>
      <span class="logo">Sonant</span>
      <span class="slash">/</span>
      <input class="pname" bind:value={name} placeholder={t('untitled')} aria-label={t('projectName')} disabled={!assets.length} />
      {#if assets.length}<span class="pill">{saveState}</span>{/if}
    </div>
    <div class="actions">
      <select class="lang desk" value={ui.lang} onchange={(e) => setLang(e.currentTarget.value as 'en' | 'es')} aria-label="Interface language / Idioma">
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
      <a class="btn mob-close icon" href="#/" title={t('allProjects')} aria-label={t('allProjects')}><Icon name="close" /></a>
      <button class="desk icon" onclick={() => (showPerf = true)} title={t('perf.title')} aria-label={t('perf.title')}><Icon name="tune" /></button>
      <a class="btn desk icon" href="#/help" target="_blank" rel="noopener" title={t('help')} aria-label={t('help')}><Icon name="help" /></a>
      <a class="btn desk" href="#/" title={t('allProjects')}>
        <Icon name="grid_view" />
        {t('projects')}
      </a>
      <button class="desk" onclick={() => saveToFile()} disabled={!assets.length} title={t('saveFileTip')}><Icon name="save" size={16} /> {fileStatus ? t(fileStatus) : t('saveFile')}</button>
      <button class="desk" onclick={openHistory} disabled={!assets.length} title={t('historyTip')}><Icon name="history" size={16} /> {t('history')}</button>
      <button class="desk" class:on={assetsOpen} onclick={() => (assetsOpen = !assetsOpen)} aria-pressed={assetsOpen} title={t('toggleAssets')}>
        <Icon name="view_sidebar" />
        {t('assets')}
      </button>
      <button class="desk" class:on={textOpen} onclick={() => (textOpen = !textOpen)} aria-pressed={textOpen} title={t('toggleText')}>
        <Icon name="description" />
        {t('text')}
      </button>
      <button class="desk" class:on={styleOpen} onclick={() => (styleOpen = !styleOpen)} aria-pressed={styleOpen} title={t('toggleStyle')}>
        <Icon name="text_fields" />
        {t('style')}
      </button>
      <button class="primary" onclick={() => exporter?.open()} disabled={!hasMedia || !segments.length || !firstVideo}><Icon name="ios_share" size={16} /> {t('ex.title')}</button>
    </div>
  </header>

  {#if assetsOpen || sheet === 'assets'}
    <aside class="assets panel" class:shown={sheet === 'assets'}>
      <div class="grab" aria-hidden="true"></div>
      <div class="phead">
        <h2>{t('assets')}</h2>
        <button class="icon sm" onclick={() => { if (sheet) sheet = null; else assetsOpen = false; }} aria-label={t('collapse')}><Icon name="chevron_left" /></button>
      </div>
      <label class="import">
        <Icon name="upload" /> {t('importMedia')}
        <input type="file" accept="video/*,audio/*,image/*" multiple hidden onchange={(e) => importMedia(e.currentTarget.files)} />
      </label>
      <div class="filters" role="group" aria-label={t('assets')}>
        {#each ['all', 'video', 'audio', 'image'] as const as f}
          <button class:on={filter === f} aria-pressed={filter === f} onclick={() => (filter = f)}>{t('filter.' + f)}</button>
        {/each}
      </div>
      <div class="grid">
        {#each shown as a (a.id)}
          <div class="asset" draggable="true" role="listitem"
            ondragstart={(e) => e.dataTransfer?.setData('text/x-asset', a.id)}>
            <div class="thumb" class:used={used.has(a.id)}>
              {#if a.kind === 'image' && urls[a.id]}<img src={urls[a.id]} alt="" />
              {:else if a.kind === 'video' && thumbs[a.id]?.length}<img src={thumbs[a.id][Math.floor(thumbs[a.id].length / 3)].url} alt="" />
              {:else}<span class="muted ph">{#if a.kind === 'audio'}<Icon name="music_note" size={20} />{/if}{a.kind === 'audio' ? t('filter.audio') : t('filter.video')}</span>{/if}
              {#if a.kind !== 'image'}<span class="dur mono">{fmt(a.duration)}</span>{/if}
              {#if a.id in proxyPct}<span class="proxybar" style:width="{proxyPct[a.id] * 100}%" title={t('proxyBuilding')}></span>{/if}
              <span class="acts">
                <button class="sm icon" onclick={() => addToTimeline(a)} aria-label={t('addToTimeline', { name: a.name })} title={t('addToTimeline', { name: a.name })}>+</button>
                {#if a.kind === 'image'}
                  <button class="sm icon" onclick={() => addOverlay(a)} aria-label={t('addOverlay', { name: a.name })} title={t('addOverlay', { name: a.name })}><Icon name="picture_in_picture_alt" /></button>
                {/if}
                {#if a.kind === 'video'}
                  <button class="sm icon" class:on={!!a.proxy} aria-pressed={!!a.proxy} disabled={a.id in proxyPct}
                    onclick={() => (a.proxy ? dropProxy(a) : buildProxy(a))} title={a.proxy ? t('proxyOn') : t('proxyMake')} aria-label={a.proxy ? t('proxyOn') : t('proxyMake')}><Icon name="bolt" /></button>
                  <button class="sm icon" onclick={() => addOverlay(a)} aria-label={t('addOverlay', { name: a.name })} title={t('addOverlay', { name: a.name })}><Icon name="picture_in_picture_alt" /></button>
                {/if}
                <button class="sm icon" onclick={() => removeAsset(a)} aria-label={t('removeAsset', { name: a.name })} title={t('removeAsset', { name: a.name })}><Icon name="close" /></button>
              </span>
            </div>
            <span class="aname" title={a.name}>{a.name}</span>
          </div>
        {/each}
      </div>
      <p class="muted small">{assets.length ? t('dragToTimeline') : t('assetsHint')}</p>

      {#if clips.length}
        <h3 class="sub">{t('sequence')}</h3>
        <ol class="seq">
          {#each clips as c, i (c.id)}
            <li>
              <span class="mono muted small">{i + 1}</span>
              <span class="aname" title={names.get(c.assetId)}>{names.get(c.assetId)}</span>
              {#if kindOf(c.assetId) === 'image'}
                <input class="clen mono" type="number" min="0.5" max="600" step="0.5" value={clipLen(durations, c)}
                  aria-label={t('clipDuration')} title={t('clipDuration')} onchange={(e) => setClipLen(i, +e.currentTarget.value)} /><span class="muted small">s</span>
              {/if}
              <button class="sm icon" onclick={() => setClips(move(clips, i, -1))} disabled={i === 0} aria-label={t('moveUp')}><Icon name="arrow_upward" /></button>
              <button class="sm icon" onclick={() => setClips(move(clips, i, 1))} disabled={i === clips.length - 1} aria-label={t('moveDown')}><Icon name="arrow_downward" /></button>
              <button class="sm icon" onclick={() => setClips(clips.toSpliced(i, 1))} aria-label={t('removeClip')}><Icon name="close" /></button>
            </li>
          {/each}
        </ol>
        <label class="vol">{t('clipAudio')} <span class="mono small">{Math.round(clipVolume * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={clipVolume} />
        </label>
        <label class="vol" title={t('dnTip')}>{t('denoise')}
          <select bind:value={denoise}>
            {#each DENOISE_LEVELS as l (l)}<option value={l}>{t('dn.' + l)}</option>{/each}
          </select>
        </label>
        {#if cleanPct !== null}<p class="muted small" role="status">{t('dnBusy')} {Math.round(cleanPct)}%</p>{/if}
      {/if}
      <VoiceoverPanel caps={captionsForOutput(displayCaps, segments)} selectedIds={selectedSet} lang={language} disabled={!hasMedia} onadd={addVoiceover} />
    </aside>
  {/if}

  <section class="text panel" class:shown={sheet === 'text'}>
    <div class="grab" aria-hidden="true"></div>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'transcript'} class:on={tab === 'transcript'} onclick={() => (tab = 'transcript')}>{t('transcript')}</button>
      <button role="tab" aria-selected={tab === 'captions'} class:on={tab === 'captions'} onclick={() => (tab = 'captions')}>{t('captions')}</button>
      <button class="icon sm sheet-x" onclick={() => (sheet = null)} aria-label={t('ex.close')}><Icon name="close" /></button>
    </div>
    <div class="scroll">
      {#if notice}<p class="notice">{t(notice)}</p>{/if}
      <div class="row">
        <select bind:value={language} disabled={busy} aria-label={t('language')}>
          <option value={null}>{t('auto')}</option>
          <option value="english">English</option>
          <option value="spanish">Español</option>
        </select>
        <button onclick={run} disabled={!hasMedia || busy}>{captions.length ? t('retranscribe') : t('transcribe')}</button>
      </div>
      {#if clips.length > 1}
        <select class="target" bind:value={transcribeTarget} disabled={busy} aria-label={t('transcribeWhich')}>
          <option value="all">{t('allClips')}</option>
          {#each clips as c, i (c.id)}<option value={c.id}>{i + 1}. {names.get(c.assetId)}</option>{/each}
        </select>
      {/if}
      {#if busy}
        <p class="muted small">{t(status)}</p>
        <progress max="100" value={pct}></progress>
      {/if}
      {#if error}<p class="error small">{t(error)}</p>{/if}

      {#if tab === 'transcript'}
        <details class="hl" ontoggle={(e) => e.currentTarget.open && !highlights && captions.length && findClips()}>
          <summary><Icon name="auto_awesome_motion" size={16} /> {t('hlTitle')}</summary>
          {#if !captions.length}
            <p class="muted small">{t('hlNeedTranscript')}</p>
          {:else}
            <p class="muted small">{t('hlHint')}</p>
            <div class="row">
              <label class="vol inline">{t('hlLen')}
                <select value={`${hlOpts.min}-${hlOpts.max}`} onchange={(e) => { const [a, b] = e.currentTarget.value.split('-').map(Number); hlOpts.min = a; hlOpts.max = b; findClips(); }}>
                  {#each ['15-30', '20-45', '30-60'] as r}<option value={r}>{r.replace('-', '–')}s</option>{/each}
                </select>
              </label>
              <button class="sm" onclick={findClips}><Icon name="refresh" size={16} /> {t('hlFind')}</button>
            </div>
            {#if highlights && !highlights.length}<p class="muted small">{t('hlNone')}</p>{/if}
            <ol class="hls">
              {#each highlights ?? [] as h, i (h.start)}
                <li>
                  <div class="mono small">{fmt(toOutput(segments, h.start) ?? h.start)} · {Math.round(h.end - h.start)}s
                    {#each h.reasons as r}<span class="chip">{t('hl.' + r)}</span>{/each}</div>
                  <div class="hlt">“{h.title}”</div>
                  <div class="row">
                    <button class="sm" onclick={() => previewClip(h)}><Icon name="play_arrow" size={16} /> {t('hlPreview')}</button>
                    {#if shortsMade[h.start]}
                      <a class="btn sm" href={`#/p/${shortsMade[h.start]}`}><Icon name="open_in_new" size={16} /> {t('hlOpen')}</a>
                    {:else}
                      <button class="sm primary" onclick={() => makeShort(h, i + 1)}><Icon name="add" size={16} /> {t('hlMake')}</button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </details>
        <details class="audio-sil">
          <summary>{t('audioSilTitle')}</summary>
          <p class="muted small">{t('audioSilHint')}</p>
          <label class="sl">{t('audioSilDb')} <span class="mono">{cleanup.db} dB</span>
            <input type="range" min="-60" max="-15" step="1" bind:value={cleanup.db} /></label>
          <label class="sl">{t('minPause')} <span class="mono">{cleanup.min.toFixed(1)}s</span>
            <input type="range" min="0.2" max="2" step="0.1" bind:value={cleanup.min} /></label>
          <label class="sl">{t('keepPad')} <span class="mono">{cleanup.pad.toFixed(2)}s</span>
            <input type="range" min="0" max="0.5" step="0.05" bind:value={cleanup.pad} /></label>
          <button class="sm primary" onclick={cutAudioSilences} disabled={!hasMedia || silBusy || busy}>
            {silBusy ? t('audioSilBusy') : t('audioSilRun')}</button>
        </details>
        {#if !captions.length && !busy}<p class="muted small">{t('transcriptEmpty')}</p>{/if}
        {#if captions.length}
          <div class="spkrow">
            <button class="sm" onclick={detectSpeakers} disabled={spkBusy || busy} title={t('spkTip')}><Icon name="groups" size={16} /> {t('spkDetect')}</button>
            <label class="vol inline">{t('spkCount')}
              <select bind:value={spkCount} disabled={spkBusy}>
                {#each [0, 2, 3, 4, 5, 6] as n}<option value={n}>{n ? n : t('spkAuto')}</option>{/each}
              </select>
            </label>
            {#if spkBusy}<span class="muted small" role="status">{t(spkStatus || 'st.spkListening')} {spkStatus === 'st.reading' ? '' : Math.round(spkPct) + '%'}</span>
            {:else if spkMsg}<span class="muted small" role="status">{t(spkMsg, { n: spkPct })}</span>{/if}
          </div>
          <TranscriptView bind:this={transcriptView} {captions} {segments} {time} {duration}
            {speakers} onseek={seek} oncut={cutRanges} onkeep={keepRanges}
            onspeaker={(ids, k) => { if (k === speakers.length) speakers = [...speakers, '']; setCaps(setSpeaker(captions, new Set(ids), k)); }}
            onrename={(k, n) => (speakers = speakers.with(k, n))}
            onemphasis={(starts, on) => { const set = new Set(starts); setCaps(captions.map((c) => (c.words.some((w) => set.has(w.start)) ? { ...c, words: c.words.map((w) => (set.has(w.start) ? (on ? { ...w, em: true } : (({ em: _, ...r }) => r)(w)) : w)) } : c))); }} />
        {/if}
      {:else}
        <p class="muted small">{t('captionsHint')} {t('selectHint')}</p>
        {#if captions.length}
          <div class="trbox">
            <select bind:value={trDir} disabled={trBusy} aria-label={t('trDir')}>
              <option value="en-es">English → Español</option>
              <option value="es-en">Español → English</option>
            </select>
            <button class="sm" onclick={translateAll} disabled={trBusy}>{trBusy ? `${t(status || 'st.translating')} ${Math.round(pct)}%` : hasTr ? t('retranslate') : t('translate')}</button>
            {#if hasTr}
              <label class="chk"><input type="checkbox" bind:checked={showTr} /> {t('showTr')}</label>
            {/if}
          </div>
          <div class="trbox">
            <button class="sm" onclick={() => setCaps(autoEmphasis(captions))} title={t('emHint')}>{t('autoEm')}</button>
            {#if hasEmphasis(captions)}
              <button class="sm" onclick={() => setCaps(clearEmphasis(captions))}>{t('clearEm')}</button>
              <label class="sl">{t('emSize')} <span class="mono">{Math.round((style.emScale ?? 1) * 100)}%</span>
                <input type="range" min="1" max="1.5" step="0.05" value={style.emScale ?? 1} oninput={(e) => (style = { ...style, emScale: +e.currentTarget.value === 1 ? undefined : +e.currentTarget.value })} /></label>
            {/if}
            <span class="muted small">{t('emHandHint')}</span>
          </div>
          <div class="trbox">
            <label class="chk"><input type="checkbox" checked={!!autoZoom} onchange={(e) => (autoZoom = e.currentTarget.checked ? { ...DEFAULT_AUTOZOOM } : null)} /> {t('autoZoom')}</label>
            {#if autoZoom}
              <label class="sl">{t('azStrength')} <span class="mono">+{Math.round((autoZoom.scale - 1) * 100)}%</span>
                <input type="range" min="1.05" max="1.35" step="0.05" bind:value={autoZoom.scale} /></label>
              <label class="sl">{t('azGap')} <span class="mono">{autoZoom.gap}s</span>
                <input type="range" min="1" max="8" step="0.5" bind:value={autoZoom.gap} /></label>
              <label class="chk"><input type="checkbox" bind:checked={autoZoom.sentences} /> {t('azSentences')}</label>
              <label class="chk"><input type="checkbox" bind:checked={autoZoom.shake} /> {t('azShake')}</label>
              <button class="sm" onclick={aimZooms} disabled={aimBusy || !zooms.length} title={t('azAimTip')}><Icon name="person" size={16} /> {aimBusy ? t('azAiming') : t('azAim')}</button>
              {#if autoZoom.aim && Object.keys(autoZoom.aim).length}<button class="sm" onclick={() => autoZoom && (autoZoom.aim = undefined)}>{t('azCentre')}</button>{/if}
              {#if autoZoom.edits && Object.keys(autoZoom.edits).length}<button class="sm" onclick={() => autoZoom && (autoZoom.edits = undefined)} title={t('azResetTip')}>{t('azReset')}</button>{/if}
              <span class="muted small">{t('azEditHint')}</span>
              <span class="muted small">{zooms.length ? t('azCount').replace('{n}', String(zooms.length)) : t('azNone')}</span>
            {/if}
          </div>
        {/if}
        <ol class="caps">
          {#each captions as c, i (c.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <li class:on={active(c)} class:sel-cap={selectedSet.has(c.id)} onclick={(e) => selectCap(c.id, e)}>
              <div class="times mono">
                <input type="number" step="0.1" min="0" aria-label={t('start')} value={startOf(c).toFixed(2)}
                  onchange={(e) => update(i, setRange(c, +e.currentTarget.value, endOf(c)))} />
                <input type="number" step="0.1" min="0" aria-label={t('end')} value={endOf(c).toFixed(2)}
                  onchange={(e) => update(i, setRange(c, startOf(c), +e.currentTarget.value))} />
              </div>
              <div class="cap-main">
                <textarea rows="2" aria-label={t('capText')} value={captionText(c)} onfocus={() => { if (!selectedSet.has(c.id)) selectCap(c.id); seek(startOf(c)); }}
                  onchange={(e) => update(i, setText(c, e.currentTarget.value))}></textarea>
                {#if c.tr !== undefined}
                  <textarea class="tr" rows="1" aria-label={t('trText')} value={c.tr} placeholder={t('trText')}
                    onchange={(e) => update(i, { ...c, tr: e.currentTarget.value.trim() || undefined })}></textarea>
                {/if}
                {#if c.style?.animation}
                  <span class="cap-anim-tag" title={t('animBadge', { name: t('anim.' + c.style.animation) })}><Icon name="animation" size={13} /> {t('anim.' + c.style.animation)}</span>
                {/if}
              </div>
              <span class="tools">
                <button class="sm icon" title={t('playHere')} aria-label={t('playHere')} onclick={() => seek(startOf(c))}><Icon name="play_arrow" /></button>
                <button class="sm icon" title={t('splitCap')} aria-label={t('splitCap')} disabled={c.words.length < 2} onclick={() => setCaps(split(captions, i))}><Icon name="content_cut" /></button>
                <button class="sm icon" title={t('mergeNext')} aria-label={t('mergeNext')} disabled={i === captions.length - 1} onclick={() => setCaps(mergeNext(captions, i))}><Icon name="merge" /></button>
                <button class="sm icon" title={t('del')} aria-label={t('del')} onclick={() => setCaps(captions.toSpliced(i, 1))}><Icon name="close" /></button>
              </span>
            </li>
          {/each}
        </ol>
        <button class="add" onclick={addLine} disabled={!hasMedia}><Icon name="add" /> {t('addLine')}</button>
        {#if captions.length}
          <h3 class="sub">{t('subtitleFiles')}</h3>
          <div class="row">
            <button class="sm" onclick={() => download('srt')}>{t('dlSrt')}</button>
            <button class="sm" onclick={() => download('vtt')}>{t('dlVtt')}</button>
          </div>
        {/if}
      {/if}
    </div>
  </section>

  <section class="center">
    <!-- Hidden media elements the player drives; the canvas shows the result. -->
    {#each videoIds as id (id)}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={previewUrl(id)} use:media={['v', id]} preload="auto" playsinline hidden></video>
    {/each}
    {#each overlays.filter((o) => o.kind === 'video') as o (o.id)}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={previewUrl(o.assetId ?? '')} use:media={['o', o.id]} preload="auto" playsinline hidden></video>
    {/each}
    {#each audios as item (item.id)}
      <audio src={urls[item.assetId]} use:media={['a', item.id]} preload="auto"></audio>
    {/each}
    <div
      class="stage"
      class:dragging
      class:zoomed={zoom !== 1}
      aria-label={t('preview')}
      role="region"
      ondragover={(e) => { e.preventDefault(); dragging = true; }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => { e.preventDefault(); dragging = false; importMedia(e.dataTransfer?.files); }}
    >
      {#if hasMedia}
        <!-- .frame is the visible stage box; .fit is the largest box with the video's aspect ratio inside it (× zoom). -->
        <div class="frame">
          <div class="fit" style:--ar={frameW / frameH} style:--z={zoom}>
            {#if sharedAnim}<span class="badge">{t('animBadge', { name: t('anim.' + sharedAnim) })}</span>{/if}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (focusable so arrow keys can move the caption) -->
            <canvas bind:this={canvas} tabindex="0" onpointerdown={pointer} onpointermove={pointer} onpointerup={pointer}
              onpointercancel={pointer} onpointerleave={() => (hover = false)} onkeydown={nudge}
              aria-label={t('previewAria')}></canvas>
          </div>
        </div>
      {:else}
        <label class="empty">
          <span>{t('drop')}</span>
          <input type="file" accept="video/*,audio/*,image/*" multiple hidden onchange={(e) => importMedia(e.currentTarget.files)} />
        </label>
      {/if}
    </div>
    <div class="transport">
      <div class="row">
        <button class="round" onclick={() => seek(time - 5)} disabled={!hasMedia} aria-label={t('back')}><Icon name="replay_5" size={22} /></button>
        <button class="round play" onclick={toggle} disabled={!hasMedia} aria-label={paused ? t('play') : t('pause')}><Icon name={paused ? 'play_arrow' : 'pause'} size={28} /></button>
        <button class="round" onclick={() => seek(time + 5)} disabled={!hasMedia} aria-label={t('forward')}><Icon name="forward_5" size={22} /></button>
        {#if capInZone}<span class="zonewarn" role="status">{t('capInZone', { app: t('safe.' + safe) })}</span>{/if}
        <span class="mono tcode">{tc(outTime)} <span class="muted">/ {tc(outDuration(segments))}</span></span>
      </div>
      <div class="row zoomctl">
        <select class="ratio" bind:value={safe} aria-label={t('safeZones')} title={t('safeZonesTip')}>
          <option value="">{t('safeOff')}</option>
          {#each Object.keys(SAFE_ZONES) as k}<option value={k}>{t('safe.' + k)}</option>{/each}
        </select>
        <select class="ratio" bind:value={canvasAspect} aria-label={t('canvasRatio')} title={t('canvasRatio')}>
          <option value="source">{t('ex.original')}</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="4:5">4:5</option>
          <option value="16:9">16:9</option>
        </select>
        <button class="sm icon" onclick={() => (zoom = Math.max(0.5, zoom - 0.25))} aria-label={t('zoomOut')}><Icon name="zoom_out" /></button>
        <span class="mono small zl">{zoom === 1 ? t('fit') : `${Math.round(zoom * 100)}%`}</span>
        <button class="sm icon" onclick={() => (zoom = Math.min(3, zoom + 0.25))} aria-label={t('zoomIn')}><Icon name="zoom_in" /></button>
        <button class="sm" class:on={zoom === 1} onclick={() => (zoom = 1)} aria-pressed={zoom === 1}><Icon name="fit_screen" /> {t('fit')}</button>
      </div>
    </div>
  </section>

  <aside class="style panel" class:shown={sheet === 'style' || sheet === 'color'} class:color-only={sheet === 'color'}>
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-bar"><h2>{sheet === 'color' ? t('grading') : t('style')}</h2><button class="icon sm" onclick={() => (sheet = null)} aria-label={t('ex.close')}><Icon name="close" /></button></div>
    {#if sheet === 'color'}
      <ColorGrader color={selColor} {luts} onset={setColor} ondone={() => (colorEditing = false)} />
    {:else}
    <!-- A selected layer gets its own settings only; caption templates and styles come back when it's deselected. -->
    {#if !selOverlay}
    <details class="tpl">
      <summary>{t('templates')}</summary>
      <div class="tpl-list">
        {#each [...BUILTIN, ...myTemplates] as tp (tp.id)}
          <div class="tpl-item">
            <button class="sm" onclick={() => applyTemplate(tp)} disabled={!hasMedia}
              title={t('applyTemplateTip', { n: tp.layers.length })}>{tp.builtin ? t('tpl.' + tp.id) : tp.name}</button>
            {#if !tp.builtin}<button class="sm icon" onclick={() => deleteTemplate(tp)} aria-label={t('del')}><Icon name="close" /></button>{/if}
          </div>
        {/each}
      </div>
      <button class="sm" onclick={saveTemplate} disabled={!hasMedia} title={t('saveTemplateTip')}><Icon name="add" /> {t('saveTemplate')}</button>
    </details>
    {/if}
    {#if selected >= 0 && segments[selected] && !selOverlay}
      {@const c = selColor}
      <section class="layer strip" aria-label={t('stripColor')} onchange={() => (colorEditing = false)} onpointerup={() => (colorEditing = false)}>
        <div class="lhead"><h3>{t('stripColor')}</h3></div>
        <div class="lrow">
          <button class="sm" class:on={!Object.keys(c).length} onclick={() => (setColor({}, true), (colorEditing = false))}>{t('col.none')}</button>
          {#each Object.entries(COLOR_PRESETS) as [k, v]}
            <button class="sm" onclick={() => (setColor({ ...v, lut: c.lut, lutMix: c.lutMix }, true), (colorEditing = false))}>{t('col.' + k)}</button>
          {/each}
          {#each Object.entries(COLOR_LOOKS) as [k, v]}
            <button class="sm" onclick={() => (setColor({ ...v, lut: c.lut, lutMix: c.lutMix }, true), (colorEditing = false))}>{t('col.' + k)}</button>
          {/each}
        </div>
        {#each [['b', 'brightness'], ['c', 'contrast'], ['s', 'saturation'], ['temp', 'temperature']] as [k, label]}
          {@const v = (c as Record<string, number>)[k] ?? 0}
          <label class="vol">{t(label)} <span class="mono small">{v > 0 ? '+' : ''}{Math.round(v * 100)}</span>
            <input type="range" min="-1" max="1" step="0.01" value={v} oninput={(e) => setColor({ [k]: +e.currentTarget.value })}
              ondblclick={() => (setColor({ [k]: 0 }), (colorEditing = false))} />
          </label>
        {/each}
        {#each EFFECTS as k}
          {@const v = c[k] ?? 0}
          <label class="vol">{t('fx.' + k)} <span class="mono small">{Math.round(v * 100)}%</span>
            <input type="range" min="0" max="1" step="0.01" value={v} oninput={(e) => setColor({ [k]: +e.currentTarget.value || undefined })}
              ondblclick={() => (setColor({ [k]: undefined }), (colorEditing = false))} />
          </label>
        {/each}
        <div class="lrow">
          <label class="vol">{t('lut')}
            <select value={c.lut ?? ''} onchange={(e) => (setColor({ lut: e.currentTarget.value || undefined }), (colorEditing = false))}>
              <option value="">{t('col.noLut')}</option>
              {#each luts as l}<option value={l.id}>{l.name}</option>{/each}
            </select>
          </label>
          <label class="btn sm">{t('importLut')}<input type="file" accept=".cube" hidden onchange={(e) => importLut(e.currentTarget.files?.[0])} /></label>
        </div>
        {#if c.lut}
          <label class="vol">{t('lutMix')} <span class="mono small">{Math.round((c.lutMix ?? 1) * 100)}%</span>
            <input type="range" min="0" max="1" step="0.01" value={c.lutMix ?? 1} oninput={(e) => setColor({ lutMix: +e.currentTarget.value })} />
          </label>
        {/if}
        <button class="sm" onclick={colorToAll} disabled={segments.length < 2}>{t('colorAll')}</button>
        {#if reframes}
          {@const fc = segments[selected].fx?.focus ?? { x: 0.5, y: 0.5 }}
          <div class="lhead"><h3>{t('reframe')}</h3></div>
          <label class="vol">{t('focusX')} <span class="mono small">{Math.round(fc.x * 100)}%</span>
            <input type="range" min="0" max="1" step="0.01" value={fc.x} oninput={(e) => setFocus({ ...fc, x: +e.currentTarget.value })} />
          </label>
          <label class="vol">{t('focusY')} <span class="mono small">{Math.round(fc.y * 100)}%</span>
            <input type="range" min="0" max="1" step="0.01" value={fc.y} oninput={(e) => setFocus({ ...fc, y: +e.currentTarget.value })} />
          </label>
          <div class="lrow">
            <button class="sm" onclick={() => autoReframe(selected)} disabled={reframing}>{#if !reframing}<Icon name="center_focus_strong" />{/if} {reframing ? t('detecting') : t('autoReframe')}</button>
            <button class="sm" onclick={autoReframeAll} disabled={reframing}>{t('autoReframeAll')}</button>
            <button class="sm" onclick={() => (setFocus(undefined), (colorEditing = false))}>{t('center')}</button>
          </div>
        {/if}
        {#if !grader.ok}<p class="muted small">{t('noWebgl')}</p>{/if}
      </section>
    {/if}
    {#if selOverlay}
      {@const o = selOverlay}
      {@const cur = tfAt(o, outTime)}
      {@const onKey = !!keyAt(o.kf, outTime - o.at)}
      <!-- Layer inspector: live edits are one undo step each (snapshot on first input, closed on change). -->
      <section class="layer" class:vlayer={o.kind !== 'text'} aria-label={t('layer')} onchange={doneEditing} onpointerup={doneEditing}>
        <div class="lhead">
          <h3>{o.motion ? t('addTitle') : o.kind === 'text' ? t('textLayer') : o.kind === 'image' ? t('imageLayer') : t('videoLayer')}</h3>
          <button class="sm icon" onclick={closeLayer} aria-label={t('ex.close')}><Icon name="close" /></button>
        </div>
        {#if o.bar}
          {@const b = o.bar}
          <div class="lrow">
            <label class="vol">{t('barColor')}<input type="color" value={b.color} oninput={(e) => setOverlay(o.id, { bar: { ...b, color: e.currentTarget.value } })} onchange={doneEditing} /></label>
            <label class="chk"><input type="checkbox" checked={!!b.track} onchange={(e) => (setOverlay(o.id, { bar: { ...b, track: e.currentTarget.checked ? 'rgba(255,255,255,0.25)' : '' } }), doneEditing())} /> {t('barTrack')}</label>
            <label class="chk"><input type="checkbox" checked={!!b.top} onchange={(e) => (setOverlay(o.id, { bar: { ...b, top: e.currentTarget.checked || undefined } }), doneEditing())} /> {t('barTop')}</label>
          </div>
          <label class="vol">{t('barH')} <span class="mono small">{(b.h * 100).toFixed(1)}%</span>
            <input type="range" min="0.003" max="0.03" step="0.001" value={b.h} oninput={(e) => setOverlay(o.id, { bar: { ...b, h: +e.currentTarget.value } })} onchange={doneEditing} />
          </label>
        {:else if o.kind === 'text'}
          <label class="vol">{t('text')}
            <textarea rows="2" value={o.text} oninput={(e) => setOverlay(o.id, { text: e.currentTarget.value })}></textarea>
          </label>
          <div class="lrow">
            <label class="vol">{t('color')}<input type="color" value={textStyle(o).color} oninput={(e) => setOverlay(o.id, { style: { ...o.style, color: e.currentTarget.value } })} /></label>
            <label class="vol">{t('highlight')}<input type="color" value={textStyle(o).highlight} oninput={(e) => setOverlay(o.id, { style: { ...o.style, highlight: e.currentTarget.value } })} /></label>
            <label class="vol">{t('font')}
              <select value={textStyle(o).family} onchange={(e) => setOverlay(o.id, { style: { ...o.style, family: e.currentTarget.value } })}>
                {#each fonts as f}<option value={f.family}>{f.family}</option>{/each}
              </select>
            </label>
          </div>
        {/if}
        {#if o.kind === 'text' && !o.bar}
          {@const m = o.motion}
          <div class="lrow">
            <label class="vol">{t('titleAnim')}
              <select value={m ? m.path : 'off'} onchange={(e) => { const v = e.currentTarget.value; setMotion(o, v === 'off' ? null : { path: v as Motion['path'] }); doneEditing(); }}>
                <option value="off">{t('titleOff')}</option>
                {#each TITLE_PATHS as p}<option value={p}>{t('tpath.' + p)}</option>{/each}
              </select>
            </label>
            {#if m}
              <label class="vol">{t('titleStyle')}
                <select value={m.style ?? 'pop'} onchange={(e) => (setMotion(o, { style: e.currentTarget.value as Motion['style'] }), doneEditing())}>
                  {#each TITLE_STYLES as st}<option value={st}>{t('tstyle.' + st)}</option>{/each}
                </select>
              </label>
            {/if}
          </div>
          {#if m}
            <label class="vol">{t('titleIn')} <span class="mono small">{m.in.toFixed(1)}s</span>
              <input type="range" min="0" max={Math.max(0.1, o.len / 2)} step="0.1" value={m.in} oninput={(e) => setMotion(o, { in: +e.currentTarget.value })} />
            </label>
            <label class="vol">{t('titleOut')} <span class="mono small">{m.out.toFixed(1)}s</span>
              <input type="range" min="0" max={Math.max(0.1, o.len / 2)} step="0.1" value={m.out} oninput={(e) => setMotion(o, { out: +e.currentTarget.value })} />
            </label>
            {#if m.path !== 'none'}
              <label class="vol">{t('titleSpan')} <span class="mono small">{Math.round(m.span * 100)}%</span>
                <input type="range" min="0" max="1.2" step="0.01" value={m.span} oninput={(e) => setMotion(o, { span: +e.currentTarget.value })} />
              </label>
              <label class="vol">{t('titleCurve')} <span class="mono small">{Math.round(m.amp * 100)}%</span>
                <input type="range" min="0" max="0.3" step="0.01" value={m.amp} oninput={(e) => setMotion(o, { amp: +e.currentTarget.value })} />
              </label>
            {/if}
          {/if}
        {/if}
        <div class="keyrow" role="group" aria-label={t('keyframes')}>
          <button class="sm icon" onclick={() => jumpKey(o, -1)} disabled={!o.kf?.length} title={t('prevKey')} aria-label={t('prevKey')}><Icon name="chevron_left" /></button>
          <button class="sm key" class:on={onKey} aria-pressed={onKey} onclick={() => toggleKey(o)}
            title={onKey ? t('removeKey') : t('addKey')}><Icon name="diamond" size={16} /> {onKey ? t('removeKey') : t('addKey')}</button>
          <button class="sm icon" onclick={() => jumpKey(o, 1)} disabled={!o.kf?.length} title={t('nextKey')} aria-label={t('nextKey')}><Icon name="chevron_right" /></button>
          <button class="sm" onclick={() => punchIn(o)} title={t('punchLayerTip')}><Icon name="zoom_in" /> {t('punchIn')}</button>
          {#if o.kf?.length}<button class="sm" onclick={() => clearKeys(o)}>{t('clearKeys')}</button>{/if}
        </div>
        {#if o.kf?.length}<p class="muted small keyhint">{t('keyHint', { n: o.kf.length })}</p>{/if}
        <label class="vol">{t('scale')} <span class="mono small">{Math.round(cur.scale * 100)}%</span>
          <input type="range" min="0.05" max={o.kind === 'text' ? 4 : 1.5} step="0.01" value={cur.scale} oninput={(e) => setTf(o.id, { scale: +e.currentTarget.value })} />
        </label>
        <label class="vol">{t('rotation')} <span class="mono small">{Math.round(cur.rotation)}°</span>
          <input type="range" min="-180" max="180" step="1" value={cur.rotation} oninput={(e) => setTf(o.id, { rotation: +e.currentTarget.value })} />
        </label>
        <label class="vol">{t('opacity')} <span class="mono small">{Math.round(cur.opacity * 100)}%</span>
          <input type="range" min="0" max="1" step="0.01" value={cur.opacity} oninput={(e) => setTf(o.id, { opacity: +e.currentTarget.value })} />
        </label>
        {#if o.kind !== 'text'}
          {@const c = o.tf.crop ?? [0, 0, 0, 0]}
          <div class="crop">
            {#each [['cropL', 0], ['cropT', 1], ['cropR', 2], ['cropB', 3]] as [label, i]}
              <label class="vol">{t(label as string)} <span class="mono small">{Math.round(c[i as number] * 100)}%</span>
                <input type="range" min="0" max="0.45" step="0.01" value={c[i as number]}
                  oninput={(e) => setTf(o.id, { crop: c.with(i as number, +e.currentTarget.value) as Transform['crop'] })} />
              </label>
            {/each}
          </div>
        {/if}
        <label class="vol">{t('blend')}
          <select value={o.blend ?? 'normal'} onchange={(e) => (setOverlay(o.id, { blend: e.currentTarget.value === 'normal' ? undefined : (e.currentTarget.value as Blend) }), doneEditing())}>
            {#each BLENDS as b (b)}<option value={b}>{t('bl.' + b)}</option>{/each}
          </select>
        </label>
        {#if o.kind !== 'text'}
          <KeyControls key={o.key} picking={pickKey === o.id} onpick={() => startPick(o.id)}
            set={(k, final) => (setOverlay(o.id, { key: k }), final && doneEditing())} />
          <details class="lfx" open={!!o.mask}>
            <summary>{t('mask')}</summary>
            <select value={o.mask?.shape ?? 'none'} aria-label={t('mask')}
              onchange={(e) => { const v = e.currentTarget.value; setOverlay(o.id, { mask: v === 'none' ? undefined : { ...DEFAULT_MASK, ...o.mask, shape: v as 'rect' } }); doneEditing(); }}>
              {#each ['none', 'ellipse', 'rect', 'linear'] as m (m)}<option value={m}>{t('mk.' + m)}</option>{/each}
            </select>
            {#if o.mask}
              {@const m = o.mask}
              {#each (m.shape === 'linear' ? [['mkAngle', 'angle', -180, 180, 1], ['mkPos', 'pos', 0, 1, 0.01]] : [['mkW', 'w', 0.05, 1, 0.01], ['mkH', 'h', 0.05, 1, 0.01]]).concat([['mkFeather', 'feather', 0, 0.5, 0.01]]) as [label, f, lo, hi, st] (f)}
                <label class="vol">{t(label as string)} <span class="mono small">{f === 'angle' ? `${m.angle}°` : `${Math.round(m[f as 'w'] * 100)}%`}</span>
                  <input type="range" min={lo} max={hi} step={st} value={m[f as 'w']} oninput={(e) => setOverlay(o.id, { mask: { ...m, [f as string]: +e.currentTarget.value } })} onchange={doneEditing} />
                </label>
              {/each}
              <label class="chk"><input type="checkbox" checked={!!m.invert} onchange={(e) => (setOverlay(o.id, { mask: { ...m, invert: e.currentTarget.checked || undefined } }), doneEditing())} /> {t('mkInvert')}</label>
            {/if}
          </details>
        {/if}
        {#if o.kind === 'video'}
          <label class="vol">{t('volume')} <span class="mono small">{Math.round((o.volume ?? 0) * 100)}%</span>
            <input type="range" min="0" max="1" step="0.05" value={o.volume ?? 0} oninput={(e) => setOverlay(o.id, { volume: +e.currentTarget.value })} />
          </label>
        {/if}
        <div class="lrow">
          <button class="sm" class:on={o.behind} aria-pressed={!!o.behind} title={t('layerBehind')}
            onclick={() => (setOverlay(o.id, { behind: !o.behind || undefined }), doneEditing())}><Icon name="person" /> {t('behindPerson')}</button>
          <button class="sm" class:on={o.tf.flipX} aria-pressed={!!o.tf.flipX} onclick={() => (setTf(o.id, { flipX: !o.tf.flipX }), doneEditing())}><Icon name="flip" /> {t('flip')}</button>
          <button class="sm" onclick={() => (setTf(o.id, { x: 0.5, y: 0.5, rotation: 0, crop: undefined, flipX: false, opacity: 1 }), doneEditing())}>{t('resetLayer')}</button>
          <button class="sm icon" onclick={() => restack(1)} disabled={overlays.at(-1)?.id === o.id} title={t('bringForward')} aria-label={t('bringForward')}><Icon name="flip_to_front" /></button>
          <button class="sm icon" onclick={() => restack(-1)} disabled={overlays[0]?.id === o.id} title={t('sendBackward')} aria-label={t('sendBackward')}><Icon name="flip_to_back" /></button>
          <button class="sm" onclick={removeOverlay}>{t('del')}</button>
        </div>
      </section>
    {/if}
    {#if !selOverlay}
    <StylePanel
      bind:style
      {selectedCap}
      capIndex={selectedCapIndex}
      {fonts}
      {fontError}
      onlocal={addLocalFonts}
      onupload={addUploadedFont}
      onupdatecapstyle={updateCapStyle}
      onapplyall={applyAllCapStyle}
      onresetcapstyle={resetCapStyle}
      selectedCount={selectedCapIds.length}
      onclearcapselection={clearCapSelection}
      onclearfields={clearCapFields}
    />
    {/if}
    {/if}
  </aside>

  <section class="timeline-area" aria-label={t('timelineH')}
    ondragover={(e) => e.preventDefault()} ondrop={dropOnTimeline}>
    <div class="thead">
      <h2>{t('timelineH')}</h2>
      <div class="row">
        {#if selAudio}
          <span class="aname small selname"><Icon name="music_note" size={16} /> {names.get(selAudio.assetId)}</span>
          <label class="vol inline">{t('volume')}
            <input type="range" min="0" max="1" step="0.05" value={selAudio.volume}
              oninput={(e) => setAudio(selAudio.id, { volume: +e.currentTarget.value })} />
          </label>
          {@const ba = assets.find((a) => a.id === selAudio.assetId)}
          {#if ba?.beats?.length}
            <span class="small mono" title={t('beatsFound', { n: ba.beats.length })}><Icon name="graphic_eq" size={16} /> {ba.bpm} BPM</span>
            <button class="sm" onclick={() => cutOnBeats(selAudio)} title={t('cutBeatsTip')}>{t('cutBeats')}</button>
            <button class="sm" onclick={() => cutOnBeats(selAudio, 2)}>{t('cutBeats2')}</button>
          {:else}
            <button class="sm" onclick={() => detectBeatsFor(selAudio.assetId)} disabled={beatBusy}>{beatBusy ? t('detecting') : t('detectBeats')}</button>
          {/if}
          <label class="vol inline" title={t('vfxTip')}>{t('vfx')}
            <select value={selAudio.vfx ?? ''} disabled={vfxBusy} onchange={(e) => setVoiceFx(selAudio, e.currentTarget.value as VoiceFx | '')}>
              <option value="">{t('vfx.none')}</option>
              {#each VOICE_FX as v}<option value={v}>{t('vfx.' + v)}</option>{/each}
            </select>
          </label>
          {#if vfxBusy}<span class="small muted">{t('vfxBusy')}</span>{/if}
          <label class="chk" title={t('duckTip')}><input type="checkbox" checked={!!selAudio.duck}
            onchange={(e) => (commit(), setAudio(selAudio.id, { duck: e.currentTarget.checked || undefined }))} /> {t('duck')}</label>
          <button class="sm" onclick={removeAudioItem}>{t('removeAudio')}</button>
          <span class="divider"></span>
        {/if}
        {#if selFx}
          {#if selected > 0}
            <label class="vol inline">{t('transIn')}
              <select value={selFx.trans ?? ''} onchange={(e) => setFx({ trans: (e.currentTarget.value || undefined) as Fx['trans'] })}>
                <option value="">{t('trans.none')}</option>
                {#each TRANSITIONS as k}<option value={k}>{t('trans.' + k)}</option>{/each}
              </select>
            </label>
          {/if}
          {#if selFx.hold}
            <label class="vol inline">{t('freezeLen')}
              <input type="number" min="0.2" max="10" step="0.1" value={selFx.hold} style="width: 64px"
                onchange={(e) => setFx({ hold: Math.max(0.2, Math.min(10, +e.currentTarget.value || 1)) })} />
            </label>
          {:else}
            <label class="vol inline">{t('speed')}
              <select value={selFx.speed ?? 1} onchange={(e) => setFx({ speed: +e.currentTarget.value === 1 ? undefined : +e.currentTarget.value })}>
                {#each [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as v}<option value={v}>{v}×</option>{/each}
              </select>
            </label>
          {/if}
          <button class="sm" class:on={!!selFx.zoom} aria-pressed={!!selFx.zoom} title={t('punchTip')}
            onclick={() => setFx(selFx.zoom ? { zoom: undefined, zoomIn: undefined } : { zoom: PUNCH_IN, zoomIn: true })}><Icon name="zoom_in" /> {t('punchIn')}</button>
          <label class="vol inline" title={t('shakeTip')}>{t('shake')}
            <select value={selFx.shake ?? 0} onchange={(e) => setFx({ shake: +e.currentTarget.value || undefined })}>
              {#each [0, 0.3, 0.6, 1] as v}<option value={v}>{t('shake.' + v)}</option>{/each}
            </select>
          </label>
          <button class="sm" class:on={!!selFx.stab} aria-pressed={!!selFx.stab} title={t('stabTip')} disabled={stabPct !== null || !!selFx.hold}
            onclick={() => stabilize(selected)}><Icon name="videocam" size={16} /> {stabPct !== null ? `${t('stabBusy')} ${Math.round(stabPct)}%` : t('stab')}</button>
          <button class="sm" class:on={!!selFx.lift} aria-pressed={!!selFx.lift} title={t('liftTip')}
            onclick={() => setFx({ lift: !selFx.lift || undefined })}>{t('lift')}</button>
          <button class="sm icon" class:on={selFx.behind} aria-pressed={!!selFx.behind} title={t('textBehind')} aria-label={t('textBehind')}
            onclick={() => setFx({ behind: !selFx.behind })}><Icon name="person" /></button>
          <label class="vol">{t('background')}
            <select value={selFx.bg ?? ''} onchange={(e) => setFx({ bg: (e.currentTarget.value || undefined) as Fx['bg'] })}>
              <option value="">{t('bgOriginal')}</option>
              <option value="blur">{t('bgBlur')}</option>
              <option value="color">{t('bgColor')}</option>
              <option value="image" disabled={!imageAssets.length}>{t('bgImage')}</option>
            </select>
          </label>
          {#if selFx.bg === 'image'}
            <select value={selFx.bgImage ?? ''} aria-label={t('bgImage')} onchange={(e) => setFx({ bgImage: e.currentTarget.value || undefined })}>
              <option value="">{t('bgPick')}</option>
              {#each imageAssets as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
            </select>
          {/if}
          {#if selFx.bg === 'color'}
            <input type="color" value={selFx.bgColor ?? '#00b140'} aria-label={t('bgColor')}
              onchange={(e) => setFx({ bgColor: e.currentTarget.value })} />
          {/if}
          <div class="stripkey">
            <KeyControls key={selFx.key} picking={pickKey === 'strip'} onpick={() => startPick('strip')} set={setStripKey} />
          </div>
          <span class="divider"></span>
        {/if}
        <button class="sm" onclick={addText} disabled={!hasMedia} title={t('addTextTip')}><Icon name="title" /> {t('addText')}</button>
        <button class="sm" onclick={addTitle} disabled={!hasMedia} title={t('addTitleTip')}><Icon name="animation" /> {t('addTitle')}</button>
        <button class="sm" onclick={() => setSegs(freezeAt(segments, time, 1))} disabled={!segments.length} title={t('freezeTip')}><Icon name="ac_unit" /> {t('freeze')}</button>
        <button class="sm" onclick={cutHere} disabled={!segments.length} title={t('splitTip')}><Icon name="content_cut" /> {t('splitAt')}</button>
        <button class="sm" onclick={deleteSelected} disabled={selected < 0 || segments.length < 2} title={t('delTip')}>{t('del')}</button>
        <button class="sm icon" class:on={snapOn} aria-pressed={snapOn} title={t('snapTip')} aria-label={t('snap')}
          onclick={() => (snapOn = !snapOn)}><Icon name="magnet" /></button>
        <button class="sm icon" class:on={autoSelect} aria-pressed={autoSelect} title={t('autoSelectTip')} aria-label={t('autoSelect')}
          onclick={() => (autoSelect = !autoSelect)}><Icon name="ads_click" /></button>
        <button class="sm icon" onclick={undo} disabled={!past.length} title={t('undo')} aria-label={t('undo')}><Icon name="undo" /></button>
        <button class="sm icon" onclick={redo} disabled={!future.length} title={t('redo')} aria-label={t('redo')}><Icon name="redo" /></button>
        <button class="sm icon" onclick={() => (tlZoom = Math.max(1, tlZoom / 1.5))} disabled={tlZoom <= 1} aria-label={t('zoomOut')}><Icon name="zoom_out" /></button>
        <button class="sm icon" onclick={() => (tlZoom = Math.min(16, tlZoom * 1.5))} aria-label={t('zoomIn')}><Icon name="zoom_in" /></button>
        <button class="sm icon" onclick={() => (showKeys = true)} title={t('keysTitle') + ' (?)'} aria-label={t('keysTitle')}><Icon name="keyboard" /></button>
      </div>
    </div>
    <Timeline {segments} {time} {clips} {durations} {names} {thumbs} {peaks} {duration} {captions} {audios}
      bind:zoom={tlZoom} bind:selected bind:selectedAudio selectedCapIds={selectedSet} onselectcap={selectCap}
      animLabel={t('allCaptions', { name: animName })}
      zooms={zooms} onzoom={(k, s) => autoZoom && (autoZoom.edits = { ...autoZoom.edits, [k]: s })}
      out={outClock} onseek={(o) => seekOut(o)} onseeksrc={seek} snap={snapOn} range={marks} pending={pendingCuts} beats={beatMap}
      {overlays} bind:selectedOverlay
      onoverlay={(id, patch) => setOverlay(id, patch, false)}
      oncommit={commit}
      ontrim={(i, s, e) => (segments = trim(segments, i, s, e, duration))}
      onmovecap={(id, s, e) => (captions = captions.map((c) => (c.id === id ? setRange(c, s, e) : c)))}
      onaudio={(id, patch) => setAudio(id, patch)} />
  </section>

  {#if sheet}
    <button class="scrim" onclick={() => (sheet = null)} aria-label={t('ex.close')} tabindex="-1"></button>
  {/if}

  <nav class="dock" aria-label={t('tools')}>
    <button class:on={sheet === 'assets'} onclick={() => openSheet('assets')}>
      <Icon name="video_library" size={24} />
      <span>{t('assets')}</span>
    </button>
    <button class:on={sheet === 'text' && tab === 'transcript'} onclick={() => openSheet('text', 'transcript')}>
      <Icon name="description" size={24} />
      <span>{t('transcript')}</span>
    </button>
    <button class:on={sheet === 'text' && tab === 'captions'} onclick={() => openSheet('text', 'captions')}>
      <Icon name="closed_caption" size={24} />
      <span>{t('captions')}</span>
    </button>
    <button class:on={sheet === 'style'} onclick={() => openSheet('style')}>
      <Icon name="text_fields" size={24} />
      <span>{t('style')}</span>
    </button>
    {#if hasVideoSel}
      <button class:on={sheet === 'color'} onclick={() => openSheet('color')}>
        <Icon name="palette" size={24} />
        <span>{t('grading')}</span>
      </button>
    {/if}
    <button onclick={() => saveToFile()} disabled={!assets.length}>
      <Icon name="download" size={24} />
      <span>{fileStatus ? t(fileStatus) : t('saveFile')}</span>
    </button>
  </nav>
</div>

{#if showPerf}<PerfDialog onclose={() => (showPerf = false)} />{/if}
{#if hasMedia}
  <div class="sr-only" aria-live="polite" role="status">{liveMsg}</div>
  <dialog class="hist" bind:this={histDialog} aria-label={t('history')}>
    <div class="lhead"><h3>{t('history')}</h3><button class="sm icon" onclick={() => histDialog?.close()} aria-label={t('ex.close')}><Icon name="close" /></button></div>
    <p class="muted small">{t('historyHint')}</p>
    {#if !versions.length}<p class="muted">{t('noVersions')}</p>{/if}
    <ol>
      {#each versions as v (v.time)}
        <li>
          <span><b>{ago(v.time)}</b>{#if v.label} · <em>{v.label}</em>{/if}<br />
            <span class="muted small">{t('versionInfo', { caps: v.doc.captions?.length ?? 0, strips: v.doc.segments?.length ?? 0, layers: v.doc.overlays?.length ?? 0, secs: Math.round((v.doc.segments ?? []).reduce((a, s) => a + s.end - s.start, 0)) })}</span></span>
          <button class="sm" onclick={() => restoreVersion(v)}>{t('restore')}</button>
        </li>
      {/each}
    </ol>
  </dialog>
  {#if showKeys}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="keys-bg" onclick={() => (showKeys = false)}>
      <div class="keys" role="dialog" aria-modal="true" aria-label={t('keysTitle')} tabindex="-1" onclick={(e) => e.stopPropagation()}>
        <h3>{t('keysTitle')}</h3>
        <dl>
          {#each [['Space', 'k.play'], ['J / K / L', 'k.jkl'], ['← / →', 'k.frame'], ['Shift + ← / →', 'k.second'], ['Home / End', 'k.ends'],
            ['S', 'k.split'], ['I / O', 'k.marks'], ['X', 'k.cutRange'], ['Del', 'k.del'], ['Shift + Del', 'k.lift'], ['N', 'k.snap'], ['Alt + drag', 'k.free'],
            ['A', 'k.auto'], ['T', 'k.text'], ['Ctrl/⌘ + Z', 'undo'], ['Ctrl/⌘ + Shift + Z', 'redo'], ['Ctrl/⌘ + S', 'k.save'], ['Esc', 'k.esc'], ['?', 'keysTitle']] as [k, d]}
            <dt><kbd>{k}</kbd></dt><dd>{t(d)}</dd>
          {/each}
        </dl>
        <button class="sm" onclick={() => (showKeys = false)}>OK</button>
      </div>
    </div>
  {/if}
  <ExportDialog bind:this={exporter} {name} {segments} captions={displayCaps} {style} {srcW} {srcH} {canvasAspect}
    source={() => ({ files, assets: $state.snapshot(assets), clips: $state.snapshot(clips), audios: $state.snapshot(audios), overlays: $state.snapshot(overlays), speech: $state.snapshot(speech), luts, clipVolume, zoomShake: !!autoZoom?.shake, clean: denoise ? new Map(cleanBlobs) : undefined, zooms: $state.snapshot(zooms), zoomScale: autoZoom?.scale })} />
{/if}

<style>
  .app {
    height: calc(100dvh / var(--ui-zoom)); display: grid;
    grid-template-columns: var(--cols);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas: var(--areas);
  }
  @media (min-width: 761px) {
    .app.hide-text .text, .app.hide-style .style { display: none; }
  }
  .top { grid-area: top; display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 20px; border-bottom: 1px solid var(--border-soft); }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo { font-family: var(--display); font-weight: 700; font-size: 18px; letter-spacing: -.01em; }
  .slash { color: var(--muted); }
  .pname { background: none; border: 1px solid transparent; font-weight: 600; padding: 4px 6px; min-width: 0; width: 22ch; }
  .pname:hover:not(:disabled) { border-color: var(--border); }
  .pill { background: var(--raised); color: var(--muted); font-size: 12px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .actions { display: flex; gap: 8px; align-items: center; }
  .actions button.on { border-color: var(--accent); background: rgb(200 245 96 / .06); }
  .lang { height: 36px; padding: 0 8px; }
  .panel { background: var(--panel); min-height: 0; display: flex; flex-direction: column; }
  .assets { grid-area: assets; border-right: 1px solid var(--border-soft); padding: 16px; gap: 12px; overflow: auto; }
  .phead { display: flex; justify-content: space-between; align-items: center; }
  .import { display: flex; align-items: center; justify-content: center; gap: 6px; height: 42px; border: 1px dashed var(--border);
    border-radius: 10px; cursor: pointer; }
  .import:hover { border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .asset { display: grid; gap: 4px; min-width: 0; }
  .ph { display: inline-flex; align-items: center; gap: 4px; }
  .thumb { position: relative; aspect-ratio: 16 / 11; background: var(--tab-on); border-radius: 8px; overflow: hidden;
    display: grid; place-items: center; outline: 2px solid var(--accent); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .dur { position: absolute; right: 4px; bottom: 4px; background: rgb(0 0 0 / .75); font-size: 11px; padding: 1px 4px; border-radius: 4px; }
  .aname { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thumb { outline: none; }
  .thumb.used { outline: 2px solid var(--accent); }
  .asset { cursor: grab; }
  .acts { position: absolute; top: 4px; right: 4px; display: none; gap: 2px; }
  .asset:hover .acts, .asset:focus-within .acts { display: flex; }
  .acts button { width: 24px; height: 24px; background: rgb(15 15 15 / .85); }
  .filters { display: flex; gap: 4px; }
  .filters button { border: 0; height: 30px; font-size: 13px; color: var(--muted); border-radius: 8px; }
  .filters button.on { background: var(--tab-on); color: var(--text); }
  .clen { width: 4.5em; }
  .seq { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  .seq li { display: grid; grid-template-columns: 18px minmax(0, 1fr) repeat(5, auto); gap: 4px; align-items: center;
    padding: 4px 6px; background: var(--card); border: 1px solid var(--border-soft); border-radius: 8px; }
  .seq button { width: 26px; height: 26px; }
  .vol { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
  .vol input { accent-color: var(--accent); }
  .vol.inline { display: flex; align-items: center; gap: 6px; }
  .vol.inline input { width: 90px; }
  .selname { max-width: 160px; color: var(--speaker-1); }
  .divider { width: 1px; height: 20px; background: var(--border); }
  .thead .row { flex-wrap: wrap; justify-content: flex-end; }
  .small { font-size: 12px; }
  .text { grid-area: text; border-right: 1px solid var(--border-soft); }
  .tabs { display: flex; gap: 4px; padding: 12px 16px; }
  .tabs button { border: 0; height: 36px; color: var(--muted); font-weight: 500; border-radius: 8px; }
  .tabs button.on { background: var(--tab-on); color: var(--text); }
  .scroll { overflow: auto; padding: 0 16px 16px; display: grid; gap: 10px; align-content: start; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row select { flex: 1; height: 36px; padding: 0 8px; }
  .target { width: 100%; height: 34px; padding: 0 8px; }
  progress { width: 100%; accent-color: var(--accent); }
  .notice { font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); margin: 0; }
  .caps { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .caps li { position: relative; display: grid; grid-template-columns: 72px 1fr; gap: 8px; padding: 10px 12px;
    background: var(--card); border: 1px solid var(--border-soft); border-radius: 10px; cursor: pointer; }
  .caps li.on { border-color: var(--accent); }
  .caps li.sel-cap { border-color: var(--accent); background: rgb(200 245 96 / .08); box-shadow: 0 0 0 1px var(--accent); }
  .cap-main { display: grid; gap: 4px; min-width: 0; }
  .cap-anim-tag { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgb(200 245 96 / .18); color: var(--accent); display: inline-flex; align-items: center; width: fit-content; }
  .times { display: grid; gap: 2px; align-content: start; }
  .times input { width: 100%; font-family: var(--mono); font-size: 12px; color: var(--muted); background: none; border: 1px solid transparent; padding: 1px 2px; }
  .times input:hover, .times input:focus { border-color: var(--border); color: var(--text); }
  textarea { resize: vertical; background: none; border: 1px solid transparent; padding: 2px 4px; font-size: 14px; line-height: 1.4; }
  textarea:hover, textarea:focus { border-color: var(--border); }
  .tools { position: absolute; top: 6px; right: 6px; display: none; gap: 2px; background: var(--card); }
  .caps li:hover .tools, .caps li:focus-within .tools { display: flex; }
  .tools button { width: 26px; height: 26px; font-size: 11px; }
  /* Touch / narrow screens: no hover, and floating tools would cover the text being edited —
     put them in their own row under the caption instead. */
  @media (hover: none), (max-width: 760px) {
    .tools { position: static; grid-column: 1 / -1; justify-content: flex-end; gap: 6px; background: none; }
    .caps li:hover .tools { display: none; }
    .caps li.sel-cap .tools, .caps li:focus-within .tools { display: flex; }
    .tools button { width: 36px; height: 32px; font-size: 13px; }
  }
  .add { border-style: dashed; height: 40px; }
  .sub { margin-top: 8px; }
  .center { grid-area: center; display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; }
  .stage { position: relative; min-height: 0; border: 2px dashed transparent; }
  .stage.dragging { border-color: var(--accent); }
  .frame { position: absolute; inset: 16px; container-type: size; display: grid; place-items: safe center; overflow: auto; }
  .fit { position: relative; aspect-ratio: var(--ar); width: calc(min(100cqw, 100cqh * var(--ar)) * var(--z)); }
  canvas { display: block; width: 100%; height: 100%; border-radius: 12px; background: #000; cursor: pointer; touch-action: none; }
  canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .badge { position: absolute; top: 12px; left: 12px; z-index: 1; background: rgb(15 15 15 / .8); font-size: 12px; padding: 4px 10px; border-radius: 999px; pointer-events: none; }
  .empty { position: absolute; inset: 16px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 12px; cursor: pointer; color: var(--muted); text-align: center; padding: 16px; }
  .transport { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 20px; border-top: 1px solid var(--border-soft); }
  .zoomctl { margin-left: auto; }
  .round { width: 40px; height: 40px; border-radius: 50%; padding: 0; }
  .round.play { width: 48px; height: 48px; background: var(--text); color: var(--bg); border-color: var(--text); font-size: 16px; }
  .tcode { margin-left: 8px; font-size: 13px; white-space: nowrap; }
  .zl { min-width: 44px; text-align: center; }
  .transport button.on { border-color: var(--accent); }
  .style { grid-area: style; border-left: 1px solid var(--border-soft); overflow: auto; }
  .timeline-area { grid-area: tl; border-top: 1px solid var(--border-soft); padding: 12px 20px 16px; display: grid; gap: 10px; }
  .thead { display: flex; justify-content: space-between; align-items: center; }
  .thead button.on { border-color: var(--accent); color: var(--accent); background: rgb(200 245 96 / .08); }

  @media (max-width: 1100px) {
    .app {
      height: auto; min-height: calc(100dvh / var(--ui-zoom));
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'top' 'center' 'text' 'style' 'assets' 'tl';
    }
    .top { flex-wrap: wrap; position: sticky; top: 0; z-index: 2; background: var(--bg); }
    .assets, .text, .style { border: 0; border-top: 1px solid var(--border-soft); }
    .text .scroll { max-height: 60vh; }
    .stage { height: 62vh; }
  }
  @media (max-width: 560px) {
    .top, .timeline-area { padding-left: 16px; padding-right: 16px; }
    .pname { width: 14ch; }
    .thead { flex-wrap: wrap; gap: 8px; }
  }

  /* Desktop-only / phone-only chrome */
  .mob-close, .dock, .scrim, .grab, .sheet-x, .sheet-bar { display: none; }

  /* Phone: preview + transport + timeline fill the screen; panels open as bottom sheets from a tool dock. */
  @media (max-width: 760px) {
    .app {
      height: calc(100dvh / var(--ui-zoom)); min-height: 0;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto auto;
      grid-template-areas: 'top' 'center' 'tl' 'dock';
    }
    .top { position: static; flex-wrap: nowrap; padding: 8px 12px; border: 0; }
    .top .brand { order: 1; flex: 1; justify-content: center; }
    .top .actions { display: contents; }
    .mob-close { display: inline-flex; order: 0; border: 0; font-size: 20px; text-decoration: none; }
    .top .primary { order: 2; border-radius: 12px; }
    .desk, .brand svg, .logo, .slash, .pill { display: none; }
    .pname { width: 100%; max-width: 22ch; text-align: center; font-size: 16px; }

    .stage { height: auto; }
    .frame, .empty { inset: 8px 12px; }
    .badge { display: none; }
    .transport { padding: 6px 12px; border: 0; flex-wrap: nowrap; }
    .zoomctl { display: none; }
    .round { border: 0; }

    .timeline-area { padding: 8px 12px; border-top: 1px solid var(--border-soft); max-height: 38dvh; overflow: auto;
      grid-template-columns: minmax(0, 1fr); overflow-x: hidden; }
    .thead, .thead .row { min-width: 0; }
    /* The tools stay pinned while the timeline scrolls under them, and swiping them never moves it. */
    .thead { position: sticky; top: -8px; z-index: 5; margin-top: -8px; padding-top: 8px; background: var(--bg); }
    .thead h2 { display: none; }
    .thead .row { justify-content: flex-start; flex-wrap: nowrap; overflow-x: auto; width: 100%; scrollbar-width: none;
      touch-action: pan-x; overscroll-behavior: contain; }
    .thead .row > * { flex: none; }

    .dock { grid-area: dock; display: flex; overflow-x: auto; scrollbar-width: none; gap: 4px; padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
      border-top: 1px solid var(--border-soft); background: var(--bg); }
    .dock button { flex: 1 0 72px; height: auto; flex-direction: column; gap: 4px; padding: 6px 4px; border: 0; color: var(--muted); font-size: 12px; }
    .dock button span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .dock button.on { color: var(--accent); }

    /* Bottom sheets */
    .assets, .text, .style {
      display: none; position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; max-height: 72dvh;
      border: 0; border-radius: 18px 18px 0 0; box-shadow: 0 -8px 30px rgb(0 0 0 / .5);
      padding-bottom: env(safe-area-inset-bottom); animation: up .22s ease-out;
    }
    .assets.shown, .text.shown, .style.shown { display: flex; }
    /* Strip grading lives in its own Color sheet on phones. */
    .style > .strip { display: none; }
    .text .scroll { max-height: none; flex: 1; min-height: 0; }
    .style { overflow: auto; }
    .grab { display: block; flex: none; width: 40px; height: 4px; border-radius: 2px; background: var(--border); margin: 8px auto 0; }
    .assets .grab { margin-top: -8px; }
    .tabs { align-items: center; }
    .sheet-x { display: inline-flex; margin-left: auto; border: 0; }
    .sheet-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px 0; }
    .sheet-bar button { border: 0; }
    .scrim { display: block; position: fixed; inset: 0; z-index: 19; background: rgb(0 0 0 / .45); border: 0; border-radius: 0; height: auto; padding: 0; }
    .tools, .acts { display: flex; }
  }
  .layer { display: grid; gap: 10px; padding: 12px; margin: 0 0 12px; border: 1px solid #6ab8ff55; border-radius: 10px; background: var(--card); }
  .layer .lhead { display: flex; justify-content: space-between; align-items: center; }
  .layer h3 { margin: 0; font-size: 13px; color: #6ab8ff; }
  .layer textarea { width: 100%; resize: vertical; }
  .layer .lrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; }
  .layer .keyrow { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .layer .key.on { color: #ffd84d; border-color: #ffd84d; }
  .layer .keyhint { margin: -4px 0 0; }
  .spkrow { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; margin: 6px 0; }
  .hl { display: grid; gap: 8px; margin-bottom: 10px; }
  .hl summary { cursor: pointer; font-weight: 600; display: flex; gap: 6px; align-items: center; }
  .hl .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: end; }
  .hls { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .hls li { border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: grid; gap: 6px; }
  .hls .hlt { font-size: 13px; overflow-wrap: anywhere; }
  .hls .chip { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: var(--tab-on); font-size: 11px; }
  .stripkey { flex-basis: 100%; max-width: 360px; }
  .layer .lfx summary { cursor: pointer; font-size: 0.85em; margin: 4px 0; }
  .layer .lfx { display: grid; gap: 6px; }
  .layer .crop { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .layer input[type=color] { width: 44px; height: 28px; padding: 0; border: 0; background: none; }
  .tpl { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--border-soft); border-radius: 10px; display: grid; gap: 8px; }
  .tpl summary { cursor: pointer; font-size: 13px; font-weight: 600; }
  .tpl[open] summary { margin-bottom: 4px; }
  .tpl-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .tpl-item { display: flex; gap: 2px; }
  .hist { width: min(460px, calc(100vw - 32px)); max-height: 80vh; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .hist::backdrop { background: rgb(0 0 0 / .55); }
  .hist .lhead { display: flex; justify-content: space-between; align-items: center; }
  .hist h3 { margin: 0; }
  .hist ol { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
  .hist li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 10px; background: var(--card); border-radius: 8px; font-size: 13px; }
  .proxybar { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--accent); transition: width .2s; }
  .zonewarn { font-size: 12px; color: #ffb86b; }
  .ratio { height: 30px; font-size: 12px; }
  .trbox { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 10px; }
  .trbox select { height: 32px; font-size: 12px; }
  textarea.tr { margin-top: 4px; font-size: 12px; color: #9fd0ff; border-style: dashed; }
  .chk { display: flex; gap: 6px; align-items: center; font-size: 12px; white-space: nowrap; }
  .keys-bg { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / .55); display: grid; place-items: center; padding: 16px; }
  .keys { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; width: min(440px, 100%);
    max-height: 90vh; overflow: auto; display: grid; gap: 12px; }
  .keys h3 { margin: 0; font-size: 15px; }
  .keys dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; align-items: center; }
  .keys dd { margin: 0; color: var(--muted); }
  .keys kbd { font: 12px ui-monospace, monospace; background: var(--tab-on); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
  .keys > button { justify-self: end; }
  @keyframes up { from { transform: translateY(100%); } }
  .audio-sil { display: grid; gap: 6px; margin: 8px 0; }
  .audio-sil summary { cursor: pointer; font-weight: 600; font-size: 13px; }
  .audio-sil .sl { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; font-size: 12px; color: var(--muted); }
  .audio-sil .sl input { grid-column: 1 / -1; accent-color: var(--accent); }
</style>
