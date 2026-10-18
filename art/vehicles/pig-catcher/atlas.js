// atlas.js: the Pig Catcher's one texture (br-bwju.5), flat swatches drawn by the bike kit (art/vehicles/_kit/swatch-atlas.js).
// Paint key: 'paint' (the yellow plastics: tank, side plastics, both mudguards, the number-plate shroud) bakes pure white
// and takes the seat colour; the black light bar, the rope and sack, the rider's green helmet and khaki shirt keep theirs.
import { swatchAtlas, W, H } from '../_kit/swatch-atlas.js';

export { W, H };
export const SW = ['paint', 'frame', 'seat', 'tyre', 'rim', 'hub', 'spokes', 'chrome', 'head', 'tail', 'lightbar', 'rope', 'sack', 'helmet', 'goggles', 'skin',
  'shirt', 'pants', 'boots', 'gloves', 'engine', 'under', 'bay', 'rope2', 'pipe', 'sole', 'sack2', 'guard'];
export const DEFAULT_COLOURS = {
  paint: '#f4c418', frame: '#232428', seat: '#1b1c1f', tyre: '#262628', rim: '#b9c0c8', hub: '#7d848c', spokes: '#9aa2ab', chrome: '#c3cad2',
  head: '#d9fbff', tail: '#e8311f', lightbar: '#18191c', rope: '#cdb383', sack: '#9a7344', helmet: '#3f5a37', goggles: '#2fa8a0', skin: '#e2b08c',
  shirt: '#bba57c', pants: '#35507a', boots: '#27282c', gloves: '#2a2b2e', engine: '#4a4d54', under: '#1c1d20', bay: '#34373e', rope2: '#a8895a', pipe: '#55585f', sole: '#141517', sack2: '#7b5731', guard: '#1d1e21',
};
const EMIT = { head: '#c8f6ff', tail: '#c81a0c' };
export const { swatchUV, drawAtlas, BAKE_COLOURS } = swatchAtlas(SW, DEFAULT_COLOURS, EMIT);
