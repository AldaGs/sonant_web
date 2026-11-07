import { PRESETS, type Style } from './render.ts';
import { DEFAULT_TF, type Overlay } from './overlay.ts';

// A template: a caption look plus text layers (titles, lower thirds, calls to action), reusable across
// projects. Layer times are relative: `at` ≥ 0 from the playhead, or < 0 from the end of the video.
export type TemplateLayer = Omit<Overlay, 'id' | 'kind' | 'assetId' | 'offset' | 'volume'>;
export type Template = { id: string; name: string; style: Style; layers: TemplateLayer[]; builtin?: boolean };

const T = (text: string, at: number, len: number, tf: Partial<Overlay['tf']>, style: Partial<Style> = {}, kf?: Overlay['kf']): TemplateLayer =>
  ({ text, at, len, style, tf: { ...DEFAULT_TF, scale: 1, ...tf }, ...(kf && { kf }) });
const pop = (x: number, y: number, s: number): Overlay['kf'] => [
  { t: 0, x, y, scale: s * 0.6, rotation: 0, opacity: 0 },
  { t: 0.25, x, y, scale: s * 1.08, rotation: 0, opacity: 1 },
  { t: 0.4, x, y, scale: s, rotation: 0, opacity: 1 },
];

export const BUILTIN: Template[] = [
  { id: 'b-hook', name: 'Hook title', builtin: true, style: PRESETS['Viral pop'],
    layers: [T('WAIT FOR IT', 0, 2.5, { y: 0.22, scale: 1.4 }, { highlight: '#ffe600' }, pop(0.5, 0.22, 1.4))] },
  { id: 'b-lower', name: 'Lower third', builtin: true, style: PRESETS['Smooth rise'] ?? PRESETS['Viral pop'],
    layers: [T('Your Name', 0, 4, { x: 0.3, y: 0.72, scale: 0.8 }, { box: '#111111', boxAlpha: 0.75, animation: 'slide-up', uppercase: false }),
      T('Title · @handle', 0.2, 3.8, { x: 0.3, y: 0.8, scale: 0.55 }, { color: '#c8f560', uppercase: false })] },
  { id: 'b-cta', name: 'Follow CTA', builtin: true, style: PRESETS['Active pill'] ?? PRESETS['Viral pop'],
    layers: [T('FOLLOW FOR MORE', -2.5, 2.5, { y: 0.5, scale: 1.2 }, { highlight: '#ff4d6d' }, pop(0.5, 0.5, 1.2))] },
];

// Template layers placed into a project: `now` = playhead (output time), `end` = video length.
export function placeLayers(t: Template, now: number, end: number): Overlay[] {
  return t.layers.map((l) => {
    const at = l.at < 0 ? Math.max(0, end + l.at) : Math.min(now + l.at, Math.max(0, end - 0.2));
    return { ...structuredClone(l), id: crypto.randomUUID(), kind: 'text' as const, at, len: Math.max(0.2, Math.min(l.len, end - at || l.len)) };
  });
}

// A template from the current project: its caption look and its text layers (times relative to the first one).
export function fromProject(name: string, style: Style, overlays: Overlay[], end: number): Template {
  const texts = overlays.filter((o) => o.kind === 'text');
  const t0 = Math.min(...texts.map((o) => o.at));
  const layers = texts.map(({ id: _id, kind: _k, assetId: _a, offset: _o, volume: _v, ...l }) => {
    // Layers in the last 3 seconds stick to the end; the rest keep their offset from the first one.
    const fromEnd = l.at > end - 3 && l.at > t0;
    return { ...structuredClone(l), at: fromEnd ? l.at - end : l.at - t0 };
  });
  return { id: crypto.randomUUID(), name, style: structuredClone(style), layers };
}
