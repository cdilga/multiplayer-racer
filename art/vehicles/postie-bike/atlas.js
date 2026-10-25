// atlas.js: the Postie Bike's one texture (br-bwju.5), flat swatches drawn by the bike kit (art/vehicles/_kit/swatch-atlas.js).
// Paint key: 'paint' (leg shield, side covers, mudguards) bakes pure white and takes the seat colour; the postal-red
// panniers, the hi-vis vest and everything else keep their colours, so a Postie reads as a Postie in any seat colour.
import { swatchAtlas, W, H } from '../_kit/swatch-atlas.js';

export { W, H };
export const SW = ['paint', 'frame', 'seat', 'tyre', 'rim', 'hub', 'spokes', 'chrome', 'head', 'tail', 'postred', 'parcel', 'tape', 'helmet', 'visor', 'skin',
  'shirt', 'vest', 'band', 'pants', 'boots', 'engine', 'under', 'bay', 'indicator', 'postred2', 'cavity', 'ink', 'helmet2', 'glass', 'tankInset', 'cover'];
export const DEFAULT_COLOURS = {
  paint: '#d8262b', frame: '#202227', seat: '#1d1e22', tyre: '#27272a', rim: '#aeb7c1', hub: '#8a9098', spokes: '#b5bdc6', chrome: '#c6cdd5',
  head: '#fff0b8', tail: '#e8311f', postred: '#cf1f26', parcel: '#dbb97e', tape: '#b99557', helmet: '#f2f4f8', visor: '#c9d4de', skin: '#e8aa8a',
  shirt: '#3b6eb4', vest: '#ffa51e', band: '#f26b3b', pants: '#24304a', boots: '#17181b', engine: '#858b94', under: '#18191c', bay: '#34373e', indicator: '#ff9a1a',
  postred2: '#df352c', cavity: '#3a1b1c', ink: '#3d2f1e', helmet2: '#d0d6de', glass: '#d4e6f0', tankInset: '#f3e6b2', cover: '#e1dfcc',
};
const EMIT = { head: '#fff0c0', tail: '#c81a0c', indicator: '#ff8a10' };
export const { swatchUV, drawAtlas, BAKE_COLOURS } = swatchAtlas(SW, DEFAULT_COLOURS, EMIT);
