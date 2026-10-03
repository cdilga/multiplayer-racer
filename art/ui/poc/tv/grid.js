// grid.js — the TV grid layout rule (P1-U02 proposal; becomes P1-R04's contract once the owner accepts it).
// Pure: layoutGrid(n, rect, opts) → { rows, tiles[seat order], fillers }. Master §6.2 + plan §3a.

export const BAND = { min: 1.2, max: 2.0 }; // playable tile aspect (third person); first person uses the same cell

export const PSEUDOCODE = `layout(N, screen, safe) → tiles, fillers
  # Seat order is reading order. Only joins and leaves change N, so only they reflow (300 ms ease).
  best ← none
  for rows R in 1 … N:
    counts ← balanced(N, R)            # rows differ by at most one tile, fuller rows on top
    rowH ← screen.h / R
    for each row i with c = counts[i]:
      w ← screen.w / c,  h ← rowH       # the cell
      if w / h > BAND.max: w ← h × BAND.max      # too wide: narrow the tile, row stays centred
      if w / h < BAND.min: h ← w / BAND.min      # too tall: shorten the tile, centred in the row
      place c tiles of w × h centred in the row; the rest of the row is filler
    score ← (total tile area, smallest tile area)  # gameplay area first, then own-car readability
    keep the best score
  fillers: the largest shows the join QR, the next the live standings, the rest the painted backdrop
  if no filler is big enough for a QR: a small join chip sits in the bottom-right corner, inside action-safe
  BAND = 1.2 … 2.0 (third person); portrait screens stack rows, ultrawide screens add columns,
  both fall out of the same rule. Nothing is ever black; there is no maximum N.`;

export function balanced(n, rows) {
  const base = Math.floor(n / rows), extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

export function layoutGrid(n, rect, { band = BAND, gutter = 0 } = {}) {
  if (n <= 0) return { rows: 0, counts: [], tiles: [], fillers: [{ ...rect }] };
  let best = null;
  for (let r = 1; r <= n; r++) {
    const counts = balanced(n, r);
    if (counts.some((c) => c === 0)) break;
    const rowH = rect.h / r;
    const tiles = [], fillers = [];
    let area = 0, minArea = Infinity;
    counts.forEach((c, i) => {
      const y0 = rect.y + i * rowH;
      let w = rect.w / c, h = rowH;
      if (w / h > band.max) w = h * band.max;
      if (w / h < band.min) h = w / band.min;
      const rowW = w * c, x0 = rect.x + (rect.w - rowW) / 2, yT = y0 + (rowH - h) / 2;
      for (let k = 0; k < c; k++) tiles.push({ x: x0 + k * w, y: yT, w, h });
      if (x0 - rect.x > 0.5) fillers.push({ x: rect.x, y: y0, w: x0 - rect.x, h: rowH }, { x: x0 + rowW, y: y0, w: rect.x + rect.w - (x0 + rowW), h: rowH });
      if (yT - y0 > 0.5) fillers.push({ x: x0, y: y0, w: rowW, h: yT - y0 }, { x: x0, y: yT + h, w: rowW, h: y0 + rowH - (yT + h) });
      area += w * h * c;
      minArea = Math.min(minArea, w * h);
    });
    const better = !best || area > best.area * 1.0001 || (Math.abs(area - best.area) <= best.area * 1e-4 && minArea > best.minArea);
    if (better) best = { rows: r, counts, tiles, fillers, area, minArea };
  }
  const g = gutter / 2;
  best.tiles = best.tiles.map((t) => ({ x: t.x + g, y: t.y + g, w: t.w - gutter, h: t.h - gutter }));
  best.fillers.sort((a, b) => b.w * b.h - a.w * a.h);
  return best;
}
