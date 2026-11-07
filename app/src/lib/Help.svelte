<script lang="ts">
  // Help page (#/help): a short user guide in English and Spanish.
  import Icon from './Icon.svelte';
  import { t, ui, setLang } from './i18n.svelte';

  type Section = { id: string; title: string; items: string[] };
  type Doc = { title: string; intro: string; toc: string; keysTitle: string; keys: [string, string][]; sections: Section[] };

  const en: Doc = {
    title: 'Help',
    intro: 'Sonant is a caption editor for short videos that runs entirely in your browser. Your media never leaves your device.',
    toc: 'Contents',
    keysTitle: 'Keyboard shortcuts',
    sections: [
      { id: 'start', title: 'Getting started', items: [
        'On the home page, click <b>New project</b> or drop videos, audio or images on the page.',
        'Click <b>Transcribe</b>. The first run downloads the speech model (~80 MB) once; later runs are faster.',
        'Pick a caption style, tidy the transcript, then click <b>Export</b> to get an MP4 with captions burned in.',
        'Chrome or Edge on a desktop is fastest. Firefox and Safari work, more slowly.',
      ] },
      { id: 'projects', title: 'Projects and saving', items: [
        'Projects save automatically in this browser about half a second after each change.',
        'The ⋯ menu on a project card renames, duplicates, saves to file or deletes it.',
        '<b>Save file</b> (Ctrl/⌘+S) writes a <code>.sonant</code> file with media and edits. Open it on any computer with <b>Open project file</b> or by dropping it on the page.',
        '<b>History</b> keeps a snapshot every couple of minutes; <b>Restore</b> brings one back (your current state is saved first).',
        'Browsers can clear site data. Keep <code>.sonant</code> files as backups, and click <b>Protect</b> on the home page if offered.',
      ] },
      { id: 'transcript', title: 'Transcript and cutting', items: [
        'Choose English, Spanish or auto-detect, and transcribe all clips or just one.',
        'Select words and press Delete to cut them from the video. Struck words can be restored.',
        '<b>Clean up</b> removes filler sounds (um, uh, eh…) and long pauses. Use <b>Preview</b> to see what will go before you apply it. Silence removal also works from the audio alone, without a transcript.',
        'Search the transcript, tag speakers, and translate captions between English and Spanish (the model downloads once).',
      ] },
      { id: 'captions', title: 'Captions and styles', items: [
        'Edit text and timing per line; split, merge, add or delete lines. Download SRT or VTT, which follow your cuts.',
        'The style panel has <b>Style</b> (presets), <b>Animation</b> and <b>Text</b> (font, size, colors, box, position) tabs.',
        'Click a caption to style it alone; Ctrl/⌘+click or Shift+click selects several. Turn on <b>Apply to all</b> to change every caption.',
        'Drag the caption on the preview to move it; arrow keys nudge it. Safe zones show where TikTok, Reels and Shorts draw their own buttons.',
        'Templates save a caption look plus text layers to reuse in other projects.',
      ] },
      { id: 'timeline', title: 'Timeline and clips', items: [
        'Videos play back to back. Reorder or remove them in the Sequence list.',
        'Split at the playhead (S), trim by dragging edges, and delete strips. Snapping (N) lines things up; hold Alt to drag freely.',
        'Per strip: speed, freeze frame, transitions, color and LUTs, punch-in zoom and focus point for reframing.',
        'Layers: picture-in-picture video, images, text and animated titles, with keyframes for position, size, rotation and opacity.',
        'Scroll the wheel to scrub, pinch or Ctrl+wheel to zoom. On a phone, swipe the timeline to scrub.',
      ] },
      { id: 'audio', title: 'Music and voiceover', items: [
        'Audio files go on the Music & VO track, with their own volume and one for the clips’ sound.',
        '<b>Duck under speech</b> lowers music while someone talks. <b>Find beats</b> lets you cut the video on the beat.',
        'Music stays in output time, so cutting words does not move it.',
      ] },
      { id: 'export', title: 'Export', items: [
        'Pick a preset (TikTok, Reels, Shorts, YouTube…) or set shape, resolution, frame rate and quality yourself.',
        'Options include loudness normalizing and voice cleanup.',
        'Keep the tab open while exporting. Big or long videos take longer and use more memory.',
      ] },
      { id: 'trouble', title: 'Troubleshooting', items: [
        'Transcription is slow: use Chrome or Edge so it can run on the GPU (WebGPU).',
        'Scrubbing is choppy: click ⚡ on the video to make a fast preview copy. Export still uses the original.',
        'Files over ~2 GB can run out of browser memory or storage.',
        'A project link opened in another browser goes back home: projects live in one browser. Move them with <code>.sonant</code> files.',
      ] },
    ],
    keys: [
      ['Space / K', 'Play / pause'], ['J / L', 'Back 1s (Shift: 5s) / play'], ['← / →', 'Step a frame (Shift: a second)'],
      ['Home / End', 'Go to start / end'], ['S', 'Split at playhead'], ['I / O, X', 'Mark in / out, cut the range'],
      ['Delete', 'Cut words or delete the selection'], ['Shift+Delete', 'Lift a strip (leave a gap)'], ['N', 'Toggle snapping'],
      ['T', 'Add a text layer'], ['Esc', 'Clear selection'], ['Ctrl/⌘+S', 'Save project file'],
      ['Ctrl/⌘+Z / Y', 'Undo / redo'], ['?', 'Shortcut cheat-sheet'],
    ],
  };

  const es: Doc = {
    title: 'Ayuda',
    intro: 'Sonant es un editor de subtítulos para videos cortos que funciona por completo en tu navegador. Tus archivos nunca salen de tu dispositivo.',
    toc: 'Contenido',
    keysTitle: 'Atajos de teclado',
    sections: [
      { id: 'start', title: 'Primeros pasos', items: [
        'En la página de inicio, haz clic en <b>Nuevo proyecto</b> o suelta videos, audio o imágenes en la página.',
        'Haz clic en <b>Transcribir</b>. La primera vez se descarga el modelo de voz (~80 MB); después es más rápido.',
        'Elige un estilo de subtítulos, ajusta la transcripción y haz clic en <b>Exportar</b> para obtener un MP4 con los subtítulos.',
        'Chrome o Edge en computadora es lo más rápido. Firefox y Safari funcionan, más lento.',
      ] },
      { id: 'projects', title: 'Proyectos y guardado', items: [
        'Los proyectos se guardan solos en este navegador medio segundo después de cada cambio.',
        'El menú ⋯ de cada proyecto permite renombrarlo, duplicarlo, guardarlo en archivo o eliminarlo.',
        '<b>Guardar archivo</b> (Ctrl/⌘+S) crea un archivo <code>.sonant</code> con los medios y la edición. Ábrelo en cualquier computadora con <b>Abrir archivo de proyecto</b> o soltándolo en la página.',
        '<b>Historial</b> guarda una versión cada pocos minutos; <b>Restaurar</b> recupera una (antes guarda el estado actual).',
        'El navegador puede borrar datos del sitio. Guarda archivos <code>.sonant</code> como respaldo y pulsa <b>Proteger</b> en el inicio si aparece.',
      ] },
      { id: 'transcript', title: 'Transcripción y cortes', items: [
        'Elige inglés, español o detección automática, y transcribe todos los clips o solo uno.',
        'Selecciona palabras y pulsa Suprimir para cortarlas del video. Las palabras tachadas se pueden restaurar.',
        '<b>Limpiar</b> quita muletillas (um, eh…) y pausas largas. Usa <b>Vista previa</b> para ver qué se quitará antes de aplicarlo. También se pueden quitar silencios solo con el audio, sin transcripción.',
        'Busca en la transcripción, marca hablantes y traduce los subtítulos entre inglés y español (el modelo se descarga una vez).',
      ] },
      { id: 'captions', title: 'Subtítulos y estilos', items: [
        'Edita texto y tiempos por línea; divide, une, agrega o borra líneas. Descarga SRT o VTT, que respetan tus cortes.',
        'El panel de estilo tiene las pestañas <b>Estilo</b> (preajustes), <b>Animación</b> y <b>Texto</b> (fuente, tamaño, colores, caja, posición).',
        'Haz clic en un subtítulo para darle estilo solo a él; Ctrl/⌘+clic o Mayús+clic selecciona varios. Activa <b>Aplicar a todos</b> para cambiarlos todos.',
        'Arrastra el subtítulo en la vista previa para moverlo; las flechas lo desplazan. Las zonas seguras muestran dónde TikTok, Reels y Shorts ponen sus botones.',
        'Las plantillas guardan un estilo de subtítulos y capas de texto para usarlos en otros proyectos.',
      ] },
      { id: 'timeline', title: 'Línea de tiempo y clips', items: [
        'Los videos se reproducen uno tras otro. Reordénalos o quítalos en la lista Secuencia.',
        'Divide en el cabezal (S), recorta arrastrando los bordes y borra tramos. El ajuste (N) alinea elementos; mantén Alt para arrastrar libremente.',
        'Por tramo: velocidad, congelar imagen, transiciones, color y LUT, zoom de acercamiento y punto de enfoque para reencuadrar.',
        'Capas: video en ventana, imágenes, texto y títulos animados, con fotogramas clave de posición, tamaño, rotación y opacidad.',
        'Usa la rueda para desplazarte, pellizca o Ctrl+rueda para hacer zoom. En el teléfono, desliza la línea de tiempo.',
      ] },
      { id: 'audio', title: 'Música y voz en off', items: [
        'Los archivos de audio van a la pista Música y VO, con su propio volumen y otro para el sonido de los clips.',
        '<b>Bajar bajo la voz</b> reduce la música mientras alguien habla. <b>Buscar ritmos</b> permite cortar el video al ritmo.',
        'La música va en tiempo de salida, así que cortar palabras no la mueve.',
      ] },
      { id: 'export', title: 'Exportar', items: [
        'Elige un preajuste (TikTok, Reels, Shorts, YouTube…) o define forma, resolución, cuadros por segundo y calidad.',
        'Hay opciones para normalizar el volumen y limpiar la voz.',
        'Mantén la pestaña abierta al exportar. Los videos grandes o largos tardan más y usan más memoria.',
      ] },
      { id: 'trouble', title: 'Solución de problemas', items: [
        'La transcripción es lenta: usa Chrome o Edge para que corra en la GPU (WebGPU).',
        'La vista previa va a tirones: pulsa ⚡ en el video para crear una copia rápida. La exportación usa el original.',
        'Archivos de más de ~2 GB pueden agotar la memoria o el espacio del navegador.',
        'Un enlace de proyecto abierto en otro navegador vuelve al inicio: los proyectos viven en un navegador. Muévelos con archivos <code>.sonant</code>.',
      ] },
    ],
    keys: [
      ['Espacio / K', 'Reproducir / pausar'], ['J / L', 'Atrás 1 s (Mayús: 5 s) / reproducir'], ['← / →', 'Avanzar un cuadro (Mayús: un segundo)'],
      ['Inicio / Fin', 'Ir al inicio / final'], ['S', 'Dividir en el cabezal'], ['I / O, X', 'Marcar entrada / salida, cortar el rango'],
      ['Suprimir', 'Cortar palabras o borrar la selección'], ['Mayús+Suprimir', 'Levantar un tramo (dejar un hueco)'], ['N', 'Activar ajuste'],
      ['T', 'Agregar capa de texto'], ['Esc', 'Quitar selección'], ['Ctrl/⌘+S', 'Guardar archivo de proyecto'],
      ['Ctrl/⌘+Z / Y', 'Deshacer / rehacer'], ['?', 'Lista de atajos'],
    ],
  };

  const doc = $derived(ui.lang === 'es' ? es : en);
</script>

<div class="help">
  <header class="top">
    <a class="btn" href="#/"><Icon name="chevron_left" /> {t('allProjects')}</a>
    <select class="lang" value={ui.lang} onchange={(e) => setLang(e.currentTarget.value as 'en' | 'es')} aria-label="Interface language / Idioma">
      <option value="en">EN</option>
      <option value="es">ES</option>
    </select>
  </header>

  <main>
    <h1>{doc.title}</h1>
    <p class="muted">{doc.intro}</p>

    <nav aria-label={doc.toc}>
      {#each doc.sections as s}<a href="#/help" onclick={(e) => { e.preventDefault(); document.getElementById('h-' + s.id)?.scrollIntoView({ behavior: 'smooth' }); }}>{s.title}</a>{/each}
      <a href="#/help" onclick={(e) => { e.preventDefault(); document.getElementById('h-keys')?.scrollIntoView({ behavior: 'smooth' }); }}>{doc.keysTitle}</a>
    </nav>

    {#each doc.sections as s}
      <section id={'h-' + s.id}>
        <h2>{s.title}</h2>
        <!-- Static, hard-coded strings above (no user input). -->
        <ul>{#each s.items as it}<li>{@html it}</li>{/each}</ul>
      </section>
    {/each}

    <section id="h-keys">
      <h2>{doc.keysTitle}</h2>
      <table>
        <tbody>
          {#each doc.keys as [k, a]}<tr><td><kbd>{k}</kbd></td><td>{a}</td></tr>{/each}
        </tbody>
      </table>
    </section>
  </main>
</div>

<style>
  .help { height: calc(100dvh / var(--ui-zoom)); overflow-y: auto; }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid var(--border-soft); }
  .top a { text-decoration: none; }
  .lang { height: 36px; padding: 0 8px; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-family: var(--display); font-size: 28px; margin: 0 0 8px; }
  h2 { font-family: var(--display); font-size: 19px; margin: 0 0 8px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 8px; }
  nav a { padding: 6px 12px; border: 1px solid var(--border-soft); border-radius: 999px; font-size: 13px; color: inherit; text-decoration: none; }
  nav a:hover { border-color: var(--accent); }
  section { margin-top: 28px; scroll-margin-top: 16px; }
  ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 6px 8px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
  td:first-child { white-space: nowrap; width: 1%; }
  kbd { font-family: inherit; font-size: 12px; padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel); }
</style>
