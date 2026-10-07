// The effects player (P1-A07): triggers from sim events and snapshot facts, one log entry each, a presentation voice budget.
// The budget is how many effects may sound at once on the shared screen (measured: see docs/evidence/P1-A07); past it the
// quietest-intensity sound is dropped, never a gameplay thing. Muted or blocked audio logs the trigger and plays nothing.
import type { Mix } from '../mix';
import { playSfx, type SfxKind } from './synth';

/** Effects sounding at once, at most (a presentation budget). */
export const SFX_VOICE_BUDGET = 14;
/** The same effect for the same source is at least this far apart, ms (a scrum of contacts isn't a buzz). */
const MIN_GAP_MS = 55;

export class Sfx {
  private live: Array<{ until: number; intensity: number }> = [];
  private lastAt = new Map<string, number>();
  /** Most effects ever sounding at once (the budget receipt). */
  peakVoices = 0;
  dropped = 0;

  constructor(private mix: Mix) {}

  /** `source` keys the spacing (a car, a pair); `data` rides into the log entry. */
  trigger(kind: SfxKind, intensity: number, reason: string, data: Record<string, unknown> = {}, source = '', nowMs = performance.now()): boolean {
    const key = `${kind}:${source}`;
    const prev = this.lastAt.get(key);
    if (prev !== undefined && nowMs - prev < MIN_GAP_MS) return false;
    this.lastAt.set(key, nowMs);
    this.live = this.live.filter((v) => v.until > nowMs);
    let heard = this.mix.live;
    if (this.live.length >= SFX_VOICE_BUDGET) {
      const quiet = this.live.reduce((a, b) => (a.intensity <= b.intensity ? a : b));
      if (quiet.intensity >= intensity) {
        heard = false;
        this.dropped++;
      } else this.live.splice(this.live.indexOf(quiet), 1);
    }
    if (heard) {
      this.live.push({ until: nowMs + 1200, intensity });
      this.peakVoices = Math.max(this.peakVoices, this.live.length);
      const ctx = this.mix.ctx;
      const bus = this.mix.bus('sfx');
      try {
        if (ctx && bus) playSfx(ctx, bus, kind, intensity);
      } catch {
        heard = false;
      }
    }
    this.mix.note('sfx', { sfx: kind, intensity: +intensity.toFixed(2), reason, played: heard, voices: this.live.length, ...data });
    return true;
  }
}
