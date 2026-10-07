// The announcer (P1-A03): A00's cue sheet (tools/audio/cues-playtest1.tsv: moment, variant, trigger, caption) and A01's
// clips (assets/audio/voice/<moment>-<variant>.ogg). A moment fires from the event the sheet names; the announcer picks
// among its variants without repeating the previous one, plays the clip on the voice bus (ducking music and engines),
// and shows the sheet's caption in the one brush-stroke caption component (web/shared/ui caption.ts) at the foot of the
// shared screen.
//
// Apple hosts: the clips are Ogg/Opus. `canPlayType` decides per browser: with Ogg/Opus unsupported and an `.m4a` twin
// shipped (A01 `--m4a-twin`), the twin plays; otherwise the clip is tried anyway and a decode failure is logged and
// silent (the caption still shows). tests/audio.test.mjs decodes every shipped clip in Chromium and WebKit.
import cueSheet from '../../../../tools/audio/cues-playtest1.tsv?raw';
import { caption } from '../../../shared/ui';
import { mulberry32 } from '../../../shared/audio/engine-synth';
import type { Mix } from './mix';

const clipUrls = import.meta.glob('../../../../assets/audio/voice/*.{ogg,m4a}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface Variant {
  moment: string;
  variant: number;
  trigger: string;
  caption: string;
  text: string;
  /** Ogg/Opus clip URL (and the AAC twin when one ships). */
  ogg?: string;
  m4a?: string;
}

/** Moment priorities: a higher one cuts in on a waiting lower one; none interrupts a clip already speaking. */
const PRIORITY: Record<string, number> = {
  countdown: 100,
  winner: 90,
  'time-up': 80,
  'photo-finish': 75,
  'final-lap': 70,
  'first-finisher': 70,
  wreck: 60,
  'off-course': 55,
  'door-off': 50,
  'wheel-off': 50,
  'bodywork-off': 50,
  'lead-change': 40,
  'all-ready': 30,
  'next-round': 30,
  'late-joiner': 30,
  'big-air': 20,
  welcome: 10,
};
/** The least game time between two plays of the same moment, s (a moment can recur: a wreck every few seconds is noise). */
const COOLDOWN_S: Record<string, number> = { wreck: 6, 'off-course': 8, 'door-off': 5, 'wheel-off': 5, 'bodywork-off': 5, 'lead-change': 10, 'big-air': 12, 'late-joiner': 6 };
/** A waiting cue older than this when the announcer frees up is dropped: the moment has passed. */
const STALE_MS = 3500;
const CAPTION_TAIL_MS = 700;

export function parseSheet(tsv: string): Variant[] {
  const rows = tsv.split('\n').filter((l) => l.trim());
  const head = rows.shift()!.split('\t');
  const col = (name: string) => head.indexOf(name);
  const [m, v, t, tx, cp] = ['moment_id', 'variant', 'trigger_event', 'text', 'caption'].map(col);
  return rows.map((l) => {
    const f = l.split('\t');
    const moment = f[m!]!;
    const variant = Number(f[v!]);
    const key = `/${moment}-${variant}.`;
    const find = (ext: string) => Object.entries(clipUrls).find(([p]) => p.endsWith(`${key}${ext}`))?.[1];
    return { moment, variant, trigger: f[t!]!, text: f[tx!]!, caption: f[cp!] || f[tx!]!, ogg: find('ogg'), m4a: find('m4a') };
  });
}

export const VARIANTS: Variant[] = parseSheet(cueSheet);
export const MOMENTS: string[] = [...new Set(VARIANTS.map((v) => v.moment))];
export const TRIGGERS: Record<string, string> = Object.fromEntries(VARIANTS.map((v) => [v.moment, v.trigger]));

/** Which file a browser gets: Ogg/Opus where it can play it, else the AAC twin when there is one. */
export function srcFor(v: Variant, canOgg: boolean): string | undefined {
  return canOgg || !v.m4a ? (v.ogg ?? v.m4a) : v.m4a;
}

export function canPlayOggOpus(): boolean {
  try {
    return document.createElement('audio').canPlayType('audio/ogg; codecs=opus') !== '';
  } catch {
    return false;
  }
}

interface Pending {
  moment: string;
  reason: string;
  at: number;
}

export class Announcer {
  private rng = mulberry32(0x6a6a);
  private last = new Map<string, number>(); // moment -> last variant
  private lastAt = new Map<string, number>(); // moment -> ms of last play
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private speaking: { moment: string; until: number } | null = null;
  private pending: Pending | null = null;
  private captionEl: HTMLElement | null = null;
  private captionTimer = 0;
  private canOgg = canPlayOggOpus();
  /** Decoded clip lengths, s, by source. */
  private lengths = new Map<string, number>();
  /** Clips that failed to decode here (logged once each). */
  readonly failed = new Set<string>();
  /** The captions shown, in order (introspection). */
  readonly captions: Array<{ moment: string; variant: number; text: string; at: number }> = [];

  constructor(private mix: Mix, private host: HTMLElement | null = typeof document !== 'undefined' ? document.body : null) {}

  /** The variant `moment` plays next: any variant but the one it played last (seeded, so a scripted round is repeatable). */
  pick(moment: string): Variant | null {
    const all = VARIANTS.filter((v) => v.moment === moment);
    if (!all.length) return null;
    const last = this.last.get(moment);
    const pool = all.length > 1 ? all.filter((v) => v.variant !== last) : all;
    return pool[Math.floor(this.rng() * pool.length)]!;
  }

  /** Preloads and decodes every clip (after the unlock, in the background; a failure only logs). */
  async preload(): Promise<void> {
    for (const v of VARIANTS) await this.buffer(v);
  }

  private buffer(v: Variant): Promise<AudioBuffer | null> {
    const src = srcFor(v, this.canOgg);
    if (!src) return Promise.resolve(null);
    let p = this.buffers.get(src);
    if (!p) {
      p = (async () => {
        const ctx = this.mix.ctx;
        if (!ctx) return null;
        try {
          const res = await fetch(src);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.lengths.set(src, buf.duration);
          return buf;
        } catch {
          if (!this.failed.has(src)) {
            this.failed.add(src);
            this.mix.note('decode-failed', { clip: src });
          }
          return null;
        }
      })();
      this.buffers.set(src, p);
    }
    return p;
  }

  /** A moment happened. Plays (or queues) its cue; the log records it either way. */
  say(moment: string, reason: string, nowMs = performance.now()): void {
    const gap = (COOLDOWN_S[moment] ?? 0) * 1000;
    const prev = this.lastAt.get(moment);
    if (prev !== undefined && nowMs - prev < gap) {
      this.mix.note('cue-skipped', { moment, reason: 'cooldown' });
      return;
    }
    if (this.speaking && nowMs < this.speaking.until) {
      if (!this.pending || (PRIORITY[moment] ?? 0) > (PRIORITY[this.pending.moment] ?? 0)) this.pending = { moment, reason, at: nowMs };
      return;
    }
    this.play(moment, reason, nowMs);
  }

  private play(moment: string, reason: string, nowMs: number): void {
    const v = this.pick(moment);
    if (!v) return;
    this.last.set(moment, v.variant);
    this.lastAt.set(moment, nowMs);
    const live = this.mix.live;
    // The clip's length, once decoded, sets how long the announcer is busy; until then (or blocked) a cue is ~3 s.
    const known = this.lengths.get(srcFor(v, this.canOgg) ?? '') ?? 3;
    this.speaking = { moment, until: nowMs + known * 1000 + 250 };
    // The cue is logged at its trigger, with the clip it names, whether or not it can be heard: blocked audio changes nothing.
    this.mix.note('cue', {
      moment,
      variant: v.variant,
      clip: `${moment}-${v.variant}`,
      trigger: v.trigger,
      reason,
      caption: v.caption,
      played: live,
      seconds: Number(known.toFixed(2)),
      mix: { state: this.mix.state, muted: this.mix.isMuted, ducked: true },
    });
    this.showCaption(moment, v, known);
    const duck = this.mix.duck();
    let seconds = known;
    const done = () => {
      this.mix.unduck(duck);
      if (this.speaking && this.speaking.moment === moment) this.speaking = null;
      const next = this.pending;
      this.pending = null;
      if (next && performance.now() - next.at < STALE_MS) this.say(next.moment, next.reason);
    };
    const ctx = this.mix.ctx;
    const bus = this.mix.bus('voice');
    if (live && ctx && bus) {
      void this.buffer(v).then((buf) => {
        if (buf) {
          seconds = buf.duration;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(bus);
          src.start();
        }
        window.setTimeout(done, seconds * 1000 + 250);
      });
    } else window.setTimeout(done, seconds * 1000 + 250);
  }

  private showCaption(moment: string, v: Variant, seconds: number): void {
    this.captions.push({ moment, variant: v.variant, text: v.caption, at: Math.round(performance.now()) });
    if (!this.host) return;
    if (!this.captionEl) {
      const el = document.createElement('div');
      el.id = 'jj-caption';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:6;max-width:min(80vw,900px);text-align:center;pointer-events:none';
      this.host.append(el);
      this.captionEl = el;
    }
    this.captionEl.replaceChildren(caption(v.caption, { tone: 'saffron', id: `${moment}-${v.variant}` }));
    this.captionEl.dataset.moment = moment;
    window.clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => this.captionEl?.replaceChildren(), seconds * 1000 + CAPTION_TAIL_MS);
  }
}
