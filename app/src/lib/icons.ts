// Icons: Material Symbols (rounded, weight 400), plus Lucide where Material has none (magnet).
// Only the icons listed here end up in the bundle; each is an inline SVG string.

import close from '@material-symbols/svg-400/rounded/close.svg?raw';
import chevron_left from '@material-symbols/svg-400/rounded/chevron_left.svg?raw';
import chevron_right from '@material-symbols/svg-400/rounded/chevron_right.svg?raw';
import music_note from '@material-symbols/svg-400/rounded/music_note.svg?raw';
import bolt from '@material-symbols/svg-400/rounded/bolt.svg?raw';
import animation from '@material-symbols/svg-400/rounded/animation.svg?raw';
import picture_in_picture_alt from '@material-symbols/svg-400/rounded/picture_in_picture_alt.svg?raw';
import arrow_upward from '@material-symbols/svg-400/rounded/arrow_upward.svg?raw';
import arrow_downward from '@material-symbols/svg-400/rounded/arrow_downward.svg?raw';
import play_arrow from '@material-symbols/svg-400/rounded/play_arrow.svg?raw';
import pause from '@material-symbols/svg-400/rounded/pause.svg?raw';
import content_cut from '@material-symbols/svg-400/rounded/content_cut.svg?raw';
import merge from '@material-symbols/svg-400/rounded/merge.svg?raw';
import replay_5 from '@material-symbols/svg-400/rounded/replay_5.svg?raw';
import forward_5 from '@material-symbols/svg-400/rounded/forward_5.svg?raw';
import fit_screen from '@material-symbols/svg-400/rounded/fit_screen.svg?raw';
import add from '@material-symbols/svg-400/rounded/add.svg?raw';
import center_focus_strong from '@material-symbols/svg-400/rounded/center_focus_strong.svg?raw';
import diamond from '@material-symbols/svg-400/rounded/diamond.svg?raw';
import zoom_in from '@material-symbols/svg-400/rounded/zoom_in.svg?raw';
import zoom_out from '@material-symbols/svg-400/rounded/zoom_out.svg?raw';
import flip from '@material-symbols/svg-400/rounded/flip.svg?raw';
import flip_to_front from '@material-symbols/svg-400/rounded/flip_to_front.svg?raw';
import flip_to_back from '@material-symbols/svg-400/rounded/flip_to_back.svg?raw';
import graphic_eq from '@material-symbols/svg-400/rounded/graphic_eq.svg?raw';
import person from '@material-symbols/svg-400/rounded/person.svg?raw';
import ac_unit from '@material-symbols/svg-400/rounded/ac_unit.svg?raw';
import undo from '@material-symbols/svg-400/rounded/undo.svg?raw';
import redo from '@material-symbols/svg-400/rounded/redo.svg?raw';
import image from '@material-symbols/svg-400/rounded/image.svg?raw';
import transition_fade from '@material-symbols/svg-400/rounded/transition_fade.svg?raw';
import more_horiz from '@material-symbols/svg-400/rounded/more_horiz.svg?raw';
import keyboard from '@material-symbols/svg-400/rounded/keyboard.svg?raw';
import title from '@material-symbols/svg-400/rounded/title.svg?raw';
import ads_click from '@material-symbols/svg-400/rounded/ads_click.svg?raw';
import grid_view from '@material-symbols/svg-400/rounded/grid_view.svg?raw';
import view_sidebar from '@material-symbols/svg-400/rounded/view_sidebar.svg?raw';
import search from '@material-symbols/svg-400/rounded/search.svg?raw';
import history from '@material-symbols/svg-400/rounded/history.svg?raw';
import download from '@material-symbols/svg-400/rounded/download.svg?raw';
import video_library from '@material-symbols/svg-400/rounded/video_library.svg?raw';
import description from '@material-symbols/svg-400/rounded/description.svg?raw';
import closed_caption from '@material-symbols/svg-400/rounded/closed_caption.svg?raw';
import palette from '@material-symbols/svg-400/rounded/palette.svg?raw';
import text_fields from '@material-symbols/svg-400/rounded/text_fields.svg?raw';
import colorize from '@material-symbols/svg-400/rounded/colorize.svg?raw';
import block from '@material-symbols/svg-400/rounded/block.svg?raw';
import format_line_spacing from '@material-symbols/svg-400/rounded/format_line_spacing.svg?raw';
import format_letter_spacing from '@material-symbols/svg-400/rounded/format_letter_spacing.svg?raw';
import format_align_left from '@material-symbols/svg-400/rounded/format_align_left.svg?raw';
import format_align_center from '@material-symbols/svg-400/rounded/format_align_center.svg?raw';
import format_align_right from '@material-symbols/svg-400/rounded/format_align_right.svg?raw';
import ios_share from '@material-symbols/svg-400/rounded/ios_share.svg?raw';
import save from '@material-symbols/svg-400/rounded/save.svg?raw';
import upload from '@material-symbols/svg-400/rounded/upload.svg?raw';
import magnet from 'lucide-static/icons/magnet.svg?raw';

// Material paths have no fill; give them the text colour. Lucide icons are already stroke=currentColor.
const m = (svg: string) => svg.replace('<svg', '<svg fill="currentColor" aria-hidden="true" focusable="false"');
const l = (svg: string) => svg.replace(/<!--.*?-->/s, '').replace('<svg', '<svg aria-hidden="true" focusable="false"');
export const ICONS = {
  close: m(close),
  chevron_left: m(chevron_left),
  chevron_right: m(chevron_right),
  music_note: m(music_note),
  bolt: m(bolt),
  animation: m(animation),
  picture_in_picture_alt: m(picture_in_picture_alt),
  arrow_upward: m(arrow_upward),
  arrow_downward: m(arrow_downward),
  play_arrow: m(play_arrow),
  pause: m(pause),
  content_cut: m(content_cut),
  merge: m(merge),
  replay_5: m(replay_5),
  forward_5: m(forward_5),
  fit_screen: m(fit_screen),
  add: m(add),
  center_focus_strong: m(center_focus_strong),
  diamond: m(diamond),
  zoom_in: m(zoom_in),
  zoom_out: m(zoom_out),
  flip: m(flip),
  flip_to_front: m(flip_to_front),
  flip_to_back: m(flip_to_back),
  graphic_eq: m(graphic_eq),
  person: m(person),
  ac_unit: m(ac_unit),
  undo: m(undo),
  redo: m(redo),
  image: m(image),
  transition_fade: m(transition_fade),
  more_horiz: m(more_horiz),
  keyboard: m(keyboard),
  title: m(title),
  ads_click: m(ads_click),
  grid_view: m(grid_view),
  view_sidebar: m(view_sidebar),
  search: m(search),
  history: m(history),
  download: m(download),
  video_library: m(video_library),
  description: m(description),
  closed_caption: m(closed_caption),
  text_fields: m(text_fields),
  palette: m(palette),
  colorize: m(colorize),
  block: m(block),
  format_line_spacing: m(format_line_spacing),
  format_letter_spacing: m(format_letter_spacing),
  format_align_left: m(format_align_left),
  format_align_center: m(format_align_center),
  format_align_right: m(format_align_right),
  ios_share: m(ios_share),
  save: m(save),
  upload: m(upload),
  magnet: l(magnet),
};
export type IconName = keyof typeof ICONS;
