import { createBackend, type BackendKind } from '../render/backend';
import { World } from '../render/world';
import type { MapJson } from '../render/map/map';
import type { HighlightRecorder, Clip } from './recorder';
import { unpackFrame } from './frame';
import { esc } from '../round/format';
import { applySeatPattern, motionMode, paintKit } from '../../../shared/ui';
import './reel.css';
import { mountNameplates } from '../identity/nameplates';

const titles = { detach: 'Parts flying', wreck: 'Wrecked!', air: 'Big air', finish: 'Across the line', 'close-finish': 'Photo finish' };

/** Receives only presentation footage. There is deliberately no SimClient or input callback here. */
export class ReelPlayer {
  private generation = 0;
  private raf = 0;
  private world: World | null = null;
  private host: HTMLElement | null = null;
  private state = 'idle';
  private tick = 0;
  private clip = 0;
  private frames = 0;
  private lastFrame: { a: number; b: number } | null = null;
  private label = '';
  private clips: Clip[] = [];
  private paused = false;
  private requestedSeek: {clip:number;tick:number} | null = null;
  private draw: ((now:number)=>void) | null = null;

  constructor(private backend: BackendKind, private onLayout: () => void) {}

  async play(host: HTMLElement, recorder: HighlightRecorder): Promise<void> {
    this.stop();
    const clips = recorder.select();
    if (!clips.length) return;
    this.clips = clips; this.paused = false;
    const generation = ++this.generation;
    this.host = host; this.state = 'loading'; this.frames = 0;
    host.classList.add('has-replay');
    host.insertAdjacentHTML('beforeend', '<div class="jj-reel"><canvas aria-label="Recorded round highlights"></canvas><div class="reel-caption"><span class="tag">Round highlights</span><b data-highlight></b><span data-identity></span></div></div><button class="btn brush reel-hide" type="button">Hide replay</button>');
    const layer = host.querySelector<HTMLElement>('.jj-reel')!;
    const canvas = layer.querySelector('canvas')!;
    host.querySelector('.reel-hide')!.addEventListener('click', () => this.hide());
    paintKit(host); this.onLayout();
    let world: World | null = null;
    try {
      const backend = await createBackend(this.backend, canvas);
      world = new World(backend, canvas);
      const baseline = recorder.baseline<{ map: MapJson }>();
      world.loadMap(baseline.map);
      await world.loadVehicles();
      const vehicles = new Set(clips.flatMap(c => c.frames.flatMap(f => {
        const frame = unpackFrame(f.bytes); return [...frame.flags].map(flag => flag >>> 16);
      })));
      await Promise.all([...vehicles].map(v => world!.vehicles!.ensure(v)));
      if (generation !== this.generation || !host.isConnected) { world.dispose(); return; }
      this.world = world; this.state = 'playing';
      mountNameplates(layer, world);
      const identities = new Map(recorder.actors().map(a=>[a.car,a]));
      for (const c of clips) for (const e of c.events) for (const a of e.actors) identities.set(a.car,a);
      const palette = world.vehicles!.paintOf;
      world.vehicles!.paintOf = car => {
        const a = identities.get(car); return a ? `#${a.rgb.map(c=>c.toString(16).padStart(2,'0')).join('')}` : palette(car);
      };
      world.vehicles!.numberOf = car => identities.get(car)?.number ?? car;
      world.vehicles!.nameOf = car => identities.get(car)?.name || 'Player';
      let started = performance.now(); let index = 0;
      this.lastFrame = null;
      const draw = (now: number) => {
        if (generation !== this.generation) return;
        if (this.requestedSeek) {
          index = this.requestedSeek.clip;
          this.tick = this.requestedSeek.tick;
          started = now-(this.tick-clips[index]!.frames[0]!.tick)/recorder.profile.tickHz*1000;
          this.requestedSeek = null; this.lastFrame = null;
        }
        const c = clips[index]!;
        if (this.paused) started = now-(this.tick-c.frames[0]!.tick)/recorder.profile.tickHz*1000;
        const duration = (c.frames.at(-1)!.tick - c.frames[0]!.tick) / recorder.profile.tickHz;
        if (!this.paused && (now - started) / 1000 > duration) {
          index++;
          if (index === clips.length) { this.state = 'ended'; this.raf = 0; return; }
          started = now; this.lastFrame = null;
        }
        const clip = clips[index]!;
        const tick = Math.min(clip.frames.at(-1)!.tick, clip.frames[0]!.tick + (now-started) * recorder.profile.tickHz / 1000);
        this.drawFrame(world!, clip, tick);
        const event = clip.events.filter(e=>e.tick<=tick).at(-1) ?? clip.events[0]!;
        const actor = event.actors[0]!;
        const key = JSON.stringify(event);
        if (key !== this.label) {
          this.label = key;
          layer.querySelector('[data-highlight]')!.textContent = titles[event.kind];
          layer.querySelector('[data-identity]')!.innerHTML = event.actors.map(a => `<span class="reel-who"><span class="badge" style="--b:rgb(${a.rgb.join(',')});--on:var(--c-ink)">#${a.number}</span>${esc(a.name || 'Player')}</span>`).join('');
          for (const badge of layer.querySelectorAll<HTMLElement>('[data-identity] .badge')) applySeatPattern(badge, Number(badge.textContent?.replace('#', '')));
        }
        const reduced = motionMode() === 'reduced';
        world!.replayCamera = {car:actor.car,orbit:recorder.profile.orbitStartDegrees + (reduced ? 0 : (now-started)/1000 * recorder.profile.orbitDegreesPerSecond)};
        world!.frame(); this.frames++; this.tick = tick; this.clip = index;
        this.raf = requestAnimationFrame(draw);
      };
      this.draw = draw;
      this.raf = requestAnimationFrame(draw);
    } catch {
      world?.dispose();
      if (generation === this.generation) { this.state = 'unavailable'; this.removeLayer(); }
    }
  }

  private drawFrame(world: World, clip: Clip, tick: number): void {
    let i = clip.frames.findIndex(f => f.tick >= tick);
    if (i < 0) i = clip.frames.length - 1;
    const a = Math.max(0,i-1); const b = i;
    if (this.lastFrame?.a !== a || this.lastFrame?.b !== b) {
      world.interp.push(unpackFrame(clip.frames[a]!.bytes));
      if (b !== a) world.interp.push(unpackFrame(clip.frames[b]!.bytes));
      this.lastFrame = {a,b};
    }
    world.interp.fixedTick = tick;
  }

  hide(): void {
    this.stop(); this.state = 'hidden';
    const results = document.querySelector<HTMLElement>('[data-screen=results]');
    results?.classList.add('replay-hidden'); this.onLayout();
  }

  /** R90: exact presentation setup/stepping for captures. These controls have no authoritative input path. */
  pause(on:boolean): void {
    this.paused = on;
    if (!on && this.clips[this.clip]) this.requestedSeek = {clip:this.clip,tick:this.tick};
  }

  seek(seconds:number, tickHz:number): void {
    if (!Number.isFinite(seconds) || !this.clips.length) return;
    let remaining = Math.max(0,seconds);
    let index = 0;
    for (;index<this.clips.length-1;index++) {
      const c=this.clips[index]!; const duration=(c.frames.at(-1)!.tick-c.frames[0]!.tick)/tickHz;
      if (remaining<=duration) break;
      remaining-=duration;
    }
    const c=this.clips[index]!;
    this.requestedSeek={clip:index,tick:Math.min(c.frames.at(-1)!.tick,c.frames[0]!.tick+remaining*tickHz)};
    if (this.draw && !this.raf) { this.state='playing'; this.raf=requestAnimationFrame(this.draw); }
  }

  private removeLayer(): void {
    this.host?.querySelector('.jj-reel')?.remove(); this.host?.querySelector('.reel-hide')?.remove();
    this.host?.classList.remove('has-replay'); this.host = null;
    this.onLayout();
  }

  stop(): void {
    this.generation++; cancelAnimationFrame(this.raf); this.raf = 0;
    this.world?.dispose(); this.world = null; this.lastFrame = null; this.label = '';
    this.draw = null; this.clips = []; this.requestedSeek = null; this.paused = false;
    this.removeLayer(); this.state = 'idle';
  }

  inspect() { return {state:this.state, tick:this.tick, clip:this.clip, drawnFrames:this.frames, paused:this.paused,
    cars:this.world?.stats.cars ?? 0, label:this.label, separateWorld:true}; }
}
