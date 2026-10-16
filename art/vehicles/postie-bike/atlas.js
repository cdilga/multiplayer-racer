// atlas.js: the Postie Bike's one texture (br-bwju.5), flat swatches drawn by the bike kit (art/vehicles/_kit/swatch-atlas.js).
// Paint key: 'paint' (leg shield, side covers, mudguards) bakes pure white and takes the seat colour; the postal-red
// panniers, the hi-vis vest and everything else keep their colours, so a Postie reads as a Postie in any seat colour.
import { swatchAtlas, W, H } from '../_kit/swatch-atlas.js';

export { W, H };
export const SW = ['paint', 'frame', 'seat', 'tyre', 'rim', 'hub', 'spokes', 'chrome', 'head', 'tail', 'postred', 'parcel', 'tape', 'helmet', 'visor', 'skin',
  'shirt', 'vest', 'band', 'pants', 'boots', 'engine', 'under', 'bay', 'indicator'];
export const DEFAULT_COLOURS = {
  paint: '#d8262b', frame: '#22242a', seat: '#1d1e22', tyre: '#2a2a2c', rim: '#34373c', hub: '#7d848c', spokes: '#c3cad2', chrome: '#c3cad2',
  head: '#fff2c8', tail: '#e8311f', postred: '#cf1f26', parcel: '#d9b77e', tape: '#8a6a3e', helmet: '#f2f4f8', visor: '#2b3036', skin: '#e2b08c',
  shirt: '#3f6fb6', vest: '#ff9a1a', band: '#e8eef2', pants: '#24304a', boots: '#1a1b1e', engine: '#4a4d54', under: '#1c1d20', bay: '#34373e', indicator: '#ff9a1a',
};
const EMIT = { head: '#fff0c0', tail: '#c81a0c', indicator: '#ff8a10' };
export const { swatchUV, drawAtlas, BAKE_COLOURS } = swatchAtlas(SW, DEFAULT_COLOURS, EMIT);
