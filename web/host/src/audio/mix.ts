// The host's one mix (P1-A03/A05/A07): a single AudioContext behind a gesture unlock, four buses (music, announcer voice,
// effects, engines) into one master, a mute toggle, and the ducking under the announcer. Audio is presentation: nothing
// here ever throws into the round. A browser that refuses an AudioContext, or one that stays `suspended` because there was
// no gesture, leaves `ctx` null or suspended; every `play` then logs the trigger with `played: false` and returns, and
// the round carries on unchanged (a mute and a block are the same silence).
//
// The trigger log (R90) is the introspection surface: every cue, music change, effect and engine on/off is a log entry,
// whether or not it could be heard, so a scripted round can be checked with audio blocked.

export type BusName = 'music' | 'voice' | 'sfx' | 'engine';

export interface LogEntry {
  /** Milliseconds since the mix was created (performance.now based; the log is for order and spacing, not for the sim). */
  at: number;
  kind: string;
  [k: string]: unknown;
}

export type MixState = 'locked' | 'running' | 'blocked' | 'unsupported' | 'failed';

/** Ducking: how far the music and engines fall while the announcer talks, and the ramps. */
export const DUCK = { music: 0.3, engine: 0.55, sfx: 0.7, attackS: 0.12, releaseS: 0.5 };
const BASE = { music: 0.55, voice: 1, sfx: 0.9, engine: 0.7 } as const;
const MUTE_KEY = 'jj-host-audio-muted';

export class Mix {
  ctx: AudioContext | null = null;
  state: MixState = 'locked';
  readonly log: LogEntry[] = [];
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private buses = new Map<BusName, GainNode>();
  private duckers = new Set<number>();
  private nextDuck = 1;
  private muted = false;
  private t0 = performance.now();
  private waiters: Array<() => void> = [];

  /** `deny`: pretend the browser refused audio (the `?audio=blocked` test hook): no context is made, the state is `blocked`. */
  constructor(private deny = false) {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage can be blocked: unmuted */
    }
  }

  /** Records a trigger. `played` says whether a sound could actually start (context running and not muted). */
  note(kind: string, data: Record<string, unknown> = {}): LogEntry {
    const entry: LogEntry = { at: Math.round(performance.now() - this.t0), kind, ...data };
    this.log.push(entry);
    return entry;
  }

  /** True when a sound started now would be heard. */
  get live(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && !this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(on: boolean): void {
    this.muted = on;
    try {
      localStorage.setItem(MUTE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.02);
    this.note('mute', { muted: on });
  }

  private recorder: { rec: MediaRecorder; chunks: Blob[] } | null = null;

  /** Starts recording the master output (after the limiter: what the host plays) for the listen-through clips. */
  startRecording(): boolean {
    if (!this.ctx || !this.limiter || this.recorder) return false;
    const dest = this.ctx.createMediaStreamDestination();
    this.limiter.connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    this.recorder = { rec, chunks };
    return true;
  }

  /** Stops the recording; resolves with the webm/opus bytes. */
  stopRecording(): Promise<Uint8Array> {
    const r = this.recorder;
    this.recorder = null;
    if (!r) return Promise.resolve(new Uint8Array());
    return new Promise((resolve) => {
      r.rec.onstop = async () => resolve(new Uint8Array(await new Blob(r.chunks).arrayBuffer()));
      r.rec.stop();
    });
  }

  /** The bus a sound plays into (null until a context exists). */
  bus(name: BusName): GainNode | null {
    return this.buses.get(name) ?? null;
  }

  /**
   * Creates the context (first call) and tries to resume it. Call it from a user gesture; calling it from anywhere else
   * is safe (the browser keeps the context suspended and the state says `blocked`). Resolves with the state.
   */
  async unlock(): Promise<MixState> {
    if (this.deny) {
      if (this.state !== 'blocked') {
        this.state = 'blocked';
        this.note('state', { state: this.state });
      }
      return this.state;
    }
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          this.state = 'unsupported';
          this.note('state', { state: this.state });
          return this.state;
        }
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        const limiter = this.ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.2;
        this.limiter = limiter;
        this.master.connect(limiter).connect(this.ctx.destination);
        for (const name of ['music', 'voice', 'sfx', 'engine'] as const) {
          const g = this.ctx.createGain();
          g.gain.value = BASE[name];
          g.connect(this.master);
          this.buses.set(name, g);
        }
        this.ctx.addEventListener('statechange', () => this.sync());
      }
      if (this.ctx.state !== 'running') await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
    } catch {
      this.state = 'failed';
      this.note('state', { state: this.state });
      return this.state;
    }
    this.sync();
    return this.state;
  }

  private sync(): void {
    const next: MixState = this.ctx?.state === 'running' ? 'running' : this.ctx ? 'blocked' : this.state;
    if (next !== this.state) {
      this.state = next;
      this.note('state', { state: next });
      if (next === 'running') this.waiters.splice(0).forEach((w) => w());
    }
  }

  /** Runs `fn` once the context is running (immediately if it is). Never rejects. */
  whenRunning(fn: () => void): void {
    if (this.ctx?.state === 'running') fn();
    else this.waiters.push(fn);
  }

  /** Installs the gesture listeners that unlock audio, and the M key that toggles the mute. */
  installGestures(target: Window = window): void {
    const go = () => {
      void this.unlock();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'click'] as const) target.addEventListener(ev, go, { passive: true });
    target.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'm' && !(e as KeyboardEvent).repeat && !(e.target instanceof HTMLInputElement)) this.setMuted(!this.muted);
    });
  }

  /** Starts a duck (the announcer is talking); returns the handle to end it. Music and engines fall, then recover. */
  duck(): number {
    const id = this.nextDuck++;
    this.duckers.add(id);
    this.applyDuck();
    return id;
  }

  unduck(id: number): void {
    this.duckers.delete(id);
    this.applyDuck();
  }

  get ducked(): boolean {
    return this.duckers.size > 0;
  }

  private applyDuck(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const down = this.duckers.size > 0;
    const set = (bus: BusName, level: number) => {
      const g = this.buses.get(bus);
      if (g) g.gain.setTargetAtTime(BASE[bus] * (down ? level : 1), ctx.currentTime, down ? DUCK.attackS / 3 : DUCK.releaseS / 3);
    };
    set('music', DUCK.music);
    set('engine', DUCK.engine);
    set('sfx', DUCK.sfx);
    this.note('duck', { down, bus: { music: down ? DUCK.music : 1, engine: down ? DUCK.engine : 1, sfx: down ? DUCK.sfx : 1 } });
  }
}
