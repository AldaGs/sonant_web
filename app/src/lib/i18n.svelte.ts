// UI strings, English + Spanish. t(key) falls back to English, then to the key itself
// (so library errors can throw a key and plain messages still show as-is).
const en = {
  open: 'Open video', export: 'Export', drop: 'Drop a video here or click “Open video”',
  preview: 'Preview. Drag to move captions, click to play or pause.',
  style: 'Style', font: 'Font', myFonts: 'Use my fonts', uploadFont: 'Upload font', animation: 'Animation',
  size: 'Size', text: 'Text', highlight: 'Highlight', outline: 'Outline', upper: 'UPPERCASE',
  dragHint: 'Drag the captions on the video to move them.',
  'anim.none': 'None', 'anim.pop': 'Pop', 'anim.karaoke': 'Karaoke', 'anim.typewriter': 'Typewriter', 'anim.bounce': 'Bounce',
  captions: 'Captions', language: 'Language', auto: 'Auto-detect', transcribe: 'Transcribe', retranscribe: 'Re-transcribe',
  dlSrt: 'Download SRT', dlVtt: 'Download VTT', start: 'Start (s)', end: 'End (s)', playHere: 'Play from here',
  splitCap: 'Split in two', mergeNext: 'Merge with next', del: 'Delete', capText: 'Caption text',
  play: 'Play', pause: 'Pause', split: 'Split', splitTip: 'Split at playhead (S)', delTip: 'Delete selected (Del)',
  undo: 'Undo (Ctrl+Z)', redo: 'Redo (Ctrl+Y)', timeline: 'Timeline', trimStart: 'Trim start', trimEnd: 'Trim end',
  noSpeech: 'No speech found.', badFont: 'That file isn’t a font the browser can read.',
  restored: 'Restored your last project.', newProject: 'New project', confirmNew: 'Start over? This clears the saved project.',
  'st.reading': 'Reading audio…', 'st.download': 'Downloading model (first time only)…', 'st.transcribing': 'Transcribing…',
  'err.noAudio': 'This video has no audio track the browser can read.',
  'err.noLocalFonts': 'Your browser can’t list installed fonts. Upload a font file instead.',
  'err.noVideo': 'This file has no video track.', 'err.noH264': 'This browser can’t encode H.264 video. Try Chrome or Edge.',
  'err.saveVideo': 'Video too large to save in the browser; you’ll need to reopen it after a reload.',
  'ex.title': 'Export video', 'ex.res': 'Resolution', 'ex.original': 'Original', 'ex.shape': 'Shape',
  'ex.vertical': '9:16 vertical (Reels, TikTok, Shorts)', 'ex.wide': '16:9 wide (YouTube)', 'ex.square': '1:1 square',
  'ex.fps': 'Frame rate', 'ex.output': 'Output: {w} × {h} MP4', 'ex.done': 'Done in {s}s · {mb} MB',
  'ex.download': 'Download {name}', 'ex.cancel': 'Cancel', 'ex.close': 'Close', 'ex.again': 'Export again',
  'ex.cancelled': 'Export cancelled.',
  untitled: 'Untitled project', projectName: 'Project name', saving: 'Saving…', saved: 'Saved',
  assets: 'Assets', toggleAssets: 'Show or hide assets', collapse: 'Collapse panel', importMedia: '+ Import media',
  assetsHint: 'Your video appears here. Importing a new one starts a new project.',
  transcript: 'Transcript', transcriptEmpty: 'Transcribe your video to see the transcript here.',
  captionsHint: 'Captions are generated from the transcript, split by phrase. Edit text or timing per line.',
  addLine: '+ Add caption line', newLine: 'New caption', subtitleFiles: 'Subtitle files',
  captionStyle: 'Caption style', textAnimation: 'Text animation', advanced: 'Advanced',
  'animd.none': 'Static line', 'animd.pop': 'Each word scales in', 'animd.karaoke': 'Highlight spoken word',
  'animd.typewriter': 'Letter by letter', 'animd.bounce': 'Spoken word jumps',
  animBadge: 'Animation: {name}', back: 'Back 5 seconds', forward: 'Forward 5 seconds',
  zoomOut: 'Zoom out', zoomIn: 'Zoom in', fit: 'Fit', timelineH: 'Timeline', splitAt: 'Split at playhead', videoTrack: 'Video',
  'ex.quality': 'Quality', 'ex.draft': 'Draft', 'ex.standard': 'Standard', 'ex.high': 'High',
  'exd.draft': 'Small file, fast to share. Lower detail.', 'exd.standard': 'Balanced quality and size.',
  'exd.high': 'Best detail, larger file.', 'ex.summary': 'Output: {w} × {h} · MP4 (H.264) · captions burned in',
  searchTranscript: 'Search transcript', removeFillers: 'Remove filler words ({n})', trimSilences: 'Trim silences ({n})',
  deleteHint: 'Delete a word to cut it from the video. Struck words are removed. Shift+click selects a range.',
  cutSel: 'Cut (Del)', restoreSel: 'Restore (Del)', clearSel: 'Clear selection',
  transcriptAria: 'Transcript words. Arrow keys select a word, Shift extends, Delete cuts or restores.',
  'anim.fade': 'Fade up', 'animd.fade': 'Line rises in', timing: 'Timing', durationMs: 'Duration (ms)', easing: 'Easing',
  'ease.ease-out': 'Ease out', 'ease.ease-in-out': 'Ease in-out', 'ease.linear': 'Linear', 'ease.back': 'Overshoot',
  outlineWidth: 'Outline width', bgBox: 'Background box', bgBoxColor: 'Box color', italic: 'Italic',
  audioTrack: 'Audio', animTrack: 'Text anim', lineN: 'Line {n}', allCaptions: '{name} · all captions',
  speakers: 'Speakers', speakerN: 'Speaker {n}', speakerName: 'Name for speaker {n}', speakerFor: 'Speaker',
  noSpeaker: 'No speaker', addSpeaker: '+ Speaker', newSpeaker: '+ New speaker',
  speakersHint: 'Pick a speaker on any paragraph, or select words and choose one to tag just those lines.',
};

const es: Partial<Record<keyof typeof en, string>> = {
  open: 'Abrir video', export: 'Exportar', drop: 'Suelta un video aquí o haz clic en “Abrir video”',
  preview: 'Vista previa. Arrastra para mover los subtítulos, haz clic para reproducir o pausar.',
  style: 'Estilo', font: 'Fuente', myFonts: 'Usar mis fuentes', uploadFont: 'Subir fuente', animation: 'Animación',
  size: 'Tamaño', text: 'Texto', highlight: 'Resaltado', outline: 'Contorno', upper: 'MAYÚSCULAS',
  dragHint: 'Arrastra los subtítulos sobre el video para moverlos.',
  'anim.none': 'Ninguna', 'anim.pop': 'Pop', 'anim.karaoke': 'Karaoke', 'anim.typewriter': 'Máquina de escribir', 'anim.bounce': 'Rebote',
  captions: 'Subtítulos', language: 'Idioma', auto: 'Detectar', transcribe: 'Transcribir', retranscribe: 'Volver a transcribir',
  dlSrt: 'Descargar SRT', dlVtt: 'Descargar VTT', start: 'Inicio (s)', end: 'Fin (s)', playHere: 'Reproducir desde aquí',
  splitCap: 'Dividir en dos', mergeNext: 'Unir con el siguiente', del: 'Eliminar', capText: 'Texto del subtítulo',
  play: 'Reproducir', pause: 'Pausar', split: 'Cortar', splitTip: 'Cortar en el cursor (S)', delTip: 'Eliminar selección (Supr)',
  undo: 'Deshacer (Ctrl+Z)', redo: 'Rehacer (Ctrl+Y)', timeline: 'Línea de tiempo', trimStart: 'Recortar inicio', trimEnd: 'Recortar final',
  noSpeech: 'No se encontró voz.', badFont: 'Ese archivo no es una fuente que el navegador pueda leer.',
  restored: 'Se restauró tu último proyecto.', newProject: 'Nuevo proyecto', confirmNew: '¿Empezar de nuevo? Se borrará el proyecto guardado.',
  'st.reading': 'Leyendo el audio…', 'st.download': 'Descargando el modelo (solo la primera vez)…', 'st.transcribing': 'Transcribiendo…',
  'err.noAudio': 'Este video no tiene una pista de audio que el navegador pueda leer.',
  'err.noLocalFonts': 'Tu navegador no puede listar las fuentes instaladas. Sube un archivo de fuente.',
  'err.noVideo': 'Este archivo no tiene pista de video.', 'err.noH264': 'Este navegador no puede codificar H.264. Prueba Chrome o Edge.',
  'err.saveVideo': 'El video es demasiado grande para guardarlo en el navegador; tendrás que volver a abrirlo al recargar.',
  'ex.title': 'Exportar video', 'ex.res': 'Resolución', 'ex.original': 'Original', 'ex.shape': 'Formato',
  'ex.vertical': '9:16 vertical (Reels, TikTok, Shorts)', 'ex.wide': '16:9 horizontal (YouTube)', 'ex.square': '1:1 cuadrado',
  'ex.fps': 'Cuadros por segundo', 'ex.output': 'Salida: {w} × {h} MP4', 'ex.done': 'Listo en {s}s · {mb} MB',
  'ex.download': 'Descargar {name}', 'ex.cancel': 'Cancelar', 'ex.close': 'Cerrar', 'ex.again': 'Exportar de nuevo',
  'ex.cancelled': 'Exportación cancelada.',
  untitled: 'Proyecto sin título', projectName: 'Nombre del proyecto', saving: 'Guardando…', saved: 'Guardado',
  assets: 'Recursos', toggleAssets: 'Mostrar u ocultar recursos', collapse: 'Contraer panel', importMedia: '+ Importar medios',
  assetsHint: 'Tu video aparece aquí. Importar otro empieza un proyecto nuevo.',
  transcript: 'Transcripción', transcriptEmpty: 'Transcribe tu video para ver la transcripción aquí.',
  captionsHint: 'Los subtítulos se generan desde la transcripción, divididos por frase. Edita el texto o los tiempos de cada línea.',
  addLine: '+ Agregar línea', newLine: 'Nuevo subtítulo', subtitleFiles: 'Archivos de subtítulos',
  captionStyle: 'Estilo de subtítulos', textAnimation: 'Animación de texto', advanced: 'Avanzado',
  'animd.none': 'Línea fija', 'animd.pop': 'Cada palabra crece', 'animd.karaoke': 'Resalta la palabra dicha',
  'animd.typewriter': 'Letra por letra', 'animd.bounce': 'La palabra dicha salta',
  animBadge: 'Animación: {name}', back: 'Atrás 5 segundos', forward: 'Adelante 5 segundos',
  zoomOut: 'Alejar', zoomIn: 'Acercar', fit: 'Ajustar', timelineH: 'Línea de tiempo', splitAt: 'Cortar en el cursor', videoTrack: 'Video',
  'ex.quality': 'Calidad', 'ex.draft': 'Borrador', 'ex.standard': 'Estándar', 'ex.high': 'Alta',
  'exd.draft': 'Archivo pequeño, rápido de compartir. Menos detalle.', 'exd.standard': 'Equilibrio entre calidad y tamaño.',
  'exd.high': 'Máximo detalle, archivo más grande.', 'ex.summary': 'Salida: {w} × {h} · MP4 (H.264) · subtítulos incrustados',
  searchTranscript: 'Buscar en la transcripción', removeFillers: 'Quitar muletillas ({n})', trimSilences: 'Recortar silencios ({n})',
  deleteHint: 'Borra una palabra para cortarla del video. Las palabras tachadas se eliminan. Mayús+clic selecciona un rango.',
  cutSel: 'Cortar (Supr)', restoreSel: 'Restaurar (Supr)', clearSel: 'Quitar selección',
  transcriptAria: 'Palabras de la transcripción. Las flechas seleccionan una palabra, Mayús amplía, Supr corta o restaura.',
  'anim.fade': 'Aparecer', 'animd.fade': 'La línea sube', timing: 'Tiempo', durationMs: 'Duración (ms)', easing: 'Suavizado',
  'ease.ease-out': 'Salida suave', 'ease.ease-in-out': 'Entrada y salida', 'ease.linear': 'Lineal', 'ease.back': 'Rebote suave',
  outlineWidth: 'Grosor del contorno', bgBox: 'Caja de fondo', bgBoxColor: 'Color de la caja', italic: 'Cursiva',
  audioTrack: 'Audio', animTrack: 'Animación', lineN: 'Línea {n}', allCaptions: '{name} · todos los subtítulos',
  speakers: 'Hablantes', speakerN: 'Hablante {n}', speakerName: 'Nombre del hablante {n}', speakerFor: 'Hablante',
  noSpeaker: 'Sin hablante', addSpeaker: '+ Hablante', newSpeaker: '+ Nuevo hablante',
  speakersHint: 'Elige un hablante en cualquier párrafo, o selecciona palabras y elige uno para marcar solo esas líneas.',
};

export type Lang = 'en' | 'es';
export type Key = keyof typeof en;

function initial(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {}
  return navigator.language.startsWith('es') ? 'es' : 'en';
}

export const ui = $state({ lang: initial() });

export function setLang(l: Lang) {
  ui.lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem('lang', l); } catch {}
}

export function t(key: Key | string, vars: Record<string, string | number> = {}): string {
  const s = (ui.lang === 'es' ? (es as Record<string, string>)[key] : undefined) ?? (en as Record<string, string>)[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ''));
}
