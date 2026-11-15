// Gated start (R127): a big callout over a car for how its launch went: "PERFECT START!", "LAUNCH!" or "EARLY! NO LAUNCH".
// Landings (R129, P1-FL07) use it too: "CLEAN LANDING! BOOST", "BIG AIR! BOOST", "HARD LANDING!", "STACKED IT!"; and
// takedowns (R134, P1-FL19): "TAKEDOWN! BOOST" over the car that did it.
// Same device as the Identify number (a billboard drawn over the world, so every tile that can see the car shows it).
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, type Camera, type Scene } from 'three';
import type { Sampled } from './interp';
import { LAUNCH_SHOWN_MS, LAUNCH_TEXT, type LaunchOutcome } from '../../../shared/src/launch';
import { LANDING_TEXT, type LandingCallout } from '../../../shared/src/landing';
import { TAKEDOWN_TEXT, type TakedownCallout } from '../../../shared/src/takedown';

/** What a callout says: a start (R127), a landing (R129) or a takedown (R134). */
export type Callout = LaunchOutcome | LandingCallout | TakedownCallout;
const TEXT: Record<Callout, string> = { ...LAUNCH_TEXT, ...LANDING_TEXT, ...TAKEDOWN_TEXT };

interface Live {
  sprite: Sprite;
  until: number;
  at: number;
  outcome: Callout;
}

type Rect = [number, number, number, number];

/** What the arena Overview's banner lane needs to know each frame (CSS px): the gameplay frame, every car's screen box
 *  by car id, the rects its name labels take, and a car's number and paint for the banner's badge. */
export interface BannerScene {
  root: HTMLElement;
  frame: { left: number; top: number; right: number; bottom: number };
  cars: Array<{ car: number; box: Rect }>;
  labels: () => Rect[];
  badge: (car: number) => { number: number; paint: string };
}

/** The Overview banner's lane, as data (R90): the car it is for, what it says and where it sits (CSS px). */
export interface BannerShown {
  car: number;
  outcome: Callout;
  rect: Rect;
}

/** Billboard size in metres at REF m from the camera (a car is ~4.4 m long), and its height above the car's origin (above the Identify number). */
const W = 7.2;
const H = 1.8;
const LIFT = 4.4;
/** Each tile's camera sees it at the same on-screen size between NEAR and FAR metres; closer it shrinks (a car passing the
 *  camera never fills the tile), farther it shrinks with distance. */
const REF = 12;
const NEAR = 9;
const FAR = 40;

const FILL: Record<Callout, { fill: string; ink: string }> = {
  Early: { fill: '#B3261E', ink: '#FFFFFF' },
  Perfect: { fill: '#FFB400', ink: '#15203A' },
  Launch: { fill: '#00C2B8', ink: '#15203A' },
  Clean: { fill: '#00C2B8', ink: '#15203A' },
  BigAir: { fill: '#FFB400', ink: '#15203A' },
  Bad: { fill: '#FF7A1A', ink: '#15203A' },
  Crash: { fill: '#B3261E', ink: '#FFFFFF' },
  Takedown: { fill: '#E5322D', ink: '#FFFFFF' },
};

export class LaunchCallouts {
  private readonly live = new Map<number, Live>();
  /** Every callout put up (car, outcome), oldest first: introspection for tests (R90). */
  readonly shown: Array<{ car: number; outcome: Callout }> = [];

  /** The arena Overview draws its callouts as one flat banner beside the car instead of billboards (see `banner`). */
  flat = false;
  private el: HTMLElement | null = null;
  private elKey = '';
  private elSize: [number, number] = [0, 0];
  private spot = -1;
  private bannerShown: BannerShown | null = null;

  constructor(private readonly scene: Scene) {}

  pop(car: number, outcome: Callout, ms = LAUNCH_SHOWN_MS): void {
    this.drop(car);
    this.shown.push({ car, outcome });
    if (this.shown.length > 500) this.shown.shift();
    const text = TEXT[outcome];
    const { fill, ink } = FILL[outcome];
    const c = document.createElement('canvas');
    c.width = 720;
    c.height = 180;
    const g = c.getContext('2d')!;
    g.fillStyle = '#15203A';
    g.beginPath();
    g.roundRect(0, 0, c.width, c.height, 24);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(10, 10, c.width - 20, c.height - 20, 16);
    g.fill();
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 120;
    g.font = `italic 900 ${size}px "Barlow Condensed", system-ui, sans-serif`;
    while (g.measureText(text).width > c.width - 60 && size > 24) g.font = `italic 900 ${(size -= 4)}px "Barlow Condensed", system-ui, sans-serif`;
    g.fillText(text, c.width / 2, c.height / 2 + 6);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(W, H, 1);
    sprite.renderOrder = 11;
    sprite.visible = false;
    this.scene.add(sprite);
    const now = performance.now();
    this.live.set(car, { sprite, until: now + ms, at: now, outcome });
  }

  /** Each frame: follow the cars, retire finished callouts. */
  update(s: Sampled): void {
    const now = performance.now();
    for (const [car, m] of this.live) {
      if (now > m.until) {
        this.drop(car);
        continue;
      }
      if (car >= s.cars) {
        m.sprite.visible = false;
        continue;
      }
      m.sprite.position.set(s.pos[car * 3]!, s.pos[car * 3 + 1]! + LIFT, s.pos[car * 3 + 2]!);
      m.sprite.visible = !this.flat;
    }
  }

  /** Before each tile's draw: sizes every callout for that tile's camera. */
  fit(camera: Camera): void {
    for (const m of this.live.values()) {
      if (!m.sprite.visible) continue;
      const d = camera.position.distanceTo(m.sprite.position);
      const k = Math.min(FAR, Math.max(NEAR, d)) / REF;
      // A callout nearer than NEAR shrinks in step with its distance so it stays a small part of the tile.
      const near = d < NEAR ? (Math.max(d, 1) / NEAR) ** 2 : 1;
      m.sprite.scale.set(W * k * near, H * k * near, 1);
    }
  }

  /** Cars showing a callout now. */
  active(): number[] {
    if (this.flat) return this.bannerShown ? [this.bannerShown.car] : [];
    return [...this.live].filter(([, m]) => m.sprite.visible).map(([car]) => car);
  }

  /** The Overview's banner now, or null. */
  banner(): BannerShown | null {
    return this.bannerShown;
  }

  /** The arena Overview (council review 2026-11-15): billboards sized for a chase camera were ~350 x 70 px over the
   *  cars and their labels from the overview's height, and stacked when two cars scored at once. There the callouts are
   *  one flat banner, one at a time (the newest live one; an older one still live comes back when it ends), beside its
   *  own car where that covers no car and no label, else in the first free corner of the gameplay frame. Pass null to
   *  take it down (the grid draws billboards). */
  place(o: BannerScene | null): void {
    const now = performance.now();
    let pick: [number, Live, Rect] | null = null;
    if (o) {
      for (const [car, m] of this.live) {
        const c = m.until > now ? o.cars.find((k) => k.car === car) : undefined;
        if (c && (!pick || m.at > pick[1].at)) pick = [car, m, c.box];
      }
    }
    if (!o || !pick) {
      if (this.el && !this.el.hidden) this.el.hidden = true;
      this.bannerShown = null;
      this.spot = -1;
      return;
    }
    const [car, m, box] = pick;
    if (!this.el || this.el.parentElement !== o.root) {
      this.el?.remove();
      this.el = document.createElement('div');
      this.el.className = 'jj-callout-banner';
      this.el.setAttribute('aria-hidden', 'true');
      Object.assign(this.el.style, { position: 'absolute', left: '0', top: '0', zIndex: '2', pointerEvents: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '.35em', padding: '.12em .5em .16em', borderRadius: '.35em', border: '.12em solid #15203A', font: 'italic 900 20px/1 "Barlow Condensed", system-ui, sans-serif', letterSpacing: '.02em', boxShadow: '0 .12em 0 #15203A' });
      o.root.append(this.el);
      this.elKey = '';
    }
    const el = this.el;
    // Readable from the couch without covering the field: ~4 % of the gameplay frame's height, never under 20 px.
    const fh = o.frame.bottom - o.frame.top, font = Math.max(20, Math.round(fh * 0.04));
    const { number, paint } = o.badge(car);
    const key = `${car}:${m.at}:${font}:${number}:${paint}`;
    if (key !== this.elKey) {
      const isNew = !this.elKey.startsWith(`${car}:${m.at}:`);
      this.elKey = key;
      const { fill, ink } = FILL[m.outcome];
      el.style.fontSize = `${font}px`;
      el.style.background = fill;
      el.style.color = ink;
      el.innerHTML = `<span style="background:${paint};color:#fff;padding:0 .25em;border-radius:.2em;text-shadow:0 1px 0 #15203A">#${number}</span><span></span>`;
      el.lastElementChild!.textContent = TEXT[m.outcome];
      el.hidden = false;
      this.elSize = [el.offsetWidth, el.offsetHeight];
      if (isNew) {
        this.spot = -1;
        el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      }
    }
    el.hidden = false;
    const [w, h] = this.elSize, f = o.frame, gap = font * 0.5, pad = 6;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    const spots: Array<[number, number]> = [
      [box[2] + gap, cy - h / 2], [box[0] - gap - w, cy - h / 2], [cx - w / 2, box[3] + gap], [cx - w / 2, box[1] - gap - h],
      [box[2] + gap, box[3] + gap], [box[0] - gap - w, box[3] + gap], [box[2] + gap, box[1] - gap - h], [box[0] - gap - w, box[1] - gap - h],
      [f.left + gap, f.top + gap], [f.right - gap - w, f.top + gap], [f.left + gap, f.bottom - gap - h], [f.right - gap - w, f.bottom - gap - h],
    ];
    const blocks: Rect[] = [...o.cars.map((c) => c.box), ...o.labels()].map((r) => [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad]);
    const rectAt = (i: number): Rect => {
      const [x, y] = spots[i]!;
      const l = Math.max(f.left, Math.min(f.right - w, x)), t = Math.max(f.top, Math.min(f.bottom - h, y));
      return [l, t, l + w, t + h];
    };
    const cover = (r: Rect) => blocks.reduce((sum, b) => sum + Math.max(0, Math.min(r[2], b[2]) - Math.max(r[0], b[0])) * Math.max(0, Math.min(r[3], b[3]) - Math.max(r[1], b[1])), 0);
    // Stays where it is while that spot is still clear (no hopping as the cars move), else the first clear spot, else the
    // one covering least.
    let best = this.spot >= 0 && cover(rectAt(this.spot)) === 0 ? this.spot : -1;
    if (best < 0) {
      let least = Infinity;
      best = spots.length - 1;
      for (let i = 0; i < spots.length; i++) {
        const c = cover(rectAt(i));
        if (c < least) [least, best] = [c, i];
        if (c === 0) break;
      }
    }
    this.spot = best;
    const r = rectAt(best);
    // The scene's rects are the canvas's own CSS px, and the canvas fills its root.
    el.style.transform = `translate(${r[0].toFixed(1)}px, ${r[1].toFixed(1)}px)`;
    this.bannerShown = { car, outcome: m.outcome, rect: r.map((n) => +n.toFixed(1)) as Rect };
  }

  private drop(car: number): void {
    const m = this.live.get(car);
    if (!m) return;
    this.scene.remove(m.sprite);
    m.sprite.material.map?.dispose();
    m.sprite.material.dispose();
    this.live.delete(car);
  }
}
