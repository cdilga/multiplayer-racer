// Gated start (R127): a big callout over a car for how its launch went: "PERFECT START!", "LAUNCH!" or "EARLY! NO LAUNCH".
// Landings (R129, P1-FL07) use it too: "CLEAN LANDING! BOOST", "BIG AIR! BOOST", "HARD LANDING!", "STACKED IT!".
// Same device as the Identify number (a billboard drawn over the world, so every tile that can see the car shows it).
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, type Camera, type Scene } from 'three';
import type { Sampled } from './interp';
import { LAUNCH_SHOWN_MS, LAUNCH_TEXT, type LaunchOutcome } from '../../../shared/src/launch';
import { LANDING_TEXT, type LandingCallout } from '../../../shared/src/landing';

/** What a callout says: a start (R127) or a landing (R129). */
export type Callout = LaunchOutcome | LandingCallout;
const TEXT: Record<Callout, string> = { ...LAUNCH_TEXT, ...LANDING_TEXT };

interface Live {
  sprite: Sprite;
  until: number;
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
};

export class LaunchCallouts {
  private readonly live = new Map<number, Live>();
  /** Every callout put up (car, outcome), oldest first: introspection for tests (R90). */
  readonly shown: Array<{ car: number; outcome: Callout }> = [];

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
    this.live.set(car, { sprite, until: performance.now() + ms });
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
      m.sprite.visible = true;
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
    return [...this.live].filter(([, m]) => m.sprite.visible).map(([car]) => car);
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
