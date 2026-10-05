// grid.js — the TV grid layout rule (P1-U02.2 proposal after the owner's POC round 1; becomes P1-R04's contract once the
// owner accepts it). Pure: layoutGrid(n, rect, opts) → { rows, cols, cell, tiles[seat order], fillers }. R95, master §6.2.

export const BAND = { min: 1.2, max: 2.0 }; // playable tile aspect (third person); first person uses the same cell

export const PSEUDOCODE = `layout(N, screen) → tiles, fillers
  # R95: every player tile is exactly the same size, at any N.
  # Seat order is reading order. Only joins and leaves change N, so only they reflow (300 ms ease).
  best ← none
  for rows R in 1 … N:
    C ← ceil(N / R)                       # columns
    if C × (R − 1) ≥ N: skip              # the last row would be empty
    w ← floor(screen.w / C),  h ← floor(screen.h / R)     # whole pixels: equal to the pixel
    if w / h > BAND.max: w ← floor(h × BAND.max)          # too wide: narrow every tile
    if w / h < BAND.min: h ← floor(w / BAND.min)          # too tall: shorten every tile
    keep R if N × w × h beats the best (ties: fewer empty cells)
  the C × R block is centred; seats fill it in reading order
  the C × R − N empty cells sit at the end of the last row, each exactly a tile
  chrome (host-layout.js): QR + player list use free cells/margins first, else the smallest strip;
           QR = largest square that fits, never under the minimum scannable size
  no QR fits at all: the room code in a small chip, bottom-right
  BAND = 1.2 … 2.0 (third person); portrait screens stack rows, ultrawide screens add columns,
  both fall out of the same rule. Nothing is ever black, no tile is ever larger; there is no maximum N.`;

/** The equal-tile grid: every tile is `cell.w × cell.h` whole pixels, inset by the same half-gutter. */
// `min` ({ w, h }, optional) rejects arrangements whose tile would be smaller; with it the result is null when none fits
// (the lobby roster asks, tier by tier, for the biggest equal cards that stay legible; the race grid never passes it).
export function layoutGrid(n, rect, { band = BAND, gutter = 0, min = null } = {}) {
  const X = Math.round(rect.x), Y = Math.round(rect.y), RW = Math.floor(rect.x + rect.w) - X, RH = Math.floor(rect.y + rect.h) - Y;
  const right = rect.x + rect.w, bottom = rect.y + rect.h;
  if (n <= 0) return { rows: 0, cols: 0, cell: null, tiles: [], fillers: [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h, kind: 'margin' }] };
  let best = null;
  for (let r = 1; r <= n; r++) {
    const c = Math.ceil(n / r);
    if (c * (r - 1) >= n) continue;
    let w = Math.floor(RW / c), h = Math.floor(RH / r);
    if (w / h > band.max) w = Math.floor(h * band.max);
    if (w / h < band.min) h = Math.floor(w / band.min);
    if (min && (w < min.w || h < min.h)) continue;
    const area = w * h, empty = c * r - n;
    if (!best || area > best.area || (area === best.area && empty < best.empty)) best = { rows: r, cols: c, w, h, area, empty };
  }
  if (!best) return null;
  const { rows, cols, w, h } = best;
  const x0 = X + Math.floor((RW - cols * w) / 2), y0 = Y + Math.floor((RH - rows * h) / 2);
  const x1 = x0 + cols * w, y1 = y0 + rows * h;
  const hg = Math.round(gutter / 2); // whole pixels, so every tile stays the same size
  const slot = (i) => ({ x: x0 + (i % cols) * w + hg, y: y0 + Math.floor(i / cols) * h + hg, w: w - 2 * hg, h: h - 2 * hg });
  const tiles = Array.from({ length: n }, (_, i) => slot(i));
  const fillers = [];
  for (let i = n; i < cols * rows; i++) fillers.push({ ...slot(i), kind: 'cell' });
  // Margins left by the aspect band and the whole-pixel rounding, out to the exact rect edges.
  const margins = [
    { x: rect.x, y: rect.y, w: x0 - rect.x, h: rect.h },
    { x: x1, y: rect.y, w: right - x1, h: rect.h },
    { x: x0, y: rect.y, w: cols * w, h: y0 - rect.y },
    { x: x0, y: y1, w: cols * w, h: bottom - y1 },
  ].filter((m) => m.w > 0.01 && m.h > 0.01).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const m of margins) fillers.push({ ...m, kind: 'margin' });
  return { rows, cols, cell: { w, h, x0, y0 }, tiles, fillers };
}
