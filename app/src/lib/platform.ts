// iPhone/iPad (iPadOS reports itself as a Mac, but has touch).
export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

// File-picker filter for custom extensions (.sonant, .cube, fonts). iOS greys out file types it doesn't know,
// so there the picker shows every file and the app checks what was picked.
export const acceptExt = (exts: string) => (isIOS() ? undefined : exts);
