// br-8h3u.18: a car that missed a gate is shown the way back on the TV until it takes the gate. A beacon (a column of
// light and a ring on the road, in the car's own paint) stands on the gate it missed, and an arrow over the car points
// at it under "MISSED GATE! GO BACK". World objects, so every tile that can see the car or the gate shows them.
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Camera,
  type Scene,
} from 'three';
import type { Sampled } from './interp';
import { MISSED_GATE_TEXT } from '../../../shared/src/missed-gate';

const ALARM = '#FF7A1A';
const INK = '#15203A';
/** The beacon's column, m: tall enough to see over a crest or a building from the chase camera. */
const COLUMN_H = 28;
const COLUMN_R = 1.1;
/** The arrow floats this far over the car's origin, and the words this far (above a callout's 4.4 m). */
const ARROW_LIFT = 3.0;
const LABEL_LIFT = 5.9;
/** The label's size at REF m from the camera, and the band it keeps the same on-screen size in (as the callouts do). */
const W = 7.2;
const H = 1.8;
const REF = 12;
const NEAR = 9;
const FAR = 40;

interface Live {
  gate: [number, number, number];
  beacon: Group;
  arrow: Group;
  label: Sprite;
  column: MeshBasicMaterial;
}

/** A chevron in the x-z plane pointing +z, `len` long. */
function chevron(len: number, width: number): ShapeGeometry {
  const s = new Shape();
  const [hw, back] = [width / 2, len * 0.45];
  s.moveTo(0, len / 2);
  s.lineTo(hw, -len / 2);
  s.lineTo(0, -len / 2 + back);
  s.lineTo(-hw, -len / 2);
  s.closePath();
  const g = new ShapeGeometry(s);
  // ShapeGeometry lies in x-y; lay it flat with its tip along +z.
  g.rotateX(Math.PI / 2);
  return g;
}

function label(): Sprite {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 180;
  const g = c.getContext('2d')!;
  g.fillStyle = INK;
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, 24);
  g.fill();
  g.fillStyle = ALARM;
  g.beginPath();
  g.roundRect(10, 10, c.width - 20, c.height - 20, 16);
  g.fill();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 120;
  g.font = `italic 900 ${size}px "Barlow Condensed", system-ui, sans-serif`;
  while (g.measureText(MISSED_GATE_TEXT).width > c.width - 60 && size > 24) g.font = `italic 900 ${(size -= 4)}px "Barlow Condensed", system-ui, sans-serif`;
  g.fillText(MISSED_GATE_TEXT, c.width / 2, c.height / 2 + 6);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(W, H, 1);
  sprite.renderOrder = 12;
  return sprite;
}

export class MissedGates {
  private readonly live = new Map<number, Live>();
  /** Every car pointed back to a gate (car, gate x/y/z), oldest first: introspection for tests (R90). */
  readonly shown: Array<{ car: number; gate: [number, number, number] }> = [];

  constructor(
    private readonly scene: Scene,
    /** The car's paint (its seat's colour), for its beacon. */
    private readonly paintOf: (car: number) => string = () => ALARM,
  ) {}

  /** Car `car` missed the gate at (x, y, z) m: mark it and point the car to it until `clear`. */
  show(car: number, gate: [number, number, number]): void {
    this.clear(car);
    this.shown.push({ car, gate });
    if (this.shown.length > 500) this.shown.shift();
    const paint = this.paintOf(car);
    const beacon = new Group();
    const column = new MeshBasicMaterial({ color: paint, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide });
    const col = new Mesh(new CylinderGeometry(COLUMN_R, COLUMN_R, COLUMN_H, 20, 1, true), column);
    col.position.y = COLUMN_H / 2;
    const ring = new Mesh(
      new RingGeometry(3.4, 4.6, 40),
      new MeshBasicMaterial({ color: paint, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    beacon.add(col, ring);
    beacon.position.set(gate[0], gate[1], gate[2]);
    beacon.renderOrder = 10;
    const arrow = new Group();
    const outline = new Mesh(chevron(3.6, 3.0), new MeshBasicMaterial({ color: INK, depthTest: false, transparent: true, side: DoubleSide }));
    const fill = new Mesh(chevron(3.0, 2.4), new MeshBasicMaterial({ color: ALARM, depthTest: false, transparent: true, side: DoubleSide }));
    fill.position.y = 0.02;
    fill.position.z = 0.05;
    outline.renderOrder = 12;
    fill.renderOrder = 13;
    arrow.add(outline, fill);
    arrow.visible = false;
    const text = label();
    text.visible = false;
    this.scene.add(beacon, arrow, text);
    this.live.set(car, { gate, beacon, arrow, label: text, column });
  }

  /** Car `car` took the gate (or its race ended): its marks go. */
  clear(car: number): void {
    const m = this.live.get(car);
    if (!m) return;
    this.scene.remove(m.beacon, m.arrow, m.label);
    for (const o of [m.beacon, m.arrow]) {
      o.traverse((x) => {
        if (x instanceof Mesh) {
          x.geometry.dispose();
          (x.material as MeshBasicMaterial).dispose();
        }
      });
    }
    m.label.material.map?.dispose();
    m.label.material.dispose();
    this.live.delete(car);
  }

  /** A new track or round: nobody is being pointed anywhere. */
  clearAll(): void {
    for (const car of [...this.live.keys()]) this.clear(car);
  }

  /** Each frame: the arrow and words follow their car and point at its gate; the beacon pulses. */
  update(s: Sampled): void {
    const pulse = 0.38 + 0.22 * Math.sin(performance.now() / 180);
    for (const [car, m] of this.live) {
      m.column.opacity = pulse;
      if (car >= s.cars) {
        m.arrow.visible = m.label.visible = false;
        continue;
      }
      const [x, y, z] = [s.pos[car * 3]!, s.pos[car * 3 + 1]!, s.pos[car * 3 + 2]!];
      m.arrow.position.set(x, y + ARROW_LIFT, z);
      m.arrow.rotation.y = Math.atan2(m.gate[0] - x, m.gate[2] - z);
      m.label.position.set(x, y + LABEL_LIFT, z);
      m.arrow.visible = m.label.visible = true;
    }
  }

  /** Before each tile's draw: sizes the words for that tile's camera (as the callouts are). */
  fit(camera: Camera): void {
    for (const m of this.live.values()) {
      if (!m.label.visible) continue;
      const d = camera.position.distanceTo(m.label.position);
      const k = Math.min(FAR, Math.max(NEAR, d)) / REF;
      const near = d < NEAR ? (Math.max(d, 1) / NEAR) ** 2 : 1;
      m.label.scale.set(W * k * near, H * k * near, 1);
    }
  }

  /** Cars being pointed back to a gate now, with the gate. */
  active(): Array<{ car: number; gate: [number, number, number] }> {
    return [...this.live].map(([car, m]) => ({ car, gate: m.gate }));
  }
}
