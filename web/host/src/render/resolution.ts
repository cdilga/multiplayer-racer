// The host's Render resolution (R111, P1-R): Native by default, lower steps by the host's choice, and an automatic lowering
// only as a measured last resort (a frame budget missed on this hardware). Never because of tile or player count, and
// never raised again behind the host's back: only choosing a setting resets it.

/** The steps the setting offers, highest first. Auto-lowering walks down this list, one step per measured miss. */
export const LEVELS = [1, 0.75, 0.5] as const;

/** The frame budget, as data: lower a step only when the p95 frame time stays above `frameMs` for `seconds` in a row. */
export const BUDGET = { frameMs: 50, seconds: 5, percentile: 0.95 } as const;

export type Source = 'native' | 'user' | 'auto';

export const STORAGE_KEY = 'jj.host.renderResolution';

export const labelOf = (scale: number): string => (scale >= 1 ? 'Native' : `${Math.round(scale * 100)} %`);

/** The persisted choice (a scale), or null when absent or storage is unavailable. */
export function loadChoice(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return v > 0 && v <= 1 ? v : null;
  } catch {
    return null;
  }
}

export function saveChoice(scale: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    /* works without storage */
  }
}

/** One recorded automatic lowering, named in the stats and so in the receipts. */
export interface AutoEvent {
  from: number;
  to: number;
  p95Ms: number;
  budgetMs: number;
  seconds: number;
  atFrame: number;
}

/** Watches frame intervals; each second of (real or injected) time yields a p95, and `seconds` over budget in a row
 *  asks for one step down. Pure data in, a decision out. */
export class FrameBudget {
  private samples: number[] = [];
  private elapsed = 0;
  private over = 0;
  /** The last second's p95 (ms), or 0 before one has passed. */
  p95Ms = 0;
  get cfgMs(): number {
    return this.cfg.frameMs;
  }
  get cfgSeconds(): number {
    return this.cfg.seconds;
  }
  constructor(private cfg: { frameMs: number; seconds: number; percentile: number } = BUDGET) {}

  /** Adds a frame interval; returns the p95 that triggered a miss (the caller lowers a step), or null. */
  push(dtMs: number): number | null {
    if (!(dtMs > 0) || dtMs > 2000) return null; // a hidden tab or a stall is not a measurement
    this.samples.push(dtMs);
    this.elapsed += dtMs;
    if (this.elapsed < 1000) return null;
    const s = this.samples.sort((a, b) => a - b);
    this.p95Ms = s[Math.min(s.length - 1, Math.floor(s.length * this.cfg.percentile))]!;
    this.samples = [];
    this.elapsed = 0;
    this.over = this.p95Ms > this.cfg.frameMs ? this.over + 1 : 0;
    if (this.over >= this.cfg.seconds) {
      this.over = 0;
      return this.p95Ms;
    }
    return null;
  }

  reset(): void {
    this.samples = [];
    this.elapsed = 0;
    this.over = 0;
  }
}

/** The next step below `scale`, or null at the bottom: auto-lowering never goes under the lowest step. */
export function stepBelow(scale: number): number | null {
  return LEVELS.find((l) => l < scale - 1e-6) ?? null;
}
