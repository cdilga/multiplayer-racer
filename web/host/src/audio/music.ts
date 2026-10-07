// Music (P1-A03): A02's loops (assets/audio/music/*.ogg, instrumental, loop crossfade baked in). The lobby loop plays in the
// lobby, one of the race loops while a round runs, one of the results loops in the intermission; a change fades the old loop
// out and the new one in. One track at a time. The pick among a family rotates (no immediate repeat).
import type { Mix } from './mix';

const urls = import.meta.glob('../../../../assets/audio/music/*.ogg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export type MusicCue = 'lobby' | 'race' | 'results' | 'none';
const FILES: Record<Exclude<MusicCue, 'none'>, string[]> = { lobby: ['lobby'], race: ['race-1', 'race-2', 'race-3', 'race-4'], results: ['results-1', 'results-2', 'results-3'] };
const FADE_S = 1.5;

export class Music {
  current: { cue: MusicCue; clip: string } = { cue: 'none', clip: '' };
  private playing: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private next = new Map<MusicCue, number>();
  private epoch = 0;

  constructor(private mix: Mix) {}

  private clipFor(cue: Exclude<MusicCue, 'none'>): string {
    const list = FILES[cue].filter((f) => Object.keys(urls).some((p) => p.endsWith(`/${f}.ogg`)));
    const i = this.next.get(cue) ?? 0;
    this.next.set(cue, i + 1);
    return list[i % Math.max(1, list.length)] ?? FILES[cue][0]!;
  }

  private load(clip: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(clip);
    if (!p) {
      p = (async () => {
        const url = Object.entries(urls).find(([path]) => path.endsWith(`/${clip}.ogg`))?.[1];
        const ctx = this.mix.ctx;
        if (!url || !ctx) return null;
        try {
          return await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
        } catch {
          this.mix.note('decode-failed', { clip });
          return null;
        }
      })();
      this.buffers.set(clip, p);
    }
    return p;
  }

  /** Switches the music (a no-op if that cue is already playing). The log records the change even when it can't be heard. */
  set(cue: MusicCue, reason: string): void {
    if (cue === this.current.cue) return;
    const clip = cue === 'none' ? '' : this.clipFor(cue);
    this.current = { cue, clip };
    this.mix.note('music', { cue, clip, reason, played: this.mix.live, mix: { state: this.mix.state, muted: this.mix.isMuted } });
    const epoch = ++this.epoch;
    const ctx = this.mix.ctx;
    const bus = this.mix.bus('music');
    const old = this.playing;
    this.playing = null;
    if (old && ctx) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, FADE_S / 3);
      window.setTimeout(() => {
        try {
          old.src.stop();
        } catch {
          /* already stopped */
        }
        old.gain.disconnect();
      }, FADE_S * 1500);
    }
    if (cue === 'none' || !ctx || !bus) return;
    this.mix.whenRunning(() => {
      void this.load(clip).then((buf) => {
        if (!buf || epoch !== this.epoch || !this.mix.ctx) return;
        const g = this.mix.ctx.createGain();
        g.gain.value = 0;
        g.connect(bus);
        const src = this.mix.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(g);
        src.start();
        g.gain.setTargetAtTime(1, this.mix.ctx.currentTime, FADE_S / 3);
        this.playing = { gain: g, src };
      });
    });
  }
}
