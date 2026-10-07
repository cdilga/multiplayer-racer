// The worker's side of the journal stream (P1-F07, plan §4.4 `Journal`): asks the sim what its journal gained and hands
// main a small message. It runs in the sim worker next to the sim, costs a delta (most polls are a few bytes), and times
// itself so the receipt can say what it costs per frame. It never faults the sim: a failed poll is dropped.
import type { JournalMessage } from './types';

/** The part of the sim the tap needs: the testing build's JSON command surface (`journalChunk`). */
export interface TapSim {
  tick(): number;
  test(command: string): string;
}

export interface TapStats {
  polls: number;
  messages: number;
  totalMs: number;
  maxMs: number;
  /** Characters of base64 chunk sent (≈ bytes × 1.33). */
  chunkChars: number;
  failures: number;
}

export class JournalTap {
  private lastTick = -1;
  private lastHashTick = 0;
  readonly stats: TapStats = { polls: 0, messages: 0, totalMs: 0, maxMs: 0, chunkChars: 0, failures: 0 };

  /** `everyTicks`: the least the sim advances between polls (12 ticks = 0.1 s); `hashEvery`: ticks between checkpoint hashes. */
  constructor(
    private everyTicks = 12,
    private hashEvery = 600,
  ) {}

  /** Polls the sim if it moved enough (or `force`); returns the message to post, if there is one. */
  poll(sim: TapSim, opts: { force?: boolean; hash?: boolean } = {}): JournalMessage | null {
    const tick = sim.tick();
    if (!opts.force && tick >= this.lastTick && this.lastTick >= 0 && tick - this.lastTick < this.everyTicks) return null;
    const hash = opts.hash === true || this.lastTick < 0 || tick - this.lastHashTick >= this.hashEvery;
    const t0 = performance.now();
    let m: JournalMessage;
    try {
      m = JSON.parse(sim.test(JSON.stringify({ cmd: 'journalChunk', hash }))) as JournalMessage;
    } catch {
      this.stats.failures++;
      return null;
    }
    const ms = performance.now() - t0;
    m.kind = 'journal';
    m.ms = ms;
    this.lastTick = m.tick;
    if (m.hash) this.lastHashTick = m.tick;
    const s = this.stats;
    s.polls++;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    s.chunkChars += m.chunk?.length ?? 0;
    s.messages++;
    return m;
  }
}
