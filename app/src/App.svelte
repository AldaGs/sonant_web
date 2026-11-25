<script lang="ts">
  import { setRange, split, startOf, endOf, type Caption, type Word } from './lib/captions';
  import { DEFAULT_STYLE, type Style } from './lib/render';
  import { BUNDLED, type Font, type SavedFont } from './lib/fonts';
  import { type Asset, type AudioItem } from './lib/project';
  import { assignBases, piecesOf, captionsOut, keptCaps, srcToOut, timelineEnd, outToSrc } from './lib/model';
  import { Player } from './lib/player';
  import { Transitioner } from './lib/transitions';
  import { Grader, parseCube, type Color, type Lut } from './lib/grade';
  import { median } from './lib/reframe';
  import { SAFE_ZONES, type Platform } from './lib/safezones';
  import { outputSize, type Aspect } from './lib/export';
  import { untrack } from 'svelte';
  import { cleanup, cleanupRanges } from './lib/cleanup.svelte';
  import { speechRanges } from './lib/audio';
  import { translated, type Dir } from './lib/translate';
  import PerfDialog from './lib/PerfDialog.svelte';
  import MediaPanel from './lib/MediaPanel.svelte';
  import AudioPanel from './lib/AudioPanel.svelte';
  import AIToolsPanel from './lib/AIToolsPanel.svelte';
  import ClipInspector from './lib/ClipInspector.svelte';
  import TextPanel from './lib/TextPanel.svelte';
  import LayerInspector from './lib/LayerInspector.svelte';
  import { DEFAULT_HL, type Highlight } from './lib/highlights';
  import { zoomMoments, zoomShake, type AutoZoom } from './lib/autozoom';
  import { BUILTIN, type Template } from './lib/templates';
  import { fitMedia, type Overlay } from './lib/overlay';
  import { type Thumb } from './lib/thumbs';
  import * as store from './lib/store';
  import { t, ui, setLang } from './lib/i18n.svelte';
  import Timeline from './lib/Timeline.svelte';
  import Icon from './lib/Icon.svelte';
  import ExportDialog from './lib/ExportDialog.svelte';
  import StylePanel from './lib/StylePanel.svelte';
  import TranscriptView from './lib/TranscriptView.svelte';
  import { end } from './lib/crash';
  import { type Version } from './lib/projects';
  import type { Ed, Snap } from './lib/editor/ed';
  import { createEdit } from './lib/editor/edit.svelte';
  import { createMedia } from './lib/editor/media.svelte';
  import { createJobs } from './lib/editor/jobs.svelte';
  import { createLayers } from './lib/editor/layers.svelte';
  import { createPreview } from './lib/editor/preview.svelte';
  import { createKeys } from './lib/editor/keys.svelte';
  import { TOOLS, type Tool } from './lib/tools';
  import { reconcile } from './lib/links';
  import { assignTracks, byTrack, isHidden, isMuted, type Tracks } from './lib/tracks';
  import { itemLen as audItemLen, STILL_LEN } from './lib/project';

  // The editor works on one project at a time; the home page (#/) lists them all.
  let { projectId }: { projectId: string } = $props();

  // ---- Project media ----
  let assets = $state<Asset[]>([]);
  // Every track works the same (lib/model.ts): video tracks V1, V2… hold video, pictures and text; audio tracks
  // A1, A2… hold sound (a video's own sound is a linked item). All placed in output time.
  let overlays = $state<Overlay[]>([]); // items on the video tracks; track 0 = V1
  let audios = $state<AudioItem[]>([]); // items on the audio tracks; track 0 = A1
  let clipVolume = $state(1); // extra volume for the sound of videos
  let denoise = $state(0); // AI noise reduction on the sound of videos: wet mix, 0 = off
  let selectedOverlay = $state('');
  // Numbered tracks and their hide / mute / lock switches.
  let tracks = $state<Tracks>({ v: [], a: [] });
  const TOOL_ICON = { select: 'arrow_selector_tool', razor: 'content_cut', ripple: 'keyboard_tab', roll: 'arrow_range', slip: 'swap_horiz' } as const;
  let tool = $state<Tool>('select'); // timeline tool (V select, C razor, B ripple, R roll, Y slip)
  const shownOverlays = $derived(overlays.filter((o) => !isHidden(tracks, o)));
  const liveAudios = $derived(audios.filter((a) => !isMuted(tracks, a)));
  // The player keeps every element in step (so nothing keeps playing after a toggle); muted/hidden ones are silent.
  const playAudios = $derived(audios.map((a) => (isMuted(tracks, a) ? { ...a, volume: 0 } : a)));
  const playOverlays = $derived(overlays.map((o) => (isHidden(tracks, o) ? { ...o, volume: 0 } : o)));
  // Every layer and audio item sits on a track. Items added without one (and older projects) get the
  // lowest free track above whatever they overlap, so new layers land on top like before.
  $effect(() => {
    if (overlays.some((o) => o.track === undefined)) overlays = byTrack(assignTracks(overlays, (o) => o.len));
  });
  // Linked picture + sound (links.ts): after any edit, the side that changed leads and its partner follows.
  const linkMem = new Map<string, { at: number; len: number; offset: number; fx: string }>();
  $effect(() => {
    const r = reconcile(overlays, audios, (id) => durations.get(id) ?? 0, linkMem);
    if (r) ((overlays = r.overlays), (audios = r.audios));
  });
  $effect(() => {
    if (audios.some((a) => a.track === undefined)) audios = assignTracks(audios, (a) => audItemLen(a, durations.get(a.assetId) ?? 0));
  });
  // Audio items saved without a length play the rest of their file: give them one (edits work on lengths).
  $effect(() => {
    if (audios.some((a) => a.len === undefined && durations.has(a.assetId))) audios = audios.map((a) => (a.len === undefined && durations.has(a.assetId) ? { ...a, len: audItemLen(a, durations.get(a.assetId)!) } : a));
  });
  // assetId → image decoded once and downscaled for the preview. Drawing a full-size photo (and uploading it
  // to the GPU for effects) every frame is what made stills slow; a ~1080p bitmap costs about as much as a video frame.
  const pics = new Map<string, { src: ImageBitmap; w: number; h: number }>();
  const PIC_MAX: number = 1920;
  let urls = $state<Record<string, string>>({}); // assetId → object URL
  const files = new Map<string, File>(); // assetId → file
  let thumbs = $state<Record<string, Thumb[]>>({});
  let peaks = $state<Record<string, Float32Array>>({});
  let wordCache: Record<string, Word[]> = {}; // `${assetId}|${language}` → words in asset time

  const durations = $derived(new Map(assets.map((a) => [a.id, a.duration])));
  const names = $derived(new Map(assets.map((a) => [a.id, a.name])));
  const duration = $derived(timelineEnd({ overlays, audios }, (id) => durations.get(id) ?? 0)); // where the timeline ends
  const hasMedia = $derived(overlays.length > 0 || audios.length > 0); // anything on the timeline
  // Frame size: the first video or picture on the lowest track.
  const firstVideo = $derived(byTrack(overlays).map((o) => o.assetId && assets.find((a) => a.id === o.assetId)).find((a) => a && a.width) || undefined);
  // Every file has a place in source time, where captions are timed (lib/model.ts).
  $effect(() => {
    if (assets.some((a) => a.base === undefined)) assets = assignBases(assets);
  });
  const bases = $derived(new Map(assets.flatMap((a) => (a.base !== undefined ? [[a.id, a.base] as [string, number]] : []))));
  // What plays each moment of each file: words show where their footage plays, and are "cut" where none does.
  const pieces = $derived(piecesOf(shownOverlays, liveAudios, bases));
  const srcW = $derived(firstVideo?.width || 1280);
  const srcH = $derived(firstVideo?.height || 720);
  // Canvas shape for the whole project (Original, 9:16, 1:1, 4:5, 16:9); videos cover it around each strip's focus.
  let canvasAspect = $state<Aspect>('source');
  const canvasSize = $derived(outputSize(srcW, srcH, 'source', canvasAspect));
  const frameW = $derived(canvasSize.width);
  const frameH = $derived(canvasSize.height);

  // ---- Editing state ----
  let time = $state(0); // output time of the playhead
  let paused = $state(true);
  let fileDrag = $state(false); // files from the computer are being dragged over the editor
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
  // Selected captions for per-caption styling. The last one clicked is the "primary": the style panel shows its look.
  let selectedCapIds = $state<string[]>([]);
  let selectedAudio = $state('');
  let tlZoom = $state(1);
  let exporter = $state<ExportDialog>();

  const selectedCapId = $derived(selectedCapIds.at(-1) ?? null);
  const selectedSet = $derived(new Set(selectedCapIds));
  const selectedCapIndex = $derived(captions.findIndex((c) => c.id === selectedCapId));
  const selectedCap = $derived(selectedCapIndex >= 0 ? captions[selectedCapIndex] : null);
  const clearCapSelection = () => (selectedCapIds = []);

  let cleanUrls = $state<Record<string, string>>({}); // assetId → noise-reduced sound of a video
  const player = new Player(() => ({ overlays: playOverlays, audios: playAudios, durations, clipVolume, speech,
    videoUrl: (id) => previewUrl(id), audioUrl: (id, linked) => (linked && cleanUrls[id]) || urls[id] }));
  let mediaHost = $state<HTMLDivElement>();
  $effect(() => { player.host = mediaHost ?? null; });

  // Undo/redo: snapshots of the editable project.
  let past = $state<Snap[]>([]);
  let future = $state<Snap[]>([]);
  // Screen-reader announcements for actions that only change the picture or the timeline.
  let liveMsg = $state('');

  // ---- Persistence: this project's doc + media in IndexedDB (see lib/projects.ts) ----
  let speakers = $state<string[]>([]);
  let name = $state('');
  let saving = $state(false); // no autosave until the saved project has been restored
  let savedFonts: SavedFont[] = [];

  // ---- AI noise reduction: a cleaned copy of each video clip's sound, made once per level and cached ----
  let cleanBlobs = new Map<string, Blob>(); // assetId → level of the copy in player.clean
  let cleanPct = $state<number | null>(null);

  // ---- Proxies: small fast-seeking copies for the preview (export uses the originals) ----
  let proxyUrls = $state<Record<string, string>>({});
  let proxyPct = $state<Record<string, number>>({});

  // ---- Version history ----
  let histDialog = $state<HTMLDialogElement>();
  let versions = $state<Version[]>([]);

  // Save the project as a .sonant file (Ctrl/⌘+S). Chrome/Edge keep writing to the same file afterwards.
  let fileStatus = $state('');
  // ---- Auto-zoom aim: find the person in the frame at each zoom and zoom towards them ----
  let aimBusy = $state(false);

  // ---- Stabilization: measure the camera's shake on small greyscale frames, then shift it out ----
  let stabPct = $state<number | null>(null);

  // ---- Reverse a strip: a reversed copy of its range is made once and played in its place ----
  let revPct = $state<number | null>(null);

  // ---- Voice changer on a Music & VO item: rendered into a new audio file (the original is kept) ----
  let vfxBusy = $state(false);

  // ---- Speaker detection: a voice fingerprint per caption, grouped by similarity ----
  let spkCount = $state(0); // 0 = auto
  let spkSplit = $state(true); // split a caption where the speaker changes
  let spkBusy = $state(false), spkStatus = $state(''), spkPct = $state(0), spkMsg = $state('');

  // ---- Auto-clips: best 15–60s moments from the transcript, each can become its own 9:16 project ----
  let hlOpts = $state({ ...DEFAULT_HL });
  let highlights = $state<Highlight[] | null>(null);
  let shortsMade = $state<Record<number, string>>({});
  let hlReframe = $state(true); // keep the person in the 9:16 frame on each new short
  let hlBusy = $state('');
  const kindOf = (id: string) => assets.find((a) => a.id === id)?.kind;
  const imageAssets = $derived(assets.filter((a) => a.kind === 'image'));

  // ---- Overlays (layers over the main video) ----
  const outNow = () => player.o;

  // ---- Templates (shared by every project in this browser) ----
  let myTemplates = $state<Template[]>([]);
  const selOverlay = $derived(overlays.find((o) => o.id === selectedOverlay) ?? null);

  // ---- Transcription: per file (cached), then laid out where the timeline plays it ----
  // Transcribe every video, or just one (its captions are replaced; captions on other footage are kept).
  let transcribeTarget = $state<string>('all'); // 'all' or a video item id
  const vidItems = $derived(byTrack(overlays).filter((o) => o.kind === 'video' && !o.fx?.hold && !o.fx?.rev));
  const targetClip = $derived(vidItems.find((o) => o.id === transcribeTarget) ?? null);

  // Trim silences from the audio itself (no transcription): quiet stretches in every clip are cut.
  let silBusy = $state(false);

  // ---- Playback ----
  // The playhead in source time (the time captions are in), for the transcript.
  const srcTime = $derived(outToSrc(pieces, time) ?? -1);
  const active = (c: Caption) => srcTime >= startOf(c) && srcTime < endOf(c);
  function seekOut(o: number) {
    player.seek(o);
    time = outClock = player.o;
  }
  // Seek to a source time (a word in the transcript): where the timeline plays it.
  const seek = (s: number) => {
    const o = srcToOut(pieces, s);
    if (o !== null) seekOut(o);
  };
  const toggle = () => (player.playing ? player.pause() : player.play(), (paused = !player.playing));
  let outClock = $state(0); // output time from the player
  const outTime = $derived(outClock); // layers drawn this frame, bottom first (for hit tests)
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
  // The selected media item (video or picture): its effects show in the clip inspector.
  const selMedia = $derived(selOverlay && selOverlay.kind !== 'text' ? selOverlay : null);
  const selColor = $derived<Color>(selMedia?.fx?.color ?? {});
  // Slider drags: one undo step per drag (like layer edits).
  let colorEditing = false;
  function setColor(patch: Partial<Color>, replace = false) {
    if (!selMedia) return;
    setFx({ color: replace ? patch : { ...selMedia.fx?.color, ...patch } }, true);
  }
  // Reframing only matters when the canvas shape differs from the footage.
  const reframes = $derived(!!selMedia && (() => {
    const a = assets.find((x) => x.id === selMedia.assetId);
    return !!a?.width && Math.abs(frameW / frameH - a.width / (a.height || 1)) > 0.01;
  })());
  const setFocus = (focus: { x: number; y: number } | undefined) => setFx({ focus }, true);
  // Auto-reframe: find the person in a few frames of the strip and centre on them (median, so one miss doesn't matter).
  let reframing = $state(false);

  // ---- Layout state ----
  let tab = $state<'transcript' | 'captions'>('transcript');
  // Left panel: Media (library + sequence), Audio (levels, cleanup, music, voiceover), AI tools.
  type LeftTab = 'media' | 'audio' | 'ai';
  // Desktop panel visibility, remembered per project.
  const layoutKey = `sonant.layout.${projectId}`;
  const savedLayout = (() => { try { return JSON.parse(localStorage.getItem(layoutKey) ?? '{}'); } catch { return {}; } })();
  let assetsOpen = $state<boolean>(savedLayout.assets ?? true);
  let textOpen = $state<boolean>(savedLayout.text ?? true);
  let styleOpen = $state<boolean>(savedLayout.style ?? true);
  let leftTab = $state<LeftTab>(['media', 'audio', 'ai'].includes(savedLayout.left) ? savedLayout.left : 'media');
  $effect(() => {
    const v = JSON.stringify({ assets: assetsOpen, text: textOpen, style: styleOpen, left: leftTab });
    try { localStorage.setItem(layoutKey, v); } catch { /* storage unavailable */ }
  });
  const gridCols = $derived([assetsOpen && '270px', textOpen && '340px', 'minmax(0, 1fr)', styleOpen && '340px'].filter(Boolean).join(' '));
  const gridAreas = $derived.by(() => {
    const mid = [assetsOpen && 'assets', textOpen && 'text', 'center', styleOpen && 'style'].filter(Boolean) as string[];
    return [mid.map(() => 'top'), mid, mid.map(() => 'tl')].map((r) => `'${r.join(' ')}'`).join(' ');
  });
  // Phone layout: panels open one at a time as bottom sheets from the tool dock.
  let sheet = $state<'assets' | 'text' | 'style' | null>(null);
  function openSheet(s: 'assets' | 'text' | 'style', sub?: LeftTab) {
    const same = sheet === s && (!sub || leftTab === sub);
    if (sub) leftTab = sub;
    sheet = same ? null : s;
  }
  let zoom = $state(1); // 1 = fit to the stage
  const used = $derived(new Set([...overlays.flatMap((o) => (o.assetId ? [o.assetId] : [])), ...audios.map((a) => a.assetId)]));
  const selAudio = $derived(audios.find((a) => a.id === selectedAudio));
  // Selecting music on the timeline brings up its settings in the Audio tab.
  $effect(() => {
    if (!selectedAudio) return;
    leftTab = 'audio';
    if (!sheet) assetsOpen = true;
  });

  let transcriptView = $state<TranscriptView>();
  const visibleCaps = $derived(captionsOut(captions, pieces)); // the original captions where they play, without cut words
  // The transcript reads in timeline order: each caption goes where its first played word plays; fully struck
  // ones stay right after the caption before them in their file.
  const transcriptCaps = $derived.by(() => {
    let last = -1;
    const keyed = captions.filter((c) => !c.free).map((c) => {
      const o = c.words.map((w) => srcToOut(pieces, (w.start + w.end) / 2)).find((x) => x !== null) ?? null;
      last = o ?? last + 1e-6;
      return [last, c] as const;
    });
    return keyed.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  });
  const seekCap = (c: Caption) => (c.free ? seekOut(startOf(c)) : seek(startOf(c)));
  // A caption dragged on the timeline (output time): footage-bound ones move by the same amount in source time.
  function moveCap(id: string, s: number, e: number) {
    captions = captions.map((c) => {
      if (c.id !== id) return c;
      const o = visibleCaps.find((x) => x.id === id);
      if (c.free || !o) return setRange(c, s, e);
      const k = (endOf(c) - startOf(c)) / Math.max(1e-3, endOf(o) - startOf(o)); // speed of the footage
      return setRange(c, startOf(c) + (s - startOf(o)) * k, startOf(c) + (e - startOf(o)) * k);
    });
  }
  // ---- Translation: a second language per caption (Caption.tr), shown instead of the original when on ----
  let showTr = $state(false);
  let trDir = $state<Dir>('en-es');
  $effect(() => { if (language) trDir = language === 'spanish' ? 'es-en' : 'en-es'; });
  let trBusy = $state(false);
  const hasTr = $derived(captions.some((c) => c.tr));
  // What the preview, SRT/VTT files and export show.
  // Zoom moments come from the original captions (translated ones don't carry emphasis).
  // Moments are found in source time (so hand edits stay put through cuts) and drawn where they play.
  const zoomsSrc = $derived(autoZoom ? zoomMoments(keptCaps(captions, pieces).filter((c) => !c.free), autoZoom) : []);
  const zooms = $derived(zoomsSrc.flatMap((m) => {
    const s = srcToOut(pieces, m.start);
    return s === null ? [] : [{ ...m, start: s, end: s + (m.end - m.start) }];
  }));
  const displayCaps = $derived(showTr ? translated(visibleCaps) : visibleCaps);
  // Where someone is talking, in output time: music marked "duck" dips under it.
  const speech = $derived(speechRanges(visibleCaps.flatMap((c) => c.words)));
  // Clean-up preview on the timeline: what "Apply" would cut.
  const pendingCuts = $derived.by(() => {
    if (!cleanup.preview) return [];
    const r = cleanupRanges(captions.filter((c) => !c.free).flatMap((c) => c.words), pieces);
    return [...r.fillers, ...r.silences].flatMap(([a, b]) => {
      const x = srcToOut(pieces, a), y = srcToOut(pieces, b - 1e-3);
      return x === null || y === null ? [] : [[x, y] as [number, number]];
    });
  });

  // Auto-select: follow the playhead. The caption under it becomes the selection (none in a gap),
  // and with more than one video strip the strip under it is selected too. Only acts when the
  // thing under the playhead changes, so a manual pick stays until the playhead moves on.
  const pref = (k: string) => { try { return localStorage.getItem('sonant.' + k) !== '0'; } catch { return true; } };
  let snapOn = $state(pref('snap'));
  $effect(() => { try { localStorage.setItem('sonant.snap', snapOn ? '1' : '0'); } catch {} });
  let marks = $state<[number | null, number | null]>([null, null]); // I/O range, output time
  let showKeys = $state(false);
  let autoSelect = $state((() => { try { return localStorage.getItem('sonant.autoSelect') !== '0'; } catch { return true; } })());
  $effect(() => { try { localStorage.setItem('sonant.autoSelect', autoSelect ? '1' : '0'); } catch {} });
  const capUnder = $derived(visibleCaps.find((c) => time >= startOf(c) && time < endOf(c))?.id ?? null);
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

  // Clear every selection so the inspector goes back to the caption styles.
  const deselect = () => ((selectedAudio = ''), (selectedOverlay = ''), (selectedCapIds = []));
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

  // S: split the selected item (and its linked sound/picture) at the playhead; with nothing selected under it,
  // every unlocked track.
  function cutHere() {
    const sel = selectedOverlay || selectedAudio;
    if (!(sel && splitItems([sel], outClock)) && !splitAll()) return;
    announce(t('a11y.split', { t: tc(outTime) }));
  }
  // Shift+S: split every unlocked track at the playhead.
  const cutAll = () => splitAll() && announce(t('a11y.split', { t: tc(outTime) }));
  // Key colour eyedropper: keys are switched off in the preview, the next click samples the frame there.
  let pickKey = $state<string | null>(null);
  let showPerf = $state(false);
  // Beats of the selected music: detected once per file and kept on the asset.
  let beatBusy = $state(false);
  const beatMap = $derived(new Map(assets.flatMap((a) => (a.beats?.length ? [[a.id, a.beats] as [string, number[]]] : []))));

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  // 00:00:08.12 (hh:mm:ss.cc)
  const tc = (s: number) => {
    const cs = Math.floor(s * 100), p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(cs / 360000))}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
  };

  // ---- Feature modules: they read and write the state above through this accessor ----
  const ed: Ed = {
    get PIC_MAX() { return PIC_MAX; },
    get addAudio() { return addAudio; },
    get addOverlay() { return addOverlay; },
    get addText() { return addText; },
    get aimBusy() { return aimBusy; }, set aimBusy(v) { aimBusy = v; },
    get announce() { return announce; },
    get assets() { return assets; }, set assets(v) { assets = v; },
    get audios() { return audios; }, set audios(v) { audios = v; },
    get autoSelect() { return autoSelect; }, set autoSelect(v) { autoSelect = v; },
    get autoZoom() { return autoZoom; }, set autoZoom(v) { autoZoom = v; },
    get beatBusy() { return beatBusy; }, set beatBusy(v) { beatBusy = v; },
    get busy() { return busy; }, set busy(v) { busy = v; },
    get canvas() { return canvas; },
    get canvasAspect() { return canvasAspect; }, set canvasAspect(v) { canvasAspect = v; },
    get capInZone() { return capInZone; }, set capInZone(v) { capInZone = v; },
    get captions() { return captions; }, set captions(v) { captions = v; },
    get cleanBlobs() { return cleanBlobs; },
    get cleanUrls() { return cleanUrls; },
    get cleanPct() { return cleanPct; }, set cleanPct(v) { cleanPct = v; },
    get clearCapSelection() { return clearCapSelection; },
    get clipVolume() { return clipVolume; }, set clipVolume(v) { clipVolume = v; },
    get commit() { return commit; },
    get cutHere() { return cutHere; },
    get cutAll() { return cutAll; },
    get cutRanges() { return cutRanges; },
    get cutOutRange() { return cutOutRange; },
    get dropAsset() { return dropAsset; },
    get splitItems() { return splitItems; },
    get pieces() { return pieces; },
    get deleteSelected() { return deleteSelected; },
    get denoise() { return denoise; }, set denoise(v) { denoise = v; },
    get displayCaps() { return displayCaps; },
    get doneEditing() { return doneEditing; },
    get duration() { return duration; },
    get durations() { return durations; },
    get endPick() { return endPick; },
    get error() { return error; }, set error(v) { error = v; },
    get fileStatus() { return fileStatus; }, set fileStatus(v) { fileStatus = v; },
    get files() { return files; },
    get fontError() { return fontError; }, set fontError(v) { fontError = v; },
    get fonts() { return fonts; }, set fonts(v) { fonts = v; },
    get frameH() { return frameH; },
    get frameW() { return frameW; },
    get future() { return future; }, set future(v) { future = v; },
    get grader() { return grader; },
    get hasMedia() { return hasMedia; },
    get highlights() { return highlights; }, set highlights(v) { highlights = v; },
    get histDialog() { return histDialog; },
    get hlBusy() { return hlBusy; }, set hlBusy(v) { hlBusy = v; },
    get hlOpts() { return hlOpts; },
    get hlReframe() { return hlReframe; },
    get importMedia() { return importMedia; },
    get kindOf() { return kindOf; },
    get language() { return language; }, set language(v) { language = v; },
    get liveMsg() { return liveMsg; }, set liveMsg(v) { liveMsg = v; },
    get lutMap() { return lutMap; },
    get luts() { return luts; }, set luts(v) { luts = v; },
    get marks() { return marks; }, set marks(v) { marks = v; },
    get myTemplates() { return myTemplates; }, set myTemplates(v) { myTemplates = v; },
    get name() { return name; }, set name(v) { name = v; },
    get names() { return names; },
    get notice() { return notice; }, set notice(v) { notice = v; },
    get outClock() { return outClock; }, set outClock(v) { outClock = v; },
    get outNow() { return outNow; },
    get outTime() { return outTime; },
    get overlays() { return overlays; }, set overlays(v) { overlays = v; },
    get tracks() { return tracks; }, set tracks(v) { tracks = v; },
    get tool() { return tool; }, set tool(v) { tool = v; },
    get rippleDeleteSel() { return rippleDeleteSel; },
    get shownOverlays() { return shownOverlays; },
    get liveAudios() { return liveAudios; },
    get past() { return past; }, set past(v) { past = v; },
    get paused() { return paused; }, set paused(v) { paused = v; },
    get pct() { return pct; }, set pct(v) { pct = v; },
    get peaks() { return peaks; },
    get pickKey() { return pickKey; }, set pickKey(v) { pickKey = v; },
    get pics() { return pics; },
    get player() { return player; },
    get previewUrl() { return previewUrl; },
    get projectId() { return projectId; },
    get proxyPct() { return proxyPct; },
    get proxyUrls() { return proxyUrls; },
    get redo() { return redo; },
    get reframing() { return reframing; }, set reframing(v) { reframing = v; },
    get register() { return register; },
    get removeAudioItem() { return removeAudioItem; },
    get removeOverlay() { return removeOverlay; },
    get revPct() { return revPct; }, set revPct(v) { revPct = v; },
    get safe() { return safe; },
    get saveToFile() { return saveToFile; },
    get savedFonts() { return savedFonts; }, set savedFonts(v) { savedFonts = v; },
    get saving() { return saving; }, set saving(v) { saving = v; },
    get seekOut() { return seekOut; },
    get selColor() { return selColor; },
    get selOverlay() { return selOverlay; },
    get selectedAudio() { return selectedAudio; }, set selectedAudio(v) { selectedAudio = v; },
    get selectedCap() { return selectedCap; },
    get selectedCapId() { return selectedCapId; },
    get selectedCapIds() { return selectedCapIds; }, set selectedCapIds(v) { selectedCapIds = v; },
    deselect, get selectedOverlay() { return selectedOverlay; }, set selectedOverlay(v) { selectedOverlay = v; },
    get selectedSet() { return selectedSet; },
    get setAudio() { return setAudio; },
    get setCaps() { return setCaps; },
    get setFx() { return setFx; },
    get setOverlay() { return setOverlay; },
    get setTf() { return setTf; },
    get sheet() { return sheet; }, set sheet(v) { sheet = v; },
    get shortsMade() { return shortsMade; }, set shortsMade(v) { shortsMade = v; },
    get showKeys() { return showKeys; }, set showKeys(v) { showKeys = v; },
    get showTr() { return showTr; }, set showTr(v) { showTr = v; },
    get silBusy() { return silBusy; }, set silBusy(v) { silBusy = v; },
    get snapOn() { return snapOn; }, set snapOn(v) { snapOn = v; },
    get speakers() { return speakers; }, set speakers(v) { speakers = v; },
    get spkBusy() { return spkBusy; }, set spkBusy(v) { spkBusy = v; },
    get spkCount() { return spkCount; },
    get spkMsg() { return spkMsg; }, set spkMsg(v) { spkMsg = v; },
    get spkPct() { return spkPct; }, set spkPct(v) { spkPct = v; },
    get spkSplit() { return spkSplit; },
    get spkStatus() { return spkStatus; }, set spkStatus(v) { spkStatus = v; },
    get stabPct() { return stabPct; }, set stabPct(v) { stabPct = v; },
    get status() { return status; }, set status(v) { status = v; },
    get style() { return style; }, set style(v) { style = v; },
    get tab() { return tab; }, set tab(v) { tab = v; },
    get targetClip() { return targetClip; },
    get tc() { return tc; },
    get thumbs() { return thumbs; },
    get time() { return time; }, set time(v) { time = v; },
    get toggle() { return toggle; },
    get trBusy() { return trBusy; }, set trBusy(v) { trBusy = v; },
    get trDir() { return trDir; },
    get trans() { return trans; },
    get transcriptView() { return transcriptView; },
    get undo() { return undo; },
    get urls() { return urls; },
    get versions() { return versions; }, set versions(v) { versions = v; },
    get vfxBusy() { return vfxBusy; }, set vfxBusy(v) { vfxBusy = v; },
    get wordCache() { return wordCache; }, set wordCache(v) { wordCache = v; },
    get zooms() { return zooms; },
  };
  const { selectCap, clearCapFields, updateCapStyle, applyAllCapStyle, resetCapStyle, commit, undo, redo, announce, setCaps, cutRanges, keepRanges, cutOutRange, setFx, fxDone, freezeHere, addAudio, addToTimeline, removeAsset, update, download, addLocalFonts, addUploadedFont, addLine, deleteSelected, removeAudioItem, setAudio, dropOnTimeline } = createEdit(ed);
  const { previewUrl, buildProxy, dropProxy, register, openHistory, restoreVersion, ago, saveToFile, importMedia, addVoiceover } = createMedia(ed);
  const { aimZooms, stabilize, reverseStrip, renderItem, setVoiceFx, detectSpeakers, findClips, setHlLen, makeAllShorts, previewClip, makeShort, run, cutAudioSilences, autoReframe, autoReframeAll, colorToAll, translateAll, detectBeatsFor, cutOnBeats } = createJobs(ed);
  const { addOverlay, addText, addTitle, setMotion, applyTemplate, saveTemplate, deleteTemplate, setOverlay, setTf, layerT, toggleKey, jumpKey, punchIn, clearKeys, doneEditing, closeLayer, removeOverlay, restack, retrack, dropAsset, splitAll, detachSound, unlinkSound, toolEdit, toolDone, razor, rippleDeleteSel, setTrack, addTrack, dropTrack, splitItems } = createLayers(ed);
  // ---- Importing by drag and drop ----
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  // Import into the Media panel only; nothing is put on the timeline until it's dragged there.
  async function importToBin(list: FileList | File[] | undefined | null) {
    const added = await importMedia(list);
    if (added.length) ((leftTab = 'media'), announce(t('imported', { n: added.length })));
  }
  // Files dropped on a timeline track: imported, then placed one after another from the drop point.
  async function dropFiles(list: FileList, zone: 'v' | 'a', track: number, out: number) {
    let at = out;
    for (const a of await importMedia(list)) {
      dropAsset(a, zone, track, at);
      at += a.kind === 'image' ? STILL_LEN : a.duration;
    }
  }
  const { leave, pointer, nudge, startPick, endPick } = createPreview(ed);
  const { step, keys } = createKeys(ed);
</script>

<svelte:window onkeydown={keys} />

<!-- Files dropped anywhere in the editor are imported into the Media panel (a drop on a timeline track also places them there). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="app" class:file-drag={fileDrag} class:hide-text={!textOpen} class:hide-style={!styleOpen} class:sheet-open={sheet !== null}
  style:--cols={gridCols} style:--areas={gridAreas}
  ondragover={(e) => { if (hasFiles(e)) (e.preventDefault(), (fileDrag = true)); }}
  ondragleave={(e) => { if (!e.relatedTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) fileDrag = false; }}
  ondropcapture={() => (fileDrag = false)}
  ondrop={(e) => { if (e.defaultPrevented || !hasFiles(e)) return; e.preventDefault(); importToBin(e.dataTransfer?.files); }}>
  {#if fileDrag}<div class="dropnote" aria-hidden="true"><Icon name="upload" size={28} /> {t('dropImport')}</div>{/if}
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
      <button class="desk" class:on={styleOpen} onclick={() => (styleOpen = !styleOpen)} aria-pressed={styleOpen} title={t('toggleInspector')}>
        <Icon name="tune" />
        {t('inspector')}
      </button>
      <button class="primary" onclick={() => exporter?.open()} disabled={!hasMedia}><Icon name="ios_share" size={16} /> {t('ex.title')}</button>
    </div>
  </header>

  {#if assetsOpen || sheet === 'assets'}
    <aside class="assets panel" class:shown={sheet === 'assets'}>
      <div class="grab" aria-hidden="true"></div>
      <div class="phead">
        <div class="tabs ltabs" role="tablist" aria-label={t('assets')}>
          {#each ['media', 'audio', 'ai'] as const as k}
            <button role="tab" aria-selected={leftTab === k} class:on={leftTab === k} onclick={() => (leftTab = k)}>{t('tab.' + k)}</button>
          {/each}
        </div>
        <button class="icon sm" onclick={() => { if (sheet) sheet = null; else assetsOpen = false; }} aria-label={t('collapse')}><Icon name="chevron_left" /></button>
      </div>
      {#if leftTab === 'media'}
        <MediaPanel {assets} {used} {urls} {thumbs} {proxyPct} {fmt}
          importMedia={importToBin} {addToTimeline} addOverlay={(a: Asset) => addOverlay(a, undefined, true)} {buildProxy} {dropProxy} {removeAsset} />
      {:else if leftTab === 'audio'}
        <AudioPanel {selAudio} {unlinkSound} outNow={() => outClock} {assets} {names} hasClips={audios.some((a) => a.link)} bind:clipVolume bind:denoise {cleanPct} {vfxBusy} {beatBusy} {silBusy} {busy} {hasMedia}
          {setAudio} {cutOnBeats} {detectBeatsFor} {setVoiceFx} {renderItem} {commit} {removeAudioItem} {cutAudioSilences}
          voCaps={displayCaps} {selectedSet} {language} {addVoiceover} />
      {:else}
        <AIToolsPanel {captions} {highlights} {hlOpts} bind:hlReframe {hlBusy} {shortsMade} {fmt} {findClips} {setHlLen} {previewClip} {makeShort} {makeAllShorts}
          {busy} {spkBusy} bind:spkCount bind:spkSplit {spkStatus} {spkPct} {spkMsg} {detectSpeakers}
          bind:autoZoom {aimBusy} zoomCount={zooms.length} {aimZooms} />
      {/if}
    </aside>
  {/if}

  <section class="text panel" class:shown={sheet === 'text'}>
    <div class="grab" aria-hidden="true"></div>
    <TextPanel bind:tab bind:language bind:transcribeTarget bind:transcriptView bind:speakers bind:trDir bind:showTr bind:style
      {notice} {busy} {status} {pct} {error} {hasMedia} {captions} {transcriptCaps} videos={vidItems} {names} {pieces} time={srcTime}
      {trBusy} {hasTr} {selectedSet} {run} {seek} {seekCap} {cutRanges} {keepRanges} {setCaps} {translateAll} {active} {selectCap} {update} {addLine}
      onclose={() => (sheet = null)} />
  </section>

  <section class="center">
    <!-- Hidden media elements the player lends to items as they play; the canvas shows the result. -->
    <div class="media-host" bind:this={mediaHost} hidden></div>
    <div
      class="stage"
      class:zoomed={zoom !== 1}
      aria-label={t('preview')}
      role="region"
    >
      {#if hasMedia}
        <!-- .frame is the visible stage box; .fit is the largest box with the video's aspect ratio inside it (× zoom). -->
        <div class="frame">
          <div class="fit" style:--ar={frameW / frameH} style:--z={zoom}>
            {#if sharedAnim}<span class="badge">{t('animBadge', { name: t('anim.' + sharedAnim) })}</span>{/if}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (focusable so arrow keys can move the caption) -->
            <canvas bind:this={canvas} tabindex="0" onpointerdown={pointer} onpointermove={pointer} onpointerup={pointer}
              onpointercancel={pointer} onpointerleave={leave} onkeydown={nudge}
              aria-label={t('previewAria')}></canvas>
          </div>
        </div>
      {:else}
        <label class="empty">
          <span>{assets.length ? t('emptyTimeline') : t('drop')}</span>
          <input type="file" accept="video/*,audio/*,image/*" multiple hidden onchange={(e) => importToBin(e.currentTarget.files)} />
        </label>
      {/if}
    </div>
    <div class="transport">
      <div class="row">
        <button class="round" onclick={() => seekOut(time - 5)} disabled={!hasMedia} aria-label={t('back')}><Icon name="replay_5" size={22} /></button>
        <button class="round play" onclick={toggle} disabled={!hasMedia} aria-label={paused ? t('play') : t('pause')}><Icon name={paused ? 'play_arrow' : 'pause'} size={28} /></button>
        <button class="round" onclick={() => seekOut(time + 5)} disabled={!hasMedia} aria-label={t('forward')}><Icon name="forward_5" size={22} /></button>
        {#if capInZone}<span class="zonewarn" role="status">{t('capInZone', { app: t('safe.' + safe) })}</span>{/if}
        <span class="mono tcode">{tc(outTime)} <span class="muted">/ {tc(duration)}</span></span>
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

  <aside class="style panel" class:shown={sheet === 'style'}>
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-bar"><h2>{t('inspector')}</h2><button class="icon sm" onclick={() => (sheet = null)} aria-label={t('ex.close')}><Icon name="close" /></button></div>
    {#if selMedia}
      <ClipInspector item={selMedia} {imageAssets} {revPct} {stabPct} pickingKey={pickKey === selMedia.id}
        {setFx} {fxDone} {reverseStrip} {stabilize} {startPick}
        {selColor} {luts} {setColor} oncolordone={fxDone} {importLut} {colorToAll}
        {reframes} {setFocus} {autoReframe} {autoReframeAll} {reframing} webgl={grader.ok} />
    {/if}
    {#if selOverlay}
      <LayerInspector o={selOverlay} {outTime} {fonts} {overlays} {pickKey} {doneEditing} {closeLayer} {setOverlay} {setMotion} {setTf}
        {jumpKey} {toggleKey} {punchIn} {clearKeys} {startPick} {removeOverlay} {restack} {layerT} {outNow}
        linkedSound={selOverlay.link ? audios.find((a) => a.link === selOverlay.link) : undefined} {setAudio} {detachSound} {unlinkSound}
        fitOf={(o) => { const a = assets.find((x) => x.id === o.assetId); return fitMedia(a?.width, a?.height, frameW, frameH); }} />
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
  </aside>

  <section class="timeline-area" aria-label={t('timelineH')}
    ondragover={(e) => e.preventDefault()} ondrop={dropOnTimeline}>
    <div class="thead">
      <h2>{t('timelineH')}</h2>
      <div class="row">
        <button class="sm" onclick={addText} title={t('addTextTip')}><Icon name="title" /> {t('addText')}</button>
        <button class="sm" onclick={addTitle} title={t('addTitleTip')}><Icon name="animation" /> {t('addTitle')}</button>
        <button class="sm" onclick={() => freezeHere(1)} disabled={!overlays.some((o) => o.kind === 'video')} title={t('freezeTip')}><Icon name="ac_unit" /> {t('freeze')}</button>
        <button class="sm" onclick={cutHere} disabled={!hasMedia} title={t('splitTip')}><Icon name="content_cut" /> {t('splitAt')}</button>
        <button class="sm" onclick={cutAll} title={t('splitAllTip')}><Icon name="content_cut" /> {t('splitAll')}</button>
        <span class="tools" role="radiogroup" aria-label={t('tlTools')}>
          {#each TOOLS as k}
            <button class="sm icon" class:on={tool === k} role="radio" aria-checked={tool === k} onclick={() => (tool = k)}
              title={t('tool.' + k)} aria-label={t('tool.' + k)}><Icon name={TOOL_ICON[k]} /></button>
          {/each}
        </span>
        <button class="sm" onclick={deleteSelected} disabled={!selectedOverlay && !selectedAudio} title={t('delTip')}>{t('del')}</button>
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
    <Timeline {durations} {names} {thumbs} {peaks} captions={visibleCaps} {audios} duration={duration}
      bind:zoom={tlZoom} bind:selectedAudio selectedCapIds={selectedSet} onselectcap={selectCap}
      animLabel={t('allCaptions', { name: animName })}
      {zooms} onzoom={(k, s) => autoZoom && (autoZoom.edits = { ...autoZoom.edits, [k]: s === null ? null : outToSrc(pieces, s) })}
      out={outClock} onseek={(o) => seekOut(o)} snap={snapOn} range={marks} pending={pendingCuts} beats={beatMap}
      {overlays} bind:selectedOverlay {tracks}
      onretrack={(k, id, n) => retrack(k, id, n, false)} ontrack={setTrack} onaddtrack={addTrack} ondroptrack={dropTrack}
      onoverlay={(id, patch) => setOverlay(id, patch, false)}
      oncommit={() => (toolDone(), commit())}
      ondropasset={(id, zone, k, o) => { const a = assets.find((x) => x.id === id); if (a) dropAsset(a, zone, k, o); }}
      ondropfiles={dropFiles}
      {tool} ontool={toolEdit} onrazor={(k, id, t0) => razor(k, id, t0)}
      onmovecap={moveCap}
      onaudio={(id, patch) => setAudio(id, patch)} />
  </section>

  {#if sheet}
    <button class="scrim" onclick={() => (sheet = null)} aria-label={t('ex.close')} tabindex="-1"></button>
  {/if}

  <nav class="dock" aria-label={t('tlTools')}>
    {#each [['media', 'video_library'], ['audio', 'music_note'], ['ai', 'auto_awesome_motion']] as const as [k, icon]}
      <button class:on={sheet === 'assets' && leftTab === k} onclick={() => openSheet('assets', k)}>
        <Icon name={icon} size={24} />
        <span>{t('tab.' + k)}</span>
      </button>
    {/each}
    <button class:on={sheet === 'text'} onclick={() => openSheet('text')}>
      <Icon name="description" size={24} />
      <span>{t('text')}</span>
    </button>
    <button class:on={sheet === 'style'} onclick={() => openSheet('style')}>
      <Icon name="tune" size={24} />
      <span>{t('inspector')}</span>
    </button>
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
            <span class="muted small">{t('versionInfo', { caps: v.doc.captions?.length ?? 0, strips: v.doc.segments?.length ?? (v.doc.overlays ?? []).filter((o) => o.kind !== 'text').length, layers: v.doc.overlays?.length ?? 0, secs: Math.round(v.doc.segments ? v.doc.segments.reduce((a, s) => a + s.end - s.start, 0) : timelineEnd({ overlays: v.doc.overlays ?? [], audios: v.doc.audios ?? [] }, (id) => durations.get(id) ?? 0)) })}</span></span>
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
            ['V / C / B / R / Y', 'k.tools'], ['S', 'k.split'], ['Shift + S', 'k.splitAll'], ['I / O', 'k.marks'], ['X', 'k.cutRange'], ['Del', 'k.del'], ['Shift + Del', 'k.lift'], ['N', 'k.snap'], ['Alt + drag', 'k.free'],
            ['A', 'k.auto'], ['T', 'k.text'], ['Ctrl/⌘ + Z', 'undo'], ['Ctrl/⌘ + Shift + Z', 'redo'], ['Ctrl/⌘ + S', 'k.save'], ['Esc', 'k.esc'], ['?', 'keysTitle']] as [k, d]}
            <dt><kbd>{k}</kbd></dt><dd>{t(d)}</dd>
          {/each}
        </dl>
        <button class="sm" onclick={() => (showKeys = false)}>OK</button>
      </div>
    </div>
  {/if}
  <ExportDialog bind:this={exporter} {name} {duration} captions={displayCaps} onsubtitles={captions.length ? download : undefined} {style} {srcW} {srcH} {canvasAspect}
    source={() => ({ files, assets: $state.snapshot(assets), audios: $state.snapshot(liveAudios), overlays: $state.snapshot(shownOverlays), speech: $state.snapshot(speech), luts, clipVolume, zoomShake: !!autoZoom?.shake, clean: denoise ? new Map(cleanBlobs) : undefined, zooms: $state.snapshot(zooms), zoomScale: autoZoom?.scale })} />
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
  .actions button.on { border-color: var(--accent); background: rgb(255 255 255 / .06); }
  .lang { height: 36px; padding: 0 8px; }
  .panel { background: var(--panel); min-height: 0; display: flex; flex-direction: column; }
  .assets { grid-area: assets; border-right: 1px solid var(--border-soft); padding: 16px; gap: 12px; overflow: auto; }
  .phead { display: flex; justify-content: space-between; align-items: center; }
  .thead .row { flex-wrap: wrap; justify-content: flex-end; }
  .text { grid-area: text; border-right: 1px solid var(--border-soft); }
  .tabs { display: flex; gap: 4px; padding: 12px 16px; }
  .tabs button { border: 0; height: 36px; color: var(--muted); font-weight: 500; border-radius: 8px; }
  .tabs button.on { background: var(--tab-on); color: var(--text); }
  .row { display: flex; gap: 8px; align-items: center; }
  .row select { flex: 1; height: 36px; padding: 0 8px; }
  .center { grid-area: center; display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; }
  .stage { position: relative; min-height: 0; border: 2px dashed transparent; }
  .app.file-drag { outline: 2px dashed var(--accent); outline-offset: -4px; }
  .dropnote { position: fixed; z-index: 50; left: 50%; top: 16px; translate: -50% 0; pointer-events: none; display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; border-radius: 10px; background: var(--card); border: 1px solid var(--accent); box-shadow: 0 6px 24px rgb(0 0 0 / .4); }
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
  .thead button.on { border-color: var(--accent); color: var(--accent); background: rgb(255 255 255 / .08); }

  @media (max-width: 1100px) {
    .app {
      height: auto; min-height: calc(100dvh / var(--ui-zoom));
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'top' 'center' 'text' 'style' 'assets' 'tl';
    }
    .top { flex-wrap: wrap; position: sticky; top: 0; z-index: 2; background: var(--bg); }
    .assets, .text, .style { border: 0; border-top: 1px solid var(--border-soft); }
    .stage { height: 62vh; }
  }
  @media (max-width: 560px) {
    .top, .timeline-area { padding-left: 16px; padding-right: 16px; }
    .pname { width: 14ch; }
    .thead { flex-wrap: wrap; gap: 8px; }
  }

  /* Desktop-only / phone-only chrome */
  .ltabs { padding: 0; flex: 1; }
  .ltabs button { flex: 1; padding: 0 6px; white-space: nowrap; font-size: 13px; }
  .mob-close, .dock, .scrim, .grab, .sheet-bar { display: none; }

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
    .style { overflow: auto; }
    .assets .grab { margin-top: -8px; }
    .grab { display: block; flex: none; width: 40px; height: 4px; border-radius: 2px; background: var(--border); margin: 8px auto 0; }
    .tabs { align-items: center; }
    .sheet-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px 0; }
    .sheet-bar button { border: 0; }
    .scrim { display: block; position: fixed; inset: 0; z-index: 19; background: rgb(0 0 0 / .45); border: 0; border-radius: 0; height: auto; padding: 0; }
  }
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
  .zonewarn { font-size: 12px; color: #ffb86b; }
  .ratio { height: 30px; font-size: 12px; }
  .keys-bg { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / .55); display: grid; place-items: center; padding: 16px; }
  .keys { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; width: min(440px, 100%);
    max-height: 90vh; overflow: auto; display: grid; gap: 12px; }
  .keys h3 { margin: 0; font-size: 15px; }
  .keys dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; align-items: center; }
  .keys dd { margin: 0; color: var(--muted); }
  .keys kbd { font: 12px ui-monospace, monospace; background: var(--tab-on); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
  .keys > button { justify-self: end; }
  @keyframes up { from { transform: translateY(100%); } }
</style>
