// Mounting the host's audio (P1-A03/A05/A07): `mountAudio(client)` taps the worker client's three feeds without taking them
// over (each handler is wrapped: the page's own runs first, audio second, and an error in audio never reaches it), installs
// the gesture unlock and the mute toggle, and puts the introspection surface on `window.__jjAudio` (R90): the trigger log,
// the engines, the mix state, and feeds for scripted rounds.
import type { RoomView, SimClient, SimEventJson } from '../worker/client';
import { Announcer, MOMENTS, TRIGGERS, VARIANTS } from './announcer';
import { AudioDirector } from './director';
import { benchEngines, PROFILES, type CarFact } from './engine';
import { Mix } from './mix';
import { Music } from './music';
import { Sfx } from './sfx';
import { renderSfx, SFX_KINDS, type SfxKind } from './sfx/synth';

export interface AudioHandle {
  mix: Mix;
  director: AudioDirector;
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.warn('jj audio:', e);
  }
}

export function mountAudio(client: SimClient, doc: Document = document): AudioHandle {
  const mix = new Mix(new URLSearchParams(location.search).get('audio') === 'blocked');
  const announcer = new Announcer(mix);
  const music = new Music(mix);
  const sfx = new Sfx(mix);
  const director = new AudioDirector(mix, announcer, music, sfx);
  mix.installGestures();
  void mix.unlock().then(() => mix.whenRunning(() => void announcer.preload()));
  mix.whenRunning(() => void announcer.preload());

  const prevSnap = client.onSnapshot;
  client.onSnapshot = (s) => {
    safe(() => director.onSnapshot(s.view));
    prevSnap(s);
  };
  const prevEvents = client.onEvents;
  client.onEvents = (events) => {
    prevEvents(events);
    safe(() => director.onEvents(events));
  };
  const prevRoom = client.onRoom;
  client.onRoom = (room) => {
    prevRoom(room);
    safe(() => director.onRoom(room));
  };
  if (client.room) safe(() => director.onRoom(client.room!));

  mountMuteButton(mix, doc);

  const surface = {
    /** Every trigger so far: cues, music, effects, engines, mute and mix state changes. */
    log: (kind?: string) => (kind ? mix.log.filter((l) => l.kind === kind) : mix.log.slice()),
    clear: () => (mix.log.length = 0),
    state: () => ({ mix: mix.state, muted: mix.isMuted, ducked: mix.ducked, music: music.current, sfxPeakVoices: sfx.peakVoices, sfxDropped: sfx.dropped, engineBudget: director.engines.budget, engineCostMs: +director.engines.costMs.toFixed(3), engineBuildMs: +director.engines.buildMs.toFixed(2), decodeFailures: [...announcer.failed] }),
    engines: () => director.engines.engines(),
    captions: () => announcer.captions.slice(),
    captionShown: () => doc.querySelector('#jj-caption')?.textContent ?? '',
    variants: () => VARIANTS.map((v) => ({ moment: v.moment, variant: v.variant, trigger: v.trigger, caption: v.caption, ogg: Boolean(v.ogg), m4a: Boolean(v.m4a) })),
    moments: () => MOMENTS.map((m) => ({ moment: m, trigger: TRIGGERS[m], variants: VARIANTS.filter((v) => v.moment === m).length })),
    profiles: () => Object.fromEntries(Object.entries(PROFILES).map(([id, p]) => [id, { boost: Boolean(p.boost) }])),
    unlock: () => mix.unlock(),
    setMuted: (on: boolean) => mix.setMuted(on),
    /** Scripted rounds: the same handlers the worker's feeds call. `at` is a virtual clock (ms) for spacing. */
    feedEvents: (events: SimEventJson[], at?: number) => director.onEvents(events, at),
    feedRoom: (room: RoomView, at?: number) => director.onRoom(room, at),
    say: (moment: string, at?: number) => announcer.say(moment, 'test', at),
    /** Scripted facts: cars as a snapshot would describe them (and each one's vertical speed), through the same paths. */
    feedFacts: (facts: CarFact[], vys: number[] = []) => {
      facts.forEach((f, i) => director.carFacts(f, vys[i] ?? 0));
      director.engines.update(facts);
    },
    useProfile: (id: string) => (director.engines.profileOf = () => id),
    gains: () => Object.fromEntries((['music', 'voice', 'sfx', 'engine'] as const).map((b) => [b, +(mix.bus(b)?.gain.value ?? 0).toFixed(3)])),
    pick: (moment: string) => announcer.pick(moment)?.variant ?? null,
    sfx: (kind: SfxKind, intensity = 0.7) => sfx.trigger(kind, intensity, 'test', {}, `test:${kind}`, performance.now() + Math.random()),
    /** Receipts: an effect rendered offline (peak, RMS), and the engines' CPU cost offline. */
    renderSfx: (kind: SfxKind, intensity = 0.7) => renderSfx(kind, intensity),
    sfxKinds: () => [...SFX_KINDS],
    benchEngines,
    /** Decodes every shipped announcer clip in this browser (the A03 decode check): failures by file. */
    async decodeAll(): Promise<{ total: number; failed: string[]; canOggOpus: boolean }> {
      await mix.unlock();
      const ctx = mix.ctx ?? new OfflineAudioContext(1, 1, 44100);
      const failed: string[] = [];
      let total = 0;
      for (const v of VARIANTS) {
        for (const src of [v.ogg, v.m4a].filter((x): x is string => Boolean(x))) {
          total++;
          try {
            await ctx.decodeAudioData(await (await fetch(src)).arrayBuffer());
          } catch {
            failed.push(src);
          }
        }
      }
      return { total, failed, canOggOpus: document.createElement('audio').canPlayType('audio/ogg; codecs=opus') !== '' };
    },
  };
  (window as unknown as { __jjAudio: unknown }).__jjAudio = surface;
  return { mix, director };
}

function mountMuteButton(mix: Mix, doc: Document): void {
  const b = doc.createElement('button');
  b.id = 'jj-mute';
  b.type = 'button';
  b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:7;width:36px;height:36px;border-radius:50%;border:2px solid #2a2a2a;background:#fff8e6;font-size:18px;line-height:1;cursor:pointer;opacity:.8';
  const paint = () => {
    b.textContent = mix.isMuted ? '🔇' : '🔊';
    b.setAttribute('aria-label', mix.isMuted ? 'Unmute sound (M)' : 'Mute sound (M)');
    b.setAttribute('aria-pressed', String(mix.isMuted));
  };
  b.addEventListener('click', () => {
    mix.setMuted(!mix.isMuted);
    paint();
  });
  paint();
  doc.addEventListener('keydown', (e) => e.key === 'm' && queueMicrotask(paint));
  doc.body.append(b);
}
