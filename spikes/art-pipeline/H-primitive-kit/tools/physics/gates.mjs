#!/usr/bin/env node
// gates.mjs — physics-fit gates for the baked asset (baseline LOD1 by default). The same questions the Blender track asked
// (spikes/art-pipeline/G-cruze-v2/physics/REPORT.md) as pass/fail assertions instead of a one-off report:
//   load · settle · drive · brake · turn · rollover · detach (door, wheel) · determinism · collider/underbody sanity
//   node tools/physics/gates.mjs [assetDir=asset/cruze] [--lod 1] [--json out.json]
// Rapier (@dimforge/rapier3d-compat) headless, dt = 1/120, DynamicRayCastVehicleController. World: glTF space, −Z forward.
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import { ensureInit, createWorld, createGround, buildVehicle, stepWorld, DT, GROUP_CAR, GROUP_DEBRIS, GROUP_GROUND, interactionGroups, quatFromAxisAngle } from './physics_common.mjs';
import { loadVehicle } from './load_vehicle.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) ?? 'asset/cruze'), LOD = +opt('--lod', 1);
const results = []; let failed = 0;
const gate = (id, ok, detail) => { results.push({ id, ok, detail }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} physics.${id} ${detail}`); };
const info = (id, detail) => console.log(`INFO physics.${id} ${detail}`);
const fmt = (x, n = 3) => +x.toFixed(n);

await ensureInit();
const load = () => loadVehicle(path.join(DIR, `cruze.lod${LOD}.glb`), path.join(DIR, 'cruze.asset.json'));

function fresh({ spawnY } = {}) {
  const v = load(), world = createWorld(); world.timestep = DT; createGround(world);
  const veh = buildVehicle(world, v, { spawn: [0, spawnY ?? 0.08, 0] });
  return { v, world, ...veh };
}
const pos = (b) => b.translation(), vel = (b) => b.linvel();
const speed = (b) => { const l = vel(b); return Math.hypot(l.x, l.y, l.z); };
const upDot = (b) => { const q = b.rotation(); return 1 - 2 * (q.x * q.x + q.z * q.z); };             // world-up · body-up
const fwdSpeed = (b) => -vel(b).z;
const steps = (S, n, fn) => { for (let i = 0; i < n; i++) { fn?.(i); stepWorld(S.world, S.controller, DT); } };
const drive = (S, engine, steer, brake = 0) => { for (const i of S.drivenWheels) S.controller.setWheelEngineForce(i, engine); for (const i of S.steerWheels) S.controller.setWheelSteering(i, steer); for (let i = 0; i < 4; i++) S.controller.setWheelBrake(i, brake); };
const trace = (S, log) => { const p = pos(S.body), r = S.body.rotation(); log.push([p.x, p.y, p.z, r.x, r.y, r.z, r.w].map((x) => Math.round(x * 1e5))); };
const hash = (a) => crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex').slice(0, 16);

// ── 1. load ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const v = load(), issues = [];
  if (Math.abs(v.massFractionSum - 1) > 1e-3) issues.push(`mass fractions sum ${v.massFractionSum}`);
  if (Math.abs(v.groundOffsetY) > 0.01) issues.push(`chassis origin y=${v.groundOffsetY}`);
  if (v.anchorMismatches.length) issues.push(`anchor mismatches ${JSON.stringify(v.anchorMismatches)}`);
  for (const [n, c] of Object.entries(v.colliders)) if (c.shape === 'convex') { const d = RAPIER.ColliderDesc.convexHull(c.chassisRelVerts); if (!d) issues.push(`${n}: convexHull() failed`); }
  const com = v.anchors.com, cw = v.colliders.col_chassis, track = Math.abs(v.wheels.wheel_FL.hubRel[0] - v.wheels.wheel_FR.hubRel[0]), ssf = track / (2 * com[1]);
  if (ssf < 1.2) issues.push(`static stability factor ${ssf.toFixed(2)} < 1.2 (CoM too high for the track: the Blender asset failed this at 0.94)`);
  gate('load', !issues.length, issues.length ? issues.join('; ') : `mass ${v.totalMassKg} kg, ${Object.keys(v.colliders).length} colliders build, CoM y=${com[1]}, track ${track.toFixed(2)} m, static stability factor ${ssf.toFixed(2)}`);
}
// ── 2. settle ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const S = fresh(); steps(S, 360);
  const p = pos(S.body), contacts = [0, 1, 2, 3].map((i) => S.controller.wheelIsInContact(i)), hubY = S.v.wheels.wheel_FL.hubRel[1], sag = S.v.wheels.wheel_FL.hubRel[1] - (hubY + (p.y - S.v.groundOffsetY));
  const colBottom = S.v.colliders.col_chassis.centerRel[1] - S.v.colliders.col_chassis.halfExtents[1] + p.y;
  const issues = []; if (!contacts.every(Boolean)) issues.push(`wheels in contact ${contacts}`); if (Math.abs(p.y) > 0.12) issues.push(`rest height offset ${p.y.toFixed(3)} m (suspension sag)`); if (speed(S.body) > 0.05) issues.push('still moving'); if (colBottom < 0.03) issues.push(`chassis hull rests on the ground (${colBottom.toFixed(3)})`);
  gate('settle', !issues.length, issues.length ? issues.join('; ') : `4/4 wheels grounded, rest y offset ${fmt(p.y)} m, hull clears ground by ${fmt(colBottom)} m`);
}
// ── 3. throttle + brake ───────────────────────────────────────────────────────────────────────────────────────────
let driveTrace = [];
{
  const S = fresh(); steps(S, 240); const z0 = pos(S.body).z; const log = [];
  drive(S, 1800, 0); steps(S, 360, (i) => i % 12 === 0 && trace(S, log));
  const v3 = fwdSpeed(S.body), dist = z0 - pos(S.body).z; driveTrace = log;
  gate('throttle', v3 > 8 && dist > 12 && Math.abs(pos(S.body).x) < 1.5 && upDot(S.body) > 0.95, `3 s full throttle (FWD): ${fmt(v3 * 3.6, 1)} km/h, ${fmt(dist, 1)} m forward (−Z), lateral drift ${fmt(pos(S.body).x)} m`);
  drive(S, 0, 0, 40); const t0 = pos(S.body).z; let n = 0; while (fwdSpeed(S.body) > 0.3 && n < 1200) { steps(S, 1); n++; }
  const stopDist = t0 - pos(S.body).z; gate('brake', n < 1200 && stopDist < 30, `braking from ${fmt(v3 * 3.6, 1)} km/h stops in ${fmt(n * DT, 2)} s / ${fmt(stopDist, 1)} m`);
}
// ── 4. turn + rollover scan ───────────────────────────────────────────────────────────────────────────────────────
function turnAt(kmh, steerDeg = 30) {
  const S = fresh(); steps(S, 200); const target = kmh / 3.6; drive(S, 1800, 0); let n = 0; while (fwdSpeed(S.body) < target && n < 900) { steps(S, 1); n++; }
  drive(S, 200, 0); steps(S, 30);
  const start = pos(S.body); const ang = steerDeg * Math.PI / 180; let rolled = false, maxLat = 0;
  for (let i = 0; i < 360; i++) { drive(S, 300, ang * Math.min(1, i / 60)); steps(S, 1); if (upDot(S.body) < 0.6) { rolled = true; break; } }
  const p = pos(S.body); return { rolled, speed: speed(S.body) * 3.6, end: p, start, nan: [p.x, p.y, p.z].some(Number.isNaN) };
}
{
  const t = turnAt(40, 30), yawRate = (() => { const S = fresh(); steps(S, 200); drive(S, 1800, 0); let n = 0; while (fwdSpeed(S.body) < 11 && n < 900) { steps(S, 1); n++; } const a = S.body.rotation(); const y0 = 2 * Math.atan2(a.y, a.w); drive(S, 300, 30 * Math.PI / 180); steps(S, 120); const b = S.body.rotation(); return Math.abs((2 * Math.atan2(b.y, b.w) - y0)) / (120 * DT); })();
  const radius = 11 / Math.max(yawRate, 1e-3);
  gate('turn', !t.rolled && !t.nan && radius > 2 && radius < 9, `30° lock at ~40 km/h: no rollover, turning radius ≈ ${fmt(radius, 1)} m (wheelbase 2.30 m ⇒ Ackermann ≈ ${fmt(2.3 / Math.tan(30 * Math.PI / 180), 1)} m)`);
  let threshold = null; for (const k of [30, 40, 48.6, 55, 62.5, 70]) { if (turnAt(k, 30).rolled) { threshold = k; break; } }
  gate('rollover', threshold === null || threshold > 55, threshold === null ? 'no rollover up to 70 km/h at full lock' : `rolls at ${threshold} km/h with 30° lock (gate: > 55 km/h; the Blender asset rolled at ~55)`);
}
// ── 5. detach: door and wheel ─────────────────────────────────────────────────────────────────────────────────────
function detach(kind) {
  const S = fresh(); steps(S, 240);
  const isDoor = kind === 'door', partId = isDoor ? 'door_L' : 'wheel_FL', part = S.v.parts[partId], col = S.v.colliders['col_' + partId];
  drive(S, 1200, 0); steps(S, 120); const carV = vel(S.body), carPos = pos(S.body), carW = S.body.angvel();
  // debris: rigid body at the part's collider pose, inheriting car velocity + angular contribution at the attach point
  const c = col.centerRel, off = { x: c[0], y: c[1] + carPos.y, z: c[2] + carPos.z }, r = [c[0], c[1], c[2]];
  const lv = { x: carV.x + carW.y * r[2] - carW.z * r[1], y: carV.y + carW.z * r[0] - carW.x * r[2], z: carV.z + carW.x * r[1] - carW.y * r[0] };
  // NOTE for jj-sim: debris bodies need damping. A cylinder wheel on a plane has no rolling resistance in Rapier and rolls until the ground ends;
  // linear 0.35 / angular 0.6 makes it coast to rest and sleep in a few seconds.
  const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(carPos.x + c[0], carPos.y + c[1], carPos.z + c[2]).setLinvel(lv.x, lv.y + 2, lv.z).setCcdEnabled(true).setLinearDamping(0.35).setAngularDamping(0.6);
  const debris = S.world.createRigidBody(bd);
  const cd = isDoor ? RAPIER.ColliderDesc.cuboid(...col.halfExtents) : RAPIER.ColliderDesc.cylinder(col.halfExtents[0], col.halfExtents[1]).setRotation(quatFromAxisAngle([0, 0, 1], Math.PI / 2));
  cd.setMass(part.massKg).setFriction(0.8).setRestitution(0.3).setCollisionGroups(interactionGroups(GROUP_DEBRIS, GROUP_GROUND | GROUP_DEBRIS));   // grace period: no contact with the car it just left
  S.world.createCollider(cd, debris);
  const before = S.v.totalMassKg; S.body.setAdditionalMass?.(0, true);
  if (!isDoor) { const i = S.wheelIndex.wheel_FL; S.controller.setWheelMaxSuspensionForce(i, 0); S.controller.setWheelSuspensionStiffness(i, 0); S.controller.setWheelEngineForce(i, 0); }
  drive(S, 0, 0, 5); let maxPop = 0, nan = false;
  for (let i = 0; i < 20; i++) { steps(S, 1); const l = debris.linvel(); maxPop = Math.max(maxPop, Math.hypot(l.x, l.y, l.z) - Math.hypot(lv.x, lv.y + 2, lv.z)); }
  steps(S, 600); const dp = debris.translation(), dl = debris.linvel(); nan = [dp.x, dp.y, dp.z].some(Number.isNaN) || Number.isNaN(pos(S.body).x);
  let sleeps = debris.isSleeping(); let t = 0; while (!sleeps && t < 2400) { steps(S, 1); t++; sleeps = debris.isSleeping(); }
  return { partId, massKg: part.massKg, dynamic: debris.isDynamic(), sleeps, sleepS: (600 + t) * DT, pop: maxPop, nan, carUp: upDot(S.body), carAlive: !Number.isNaN(pos(S.body).y) && pos(S.body).y > -0.5, debrisY: dp.y };
}
{
  const d = detach('door'); gate('detach_door', d.dynamic && d.sleeps && !d.nan && d.pop < 3 && d.debrisY > -0.2, `door_L → debris ${fmt(d.massKg, 1)} kg: dynamic, sleeps after ${fmt(d.sleepS, 1)} s, launch overshoot ${fmt(d.pop)} m/s, lands at y=${fmt(d.debrisY)}`);
  const w = detach('wheel'); gate('detach_wheel', w.dynamic && w.sleeps && !w.nan && w.carAlive && w.carUp > 0.6, `wheel_FL → debris ${fmt(w.massKg, 1)} kg; car stays up (up·y=${fmt(w.carUp)}) on 3 wheels + body, no NaN — "handling change, not instant death"`);
  const v = load(), a = v.colliders.col_door_L, ch = v.colliders.col_chassis;
  const ov = ['x', 'y', 'z'].map((_, k) => Math.max(0, Math.min(a.centerRel[k] + a.halfExtents[k], ch.centerRel[k] + ch.halfExtents[k]) - Math.max(a.centerRel[k] - a.halfExtents[k], ch.centerRel[k] - ch.halfExtents[k])));
  info('detach_overlap', `col_door_L overlaps col_chassis AABB by ${ov.map((x) => fmt(x, 2)).join('×')} m ⇒ spawn detached panels with a collision-group grace period (as this gate does) or an outward nudge`);
}
// ── 6. determinism ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const run = () => { const S = fresh(); steps(S, 200); const log = []; drive(S, 1800, 0); steps(S, 240, (i) => i % 4 === 0 && trace(S, log)); drive(S, 900, 0.4); steps(S, 240, (i) => i % 4 === 0 && trace(S, log)); return hash(log); };
  const a = run(), b = run(); gate('determinism', a === b, `two independent runs: ${a} ${a === b ? '==' : '!='} ${b} (bit-identical trajectory)`);
}
// ── 7. collider/underbody sanity (the Blender finding #3) ───────────────────────────────────────────────────────────
{
  const v = load(), ch = v.colliders.col_chassis, bottom = ch.centerRel[1] - ch.halfExtents[1];
  gate('collider_underbody', bottom < 0.4, `col_chassis bottom at ${fmt(bottom)} m above the ground plane (ride height ~${fmt(v.wheels.wheel_FL.hubRel[1])} m); the Blender v2 asset had a 0.5 m gap`);
}
console.log(`--- physics: ${results.length - failed} PASS, ${failed} FAIL (LOD${LOD}) ---`);
const out = opt('--json'); if (out) fs.writeFileSync(out, JSON.stringify({ lod: LOD, results }, null, 1));
process.exit(failed ? 1 : 0);
