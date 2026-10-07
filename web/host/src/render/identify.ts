// Identify over the car (P1-R06): while a seat's Identify flashes, its number floats above its car in the seat's colour,
// so every view that can see the car (its own tile and everyone else's) shows whose it is. One billboard per flash,
// drawn over the world (no depth test); the tile pulse and "Cooee #N" label are the per-tile HUD's.
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace, type Scene } from 'three';
import type { Sampled } from './interp';

interface Mark {
  sprite: Sprite;
  until: number;
}

/** Billboard size in metres (a car is ~4.4 m long), and its height above the car's origin. */
const W = 3.2;
const H = 1.4;
const LIFT = 2.6;

export class IdentifyMarks {
  private readonly marks = new Map<number, Mark>();

  constructor(private readonly scene: Scene) {}

  /** Floats `label` over car `car` for `ms`, filled `fill` with `ink` text (a repeat restarts it). */
  flash(car: number, label: string, fill: string, ink: string, ms = 1600): void {
    this.drop(car);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 112;
    const g = c.getContext('2d')!;
    g.fillStyle = '#15203A';
    g.beginPath();
    g.roundRect(0, 0, c.width, c.height, 18);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    g.roundRect(8, 8, c.width - 16, c.height - 16, 12);
    g.fill();
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Three-digit numbers (and more) shrink to fit rather than clip.
    let size = 80;
    g.font = `italic 900 ${size}px "Barlow Condensed", system-ui, sans-serif`;
    while (g.measureText(label).width > c.width - 40 && size > 24) g.font = `italic 900 ${(size -= 4)}px "Barlow Condensed", system-ui, sans-serif`;
    g.fillText(label, c.width / 2, c.height / 2 + 4);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(W, H, 1);
    sprite.renderOrder = 10;
    sprite.visible = false;
    this.scene.add(sprite);
    this.marks.set(car, { sprite, until: performance.now() + ms });
  }

  /** Each frame: follow the cars, retire finished flashes. */
  update(s: Sampled): void {
    const now = performance.now();
    for (const [car, m] of this.marks) {
      if (now > m.until || car >= s.cars) {
        this.drop(car);
        continue;
      }
      m.sprite.position.set(s.pos[car * 3]!, s.pos[car * 3 + 1]! + LIFT, s.pos[car * 3 + 2]!);
      m.sprite.visible = true;
    }
  }

  /** Cars showing a mark now (introspection, R90). */
  active(): number[] {
    return [...this.marks.keys()];
  }

  private drop(car: number): void {
    const m = this.marks.get(car);
    if (!m) return;
    this.scene.remove(m.sprite);
    m.sprite.material.map?.dispose();
    m.sprite.material.dispose();
    this.marks.delete(car);
  }
}
