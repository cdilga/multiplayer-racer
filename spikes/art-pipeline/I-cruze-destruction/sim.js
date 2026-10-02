// sim.js — Rapier side of the spike. Render geometry never feeds physics.
//
//   * Each car: one dynamic chassis body with the AUTHORED compound (cruze.js CHASSIS_COLLIDERS). Stage variants (shorter nose,
//     lower cabin) are swapped in only when a zone crosses a stage boundary, between steps.
//   * detach: the part keeps its world pose and frozen deformation, gets the authored cuboid/cylinder, its own mass, the car's
//     velocity at its attachment point (v + ω×r) plus the hit impulse; a short grace period stops it colliding with its car.
//   * wreck: PlayerVehicle → WreckEntity. Drive input is cut, the body keeps its velocity, deformation and missing parts and stays
//     a dynamic body for the round. The caller spawns a fresh car for the player.
//   * Debris and wrecks are never deleted, frozen, made static or merged; Rapier sleeps and wakes them. reset() is round-end only.
// The JS sim here is a stand-in for the Rust jj-sim; the contract it exercises (ids, colliders, masses, channels) is what carries over.
import * as THREE from 'three';
import { ZONES } from './fields.js';

const G_CAR = 1, G_GROUND = 2, G_DEBRIS = 4, G_ALL = 0xffff;
const groups = (m, f) => ((m & 0xffff) << 16) | (f & 0xffff);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3();

export class Sim {
  static async create(RAPIER, scene, { seed = 7 } = {}) {
    await RAPIER.init();
    const s = new Sim(); s.R = RAPIER; s.scene = scene; s.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); s.world.timestep = 1 / 120;
    s.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.9).setCollisionGroups(groups(G_GROUND, G_ALL)));
    s.cars = []; s.debris = []; s.shards = []; s.time = 0; s.rand = mulberry(seed);
    return s;
  }
  /** register a vehicle (kit space → world: yaw about Y). drive: null | (car, t) → {throttle, steer} */
  addCar(v, { position = [0, 0, 0], yaw = 0, drive = null, linvel = null } = {}) {
    const R = this.R; v.root.position.set(...position); v.root.rotation.set(0, yaw, 0); v.root.updateMatrixWorld(true);
    const q = v.root.quaternion;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(...position).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.15).setAngularDamping(0.8).setCcdEnabled(true);
    if (linvel) bd.setLinvel(...linvel);
    const body = this.world.createRigidBody(bd);
    const car = { v, body, drive, colliders: {}, stage: {}, mass: v.tpls[0].desc.massKg };
    this.buildChassisColliders(car);
    this.cars.push(car); v.sim = car; return car;
  }
  buildChassisColliders(car) {
    const R = this.R, cols = car.v.tpls[0].desc.chassisColliders, massTotal = car.mass;
    const vol = cols.reduce((a, c) => a + c.half[0] * c.half[1] * c.half[2], 0);
    for (const c of cols) {
      const st = this.stageOf(car, c), half = c.half.slice(), off = c.offset.slice();
      if (c.stages?.shrinkZ) { const d = c.stages.shrinkZ[st]; half[2] -= d / 2; off[2] -= Math.sign(off[2]) * d / 2; }
      if (c.stages?.lowerY) { const d = c.stages.lowerY[st]; half[1] -= d / 2; off[1] -= d / 2; }
      if (car.colliders[c.id]) this.world.removeCollider(car.colliders[c.id], false);
      const cd = R.ColliderDesc.cuboid(...half).setTranslation(...off).setFriction(0.6).setRestitution(0.15)
        .setMass(massTotal * (c.half[0] * c.half[1] * c.half[2]) / vol).setCollisionGroups(groups(G_CAR, G_ALL)).setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
      car.colliders[c.id] = this.world.createCollider(cd, car.body); car.stage[c.id] = st;
    }
    // wheel supports: a low-friction ball per ATTACHED wheel (arcade stand-in for the raycast vehicle); a lost wheel drops its corner
    for (const P of Object.values(car.v.parts)) {
      if (P.meta.kind !== 'wheel') continue; const key = 'col_' + P.id;
      if (car.colliders[key]) { this.world.removeCollider(car.colliders[key], false); delete car.colliders[key]; }
      if (P.state === 'detached') continue;
      const cd = R.ColliderDesc.ball(P.meta.radius).setTranslation(...P.home).setFriction(0.05).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0.1).setMass(P.meta.massKg).setCollisionGroups(groups(G_CAR, G_ALL));
      car.colliders[key] = this.world.createCollider(cd, car.body);
    }
  }
  stageOf(car, c) {
    if (!c.stages) return 0; const z = Math.max(...c.stages.zone.map((k) => car.v.channels[k] ?? 0));
    return z >= 0.85 ? 2 : z >= 0.45 ? 1 : 0;
  }
  /** called after channels change (between steps): rebuild only colliders whose stage changed */
  refreshStages(car) {
    const cols = car.v.tpls[0].desc.chassisColliders;
    if (cols.some((c) => this.stageOf(car, c) !== car.stage[c.id])) this.buildChassisColliders(car);
  }

  /**
   * One collision episode in car-local KIT space. point: where, dir: impactor travel direction, severity ~0..1.5.
   * Maps the contact to zones and the nearest panel; returns the events. Deterministic for a given call sequence.
   */
  hit(car, { point, dir, severity = 0.7 }, shared) {
    const v = car.v, ev = []; if (severity < 0.12) return ev;
    v.wake();
    const [x, y, z] = point, w = (a) => Math.max(0, Math.min(1, a));
    const front = w((z - 0.5) / 1.2), rear = w((-z - 0.5) / 1.2), left = w(0.5 + x / 1.2), right = 1 - left;
    const roof = y > 1.2 && dir[1] < -0.4 ? 1 : 0, k = severity * 0.42;
    const add = (ch, a) => { if (a > 0.01) { v.setChannel(ch, v.channels[ch] + a); ev.push({ t: 'zone', ch, v: +v.channels[ch].toFixed(3) }); } };
    if (roof) add('damage_ROOF', k * 1.2);
    else { add('damage_FL', k * front * left); add('damage_FR', k * front * right); add('damage_RL', k * rear * left); add('damage_RR', k * rear * right); }
    // nearest attached panel by authored collider box (part-local) → hp, dent, state
    let best = null, bd = 0.3;
    for (const P of Object.values(v.parts)) {
      if (P.state === 'detached' || P.state === 'carried' || !P.meta.collider) continue;
      const c = P.meta.collider, h = P.home, cx = h[0] + (c.offset?.[0] ?? 0), cy = h[1] + (c.offset?.[1] ?? 0), cz = h[2] + (c.offset?.[2] ?? 0);
      const hx = c.half?.[0] ?? c.halfHeight, hy = c.half?.[1] ?? c.radius, hz = c.half?.[2] ?? c.radius;
      const d = Math.hypot(Math.max(0, Math.abs(x - cx) - hx), Math.max(0, Math.abs(y - cy) - hy), Math.max(0, Math.abs(z - cz) - hz));
      if (d < bd) { bd = d; best = P; }
    }
    if (best) {
      const P = best, m = P.meta;
      P.hp -= severity * (m.kind === 'lamp' ? 90 : 55);
      if (m.channels.includes('dent_' + P.id)) v.setChannel('dent_' + P.id, v.channels['dent_' + P.id] + severity * 0.55);
      if (m.kind === 'lamp' && P.hp < m.hp * 0.5) v.breakLamp(P.id, shared);
      if (P.hp <= 0 && m.detachable) ev.push(...this.detach(car, P.id, { dir, severity, point }));
      else if (P.hp <= m.hp * 0.6 && (m.hinge || m.kind === 'wheel')) { v.loosen(P.id, severity); ev.push({ t: 'loose', id: P.id }); }
      else if (P.state === 'fixed') { P.state = 'damaged'; }
    }
    if (roof || (y > 1.1 && severity > 0.9)) { v.smashGlass(shared); this.spawnShards(v, [0, 1.3, 0], 30); }
    const ch = v.parts.chassis; ch.hp -= severity * 40;
    this.refreshStages(car);
    if (ch.hp <= 0 && !v.wreck) { this.wreck(car); ev.push({ t: 'wreck' }); }
    return ev;
  }

  detach(car, id, { dir = [0, 0.3, 1], severity = 0.7 } = {}) {
    const R = this.R, v = car.v, released = v.release(id, this.scene); if (!released) return [];
    const ev = [];
    const lv = car.body.linvel(), av = car.body.angvel(), cp = car.body.translation();
    for (const P of released) {
      const m = P.meta; P.group.updateMatrixWorld(true);
      P.group.matrixWorld.decompose(_p, _q, _v);
      if (!m.collider) { P.group.visible = false; continue; }
      // velocity of the attachment point: v + ω × r
      const r = { x: _p.x - cp.x, y: _p.y - cp.y, z: _p.z - cp.z };
      const vel = { x: lv.x + av.y * r.z - av.z * r.y, y: lv.y + av.z * r.x - av.x * r.z, z: lv.z + av.x * r.y - av.y * r.x };
      const kick = new THREE.Vector3(...dir).normalize().applyQuaternion(car.v.root.quaternion).multiplyScalar(1.2 + 3.2 * severity);
      const bd = R.RigidBodyDesc.dynamic().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinvel(vel.x + kick.x + (this.rand() - 0.5), vel.y + kick.y * 0.3 + 1.2 + 1.5 * this.rand(), vel.z + kick.z + (this.rand() - 0.5))
        .setAngvel({ x: av.x + (this.rand() - 0.5) * 6, y: av.y + (this.rand() - 0.5) * 6, z: av.z + (this.rand() - 0.5) * 6 })
        .setCcdEnabled(true).setLinearDamping(0.12).setAngularDamping(m.kind === 'wheel' ? 0.6 : 0.3);
      const body = this.world.createRigidBody(bd);
      let cd;
      if (m.collider.shape === 'cylinder') cd = R.ColliderDesc.cylinder(m.collider.halfHeight, m.collider.radius).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setFriction(1.0).setRestitution(0.3);
      else {
        cd = R.ColliderDesc.cuboid(...m.collider.half).setTranslation(...m.collider.offset).setFriction(0.7).setRestitution(0.2);
        if (m.collider.rotX) cd.setRotation({ x: Math.sin(m.collider.rotX / 2), y: 0, z: 0, w: Math.cos(m.collider.rotX / 2) });
      }
      cd.setMass(m.massKg).setCollisionGroups(groups(G_DEBRIS, G_GROUND | G_DEBRIS));   // grace: ignores cars for 0.25 s
      const col = this.world.createCollider(cd, body);
      this.debris.push({ id: P.id, car, part: P, body, col, grace: 0.25, kind: m.kind });
      if (m.kind === 'lamp') this.spawnShards(null, [_p.x, _p.y, _p.z], 8);
      ev.push({ t: 'detach', id: P.id });
    }
    // mass accounting: the chassis loses what left
    const lost = released.reduce((a, P) => a + (P.meta.massKg || 0), 0); car.mass -= lost; this.buildChassisColliders(car);
    return ev;
  }
  /** chassis at zero: becomes a persistent dynamic husk (no input), keeps everything it had */
  wreck(car) { car.v.wreck = true; car.drive = null; car.body.setLinearDamping(0.35); car.body.setAngularDamping(0.6); car.wreckedAt = this.time; this.spawnShards(car.v, [0, 1.0, 0], 12); }

  /** cosmetic glass shards: ONE InstancedMesh whose capacity doubles when full (growable allocation, never a cap); they persist for the round */
  spawnShards(v, at, n) {
    if (!this._shardMesh || this.shards.length + n > this._shardMesh.instanceMatrix.count) {
      const cap = Math.max(256, 2 * (this.shards.length + n)), m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.004, 0.05), new THREE.MeshStandardMaterial({ color: '#cfe8ff', roughness: 0.1, metalness: 0.2 }), cap);
      m.frustumCulled = false; m.castShadow = false; m.userData.loose = true;
      if (this._shardMesh) { this.scene.remove(this._shardMesh); this._shardMesh.dispose(); }
      this._shardMesh = m; this.scene.add(m);
    }
    const p = new THREE.Vector3(...at); if (v) p.applyMatrix4(v.root.matrixWorld);
    for (let i = 0; i < n; i++) {
      const pos = p.clone().add(new THREE.Vector3((this.rand() - 0.5) * 0.8, (this.rand() - 0.5) * 0.2, (this.rand() - 0.5) * 0.8));
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rand() * 6, this.rand() * 6, this.rand() * 6));
      this.shards.push({ pos, rot, vel: new THREE.Vector3((this.rand() - 0.5) * 3, 1 + this.rand() * 2.5, (this.rand() - 0.5) * 3) });
    }
    this._shardMesh.count = this.shards.length; this._shardsDirty = true;
  }
  syncShards() {
    const m = this._shardMesh; if (!m || !this._shardsDirty) return; const M = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1); let moving = false;
    this.shards.forEach((sh, i) => { M.compose(sh.pos, sh.rot, one); m.setMatrixAt(i, M); if (sh.vel.lengthSq() > 1e-6) moving = true; });
    m.count = this.shards.length; m.instanceMatrix.needsUpdate = true; this._shardsDirty = moving;
  }

  step(dt) {
    let t = dt; const h = 1 / 120;
    while (t > 1e-9) {
      const s = Math.min(h, t); t -= s; this.time += s;
      for (const car of this.cars) if (car.drive && !car.v.wreck) {
        const { throttle = 0, steer = 0 } = car.drive(car, this.time) ?? {}, q = car.body.rotation(), fw = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        const lv = car.body.linvel(), speed = lv.x * fw.x + lv.z * fw.z;
        car.body.applyImpulse({ x: fw.x * throttle * 9000 * s, y: 0, z: fw.z * throttle * 9000 * s }, true);
        car.body.applyTorqueImpulse({ x: 0, y: steer * 2600 * s * Math.max(-1, Math.min(1, speed / 4)), z: 0 }, true);
        // lateral grip (arcade): kill sideways slip
        const side = new THREE.Vector3(fw.z, 0, -fw.x), slip = lv.x * side.x + lv.z * side.z;
        car.body.applyImpulse({ x: -side.x * slip * car.mass * 0.08, y: 0, z: -side.z * slip * car.mass * 0.08 }, true);
      }
      this.world.timestep = s; this.world.step();
      for (const d of this.debris) if (d.grace > 0 && (d.grace -= s) <= 0) d.col.setCollisionGroups(groups(G_DEBRIS, G_ALL));
      for (const sh of this.shards) { if (sh.vel.lengthSq() < 1e-6) continue; this._shardsDirty = true; sh.vel.y -= 9.81 * s; sh.pos.addScaledVector(sh.vel, s); if (sh.pos.y < 0.003) { sh.pos.y = 0.003; sh.vel.set(0, 0, 0); } }
    }
    this.sync();
  }
  sync() {
    for (const car of this.cars) { const p = car.body.translation(), q = car.body.rotation(); car.v.root.position.set(p.x, p.y, p.z); car.v.root.quaternion.set(q.x, q.y, q.z, q.w); }
    for (const d of this.debris) { const p = d.body.translation(), q = d.body.rotation(); d.part.group.position.set(p.x, p.y, p.z); d.part.group.quaternion.set(q.x, q.y, q.z, q.w); }
    this.syncShards();
    // render batching only: a wreck whose body sleeps is drawn from a baked merge of its current deformed parts (4 draws, not ~40)
    for (const car of this.cars) if (car.v.wreck && !car.v.baked && car.body.isSleeping()) car.v.bakeWreck();   // the bake rides the body; any damage unbakes
  }
  stats() {
    let bodies = 0, sleeping = 0, colliders = 0;
    this.world.forEachRigidBody((b) => { if (b.isFixed()) return; bodies++; if (b.isSleeping()) sleeping++; });
    this.world.forEachCollider(() => colliders++);
    return { dynamicBodies: bodies, sleeping, active: bodies - sleeping, colliders, cars: this.cars.filter((c) => !c.v.wreck).length, wrecks: this.cars.filter((c) => c.v.wreck).length, debris: this.debris.length, shards: this.shards.length };
  }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export { ZONES };
