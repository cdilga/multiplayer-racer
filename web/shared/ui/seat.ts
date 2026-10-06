// Seat identity (tokens.identity, ported from art/ui/poc/shared/tokens.js `seatColor`): every seat gets a number and a colour;
// seat N takes colour (N-1) mod the palette length, so colours repeat for large rooms and the number never does. No cap (R66).
import { tokenData } from './tokens.generated';

export interface SeatColor {
  hex: string;
  /** Text colour on the seat colour. */
  on: string;
  name: string;
  /** Index into the identity palette (the `--id-<index>` variables). */
  index: number;
}

/** The identity colour of seat `seat` (1-based; any positive number). */
export function seatColor(seat: number): SeatColor {
  const n = tokenData.seatColors.length;
  const index = (((Math.trunc(seat) - 1) % n) + n) % n;
  const c = tokenData.seatColors[index]!;
  return { hex: c.hex, on: c.on, name: c.name, index };
}

/** A number badge: `#7` on the seat colour, in the brushed dab shape. Any digit count. */
export function seatBadge(seat: number): HTMLSpanElement {
  const { index } = seatColor(seat);
  const el = document.createElement('span');
  el.className = 'badge';
  el.style.setProperty('--b', `var(--id-${index})`);
  el.style.setProperty('--on', `var(--id-${index}-on)`);
  el.textContent = `#${seat}`;
  return el;
}
