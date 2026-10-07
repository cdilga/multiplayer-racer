// Phone UI sounds (P1-A07): a soft tap on a button press and the Identify ping. Procedural Web Audio (R89), created on the first
// touch (autoplay policy), silent when the phone's sound is muted here, and never in the way: every call is wrapped, a blocked or
// failed context just means no sound. The controller never downloads the host's audio package; this is a few oscillators.
//
// The mute is the controller's own (`jj-phone-muted` in localStorage, toggled by `window.__jjSound.setMuted`); a phone on
// silent still plays Web Audio, so the setting is the player's say. `prefers-reduced-motion` lowers the tap (no flash or
// pulse is involved here, but the settings travel together).
export interface PhoneSound {
  tap(): void;
  ping(): void;
  /** Introspection: what was triggered (R90). */
  log: Array<{ at: number; sound: string; played: boolean }>;
  setMuted(on: boolean): void;
  muted(): boolean;
}

const KEY = 'jj-phone-muted';

export function mountSound(doc: Document = document): PhoneSound {
  let ctx: AudioContext | null = null;
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === '1';
  } catch {
    /* blocked storage: unmuted */
  }
  const quiet = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const log: PhoneSound['log'] = [];
  const t0 = performance.now();

  const ensure = (): AudioContext | null => {
    try {
      if (!ctx) {
        const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor({ latencyHint: 'interactive' });
      }
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return ctx;
    } catch {
      return null;
    }
  };

  const blip = (name: string, notes: Array<[hz: number, at: number, decay: number, peak: number]>) => {
    const c = muted ? null : ensure();
    const played = Boolean(c && c.state === 'running');
    log.push({ at: Math.round(performance.now() - t0), sound: name, played });
    if (!c || !played) return;
    try {
      for (const [hz, at, decay, peak] of notes) {
        const t = c.currentTime + at;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'triangle';
        o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak * (quiet ? 0.6 : 1), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.004 + decay);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + decay + 0.05);
      }
    } catch {
      /* no sound, no harm */
    }
  };

  const sound: PhoneSound = {
    log,
    tap: () => blip('tap', [[760, 0, 0.05, 0.12]]),
    ping: () => blip('identify-ping', [[1320, 0, 0.45, 0.3], [1320, 0.14, 0.4, 0.22]]),
    setMuted(on) {
      muted = on;
      try {
        localStorage.setItem(KEY, on ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    muted: () => muted,
  };
  // A press on any button taps; the first touch also unlocks the context.
  doc.addEventListener(
    'pointerdown',
    (e) => {
      ensure();
      if ((e.target as Element | null)?.closest?.('button')) sound.tap();
    },
    { passive: true },
  );
  (window as unknown as { __jjSound: PhoneSound }).__jjSound = sound;
  return sound;
}
