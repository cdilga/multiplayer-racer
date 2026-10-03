// The TV grid layout kernel (P1-R04): `layout(displayRect, safeArea, seats) → tiles`, pure, for any N and any aspect.
// The rule is the owner's (R95, P1-U02.2's accepted pseudocode in art/ui/poc/tv/grid.js): every player tile has exactly
// the same whole-pixel area at any N; rows and columns are chosen to give the tiles the most area inside the playable
// aspect band; the block is centred; seats fill it in join order; the empty cells (each exactly a tile) sit at the end
// of the last row and hold the join QR (or the room code when no cell fits a scannable QR), then the standings, then
// the painted backdrop. Nothing is black, no tile is larger than another, and there is no maximum N.
// `GridAnimator` reflows (300 ms) only when a seat joins or leaves; the race order never moves a tile.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile extends Rect {
  /** The seat drawn here (its id), and its place in join order. */
  seat: number;
  index: number;
}

export type FillerKind = 'qr' | 'code' | 'standings' | 'backdrop' | 'margin';
export interface Filler extends Rect {
  kind: FillerKind;
}

export interface Layout {
  rows: number;
  cols: number;
  /** Every tile's size (whole pixels, before the gutter inset). */
  cell: { w: number; h: number } | null;
  tiles: Tile[];
  fillers: Filler[];
  /** The small join chip (the join address), inside the safe area, whenever no cell holds the join QR. */
  joinChip: Rect | null;
}

export interface LayoutOptions {
  /** Playable tile aspect (w / h); third person (R95, master §6.2). */
  band?: { min: number; max: number };
  /** Gap between tiles, whole pixels split evenly so every tile stays the same size. */
  gutter?: number;
  /** The smallest cell side that still shows a scannable join QR. */
  qrMin?: number;
  /** The join chip's size. */
  chip?: { w: number; h: number };
  /** How far down the top row's tiles the chip sits (a fraction of a tile's height): below the first-person mirror
   *  strip (assets/profiles/camera.json mirror y + h), in the band of sky above the horizon. */
  chipBelow?: number;
}

export const BAND = { min: 1.2, max: 2.0 };

export function layout(display: Rect, safe: Rect, seats: readonly number[], opts: LayoutOptions = {}): Layout {
  const band = opts.band ?? BAND;
  const gutter = opts.gutter ?? 0;
  const qrMin = opts.qrMin ?? Math.round(Math.min(display.w, display.h) * 0.22);
  // A slim pill (the POC's "code + address" chip), so it sits over a player's tile without hiding their car.
  const chipSize = opts.chip ?? { w: Math.round(Math.min(display.w, display.h) * 0.3), h: Math.round(Math.min(display.w, display.h) * 0.045) };
  const n = seats.length;
  const X = Math.round(display.x);
  const Y = Math.round(display.y);
  const RW = Math.floor(display.x + display.w) - X;
  const RH = Math.floor(display.y + display.h) - Y;
  // Top-right, under the mirror strip of the top row: a race tile's top is sky (R98), so the chip hides no car and
  // no mirror. Called once the grid is known.
  const chip = (y0: number, cellH: number): Rect => ({
    x: Math.round(safe.x + safe.w - chipSize.w),
    y: Math.round(Math.max(safe.y, y0 + cellH * (opts.chipBelow ?? 0.23))),
    w: chipSize.w,
    h: chipSize.h,
  });
  if (n === 0) {
    return { rows: 0, cols: 0, cell: null, tiles: [], fillers: [{ ...display, kind: 'qr' }], joinChip: null };
  }
  let best: { rows: number; cols: number; w: number; h: number; area: number; empty: number } | null = null;
  for (let r = 1; r <= n; r++) {
    const c = Math.ceil(n / r);
    if (c * (r - 1) >= n) continue; // the last row would be empty
    let w = Math.floor(RW / c);
    let h = Math.floor(RH / r);
    if (w / h > band.max) w = Math.floor(h * band.max);
    if (w / h < band.min) h = Math.floor(w / band.min);
    const area = w * h;
    const empty = c * r - n;
    if (!best || area > best.area || (area === best.area && empty < best.empty)) best = { rows: r, cols: c, w, h, area, empty };
  }
  const { rows, cols, w, h } = best!;
  const x0 = X + Math.floor((RW - cols * w) / 2);
  const y0 = Y + Math.floor((RH - rows * h) / 2);
  const x1 = x0 + cols * w;
  const y1 = y0 + rows * h;
  const hg = Math.round(gutter / 2);
  const slot = (i: number): Rect => ({ x: x0 + (i % cols) * w + hg, y: y0 + Math.floor(i / cols) * h + hg, w: w - 2 * hg, h: h - 2 * hg });
  const tiles = seats.map((seat, index) => ({ ...slot(index), seat, index }));
  const fillers: Filler[] = [];
  let joinShown = false;
  let standingsShown = false;
  for (let i = n; i < cols * rows; i++) {
    const s = slot(i);
    let kind: FillerKind = 'backdrop';
    if (!joinShown) {
      kind = Math.min(s.w, s.h) >= qrMin ? 'qr' : 'code';
      joinShown = true;
    } else if (!standingsShown) {
      kind = 'standings';
      standingsShown = true;
    }
    fillers.push({ ...s, kind });
  }
  // Margins left by the aspect band and the whole-pixel rounding, out to the exact display edges: painted backdrop.
  const right = display.x + display.w;
  const bottom = display.y + display.h;
  const margins: Rect[] = [
    { x: display.x, y: display.y, w: x0 - display.x, h: display.h },
    { x: x1, y: display.y, w: right - x1, h: display.h },
    { x: x0, y: display.y, w: cols * w, h: y0 - display.y },
    { x: x0, y: y1, w: cols * w, h: bottom - y1 },
  ];
  for (const m of margins) if (m.w > 0.01 && m.h > 0.01) fillers.push({ ...m, kind: 'margin' });
  const qrCell = fillers.some((f) => f.kind === 'qr');
  return { rows, cols, cell: { w, h }, tiles, fillers, joinChip: qrCell ? null : chip(y0, h) };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Keeps the seats in join order and reflows (animated) only when one joins or leaves. Feed it the seats present, in
 * any order (a race order, say): a seat new to it goes to the end, a gone seat leaves its place, and an unchanged set
 * never moves a tile.
 */
export class GridAnimator {
  order: number[] = [];
  private from = new Map<number, Rect>();
  private to: Layout | null = null;
  private start = 0;
  reflows = 0;
  private display: Rect;
  private safe: Rect;
  private opts: LayoutOptions & { durationMs?: number };

  // Plain fields, not parameter properties: Node's type stripping runs this file in the unit tests.
  constructor(display: Rect, safe: Rect, opts: LayoutOptions & { durationMs?: number } = {}) {
    this.display = display;
    this.safe = safe;
    this.opts = opts;
  }

  /** Updates the seats present and the screen; returns whether the layout changed (and so reflows). */
  update(present: readonly number[], now: number, display = this.display, safe = this.safe): boolean {
    const set = new Set(present);
    const next = this.order.filter((s) => set.has(s));
    for (const s of present) if (!next.includes(s)) next.push(s);
    const seatsChanged = next.length !== this.order.length || next.some((s, i) => s !== this.order[i]);
    const screenChanged = display.w !== this.display.w || display.h !== this.display.h || display.x !== this.display.x || display.y !== this.display.y;
    if (!seatsChanged && !screenChanged && this.to) return false;
    const current = new Map(this.to ? this.tiles(now).map((t) => [t.seat, t as Rect]) : []);
    this.order = next;
    this.display = display;
    this.safe = safe;
    this.to = layout(display, safe, next, this.opts);
    // A resize snaps (the screen itself changed); a join or leave tweens from where each tile was.
    this.from = seatsChanged && !screenChanged ? current : new Map();
    this.start = now;
    if (seatsChanged) this.reflows++;
    return true;
  }

  get layout(): Layout | null {
    return this.to;
  }

  /** Tile rects at time `now`: between where they were and where they go, for `durationMs` after a join or leave. */
  tiles(now: number): Tile[] {
    if (!this.to) return [];
    const k = Math.min(1, (now - this.start) / (this.opts.durationMs ?? 300));
    if (k >= 1 || this.from.size === 0) return this.to.tiles;
    const e = ease(k);
    return this.to.tiles.map((t) => {
      const f = this.from.get(t.seat);
      // A new seat grows from the middle of its own cell.
      const a = f ?? { x: t.x + t.w / 2, y: t.y + t.h / 2, w: 0, h: 0 };
      return { ...t, x: a.x + (t.x - a.x) * e, y: a.y + (t.y - a.y) * e, w: a.w + (t.w - a.w) * e, h: a.h + (t.h - a.h) * e };
    });
  }

  /** Whether a reflow is still animating at `now`. */
  animating(now: number): boolean {
    return this.from.size > 0 && now - this.start < (this.opts.durationMs ?? 300);
  }
}
