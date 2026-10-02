// vehicle.js — descriptor → per-LOD TEMPLATE (shared geometry + baked morphs) → per-car VEHICLE (scene graph + damage state).
//
//   makeTemplate(desc)       node-safe. Per part and slot: assembly geometry = vis ∪ occ layers, with one relative morph target per
//                            declared channel (position + Jacobian-correct normal deltas). Intact geometry = vis layers of every
//                            non-wheel part merged per slot, no morphs (it is never shown damaged).
//   new Vehicle(tpls, opts)  browser. One Mesh per (part, slot) whose geometry is SWAPPED on LOD change (influences restored),
//                            plus one intact Mesh per slot. Gameplay code only sees part ids, channels and states — never a LOD.
//
// Part lifecycle: fixed → damaged → loose → detached (not every part uses every state). Channels: zones on everything attached,
// dent_<panel> on the panel and its riders. Detached parts freeze their influences: a door keeps the crush it had when it left.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SLOTS, triCount } from './kit/slots.js';
import { warpGeometry } from './kit/shell.js';
import { ZONES, combined } from './fields.js';

export function makeTemplate(desc) {
  const t0 = performance.now(), parts = {}, intactList = {};
  for (const [id, p] of Object.entries(desc.parts)) {
    const toKit = new THREE.Matrix4().makeTranslation(...p.pivot), slots = {};
    for (const s of SLOTS) {
      if (p.meta.kind !== 'wheel') for (const l of desc.lodSpec.intactShells ? ['vis', 'panel'] : ['vis']) if (p.layers[l][s]) (intactList[s] ??= []).push(p.layers[l][s].clone().applyMatrix4(toKit));
      const list = [p.layers.vis[s], p.layers.panel[s], p.layers.occ[s]].filter(Boolean);
      if (!list.length) continue;
      const g = list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
      g.morphTargetsRelative = true; g.morphAttributes.position = []; g.morphAttributes.normal = []; g.morphAttributes.color = [];
      for (const ch of p.meta.channels) {
        const f0 = desc.fields[ch]; if (!f0) continue;
        // coarse LODs have no cavity under a panel (solid body): panel dents keep their meaning but shrink to stay outside the body;
        // the scuff colour still uses the full-size dent so the damage reads the same at that distance
        const ds = ch.startsWith('dent_') ? desc.lodSpec.dentScale ?? 1 : 1, f = ds === 1 ? f0 : (x, y, z, o) => { f0(x, y, z, o); o[0] *= ds; o[1] *= ds; o[2] *= ds; };
        const { pos, nor } = warpGeometry(g, f, toKit), P0 = g.attributes.position.array, N0 = g.attributes.normal.array;
        for (let i = 0; i < pos.length; i++) { pos[i] -= P0[i]; nor[i] -= N0[i]; }
        // colour morph: paint scuffs and darkens where the warp moved it (up to −35 % at ≥ 15 cm), so crush reads at a distance
        const C0 = g.attributes.color.array, col = new Float32Array(C0.length);
        for (let i = 0; i < pos.length / 3; i++) { const m = Math.min(1, Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) / (0.15 * ds)), k = 0.35 * m * m; for (let c = 0; c < 3; c++) col[i * 3 + c] = -C0[i * 3 + c] * k; }
        const pa = new THREE.BufferAttribute(pos, 3), na = new THREE.BufferAttribute(nor, 3), ca = new THREE.BufferAttribute(col, 3); pa.name = na.name = ca.name = ch;
        g.morphAttributes.position.push(pa); g.morphAttributes.normal.push(na); (g.morphAttributes.color ??= []).push(ca);
      }
      if (!g.morphAttributes.position.length) { g.morphAttributes = {}; g.morphTargetsRelative = false; }
      g.computeBoundingSphere(); g.computeBoundingBox();
      // morphs can move vertices outside the rest bounds: pad the culling sphere by the largest displacement
      let m = 0; for (const a of g.morphAttributes.position ?? []) for (let i = 0; i < a.array.length; i += 3) m = Math.max(m, Math.hypot(a.array[i], a.array[i + 1], a.array[i + 2]));
      g.boundingSphere.radius += m; g.userData.maxMorph = m;
      slots[s] = g;
    }
    parts[id] = { id, pivot: p.pivot, meta: p.meta, slots };
  }
  const intact = Object.fromEntries(Object.entries(intactList).map(([s, l]) => { const g = mergeGeometries(l, false); g.computeBoundingSphere(); return [s, g]; }));
  return { lod: desc.lod, role: desc.role, desc, parts, intact, ms: +(performance.now() - t0).toFixed(1) };
}
export const geoBytes = (g) => { if (!g) return 0; let b = g.index ? g.index.array.byteLength : 0; for (const a of Object.values(g.attributes)) b += a.array.byteLength; for (const l of Object.values(g.morphAttributes)) for (const a of l) b += a.array.byteLength; return b; };
export function templateStats(tpl) {
  const intactTris = Object.values(tpl.intact).reduce((a, g) => a + triCount(g), 0);
  let assemblyTris = 0, bytes = 0, meshes = 0, wheelTris = 0;
  for (const p of Object.values(tpl.parts)) for (const g of Object.values(p.slots)) { assemblyTris += triCount(g); bytes += geoBytes(g); meshes++; if (p.meta.kind === 'wheel') wheelTris += triCount(g); }
  for (const g of Object.values(tpl.intact)) bytes += geoBytes(g);
  return { lod: tpl.lod, intactTris: intactTris + wheelTris, assemblyTris, intactDraws: Object.keys(tpl.intact).length + 4, assemblyDraws: meshes, bytes };
}

const EMPTY = new THREE.BufferGeometry();
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export class Vehicle {
  /** tpls: one template per LOD (index = LOD). mats: from kit/materials.js carMaterials(). */
  constructor(tpls, mats, { lod = 1, name = 'car' } = {}) {
    this.tpls = tpls; this.mats = mats; this.lod = lod; this.mode = 'intact';
    this.root = new THREE.Group(); this.root.name = name; this.root.userData.vehicle = this;
    this.channels = Object.fromEntries([...ZONES, ...Object.keys(tpls[0].desc.fields).filter((k) => k.startsWith('dent_'))].map((k) => [k, 0]));
    this.parts = {}; this.wreck = false; this.events = [];
    const t = tpls[lod];
    // intact fast path
    this.intact = new THREE.Group(); this.intact.name = 'intact';
    this.intactMeshes = {};
    for (const s of ['paint', 'trim', 'glass', 'lamp']) { const m = new THREE.Mesh(t.intact[s] ?? EMPTY, mats[s]); m.castShadow = s !== 'glass'; m.receiveShadow = true; m.name = 'intact:' + s; m.visible = !!t.intact[s]; this.intact.add(m); this.intactMeshes[s] = m; }
    this.root.add(this.intact);
    // damage-ready assembly
    this.assembly = new THREE.Group(); this.assembly.name = 'assembly'; this.root.add(this.assembly);
    const ids = Object.keys(t.parts);
    for (const id of ids) {
      const tp = t.parts[id], meta = tp.meta, g = new THREE.Group(); g.name = id;
      const slotSet = new Set(); for (const tl of tpls) for (const s of Object.keys(tl.parts[id].slots)) slotSet.add(s);
      const meshes = {};
      let holder = g;
      if (meta.kind === 'wheel') { holder = new THREE.Group(); holder.name = id + '_spin'; g.add(holder); }
      for (const s of slotSet) { const m = new THREE.Mesh(EMPTY, mats[s]); m.name = `${id}:${s}`; m.castShadow = s !== 'glass'; m.receiveShadow = true; holder.add(m); meshes[s] = m; }
      this.parts[id] = { id, meta, group: g, spin: meta.kind === 'wheel' ? holder : null, meshes, state: 'fixed', hp: meta.hp, ang: 0, angVel: 0, target: 0, lod, frozen: null, home: tp.pivot };
    }
    for (const id of ids) {   // hierarchy: mirrors ride their door; everything else hangs off the root at its pivot (kit space)
      const P = this.parts[id], parent = P.meta.parentPart ? this.parts[P.meta.parentPart] : null;
      if (parent) { parent.group.add(P.group); P.group.position.set(P.home[0] - parent.home[0], P.home[1] - parent.home[1], P.home[2] - parent.home[2]); }
      else { this.assembly.add(P.group); P.group.position.set(...P.home); }
    }
    // wheels are always separate objects (they spin); in intact mode they are the only visible part meshes
    for (const P of Object.values(this.parts)) if (P.meta.kind === 'wheel') this.root.add(P.group);
    this.setLod(lod, true);
    this.showIntact();
  }
  get ids() { return Object.keys(this.parts); }
  showIntact() { this.mode = 'intact'; this.intact.visible = true; this.assembly.visible = false; }
  /** first meaningful hit: swap the merged intact meshes for the part assembly (identical at zero damage, see gates) */
  wake() { if (this.mode === 'intact') { this.mode = 'assembly'; this.intact.visible = false; this.assembly.visible = true; } }

  /** LOD for everything still attached. Detached parts choose their own LOD (setPartLod). */
  setLod(lod, force = false) {
    if (lod === this.lod && !force) return; this.lod = lod; const t = this.tpls[lod]; const wasBaked = !!this.baked; this.unbake();
    for (const [s, m] of Object.entries(this.intactMeshes)) { m.geometry = t.intact[s] ?? EMPTY; m.visible = !!t.intact[s]; }
    for (const P of Object.values(this.parts)) if (P.state !== 'detached' && P.state !== 'carried') this.setPartLod(P.id, lod, true);
    if (wasBaked) this.bakeWreck();
  }
  setPartLod(id, lod, force = false) {
    const P = this.parts[id]; if (P.lod === lod && !force) return; P.lod = lod;
    const tp = this.tpls[lod].parts[id];
    for (const [s, m] of Object.entries(P.meshes)) {
      const g = tp.slots[s] ?? EMPTY; m.geometry = g; m.visible = g !== EMPTY;
      if (g.morphAttributes.position?.length) { m.updateMorphTargets(); this.applyInfluences(P, m); } else { m.morphTargetInfluences = undefined; m.morphTargetDictionary = undefined; }
    }
    for (const Q of Object.values(this.parts)) if (Q.meta.parentPart === id && Q.state === 'carried') this.setPartLod(Q.id, lod, force);
  }
  applyInfluences(P, m) {
    const src = P.frozen ?? this.channels;
    for (const [k, i] of Object.entries(m.morphTargetDictionary ?? {})) m.morphTargetInfluences[i] = src[k] ?? 0;
  }
  /** set a channel 0..1 on every attached part that declares it; wheel hubs follow the zones */
  setChannel(name, v) {
    this.unbake();
    this.channels[name] = Math.max(0, Math.min(1, v));
    for (const P of Object.values(this.parts)) if (!P.frozen && P.meta.channels.includes(name)) for (const m of Object.values(P.meshes)) if (m.morphTargetDictionary) this.applyInfluences(P, m);
    if (ZONES.includes(name)) this.updateHubs();
  }
  updateHubs() {
    const w = Object.fromEntries(ZONES.map((z) => [z, this.channels[z]])), f = combined(this.tpls[0].desc.fields, w), d = [0, 0, 0];
    for (const P of Object.values(this.parts)) {
      if (P.meta.kind !== 'wheel' || P.state === 'detached') continue;
      f(...P.home, d); P.group.position.set(P.home[0] + d[0], P.home[1] + d[1], P.home[2] + d[2]);
      const crush = Math.hypot(d[0], d[2]);   // a crushed corner bends the wheel in: toe + camber, for the comedy
      P.group.rotation.set(0, Math.sign(P.home[2]) * Math.sign(P.home[0]) * crush * 0.9, -Math.sign(P.home[0]) * crush * 0.6);
    }
  }

  // ── part lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────────
  loosen(id, kick = 1) {
    this.unbake();
    const P = this.parts[id]; if (P.state === 'detached' || P.state === 'loose') return; P.state = 'loose';
    if (P.meta.kind === 'door') P.target = 0.55 + 0.25 * kick; else if (P.meta.kind === 'lid') P.target = 0.35 + 0.2 * kick; else if (P.meta.kind === 'wheel') P.wobble = 1;
    P.angVel += 3 * kick; this.events.push({ t: 'loose', id });
  }
  /** Freeze influences, keep world pose, hand the part's group to the caller (the sim gives it a body). Riders follow. */
  release(id, scene) {
    this.unbake();
    const P = this.parts[id]; if (P.state === 'detached') return null;
    this.wake(); P.state = 'detached'; P.hp = 0; P.frozen = { ...this.channels };
    P.group.updateWorldMatrix(true, false); scene.attach(P.group);
    const out = [P];
    for (const Q of Object.values(this.parts)) if (Q.meta.parentPart === id && Q.state !== 'detached') { Q.state = 'carried'; Q.frozen = { ...this.channels }; }   // mirror leaves with its door
    for (const Q of Object.values(this.parts)) if (Q.state !== 'detached' && (Q.meta.releasedBy === id)) out.push(...(this.release(Q.id, scene) ?? []));
    this.events.push({ t: 'detach', id });
    return out;
  }
  smashGlass(shared) { this.unbake(); const P = this.parts.glass; if (!P || P.state === 'smashed') return; this.wake(); P.state = 'smashed'; for (const m of Object.values(P.meshes)) m.material = shared.glassSmashed; this.events.push({ t: 'smash', id: 'glass' }); }
  breakLamp(id, shared) { this.unbake(); const P = this.parts[id]; if (!P || P.broken) return; P.broken = true; if (P.meshes.lamp) P.meshes.lamp.material = shared.lampDead; }

  /** visual hinge springs + wheel wobble (attached parts only) */
  step(dt, time) {
    for (const P of Object.values(this.parts)) {
      if (P.state !== 'loose') continue; const h = P.meta.hinge;
      if (h) {
        P.angVel += (38 * (P.target - P.ang) - 2.6 * P.angVel) * dt; P.ang += P.angVel * dt;
        P.ang = Math.min(P.ang, h.max); if (P.ang < -0.03) { P.ang = -0.03; P.angVel = Math.abs(P.angVel) * 0.3; }
        if (P.meta.kind === 'door') P.group.rotation.y = -h.sign * P.ang; else P.group.rotation.x = h.sign * P.ang;
      }
      if (P.meta.kind === 'wheel' && P.spin) { P.wobble = Math.max(0.35, (P.wobble ?? 1) - dt * 0.05); P.spin.rotation.z = Math.sin(time * 14) * 0.14 * P.wobble; }
    }
  }
  /** set a hinge angle directly (deterministic showcase / validation renders) */
  setOpen(id, ang) { const P = this.parts[id], h = P.meta.hinge; P.ang = ang; if (P.meta.kind === 'door') P.group.rotation.y = -h.sign * ang; else P.group.rotation.x = h.sign * ang; }

  /**
   * Wreck re-bake (render batching, not physical merging): evaluate every attached part's morphs on the CPU at its current
   * influences and pose, merge per slot into the root's space → 4 meshes instead of ~40. Physics, part ids and state are untouched;
   * unbake() (or any hit via wake/setChannel) returns to the live assembly. Re-baked on LOD change.
   */
  bakeWreck() {
    this.unbake(); this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert(), per = {};
    for (const P of Object.values(this.parts)) {
      if (P.state === 'detached') continue;
      for (const [s, m] of Object.entries(P.meshes)) {
        if (!m.visible || m.geometry === EMPTY) continue; let o = m; let vis = true; while (o && o !== this.root) { if (!o.visible) vis = false; o = o.parent; } if (!vis) continue;
        const g0 = m.geometry, g = new THREE.BufferGeometry(), n = g0.attributes.position.count;
        const pos = new Float32Array(g0.attributes.position.array), nor = new Float32Array(g0.attributes.normal.array), col = new Float32Array(g0.attributes.color.array);
        const inf = m.morphTargetInfluences ?? [];
        inf.forEach((w, k) => { if (!w) return; const dp = g0.morphAttributes.position[k].array, dn = g0.morphAttributes.normal[k].array, dc = g0.morphAttributes.color?.[k]?.array; for (let i = 0; i < n * 3; i++) { pos[i] += w * dp[i]; nor[i] += w * dn[i]; if (dc) col[i] += w * dc[i]; } });
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        for (const a of ['uv', 'pbr', 'emit']) g.setAttribute(a, g0.attributes[a].clone());
        g.setIndex(g0.index.clone()); m.updateWorldMatrix(true, false); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); g.normalizeNormals?.();
        (per[m.material.uuid] ??= { mat: m.material, list: [] }).list.push(g);
      }
    }
    const grp = new THREE.Group(); grp.name = 'wreckBake';
    for (const { mat, list } of Object.values(per)) { const mm = new THREE.Mesh(mergeGeometries(list, false), mat); mm.castShadow = true; mm.receiveShadow = true; grp.add(mm); }
    this.root.add(grp); this.baked = grp; this.bakedLod = this.lod;
    this.assembly.visible = false; for (const P of Object.values(this.parts)) if (P.meta.kind === 'wheel' && P.state !== 'detached') P.group.visible = false;
  }
  unbake() {
    if (!this.baked) return; this.root.remove(this.baked); for (const m of this.baked.children) m.geometry.dispose(); this.baked = null;
    this.assembly.visible = this.mode === 'assembly'; for (const P of Object.values(this.parts)) if (P.meta.kind === 'wheel' && P.state !== 'detached') P.group.visible = true;
  }

  /** counts what would draw for this vehicle's own meshes (attached + its detached parts) */
  stats() {
    let tris = 0, draws = 0;
    this.root.traverse((o) => { if (!o.isMesh) return; let p = o; while (p) { if (!p.visible) return; p = p.parent; } draws++; tris += triCount(o.geometry); });
    for (const P of Object.values(this.parts)) if (P.state === 'detached') P.group.traverse((o) => { if (o.isMesh && o.visible) { draws++; tris += triCount(o.geometry); } });
    return { tris, draws };
  }
}
