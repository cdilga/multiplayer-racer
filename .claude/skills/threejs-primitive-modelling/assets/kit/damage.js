// damage.js — deformation + destruction for kit-built vehicles (contract §8.1/§8.2).
//
// Why this works with the "primitives only" method:
//   * Every panel is a dense parametric grid (interior vertices everywhere), so we can dent the *actual* vertices
//     on the CPU — no morph targets to author, no cap on the number of impacts, and a detached part simply
//     carries its already-dented geometry with it.
//   * Colours are vertex colours, so a dent also scuffs the paint in the same pass (no decal atlas).
//   * Each part is its own Group with its origin at the hinge/hub, so hinging, detaching and rolling are trivial.
//
// State machine per detachable part:  fixed → loose (hinged: swings ajar on a damped spring) → detached (Rapier body)
import * as THREE from 'three';
import { wake } from './intact.js';
import { ownGeometry } from './instance.js';

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

/** Dent a BufferGeometry in place. Point/dir are in the geometry's local space. Returns number of vertices moved. */
export function dentGeometry(geo, c, dir, { radius = 0.22, depth = 0.05, crease = 0.3, scuff = 0.45, seed = 1 } = {}) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color, n = pos.count;
  if (!geo.userData.rest) geo.userData.rest = { pos: pos.array.slice(), col: col ? col.array.slice() : null };
  // surface normal at the impact = average of normals in the patch (robust for curved / thin shells)
  _a.set(0, 0, 0); let cnt = 0; const r2 = radius * radius;
  for (let i = 0; i < n; i++) {
    const dx = pos.getX(i) - c.x, dy = pos.getY(i) - c.y, dz = pos.getZ(i) - c.z;
    if (dx * dx + dy * dy + dz * dz < r2 * 0.5) { _a.x += nor.getX(i); _a.y += nor.getY(i); _a.z += nor.getZ(i); cnt++; }
  }
  if (!cnt) return 0;
  _a.normalize();
  _d.copy(dir).normalize().multiplyScalar(0.5).addScaledVector(_a, -0.5).normalize(); // blend "into the surface" with travel direction
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    const d = Math.sqrt(d2) / radius, w = (1 - d * d) * (1 - d * d);
    const wob = 1 + crease * Math.sin(d * 11 + seed * 3.1) * (1 - d);             // crumple ripples
    const m = depth * w * wob;
    pos.setXYZ(i, x + _d.x * m, y + _d.y * m, z + _d.z * m);
    if (col && scuff) {
      const k = 1 - scuff * w;
      col.setXYZ(i, col.getX(i) * k * 0.98, col.getY(i) * k * 0.96, col.getZ(i) * k * 0.94);
    }
    moved++;
  }
  pos.needsUpdate = true; if (col) col.needsUpdate = true;
  geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
  return moved;
}
export function restoreGeometry(geo) {
  const r = geo.userData.rest; if (!r) return;
  geo.attributes.position.array.set(r.pos); geo.attributes.position.needsUpdate = true;
  if (r.col) { geo.attributes.color.array.set(r.col); geo.attributes.color.needsUpdate = true; }
  geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
}

export class DamageSim {
  static async create(scene, RAPIER, { gravity = -12 } = {}) {
    await RAPIER.init();
    const s = new DamageSim(); s.R = RAPIER; s.scene = scene;
    s.world = new RAPIER.World({ x: 0, y: gravity, z: 0 }); s.world.timestep = 1 / 120;
    const g = s.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    s.world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setFriction(0.9).setRestitution(0.25), g);
    s.cars = []; s.debris = []; s.particles = []; s.time = 0; s.rand = mulberry(7);
    s.shardGeo = new THREE.BoxGeometry(0.05, 0.004, 0.05);
    return s;
  }
  constructor() { this.events = []; }

  /** Register a car built by cruze.js: creates chassis collider proxies and per-part damage state. */
  addCar(car, { position = [0, 0, 0], yaw = 0 } = {}) {
    car.position.set(...position); car.rotation.y = yaw; car.updateMatrixWorld(true);
    const R = this.R, st = { parts: {}, shake: 0, missingWheels: {} };
    car.userData.dmg = st;
    // chassis proxies (fixed): model-provided boxes (contract's col_chassis / col_cabin), Cruze defaults otherwise
    const proxy = car.userData.proxy ?? [{ half: [0.86, 0.36, 1.7], offset: [0, 0.68, 0] }, { half: [0.66, 0.3, 0.75], offset: [0, 1.3, -0.1] }];
    const pose = { p: car.position.toArray(), q: _q.setFromEuler(new THREE.Euler(0, yaw, 0)).clone() };
    st.home = pose; st.proxy = proxy;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...pose.p).setRotation(pose.q));
    for (const c of proxy) this.world.createCollider(R.ColliderDesc.cuboid(...c.half).setTranslation(...c.offset).setFriction(0.6).setRestitution(0.2), body);
    st.chassisBody = body;
    for (const [id, part] of Object.entries(car.userData.parts)) {
      const jj = part.userData.jj; if (!jj) continue;
      part.userData.home = part.position.toArray(); part.userData.homeParent = part.parent;
      st.parts[id] = { id, part, jj, hp: jj.hp, hpMax: jj.hp, state: 'fixed', ang: 0, angVel: 0, target: 0, dents: [], wobble: 0 };
    }
    this.cars.push(car); return car;
  }

  meshesOf(part) { const m = []; part.traverse((o) => { if (o.isMesh) m.push(o); }); return m; }

  /** Pick the part under a world-space ray. */
  pick(car, raycaster) {
    const meshes = [];
    if (car.userData.intact?.visible) meshes.push(...this.meshesOf(car.userData.intact));
    else for (const p of Object.values(car.userData.dmg.parts)) if (p.state !== 'detached') meshes.push(...this.meshesOf(p.part));
    const hit = raycaster.intersectObjects(meshes, false)[0]; if (!hit) return null;
    let o = hit.object; if (car.userData.intact?.children.includes(o)) return { partId: this.nearestPart(car, hit.point), point: hit.point.clone(), normal: null };
    while (o && !(o.userData.jj)) o = o.parent;
    return o ? { partId: o.userData.jj.id, point: hit.point.clone(), normal: hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null } : null;
  }

  /** when the merged intact proxy was hit, attribute the hit to the closest part by bounding box */
  nearestPart(car, wp) {
    let best = null, bd = 1e9; const b = new THREE.Box3(), lp = car.worldToLocal(wp.clone());
    for (const P of Object.values(car.userData.dmg.parts)) {
      if (P.state === 'detached' || P.id === 'chassis') continue; b.makeEmpty(); const part = P.part; part.updateWorldMatrix(true, true);
      for (const m of this.meshesOf(part)) { const bb = m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox); const mb = bb.clone().applyMatrix4(new THREE.Matrix4().copy(car.matrixWorld).invert().multiply(m.matrixWorld)); b.union(mb); }
      const d = b.distanceToPoint(lp); if (d < bd) { bd = d; best = P.id; }
    }
    return bd < 0.06 ? best : 'chassis';
  }

  /** Apply one collision episode: world point, world direction of the impactor's travel, severity ≈ 0..1.5 */
  hit(car, { partId, point, dir, severity = 0.7, radius }) {
    const st = car.userData.dmg, P = st.parts[partId]; if (!P || P.state === 'detached') return null;
    wake(car); car.updateMatrixWorld(true); const events = [];
    const isWheel = P.jj.kind === 'wheel', dentable = !isWheel;
    if (dentable) {
      const r0 = radius ?? 0.16 + 0.14 * severity, d0 = 0.028 + 0.075 * severity;
      const apply = (target, scuff, r = r0, depth = d0) => {
        for (const m of this.meshesOf(target)) {
          if (!m.userData.dentable) continue;
          ownGeometry(m);
          m.updateMatrixWorld(true);
          const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
          const lp = point.clone().applyMatrix4(inv), ld = dir.clone().transformDirection(inv);
          if (dentGeometry(m.geometry, lp, ld, { radius: r, depth, seed: P.dents.length + 1, scuff })) if (scuff) P.dents.push({ mesh: m.name, p: lp.toArray(), d: ld.toArray(), r, depth, sev: severity });
        }
      };
      apply(P.part, 0.45);
      // the body shell behind a panel takes the same dent (no scuff) so a deep dent never pokes through to the dark under-panel
      const shell = st.parts.chassis?.part; if (shell && shell !== P.part) apply(shell, 0, r0 * 1.3, d0 * 1.4);
    }
    const before = P.hp; P.hp -= severity * (P.jj.kind === 'lamp' || P.jj.kind === 'glass' ? 90 : 55);
    st.shake = Math.min(1, st.shake + severity * 0.6);
    if (car.userData.isBin && !st.dynamic && ((partId === 'chassis' && severity >= 0.55) || severity >= 1.3)) this.knock(car, dir.clone().setY(0).normalize(), 1.5 + 3.2 * severity);
    // state transitions
    if (P.hp <= 0 && P.jj.kind !== 'core') { this.detach(car, partId, { dir, severity, point }); events.push('detach'); }
    else if (P.hp <= P.hpMax * 0.6 && P.state === 'fixed' && (P.jj.hinge || isWheel)) { this.loosen(car, partId, severity); events.push('loose'); }
    else if (P.state === 'loose') P.angVel += severity * 6 * (this.rand() < 0.5 ? -1 : 1);
    if (P.jj.kind === 'lamp' && P.hp < P.hpMax * 0.5) this.breakLamp(P);
    return { partId, before, after: P.hp, state: P.state, events };
  }

  loosen(car, id, severity) {
    const P = car.userData.dmg.parts[id]; P.state = 'loose';
    if (P.jj.kind === 'door') P.target = 0.55 + 0.4 * this.rand();
    else if (P.jj.kind === 'lid') P.target = 0.3 + 0.25 * this.rand();
    else if (P.jj.kind === 'wheel') P.wobble = 1;
    P.angVel += 3 * severity;
  }

  breakLamp(P) {
    if (P.broken) return; P.broken = true;
    for (const m of this.meshesOf(P.part)) {
      const col = m.geometry.attributes.color;
      if (m.userData.kind === 'emit' || m.userData.kind === 'glass') {
        for (let i = 0; i < col.count; i++) if (m.userData.kind === 'emit') col.setXYZ(i, 0.06, 0.06, 0.07); else col.setXYZ(i, col.getX(i) * 0.35, col.getY(i) * 0.35, col.getZ(i) * 0.38);
        col.needsUpdate = true;
      }
    }
    this.shards(P.part.getWorldPosition(new THREE.Vector3()), 14, '#dff1ff');
  }

  /** Turn a part into a free rigid body that keeps its dented shape, hinge pose and momentum. */
  detach(car, id, { dir, severity = 0.7, point } = {}) {
    const st = car.userData.dmg, P = st.parts[id]; if (P.state === 'detached') return;
    const R = this.R; P.state = 'detached'; P.hp = 0;
    const part = P.part; part.updateWorldMatrix(true, false);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3(); part.matrixWorld.decompose(wp, wq, ws);
    if (P.jj.kind === 'glass') { part.visible = false; this.shards(wp, 40, '#bfe0f5'); return; }
    this.scene.attach(part);
    // collider from the part's own geometry: convex hull of a vertex subsample (thin panels stay panels)
    const pts = []; const tmp = new THREE.Vector3();
    part.updateMatrixWorld(true);
    for (const m of this.meshesOf(part)) {
      const pa = m.geometry.attributes.position, step = Math.max(1, Math.floor(pa.count / 90));
      const toPart = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(m.matrixWorld);
      for (let i = 0; i < pa.count; i += step) { tmp.fromBufferAttribute(pa, i).applyMatrix4(toPart); pts.push(tmp.x, tmp.y, tmp.z); }
    }
    const kick = dir ? dir.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const speed = 2.5 + 7 * severity;
    const lv = kick.multiplyScalar(speed).add(new THREE.Vector3((this.rand() - 0.5) * 2, 2.5 + 3 * this.rand(), (this.rand() - 0.5) * 2));
    const bd = R.RigidBodyDesc.dynamic().setTranslation(wp.x, wp.y, wp.z).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
      .setLinvel(lv.x, lv.y, lv.z).setAngvel({ x: (this.rand() - 0.5) * 9, y: (this.rand() - 0.5) * 9, z: (this.rand() - 0.5) * 9 })
      .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.15);
    const body = this.world.createRigidBody(bd);
    let cd;
    if (P.jj.kind === 'wheel') {
      cd = R.ColliderDesc.cylinder(P.jj.width / 2, P.jj.radius).setRotation(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).clone()).setFriction(1.1).setRestitution(0.35);
      body.setAngvel({ x: -speed / P.jj.radius * Math.sign(kick.z || 1) * 0.3, y: 0, z: 0 }, true);
    } else {
      cd = R.ColliderDesc.convexHull(new Float32Array(pts)) || R.ColliderDesc.cuboid(0.3, 0.05, 0.3);
      cd.setFriction(0.7).setRestitution(0.3);
    }
    cd.setMass(P.jj.mass || 5); this.world.createCollider(cd, body);
    this.debris.push({ id, part, body, car, parent: car }); P.body = body;
    car.userData.dmg.missingWheels[id] = P.jj.kind === 'wheel';
    if (P.jj.kind === 'lamp') this.breakLamp(P);
    for (const Q of Object.values(car.userData.dmg.parts)) if (Q.jj.releasedBy === id && Q.state !== 'detached') this.detach(car, Q.id, { dir: new THREE.Vector3((this.rand() - 0.5) * 2, 0.6, (this.rand() - 0.5) * 2), severity: 0.15 + 0.2 * this.rand() });
  }

  /** knock a (bin-like) prop over: swap its fixed proxy for a dynamic body carrying the whole group */
  knock(car, dir, speed = 3) {
    const st = car.userData.dmg; if (st.dynamic) return; const R = this.R;
    this.world.removeRigidBody(st.chassisBody);
    const bd = R.RigidBodyDesc.dynamic().setTranslation(...car.position.toArray()).setRotation({ x: car.quaternion.x, y: car.quaternion.y, z: car.quaternion.z, w: car.quaternion.w })
      .setLinvel(dir.x * speed, 1.2 + speed * 0.25, dir.z * speed).setAngvel({ x: dir.z * speed * 1.2, y: (this.rand() - 0.5) * 2, z: -dir.x * speed * 1.2 }).setCcdEnabled(true).setAngularDamping(0.4);
    const body = this.world.createRigidBody(bd);
    for (const c of st.proxy) this.world.createCollider(R.ColliderDesc.cuboid(...c.half).setTranslation(...c.offset).setFriction(0.8).setRestitution(0.25).setMass(6 / st.proxy.length), body);
    st.dynamic = body; st.chassisBody = body;
  }

  shardMat(color) { this._sm ??= new Map(); if (!this._sm.has(color)) this._sm.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 })); return this._sm.get(color); }
  /** cosmetic glass shards (contract §8.1: glass → particles only). They persist for the round like other debris — cleared by reset(). */
  shards(at, n, color = '#cfe8ff') {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.shardGeo, this.shardMat(color));
      m.position.copy(at).add(new THREE.Vector3((this.rand() - 0.5) * 0.3, (this.rand() - 0.5) * 0.15, (this.rand() - 0.5) * 0.3));
      m.rotation.set(this.rand() * 6, this.rand() * 6, this.rand() * 6); m.scale.setScalar(0.6 + this.rand());
      this.scene.add(m);
      this.particles.push({ m, v: new THREE.Vector3((this.rand() - 0.5) * 4, 1 + this.rand() * 3.5, (this.rand() - 0.5) * 4), w: new THREE.Vector3(this.rand() * 12, this.rand() * 12, this.rand() * 12), life: Infinity });
    }
  }

  /** Advance the simulation by dt seconds (fixed 1/120 internal step for determinism). */
  step(dt) {
    let t = dt; const h = 1 / 120;
    while (t > 1e-9) {
      const s = Math.min(h, t); t -= s; this.time += s;
      for (const car of this.cars) this.stepCar(car, s);
      this.world.timestep = s; this.world.step();
      for (const car of this.cars) { const b = car.userData.dmg.dynamic; if (b) { const p = b.translation(), q = b.rotation(); car.position.set(p.x, p.y, p.z); car.quaternion.set(q.x, q.y, q.z, q.w); } }
      for (const d of this.debris) { const p = d.body.translation(), q = d.body.rotation(); d.part.position.set(p.x, p.y, p.z); d.part.quaternion.set(q.x, q.y, q.z, q.w); }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i]; p.v.y -= 12 * s; p.m.position.addScaledVector(p.v, s); p.m.rotation.x += p.w.x * s; p.m.rotation.z += p.w.z * s;
        if (p.m.position.y < 0.003) { p.m.position.y = 0.003; p.v.multiplyScalar(0.2); p.v.y = Math.abs(p.v.y) * 0.2; p.w.multiplyScalar(0.5); }
        if ((p.life -= s) < 0) { this.scene.remove(p.m); this.particles.splice(i, 1); }
      }
      for (const car of this.cars) this.eventsRun(car);
    }
  }
  eventsRun() {}

  stepCar(car, dt) {
    const st = car.userData.dmg;
    this.stepParts(car, dt, st);
    if (st.dynamic) return;                                            // dynamic props are driven by their rigid body
    // a missing wheel drops that corner: small roll/pitch of the whole car (visual only)
    let droopX = 0, droopZ = 0, missing = 0;
    for (const id of Object.keys(st.missingWheels)) if (st.missingWheels[id]) {
      const sx = id.endsWith('L') ? 1 : -1, sz = id.includes('_F') ? 1 : -1;     // kit +X is the car's left droopX += -sx * 0.045; droopZ += sz * 0.03; missing++;
    }
    const rx = car.userData.baseRot ?? (car.userData.baseRot = { x: car.rotation.x, z: car.rotation.z });
    st.roll = (st.roll ?? 0) + (droopX - (st.roll ?? 0)) * Math.min(1, dt * 6); st.pitch = (st.pitch ?? 0) + (droopZ - (st.pitch ?? 0)) * Math.min(1, dt * 6);
    car.rotation.z = rx.z + st.roll; car.rotation.x = rx.x - st.pitch;
    car.position.y = (st.home?.p[1] ?? 0) - 0.06 * Math.min(2, missing);
    st.shake = Math.max(0, st.shake - dt * 3);
    if (st.shake > 0) { car.position.y += Math.sin(this.time * 90) * 0.008 * st.shake; car.rotation.z += Math.sin(this.time * 70) * 0.006 * st.shake; }
  }
  stepParts(car, dt, st) {
    for (const P of Object.values(st.parts)) {
      const j = P.jj;
      if (P.state === 'loose' && j.hinge) {          // damped spring toward the "ajar" angle, kicked by hits
        const k = 38, c = 2.6; P.angVel += (k * (P.target - P.ang) - c * P.angVel) * dt; P.ang += P.angVel * dt;
        P.ang = Math.min(P.ang, j.hinge.max); if (P.ang < -0.05) { P.ang = -0.05; P.angVel = Math.abs(P.angVel) * 0.3; }
        if (j.kind === 'door') P.part.rotation.y = -j.hinge.sign * P.ang; else P.part.rotation.x = j.hinge.sign * P.ang;
      }
      if (P.state === 'loose' && j.kind === 'wheel') {  // wobbly wheel: camber sway + toe flutter
        P.wobble = Math.max(0.35, P.wobble - dt * 0.05); const w = Math.sin(this.time * 14) * 0.16 * P.wobble;
        P.part.rotation.z = w * Math.sign(P.part.position.x); P.part.rotation.y = Math.sin(this.time * 11 + 1) * 0.12 * P.wobble;
      }
    }
  }

  reset(car) {
    const st = car.userData.dmg;
    for (const P of Object.values(st.parts)) {
      if (P.body) { this.world.removeRigidBody(P.body); this.debris = this.debris.filter((d) => d.body !== P.body); P.body = null; }
      P.part.visible = true; { const hp = P.part.userData.homeParent ?? car; if (P.part.parent !== hp) hp.add(P.part); }
      P.part.position.set(...(P.jj.hinge ? P.jj.hinge.point : P.part.userData.home ?? P.part.position.toArray()));
      P.part.quaternion.identity(); P.part.rotation.set(0, 0, 0);
      for (const m of this.meshesOf(P.part)) if (m.geometry.userData.rest) restoreGeometry(m.geometry);
      P.hp = P.hpMax; P.state = 'fixed'; P.ang = 0; P.angVel = 0; P.dents.length = 0; P.broken = false; P.wobble = 0;
    }
    st.missingWheels = {}; st.roll = st.pitch = 0;
    if (st.dynamic) { this.world.removeRigidBody(st.dynamic); st.dynamic = null;
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(...st.home.p).setRotation(st.home.q));
      for (const c of st.proxy) this.world.createCollider(this.R.ColliderDesc.cuboid(...c.half).setTranslation(...c.offset).setFriction(0.6).setRestitution(0.2), body);
      st.chassisBody = body; car.position.set(...st.home.p); car.quaternion.copy(st.home.q); }
    for (const p of this.particles) this.scene.remove(p.m); this.particles.length = 0;
  }
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
