#!/usr/bin/env node
// Generate lap.json (P1-A04): the gallery's scripted lap as sampled data (speed, throttle, boost, drift,
// surface, damage at 20 Hz). The driver's controls below are authored keyframes; speed comes from
// integrating them through a point-mass car model, so speed and throttle move together the way a
// recording from the sim will. This is a stand-in until P1-A05 records a real lap from the game.
// Deterministic: same script, same bytes. Usage: node art/ui/poc/audio/engine/make-lap.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DURATION = 38;
const RATE = 20;
const SIM_HZ = 200;

/** Piecewise-linear keyframes [[t, value], ...]; holds the last value. */
const track = (keys) => (t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys[keys.length - 1][1];
};

// Driver controls. Story: idle, rev on the line, launch, long straight (boost), brake and powerslide a
// corner, dirt, gravel with three knocks that loosen the body, back on tarmac, lift, brake, idle.
const throttle = track([
  [0, 0], [1.2, 0], [1.6, 1], [2.2, 1], [13, 1], [13.15, 0], [15.0, 0], [15.3, 0.7], [18.6, 0.7], [19.0, 1],
  [25.5, 1], [25.7, 0.9], [31.5, 0.9], [31.7, 0], [38, 0],
]);
const brake = track([
  [0, 0], [1.2, 1], [2.1, 1], [2.25, 0], [13.2, 0], [13.5, 0.85], [15.0, 0.85], [15.3, 0], [32.0, 0], [32.3, 0.75], [36.2, 0.75], [36.5, 1], [38, 1],
]);
const drift = track([
  [0, 0], [15.0, 0], [15.7, 0.9], [18.0, 0.9], [18.7, 0], [22.4, 0], [22.9, 0.4], [23.6, 0], [38, 0],
]);
const surfaceAt = (t) => (t < 19.4 ? 0 : t < 25.5 ? 1 : t < 31.5 ? 2 : 0); // tarmac, dirt, gravel, tarmac
const knocks = [27.0, 29.2, 30.6]; // body hits on the gravel: each loosens more of the car
const damageSteps = [0.3, 0.62, 0.9];

const out = { speedMps: [], throttle: [], boost: [], drift: [], surface: [], damage: [] };
let v = 0;
let boost = 0;
let damage = 0;
let nextKnock = 0;
const dt = 1 / SIM_HZ;
const grid = DURATION * RATE;
const smooth = (a, b) => (b > a ? 0.6 : 0.35); // boost spool time constants (s)

for (let n = 0; n <= DURATION * SIM_HZ; n++) {
  const t = n * dt;
  const th = throttle(t);
  const br = brake(t);
  const dr = drift(t);
  const surf = surfaceAt(t);
  const grip = [1, 0.82, 0.68][surf];
  let a = th * 11 * grip * Math.max(0, 1 - v / 70) - br * 15 - 0.05 * v - (v > 0.1 ? 0.3 : 0) - dr * 1.4 * (v > 3 ? 1 : 0) - (surf === 2 ? 0.05 * v : surf === 1 ? 0.02 * v : 0);
  if (br > 0.99 && v < 0.5) a = 0;
  v = Math.max(0, v + a * dt);
  if (nextKnock < knocks.length && t >= knocks[nextKnock]) {
    v *= 0.8;
    damage = damageSteps[nextKnock];
    nextKnock += 1;
  }
  const boostTarget = th * Math.min(1, Math.max(0, (v - 4) / 14));
  boost += (boostTarget - boost) * (1 - Math.exp(-dt / smooth(boost, boostTarget)));
  if (n % (SIM_HZ / RATE) === 0 && out.speedMps.length <= grid) {
    const r = (x, k = 3) => +x.toFixed(k);
    out.speedMps.push(r(v));
    out.throttle.push(r(th));
    out.boost.push(r(boost));
    out.drift.push(r(dr));
    out.surface.push(surf);
    out.damage.push(r(damage));
  }
}

const lap = {
  format: 'jj-engine-lap',
  version: 1,
  name: 'Scripted lap',
  durationS: DURATION,
  rateHz: RATE,
  surfaces: ['tarmac', 'dirt', 'gravel'],
  source:
    'Authored driver controls integrated through a point-mass car model by make-lap.mjs; a stand-in for a lap recorded from the sim (P1-A05). Sampled at rateHz; the gallery interpolates linearly (surface is held).',
  story: [
    [0, 'Idle'],
    [1.2, 'Rev on the line'],
    [2.25, 'Launch, boost builds'],
    [13.15, 'Lift and brake: pops, downshifts'],
    [15.0, 'Powerslide: tyre squeal'],
    [19.4, 'Dirt'],
    [25.5, 'Gravel'],
    [27.0, 'Knocks loosen the body: rattle'],
    [31.5, 'Tarmac, lift, brake'],
    [36.5, 'Idle with a rattling body'],
  ],
  series: out,
};
writeFileSync(join(here, 'lap.json'), `${JSON.stringify(lap)}\n`);
console.log(`lap.json: ${out.speedMps.length} samples, top speed ${Math.max(...out.speedMps).toFixed(1)} m/s`);
