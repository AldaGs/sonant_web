// Keyboard shortcuts for the editor.
import { cutRange } from '../cuts';
import { t } from '../i18n.svelte';
import type { Ed } from './ed';

export function createKeys(ed: Ed) {
  const FRAME = 1 / 30;
  const step = (d: number) => (ed.player.playing && ed.player.pause(), (ed.paused = true), ed.seek(ed.time + d));
  // Cut the I/O range (ripple: later material slides left).
  function cutMarks() {
    const [a, b] = ed.marks;
    if (a === null || b === null) return false;
    ed.setSegs(cutRange(ed.segments, Math.min(a, b), Math.max(a, b)));
    ed.marks = [null, null];
    ed.announce(t('a11y.rangeCut'));
    return true;
  }

  function keys(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (ed.showKeys && (e.key === 'Escape' || e.key === '?')) return (e.preventDefault(), (ed.showKeys = false));
    // Ctrl/⌘+S saves the project file from anywhere (Shift = choose a new file).
    if (mod && e.key.toLowerCase() === 's') return (e.preventDefault(), void ed.saveToFile(!e.shiftKey));
    if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
    if (mod && e.key.toLowerCase() === 'z') (e.preventDefault(), e.shiftKey ? ed.redo() : ed.undo());
    else if (mod && e.key.toLowerCase() === 'y') (e.preventDefault(), ed.redo());
    else if (mod) return;
    else if (e.code === 'Space' && !(e.target as HTMLElement).closest?.('button')) (e.preventDefault(), ed.toggle());
    else if (e.key === '?') ed.showKeys = true;
    else if (e.altKey) return;
    else if (e.key.toLowerCase() === 's') ed.cutHere();
    else if (e.key === 'Escape' && ed.pickKey) ed.endPick();
    else if (e.key === 'Escape') (ed.clearCapSelection(), (ed.marks = [null, null]), (ed.selectedOverlay = ''));
    else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey && ed.selFx) ed.setFx({ lift: !ed.selFx.lift || undefined });
    else if (e.key === 'Delete' || e.key === 'Backspace')
      cutMarks() || ed.removeOverlay() || (ed.tab === 'transcript' && ed.transcriptView?.toggleSelection()) || ed.removeAudioItem() || ed.deleteSelected();
    // The timeline and the preview canvas handle their own arrows (seek / nudge caption).
    else if (e.key.startsWith('Arrow') && (e.target as HTMLElement).closest?.('.tl, canvas')) return;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      (e.preventDefault(), step((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : FRAME)));
    else if (e.key === 'Home') (e.preventDefault(), ed.seek(0));
    else if (e.key === 'End') (e.preventDefault(), ed.seek(ed.duration));
    else if (e.key.toLowerCase() === 'k') (ed.player.pause(), (ed.paused = true));
    else if (e.key.toLowerCase() === 'l') (ed.player.play(), (ed.paused = !ed.player.playing));
    else if (e.key.toLowerCase() === 'j') ed.seek(ed.time - (e.shiftKey ? 5 : 1));
    else if (e.key.toLowerCase() === 'i') ((ed.marks = [ed.time, ed.marks[1]]), ed.announce(t('a11y.markIn', { t: ed.tc(ed.outTime) })));
    else if (e.key.toLowerCase() === 'o') ((ed.marks = [ed.marks[0], ed.time]), ed.announce(t('a11y.markOut', { t: ed.tc(ed.outTime) })));
    else if (e.key.toLowerCase() === 'x') cutMarks();
    else if (e.key.toLowerCase() === 'n') ((ed.snapOn = !ed.snapOn), ed.announce(t(ed.snapOn ? 'a11y.on' : 'a11y.off', { what: t('snap') })));
    else if (e.key.toLowerCase() === 'a') ((ed.autoSelect = !ed.autoSelect), ed.announce(t(ed.autoSelect ? 'a11y.on' : 'a11y.off', { what: t('autoSelect') })));
    else if (e.key.toLowerCase() === 't') ed.addText();
  }

  return { step, keys };
}
