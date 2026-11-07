<script lang="ts">
  import { onMount } from 'svelte';
  import { transcribe } from './lib/transcribe';
  import { groupWords, captionText, setText, setRange, split, mergeNext, toSRT, toVTT, startOf, endOf, setSpeaker, replaceInRange, type Caption, type Word } from './lib/captions';
  import { drawCaption, fontString, DEFAULT_STYLE, migrateStyle, resolveStyle, inBox, type Style, type Box } from './lib/render';
  import { BUNDLED, localFonts, uploadFont, registerFont, type Font, type SavedFont } from './lib/fonts';
  import { splitAt, remove, trim, toSource, toOutput, outDuration, captionsForOutput, cutRange, keepRange, keptCaptions, type Segment, type Fx } from './lib/cuts';
  import { drawFrame } from './lib/segment';
  import { clipStarts, seqDuration, remapProject, splitAtBoundaries, move, type Asset, type Clip, type AudioItem } from './lib/project';
  import { Player } from './lib/player';
  import { importFile, loadFile, mediaKind } from './lib/assets';
  import { thumbnails, type Thumb } from './lib/thumbs';
  import { audioPeaks } from './lib/waveform';
  import * as store from './lib/store';
  import { t, ui, setLang } from './lib/i18n.svelte';
  import Timeline from './lib/Timeline.svelte';
  import ExportDialog from './lib/ExportDialog.svelte';
  import StylePanel from './lib/StylePanel.svelte';
  import TranscriptView from './lib/TranscriptView.svelte';
  import { loadDoc, saveDoc, saveProjectFile, deleteAssetIfUnused, type ProjectDoc, type ProjectMeta } from './lib/projects';

  // The editor works on one project at a time; the home page (#/) lists them all.
  let { projectId }: { projectId: string } = $props();

  // ---- Project media ----
  let assets = $state<Asset[]>([]);
  let clips = $state<Clip[]>([]); // video track, in play order
  let audios = $state<AudioItem[]>([]); // music / voiceover, output time
  let clipVolume = $state(1); // volume of the clips' own sound
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
  const frameW = $derived(firstVideo?.width || 1280);
  const frameH = $derived(firstVideo?.height || 720);

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

  const player = new Player(() => ({ clips, audios, segments, durations, clipVolume }));

  // Undo/redo: snapshots of the editable project.
  type Snap = { segments: Segment[]; captions: Caption[]; clips: Clip[]; audios: AudioItem[] };
  let past = $state<Snap[]>([]);
  let future = $state<Snap[]>([]);
  const snap = (): Snap => $state.snapshot({ segments, captions, clips, audios });
  const restore = (s: Snap) => ((segments = s.segments), (captions = s.captions), (clips = s.clips), (audios = s.audios), (selected = -1), (selectedCapIds = []));
  function commit() {
    past = [...past.slice(-99), snap()]; // ponytail: 100-step cap, full snapshots; fine at caption-list sizes
    future = [];
  }
  function undo() {
    const s = past.at(-1);
    if (s) ((future = [snap(), ...future]), (past = past.slice(0, -1)), restore(s));
  }
  function redo() {
    const s = future[0];
    if (s) ((past = [...past, snap()]), (future = future.slice(1)), restore(s));
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

  // Make a file usable: object URL, thumbnails, waveform.
  function register(a: Asset, f: File) {
    files.set(a.id, f);
    const url = URL.createObjectURL(f);
    urls[a.id] = url;
    if (a.kind === 'video') thumbnails(url, a.duration).then((th) => (thumbs[a.id] = th)).catch(() => {});
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
    const doc: Doc = { ...$state.snapshot({ name, captions, segments, style, language, speakers, assets, clips, audios, clipVolume }), words: wordCache };
    const meta: Partial<ProjectMeta> = { duration: outDuration(segments), clips: clips.length };
    if (Date.now() - lastThumb > 10000) {
      const th = thumbnail();
      if (th) ((meta.thumb = th), (lastThumb = Date.now()));
    }
    await saveDoc(projectId, doc, meta);
  }
  $effect(() => {
    $state.snapshot({ name, captions, segments, style, language, speakers, assets, clips, audios, clipVolume });
    void (clips.length && thumbs[clips[0].assetId]?.length); // first-clip thumbnails ready → refresh the card
    if (!ready) return;
    saving = true;
    const id = setTimeout(() => saveNow().catch(() => {}).finally(() => (saving = false)), 400);
    return () => clearTimeout(id);
  });

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
      if (r.asset.kind === 'video') addClip(r.asset.id);
      else addAudio(r.asset.id, at);
    }
  }


  const addClip = (assetId: string) => setClips([...clips, { id: crypto.randomUUID(), assetId }]);
  function addAudio(assetId: string, at = toOutput(segments, time) ?? 0) {
    commit();
    const item = { id: crypto.randomUUID(), assetId, at, volume: 1 };
    audios = [...audios, item];
    selectedAudio = item.id;
  }
  const addToTimeline = (a: Asset) => (a.kind === 'video' ? addClip(a.id) : addAudio(a.id));

  async function removeAsset(a: Asset) {
    if (!confirm(t('confirmRemoveAsset', { name: a.name }))) return;
    setClips(clips.filter((c) => c.assetId !== a.id));
    audios = audios.filter((x) => x.assetId !== a.id);
    assets = assets.filter((x) => x.id !== a.id);
    past = future = []; // the file is gone, so earlier states can't be restored
    files.delete(a.id);
    URL.revokeObjectURL(urls[a.id]);
    delete urls[a.id];
    await deleteAssetIfUnused(a.id, projectId); // duplicates of this project may share the file
  }

  // Register each <video>/<audio> with the player.
  function media(node: HTMLMediaElement, [kind, id]: ['v' | 'a', string]) {
    const map = (kind === 'v' ? player.videos : player.audios) as Map<string, HTMLMediaElement>;
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
      const ids = [...new Set(chosen.map((c) => c.assetId))];
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
        const i = clips.indexOf(c), len = durations.get(c.assetId) ?? 0;
        return (wordCache[`${c.assetId}|${lang}`] ?? [])
          .filter((w) => w.start < len)
          .map((w) => ({ ...w, start: w.start + starts[i], end: Math.min(w.end, len) + starts[i] }));
      };
      const fresh = groupWords(chosen.flatMap(wordsOf));
      if (targetClip) {
        const i = clips.indexOf(targetClip);
        setCaps(replaceInRange(captions, fresh, starts[i], starts[i] + (durations.get(targetClip.assetId) ?? 0)));
        if (!fresh.length) error = 'noSpeech';
      } else {
        setCaps(fresh);
        if (!captions.length) error = 'noSpeech';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }


  // ---- Playback ----
  const active = (c: Caption) => time >= startOf(c) && time < endOf(c);
  const seek = (s: number) => (player.seek(Math.max(0, Math.min(s, duration))), (time = player.t));
  const toggle = () => (player.playing ? player.pause() : player.play(), (paused = !player.playing));
  const update = (i: number, c: Caption) => setCaps(captions.with(i, c));
  const outTime = $derived(toOutput(segments, time) ?? 0);

  function download(ext: 'srt' | 'vtt') {
    const caps = captionsForOutput(captions, segments);
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
      paused = !player.playing;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const p = player.frame();
      let f: HTMLVideoElement | HTMLCanvasElement | null = p && p.videoWidth ? p : null;
      let fw = p?.videoWidth ?? 0, fh = p?.videoHeight ?? 0;
      if (p && f && !p.seeking) {
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
      const cap = visibleCaps.find((c) => tNow >= startOf(c) && tNow < endOf(c));
      capOnScreen = cap ?? null;
      const fx = segments.find((s) => tNow >= s.start && tNow < s.end)?.fx;
      capBox = null;
      drawFrame(ctx, f, f ? fw : w, f ? fh : h, [(w - dw) / 2, (h - dh) / 2, dw, dh], fx, !!cap,
        () => (capBox = cap ? drawCaption(ctx, cap, tNow, resolveStyle(style, cap.style)) : null));
      // Drag box: preview only (export never draws it). Shown while paused, hovered or dragged.
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

  // Keyboard: with the preview focused, arrow keys nudge the caption (Shift = bigger steps).
  function nudge(e: KeyboardEvent) {
    const d = e.shiftKey ? 0.05 : 0.01;
    const dir = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!dir) return;
    e.preventDefault();
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
  let assetsOpen = $state(true);
  // Phone layout: panels open one at a time as bottom sheets from the tool dock.
  let sheet = $state<'assets' | 'text' | 'style' | null>(null);
  function openSheet(s: 'assets' | 'text' | 'style', t?: 'transcript' | 'captions') {
    if (t) tab = t;
    sheet = sheet === s && (!t || tab === t) ? null : s;
  }
  let zoom = $state(1); // 1 = fit to the stage
  let filter = $state<'all' | 'video' | 'audio'>('all');
  const shown = $derived(assets.filter((a) => filter === 'all' || a.kind === filter));
  const used = $derived(new Set([...clips.map((c) => c.assetId), ...audios.map((a) => a.assetId)]));
  const selAudio = $derived(audios.find((a) => a.id === selectedAudio));

  let transcriptView = $state<TranscriptView>();
  const cutRanges = (r: [number, number][]) => setSegs(r.reduce((s, [a, b]) => cutRange(s, a, b), segments));
  const keepRanges = (r: [number, number][]) => setSegs(r.reduce((s, [a, b]) => keepRange(s, a, b), segments));
  const visibleCaps = $derived(keptCaptions(captions, segments)); // what the preview draws

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
  const saveState = $derived(saving ? t('saving') : t('saved'));

  const cutHere = () => setSegs(splitAt(segments, time));
  // Effects of the selected strip (captions behind the person, background swap).
  const selFx = $derived(selected >= 0 && segments[selected] ? (segments[selected].fx ?? {}) : null);
  const setFx = (p: Partial<Fx>) => selected >= 0 && setSegs(segments.with(selected, { ...segments[selected], fx: { ...segments[selected].fx, ...p } }));
  const deleteSelected = () => selected >= 0 && (setSegs(remove(segments, selected)), (selected = -1));
  function removeAudioItem() {
    if (!selectedAudio) return false;
    commit();
    audios = audios.filter((a) => a.id !== selectedAudio);
    selectedAudio = '';
    return true;
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
    else if (e.key === 'Escape') (clearCapSelection(), (marks = [null, null]));
    else if (e.key === 'Delete' || e.key === 'Backspace')
      cutMarks() || (tab === 'transcript' && transcriptView?.toggleSelection()) || removeAudioItem() || deleteSelected();
    // The timeline and the preview canvas handle their own arrows (seek / nudge caption).
    else if (e.key.startsWith('Arrow') && (e.target as HTMLElement).closest?.('.tl, canvas')) return;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      (e.preventDefault(), step((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : FRAME)));
    else if (e.key === 'Home') (e.preventDefault(), seek(0));
    else if (e.key === 'End') (e.preventDefault(), seek(duration));
    else if (e.key.toLowerCase() === 'k') (player.pause(), (paused = true));
    else if (e.key.toLowerCase() === 'l') (player.play(), (paused = !player.playing));
    else if (e.key.toLowerCase() === 'j') seek(time - (e.shiftKey ? 5 : 1));
    else if (e.key.toLowerCase() === 'i') marks = [time, marks[1]];
    else if (e.key.toLowerCase() === 'o') marks = [marks[0], time];
    else if (e.key.toLowerCase() === 'x') cutMarks();
    else if (e.key.toLowerCase() === 'n') snapOn = !snapOn;
    else if (e.key.toLowerCase() === 'a') autoSelect = !autoSelect;
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

<div class="app" class:no-assets={!assetsOpen} class:sheet-open={sheet !== null}>
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
      <a class="btn mob-close icon" href="#/" title={t('allProjects')} aria-label={t('allProjects')}>✕</a>
      <a class="btn desk" href="#/" title={t('allProjects')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
        {t('projects')}
      </a>
      <button class="desk" onclick={() => saveToFile()} disabled={!assets.length} title={t('saveFileTip')}>{fileStatus ? t(fileStatus) : t('saveFile')}</button>
      <button class="desk" class:on={assetsOpen} onclick={() => (assetsOpen = !assetsOpen)} aria-pressed={assetsOpen} title={t('toggleAssets')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        {t('assets')}
      </button>
      <button class="primary" onclick={() => exporter?.open()} disabled={!hasMedia || !segments.length || !firstVideo}>{t('ex.title')}</button>
    </div>
  </header>

  {#if assetsOpen || sheet === 'assets'}
    <aside class="assets panel" class:shown={sheet === 'assets'}>
      <div class="grab" aria-hidden="true"></div>
      <div class="phead">
        <h2>{t('assets')}</h2>
        <button class="icon sm" onclick={() => { if (sheet) sheet = null; else assetsOpen = false; }} aria-label={t('collapse')}>‹</button>
      </div>
      <label class="import">
        {t('importMedia')}
        <input type="file" accept="video/*,audio/*" multiple hidden onchange={(e) => importMedia(e.currentTarget.files)} />
      </label>
      <div class="filters" role="group" aria-label={t('assets')}>
        {#each ['all', 'video', 'audio'] as const as f}
          <button class:on={filter === f} aria-pressed={filter === f} onclick={() => (filter = f)}>{t('filter.' + f)}</button>
        {/each}
      </div>
      <div class="grid">
        {#each shown as a (a.id)}
          <div class="asset" draggable="true" role="listitem"
            ondragstart={(e) => e.dataTransfer?.setData('text/x-asset', a.id)}>
            <div class="thumb" class:used={used.has(a.id)}>
              {#if a.kind === 'video' && thumbs[a.id]?.length}<img src={thumbs[a.id][Math.floor(thumbs[a.id].length / 3)].url} alt="" />
              {:else}<span class="muted">{a.kind === 'audio' ? '♪ ' + t('filter.audio') : t('filter.video')}</span>{/if}
              <span class="dur mono">{fmt(a.duration)}</span>
              <span class="acts">
                <button class="sm icon" onclick={() => addToTimeline(a)} aria-label={t('addToTimeline', { name: a.name })} title={t('addToTimeline', { name: a.name })}>+</button>
                <button class="sm icon" onclick={() => removeAsset(a)} aria-label={t('removeAsset', { name: a.name })} title={t('removeAsset', { name: a.name })}>✕</button>
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
              <button class="sm icon" onclick={() => setClips(move(clips, i, -1))} disabled={i === 0} aria-label={t('moveUp')}>↑</button>
              <button class="sm icon" onclick={() => setClips(move(clips, i, 1))} disabled={i === clips.length - 1} aria-label={t('moveDown')}>↓</button>
              <button class="sm icon" onclick={() => setClips(clips.toSpliced(i, 1))} aria-label={t('removeClip')}>✕</button>
            </li>
          {/each}
        </ol>
        <label class="vol">{t('clipAudio')} <span class="mono small">{Math.round(clipVolume * 100)}%</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={clipVolume} />
        </label>
      {/if}
    </aside>
  {/if}

  <section class="text panel" class:shown={sheet === 'text'}>
    <div class="grab" aria-hidden="true"></div>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'transcript'} class:on={tab === 'transcript'} onclick={() => (tab = 'transcript')}>{t('transcript')}</button>
      <button role="tab" aria-selected={tab === 'captions'} class:on={tab === 'captions'} onclick={() => (tab = 'captions')}>{t('captions')}</button>
      <button class="icon sm sheet-x" onclick={() => (sheet = null)} aria-label={t('ex.close')}>✕</button>
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
        {#if !captions.length && !busy}<p class="muted small">{t('transcriptEmpty')}</p>{/if}
        {#if captions.length}
          <TranscriptView bind:this={transcriptView} {captions} {segments} {time} {duration}
            {speakers} onseek={seek} oncut={cutRanges} onkeep={keepRanges}
            onspeaker={(ids, k) => { if (k === speakers.length) speakers = [...speakers, '']; setCaps(setSpeaker(captions, new Set(ids), k)); }}
            onrename={(k, n) => (speakers = speakers.with(k, n))} />
        {/if}
      {:else}
        <p class="muted small">{t('captionsHint')} {t('selectHint')}</p>
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
                {#if c.style?.animation}
                  <span class="cap-anim-tag" title={t('animBadge', { name: t('anim.' + c.style.animation) })}>⚡ {t('anim.' + c.style.animation)}</span>
                {/if}
              </div>
              <span class="tools">
                <button class="sm icon" title={t('playHere')} aria-label={t('playHere')} onclick={() => seek(startOf(c))}>▶</button>
                <button class="sm icon" title={t('splitCap')} aria-label={t('splitCap')} disabled={c.words.length < 2} onclick={() => setCaps(split(captions, i))}>✂</button>
                <button class="sm icon" title={t('mergeNext')} aria-label={t('mergeNext')} disabled={i === captions.length - 1} onclick={() => setCaps(mergeNext(captions, i))}>⤓</button>
                <button class="sm icon" title={t('del')} aria-label={t('del')} onclick={() => setCaps(captions.toSpliced(i, 1))}>✕</button>
              </span>
            </li>
          {/each}
        </ol>
        <button class="add" onclick={addLine} disabled={!hasMedia}>{t('addLine')}</button>
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
      <video src={urls[id]} use:media={['v', id]} preload="auto" playsinline hidden></video>
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
            <span class="badge">{t('animBadge', { name: animName })}</span>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (focusable so arrow keys can move the caption) -->
            <canvas bind:this={canvas} tabindex="0" onpointerdown={pointer} onpointermove={pointer} onpointerup={pointer}
              onpointercancel={pointer} onpointerleave={() => (hover = false)} onkeydown={nudge}
              aria-label={t('previewAria')}></canvas>
          </div>
        </div>
      {:else}
        <label class="empty">
          <span>{t('drop')}</span>
          <input type="file" accept="video/*,audio/*" multiple hidden onchange={(e) => importMedia(e.currentTarget.files)} />
        </label>
      {/if}
    </div>
    <div class="transport">
      <div class="row">
        <button class="round" onclick={() => seek(time - 5)} disabled={!hasMedia} aria-label={t('back')}>«</button>
        <button class="round play" onclick={toggle} disabled={!hasMedia} aria-label={paused ? t('play') : t('pause')}>{paused ? '▶' : '❚❚'}</button>
        <button class="round" onclick={() => seek(time + 5)} disabled={!hasMedia} aria-label={t('forward')}>»</button>
        <span class="mono tcode">{tc(outTime)} <span class="muted">/ {tc(outDuration(segments))}</span></span>
      </div>
      <div class="row zoomctl">
        <button class="sm icon" onclick={() => (zoom = Math.max(0.5, zoom - 0.25))} aria-label={t('zoomOut')}>−</button>
        <span class="mono small zl">{zoom === 1 ? t('fit') : `${Math.round(zoom * 100)}%`}</span>
        <button class="sm icon" onclick={() => (zoom = Math.min(3, zoom + 0.25))} aria-label={t('zoomIn')}>+</button>
        <button class="sm" class:on={zoom === 1} onclick={() => (zoom = 1)} aria-pressed={zoom === 1}>⛶ {t('fit')}</button>
      </div>
    </div>
  </section>

  <aside class="style panel" class:shown={sheet === 'style'}>
    <div class="grab" aria-hidden="true"></div>
    <div class="sheet-bar"><h2>{t('style')}</h2><button class="icon sm" onclick={() => (sheet = null)} aria-label={t('ex.close')}>✕</button></div>
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
  </aside>

  <section class="timeline-area" aria-label={t('timelineH')}
    ondragover={(e) => e.preventDefault()} ondrop={dropOnTimeline}>
    <div class="thead">
      <h2>{t('timelineH')}</h2>
      <div class="row">
        {#if selAudio}
          <span class="aname small selname">♪ {names.get(selAudio.assetId)}</span>
          <label class="vol inline">{t('volume')}
            <input type="range" min="0" max="1" step="0.05" value={selAudio.volume}
              oninput={(e) => setAudio(selAudio.id, { volume: +e.currentTarget.value })} />
          </label>
          <button class="sm" onclick={removeAudioItem}>{t('removeAudio')}</button>
          <span class="divider"></span>
        {/if}
        {#if selFx}
          <button class="sm icon" class:on={selFx.behind} aria-pressed={!!selFx.behind} title={t('textBehind')} aria-label={t('textBehind')}
            onclick={() => setFx({ behind: !selFx.behind })}>👤</button>
          <label class="vol">{t('background')}
            <select value={selFx.bg ?? ''} onchange={(e) => setFx({ bg: (e.currentTarget.value || undefined) as Fx['bg'] })}>
              <option value="">{t('bgOriginal')}</option>
              <option value="blur">{t('bgBlur')}</option>
              <option value="color">{t('bgColor')}</option>
            </select>
          </label>
          {#if selFx.bg === 'color'}
            <input type="color" value={selFx.bgColor ?? '#00b140'} aria-label={t('bgColor')}
              onchange={(e) => setFx({ bgColor: e.currentTarget.value })} />
          {/if}
          <span class="divider"></span>
        {/if}
        <button class="sm" onclick={cutHere} disabled={!segments.length} title={t('splitTip')}>{t('splitAt')}</button>
        <button class="sm" onclick={deleteSelected} disabled={selected < 0 || segments.length < 2} title={t('delTip')}>{t('del')}</button>
        <button class="sm icon" class:on={snapOn} aria-pressed={snapOn} title={t('snapTip')} aria-label={t('snap')}
          onclick={() => (snapOn = !snapOn)}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/></svg></button>
        <button class="sm icon" class:on={autoSelect} aria-pressed={autoSelect} title={t('autoSelectTip')} aria-label={t('autoSelect')}
          onclick={() => (autoSelect = !autoSelect)}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v4M12 18v4"/><path d="M5 9l3 3-3 3"/><path d="M19 9l-3 3 3 3"/></svg></button>
        <button class="sm icon" onclick={undo} disabled={!past.length} title={t('undo')} aria-label={t('undo')}>↶</button>
        <button class="sm icon" onclick={redo} disabled={!future.length} title={t('redo')} aria-label={t('redo')}>↷</button>
        <button class="sm icon" onclick={() => (tlZoom = Math.max(1, tlZoom / 1.5))} disabled={tlZoom <= 1} aria-label={t('zoomOut')}>−</button>
        <button class="sm icon" onclick={() => (tlZoom = Math.min(16, tlZoom * 1.5))} aria-label={t('zoomIn')}>+</button>
        <button class="sm icon" onclick={() => (showKeys = true)} title={t('keysTitle') + ' (?)'} aria-label={t('keysTitle')}>?</button>
      </div>
    </div>
    <Timeline {segments} {time} {clips} {durations} {names} {thumbs} {peaks} {duration} {captions} {audios}
      zoom={tlZoom} bind:selected bind:selectedAudio selectedCapIds={selectedSet} onselectcap={selectCap}
      animLabel={t('allCaptions', { name: animName })}
      onseek={(o) => seek(toSource(segments, o))} onseeksrc={seek} snap={snapOn} range={marks}
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
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
      <span>{t('assets')}</span>
    </button>
    <button class:on={sheet === 'text' && tab === 'transcript'} onclick={() => openSheet('text', 'transcript')}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 11h16M4 16h10" /></svg>
      <span>{t('transcript')}</span>
    </button>
    <button class:on={sheet === 'text' && tab === 'captions'} onclick={() => openSheet('text', 'captions')}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M10 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4" /></svg>
      <span>{t('captions')}</span>
    </button>
    <button class:on={sheet === 'style'} onclick={() => openSheet('style')}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20 10 4h2l6 16M7 14h8" /></svg>
      <span>{t('style')}</span>
    </button>
    <button onclick={() => saveToFile()} disabled={!assets.length}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>
      <span>{fileStatus ? t(fileStatus) : t('saveFile')}</span>
    </button>
  </nav>
</div>

{#if hasMedia}
  {#if showKeys}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="keys-bg" onclick={() => (showKeys = false)}>
      <div class="keys" role="dialog" aria-modal="true" aria-label={t('keysTitle')} tabindex="-1" onclick={(e) => e.stopPropagation()}>
        <h3>{t('keysTitle')}</h3>
        <dl>
          {#each [['Space', 'k.play'], ['J / K / L', 'k.jkl'], ['← / →', 'k.frame'], ['Shift + ← / →', 'k.second'], ['Home / End', 'k.ends'],
            ['S', 'k.split'], ['I / O', 'k.marks'], ['X', 'k.cutRange'], ['Del', 'k.del'], ['N', 'k.snap'], ['Alt + drag', 'k.free'],
            ['A', 'k.auto'], ['Ctrl/⌘ + Z', 'undo'], ['Ctrl/⌘ + Shift + Z', 'redo'], ['Ctrl/⌘ + S', 'k.save'], ['Esc', 'k.esc'], ['?', 'keysTitle']] as [k, d]}
            <dt><kbd>{k}</kbd></dt><dd>{t(d)}</dd>
          {/each}
        </dl>
        <button class="sm" onclick={() => (showKeys = false)}>OK</button>
      </div>
    </div>
  {/if}
  <ExportDialog bind:this={exporter} {name} {segments} {captions} {style} srcW={frameW} srcH={frameH}
    source={() => ({ files, assets: $state.snapshot(assets), clips: $state.snapshot(clips), audios: $state.snapshot(audios), clipVolume })} />
{/if}

<style>
  .app {
    height: calc(100dvh / var(--ui-zoom)); display: grid;
    grid-template-columns: 270px 340px minmax(0, 1fr) 340px;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas: 'top top top top' 'assets text center style' 'tl tl tl tl';
  }
  .app.no-assets { grid-template-columns: 340px minmax(0, 1fr) 340px; grid-template-areas: 'top top top' 'text center style' 'tl tl tl'; }
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
  .import { display: flex; align-items: center; justify-content: center; height: 42px; border: 1px dashed var(--border);
    border-radius: 10px; cursor: pointer; }
  .import:hover { border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .asset { display: grid; gap: 4px; min-width: 0; }
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
  .seq { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
  .seq li { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto auto; gap: 4px; align-items: center;
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

  @media (max-width: 1100px) {
    .app, .app.no-assets {
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
    .app, .app.no-assets {
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

    .timeline-area { padding: 8px 12px; border-top: 1px solid var(--border-soft); max-height: 38dvh; overflow: auto; }
    .thead h2 { display: none; }
    .thead .row { justify-content: flex-start; flex-wrap: nowrap; overflow-x: auto; width: 100%; scrollbar-width: none; }
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
