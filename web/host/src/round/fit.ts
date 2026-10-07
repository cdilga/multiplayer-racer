// The density rule for rosters (P1-R07; the accepted POC's lobby rule, art/ui/accepted/2026-10-07/poc/tv/main.js `lobby()`):
// the richest tier whose cards stay legible wins; the last tier has no floor, so every player is always drawn (R-rulings:
// no cap, never a scroll or a page). Pure, so tests and the screens share it.
export interface Tier {
  id: string;
  /** Smallest legible card (CSS px); 0 for the floorless last tier. */
  minW: number;
  minH: number;
  /** A card never grows past this (a few players read like a few). */
  maxW: number;
  maxH: number;
  /** Text size limit: the card's width in em of its font size. */
  em: number;
}

export interface Fit {
  tier: Tier;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  /** Font size (CSS px) for the cards' text. */
  fs: number;
}

/** Picks the tier and the column count for `n` cards in a `w` x `h` box with `gap` between them. Columns fill top to bottom. */
export function fitGrid(n: number, w: number, h: number, gap: number, tiers: Tier[], maxFs: number): Fit {
  for (const tier of tiers) {
    let best: (Fit & { score: number }) | null = null;
    for (let cols = 1; cols <= Math.max(1, n); cols++) {
      const rows = Math.ceil(n / cols);
      const cw = (w - (cols - 1) * gap) / cols;
      const ch = (h - (rows - 1) * gap) / rows;
      if (cw < Math.max(1, tier.minW) || ch < Math.max(1, tier.minH)) continue;
      const score = Math.min(cw, tier.maxW) * Math.min(ch, tier.maxH);
      if (!best || score > best.score + 1e-6) {
        const w2 = Math.min(cw, tier.maxW);
        const h2 = Math.min(ch, tier.maxH);
        best = { tier, cols, rows, cw: w2, ch: h2, fs: Math.max(8, Math.min(h2 * 0.42, w2 / tier.em, maxFs)), score };
      }
    }
    if (best) return best;
  }
  // Below every floor (an enormous room on a small screen): the squarest grid that holds everyone.
  const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * w) / Math.max(1, h)))));
  const rows = Math.ceil(n / cols);
  const tier = tiers[tiers.length - 1]!;
  const cw = Math.max(4, (w - (cols - 1) * gap) / cols);
  const ch = Math.max(4, (h - (rows - 1) * gap) / rows);
  return { tier, cols, rows, cw, ch, fs: Math.max(5, Math.min(ch * 0.42, cw / tier.em)) };
}
