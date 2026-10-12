// P1-R13: one identity pattern catalogue for vehicle paint and every screen.
import { tokenData } from './tokens.generated';

export function seatPattern(number: number) {
  const patterns = tokenData.seatPatterns;
  const index = ((Math.trunc(number) - 1) % patterns.length + patterns.length) % patterns.length;
  return { ...patterns[index]!, index };
}

/** Small transparent, self-hosted SVG repeat; colour and readable number remain underneath/above it. */
export function patternImage(number: number): string {
  const { svg } = seatPattern(number);
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="${svg}" fill="#15203A" fill-opacity=".28"/></svg>`)}")`;
}

export function applySeatPattern(el: HTMLElement, number: number): void {
  const pattern = seatPattern(number);
  el.dataset.identityPattern = pattern.id;
  el.style.setProperty('--identity-pattern', patternImage(number));
}

/** The same data path as CSS and car paint, for the Identify nameplate's patterned ring. */
export function drawSeatPattern(g: CanvasRenderingContext2D, number: number, width: number, height: number, cell = 32): void {
  const path = new Path2D(seatPattern(number).svg);
  g.save();
  g.fillStyle = '#15203A';
  g.globalAlpha = .28;
  g.scale(cell / 32, cell / 32);
  for (let y = 0; y < height * 32 / cell; y += 32) for (let x = 0; x < width * 32 / cell; x += 32) {
    g.save(); g.translate(x, y); g.fill(path); g.restore();
  }
  g.restore();
}
