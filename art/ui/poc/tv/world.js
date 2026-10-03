// world.js — the live 3D behind the TV mocks (P1-U02): a greybox outback loop, Spike J's Cruz Missile in every seat colour
// driving scripted laps, dust, scattered debris and a sky, plus a greybox derby bowl for the Overview reference. One
// WebGLRenderer draws every tile into its own viewport (scissored), the way Spike J's 24×24 bench does; cars are
// instanced per part and per LOD, so draws per tile stay constant in N. Nothing here is game code: it exists so the HUD
// and chrome are judged over real motion and their cost is measured, not guessed.
import * as THREE from 'three';
import { build, DEFAULT_P } from '../vendor/cruz/model.js';
import { carMaterial } from '../vendor/cruz/atlas.js';

const UP = new THREE.Vector3(0, 1, 0);
const TRACK_PTS = [[0, 0], [120, -10], [200, 40], [210, 120], [150, 170], [80, 140], [20, 190], [-80, 200], [-150, 140], [-160, 50], [-110, -20]];
const ROAD_W = 14;
const BOWL = { x: 2000, z: 0, r: 58 };
const LAPS = 3;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

export async function createWorld(canvas, { colors }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const backend = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

  let P = DEFAULT_P;
  try { P = await (await fetch('../vendor/cruz/params.json')).json(); } catch { /* defaults */ }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#f0d9b0', 160, 620);
  scene.add(new THREE.HemisphereLight('#fff6e6', '#9a6b45', 1.6));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.0);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  // Sky dome: a vertex-coloured gradient, cream at the horizon to festival blue overhead.
  {
    const g = new THREE.SphereGeometry(900, 24, 12);
    const col = [];
    const top = new THREE.Color('#5fa8e0'), hor = new THREE.Color('#f6e2bd');
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 900);
      const c = hor.clone().lerp(top, Math.pow(t, 0.55));
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -1;
    scene.add(sky);
  }

  // Ground: red earth with gentle colour noise.
  {
    const g = new THREE.PlaneGeometry(2400, 2400, 60, 60);
    g.rotateX(-Math.PI / 2);
    const r = rng(7), col = [], base = new THREE.Color('#c8622e');
    for (let i = 0; i < g.attributes.position.count; i++) {
      const c = base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.06);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
  }

  // Track: a closed loop of packed dirt with red and white kerbs.
  const curve = new THREE.CatmullRomCurve3(TRACK_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const trackLen = curve.getLength();
  const SAMPLES = 600;
  const frames = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES, p = curve.getPointAt(u % 1), t = curve.getTangentAt(u % 1);
    frames.push({ p, t, n: new THREE.Vector3().crossVectors(UP, t).normalize() });
  }
  function ribbon(off0, off1, y, colorAt) {
    const pos = [], col = [], idx = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const { p, n } = frames[i];
      const c = colorAt(i);
      for (const o of [off0, off1]) { pos.push(p.x + n.x * o, y, p.z + n.z * o); col.push(c.r, c.g, c.b); }
      if (i < SAMPLES) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }
  const dirt = new THREE.Color('#d39a62'), rut = new THREE.Color('#b9804c');
  const track = new THREE.Group();
  track.add(ribbon(-ROAD_W / 2, ROAD_W / 2, 0.02, () => dirt));
  track.add(ribbon(-3.2, -2.2, 0.03, () => rut), ribbon(2.2, 3.2, 0.03, () => rut));
  const red = new THREE.Color('#d8382c'), white = new THREE.Color('#f4efe4');
  track.add(ribbon(-ROAD_W / 2 - 1.2, -ROAD_W / 2, 0.05, (i) => ((i >> 2) & 1 ? red : white)));
  track.add(ribbon(ROAD_W / 2, ROAD_W / 2 + 1.2, 0.05, (i) => ((i >> 2) & 1 ? red : white)));
  scene.add(track);

  // Scenery: mesas on the horizon, spinifex, gum trees, tyre stacks, a windmill and some loose panels (debris).
  const scenery = new THREE.Group();
  scene.add(scenery);
  const R = rng(42);
  const offRoad = (minD, maxD) => {
    for (;;) {
      const a = R() * Math.PI * 2, d = minD + R() * (maxD - minD);
      const x = 25 + Math.cos(a) * d, z = 95 + Math.sin(a) * d;
      let near = Infinity;
      for (let i = 0; i < SAMPLES; i += 6) near = Math.min(near, Math.hypot(frames[i].p.x - x, frames[i].p.z - z));
      if (near > ROAD_W) return [x, z];
    }
  };
  function instanced(geo, mat, count, place) {
    const im = new THREE.InstancedMesh(geo, mat, count), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) { place(m, i); im.setMatrixAt(i, m); }
    scenery.add(im);
    return im;
  }
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  instanced(new THREE.CylinderGeometry(0.75, 1, 1, 7), new THREE.MeshLambertMaterial({ color: '#b9572c' }), 14, (m, i) => {
    const a = (i / 14) * Math.PI * 2 + R() * 0.3, d = 520 + R() * 160;
    v.set(25 + Math.cos(a) * d, 0, 95 + Math.sin(a) * d); s.set(40 + R() * 60, 30 + R() * 45, 40 + R() * 60);
    m.compose(v.setY(s.y / 2), q.setFromAxisAngle(UP, R() * 3), s);
  });
  instanced(new THREE.ConeGeometry(0.9, 1.1, 6), new THREE.MeshLambertMaterial({ color: '#c8b048' }), 420, (m) => {
    const [x, z] = offRoad(10, 330); s.setScalar(0.7 + R() * 0.8); m.compose(v.set(x, s.y * 0.5, z), q.setFromAxisAngle(UP, R() * 3), s);
  });
  const trunkG = new THREE.CylinderGeometry(0.25, 0.4, 7, 6); trunkG.translate(0, 3.5, 0);
  const crownG = new THREE.IcosahedronGeometry(3.4, 0); crownG.translate(0, 8.4, 0);
  const treeAt = Array.from({ length: 46 }, () => offRoad(18, 300));
  for (const [geo, color] of [[trunkG, '#e9e2d6'], [crownG, '#7d8e57']]) {
    instanced(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), treeAt.length, (m, i) => {
      s.setScalar(0.8 + ((i * 37) % 10) / 20); m.compose(v.set(treeAt[i][0], 0, treeAt[i][1]), q.setFromAxisAngle(UP, i), s);
    });
  }
  instanced(new THREE.CylinderGeometry(0.6, 0.6, 0.45, 10), new THREE.MeshLambertMaterial({ color: '#2a2a2c' }), 80, (m, i) => {
    const f = frames[(Math.floor(i / 4) * 31) % SAMPLES], side = (i >> 1) & 1 ? 1 : -1;
    v.copy(f.p).addScaledVector(f.n, side * (ROAD_W / 2 + 2.6 + (i & 1) * 1.2)).setY(0.25 + ((i >> 2) % 2) * 0.45);
    m.compose(v, q.identity(), s.setScalar(1));
  });
  {
    const wm = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 16, 0.4), new THREE.MeshLambertMaterial({ color: '#8d8f93' }));
    leg.position.y = 8;
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.2, 12), new THREE.MeshLambertMaterial({ color: '#c9ccd1' }));
    fan.rotation.x = Math.PI / 2; fan.position.set(0, 16, 0.4);
    wm.add(leg, fan); wm.position.set(70, 0, 60); scenery.add(wm);
  }
  const debrisColors = colors.map((c) => new THREE.Color(c));
  const debris = instanced(new THREE.BoxGeometry(1.2, 0.08, 0.9), new THREE.MeshLambertMaterial({ color: '#ffffff' }), 22, (m, i) => {
    const f = frames[(i * 97 + 40) % SAMPLES];
    v.copy(f.p).addScaledVector(f.n, (R() - 0.5) * (ROAD_W + 4)).setY(0.06);
    m.compose(v, q.setFromEuler(new THREE.Euler(R() * 0.4, R() * 6, R() * 0.4)), s.setScalar(1));
  });
  for (let i = 0; i < 22; i++) debris.setColorAt(i, debrisColors[i % debrisColors.length]);

  // Derby bowl (Overview reference only): a flat floor inside a lip, rocks round the outside.
  const bowl = new THREE.Group();
  {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(BOWL.r, 48), new THREE.MeshLambertMaterial({ color: '#d39a62' }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.03; bowl.add(floor);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(BOWL.r + 2, 2.2, 6, 48), new THREE.MeshLambertMaterial({ color: '#b9572c', flatShading: true }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.6; bowl.add(lip);
    const rr = rng(11);
    const rock = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, d = BOWL.r + 9 + rr() * 10, sc = 3 + rr() * 5;
      const m = new THREE.Mesh(rock, new THREE.MeshLambertMaterial({ color: '#c1652f', flatShading: true }));
      m.position.set(Math.cos(a) * d, sc * 0.5, Math.sin(a) * d); m.scale.set(sc, sc * (0.7 + rr()), sc); m.rotation.y = rr() * 6;
      bowl.add(m);
    }
    bowl.position.set(BOWL.x, 0, BOWL.z);
    scene.add(bowl);
  }

  // Cars: one InstancedMesh per part and LOD; per-car paint via instanceColor on the white paint key.
  const carMat = carMaterial({}, { paintKey: true });
  const lodSets = {};
  const cars = [];
  const blobMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });
  let blobs = null;
  const dustMat = new THREE.MeshLambertMaterial({ color: '#ecd2ad', transparent: true, opacity: 0.32, depthWrite: false, flatShading: true });
  let dust = null;
  const DUST_PER_CAR = 18;
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  let rings = null;
  const outlineGroup = new THREE.Group();
  scene.add(outlineGroup);
  const templates = { 0: build(P, 0), 1: build(P, 1), 2: build(P, 2) };
  const outlineGeo = (() => { const g = templates[1].parts.core.geometry.clone(); return g; })();

  let colorOffset = 0;
  function rebuildCars(n) {
    for (const set of Object.values(lodSets)) for (const im of set) { scene.remove(im); im.dispose(); }
    if (blobs) { scene.remove(blobs); blobs.dispose(); }
    if (dust) { scene.remove(dust); dust.dispose(); }
    if (rings) { scene.remove(rings); rings.dispose(); }
    const cap = Math.max(n, 1);
    for (const lod of [0, 1, 2]) {
      const groups = {};
      for (const [id, mesh] of Object.entries(templates[lod].parts)) (groups[id.startsWith('wheel') ? 'wheel' : id] ??= []).push(mesh);
      lodSets[lod] = Object.entries(groups).map(([key, meshes]) => {
        const im = new THREE.InstancedMesh(meshes[0].geometry, carMat, cap * meshes.length);
        im.userData = { key, meshes };
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(im);
        return im;
      });
    }
    blobs = new THREE.InstancedMesh(new THREE.CircleGeometry(1.6, 16).rotateX(-Math.PI / 2).scale(1, 1, 1.6), blobMat, cap);
    blobs.frustumCulled = false; blobs.renderOrder = 1; scene.add(blobs);
    dust = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 0), dustMat, cap * DUST_PER_CAR);
    dust.frustumCulled = false; dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(dust);
    rings = new THREE.InstancedMesh(new THREE.RingGeometry(2.6, 3.4, 32).rotateX(-Math.PI / 2), ringMat, cap);
    rings.frustumCulled = false; rings.visible = mode === 'overview'; scene.add(rings);
    const col = new THREE.Color();
    for (let i = 0; i < cap; i++) {
      col.set(colors[(i + colorOffset) % colors.length]);
      for (const set of Object.values(lodSets)) for (const im of set) for (let k = 0; k < im.userData.meshes.length; k++) im.setColorAt(i * im.userData.meshes.length + k, col);
      rings.setColorAt(i, col);
    }
  }

  function seedCars(n) {
    const r = rng(1234);
    while (cars.length < n) {
      const i = cars.length;
      cars.push({
        seat: i + 1,
        s: trackLen * 0.02 - (i % 4) * 0 - Math.floor(i / 4) * 9 + trackLen * 3, // grid rows of four, 9 m apart
        lane: ((i % 4) - 1.5) * 3.1,
        laneGoal: ((i % 4) - 1.5) * 3.1,
        skill: 0.9 + r() * 0.2,
        boost: r(),
        phase: r() * 10,
        pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), yaw: 0, speed: 0, spin: 0,
        wander: { x: (r() - 0.5) * 60, z: (r() - 0.5) * 60, t: 0 },
        dust: Array.from({ length: DUST_PER_CAR }, () => ({ p: new THREE.Vector3(0, -50, 0), age: 9 })),
        dustNext: 0,
        camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), camInit: false,
      });
    }
    cars.length = n;
  }

  let mode = 'race';
  let n = 0;
  function setCars(count, offset = 0) {
    seedCars(count);
    if (count !== n || offset !== colorOffset) { colorOffset = offset; rebuildCars(count); }
    n = count;
  }
  function setMode(m) {
    mode = m;
    track.visible = scenery.visible = m !== 'overview';
    bowl.visible = m === 'overview';
    if (rings) rings.visible = m === 'overview';
    if (m === 'overview') cars.forEach((c, i) => {
      const a = (i / Math.max(1, cars.length)) * Math.PI * 2;
      c.pos.set(BOWL.x + Math.cos(a) * 30, 0, BOWL.z + Math.sin(a) * 30); c.yaw = a + Math.PI / 2; c.camInit = false;
    });
  }

  const m4 = new THREE.Matrix4(), carM = new THREE.Matrix4(), off = new THREE.Matrix4(), spinM = new THREE.Matrix4(), mirror = new THREE.Matrix4().makeRotationY(Math.PI);
  const tmp = new THREE.Vector3();
  let simTime = 0;

  function step(dt) {
    simTime += dt;
    for (const c of cars) {
      if (mode === 'overview') {
        const w = c.wander;
        w.t -= dt;
        const dx = BOWL.x + w.x - c.pos.x, dz = BOWL.z + w.z - c.pos.z;
        if (w.t <= 0 || Math.hypot(dx, dz) < 4) { const a = Math.random() * Math.PI * 2, d = Math.random() * (BOWL.r - 8); w.x = Math.cos(a) * d; w.z = Math.sin(a) * d; w.t = 3 + Math.random() * 3; }
        const want = Math.atan2(dx, dz);
        let dy = want - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yaw += Math.max(-1.6 * dt, Math.min(1.6 * dt, dy));
        c.speed = 11 * c.skill;
        c.fwd.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        c.pos.addScaledVector(c.fwd, c.speed * dt);
      } else {
        const u = ((c.s % trackLen) + trackLen) % trackLen / trackLen;
        const t0 = curve.getTangentAt(u), t1 = curve.getTangentAt((u + 0.02) % 1);
        const bend = Math.acos(Math.min(1, t0.dot(t1)));
        const target = (34 - bend * 120) * c.skill + Math.sin(simTime * 0.7 + c.phase) * 2;
        c.speed += (Math.max(16, target) - c.speed) * Math.min(1, dt * 1.5);
        if (mode === 'lobby') c.speed = Math.min(c.speed, 20);
        c.s += c.speed * dt;
        if (Math.random() < dt * 0.15) c.laneGoal = (Math.floor(Math.random() * 4) - 1.5) * 3.1;
        c.lane += (c.laneGoal - c.lane) * Math.min(1, dt * 0.8);
        const uu = ((c.s % trackLen) + trackLen) % trackLen / trackLen;
        const p = curve.getPointAt(uu), t = curve.getTangentAt(uu);
        tmp.crossVectors(UP, t).normalize();
        c.pos.copy(p).addScaledVector(tmp, c.lane);
        c.fwd.copy(t);
        c.yaw = Math.atan2(t.x, t.z);
      }
      c.spin += (c.speed / P.wheelR) * dt;
      c.boost = Math.max(0, Math.min(1, c.boost + (Math.sin(simTime * 0.4 + c.phase) * 0.12) * dt));
      // dust puffs behind the rear wheels
      c.dustNext -= dt;
      if (c.dustNext <= 0 && c.speed > 8) {
        c.dustNext = 0.07;
        const d = c.dust.reduce((a, b) => (b.age > a.age ? b : a));
        d.age = 0; d.p.copy(c.pos).addScaledVector(c.fwd, -2.4).add(tmp.set((Math.random() - 0.5) * 1.6, 0.15, 0));
      }
      for (const d of c.dust) d.age += dt;
    }
    writeInstances();
  }

  function writeInstances() {
    for (const set of Object.values(lodSets)) for (const im of set) {
      const { key, meshes } = im.userData;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        carM.makeRotationY(c.yaw).setPosition(c.pos);
        for (let k = 0; k < meshes.length; k++) {
          const pm = meshes[k];
          off.makeTranslation(...pm.userData.rest);
          if (key === 'wheel') {
            if (pm.name.endsWith('L')) off.multiply(mirror);
            off.multiply(spinM.makeRotationX(pm.name.endsWith('L') ? -c.spin : c.spin));
          }
          m4.multiplyMatrices(carM, off);
          im.setMatrixAt(i * meshes.length + k, m4);
        }
      }
      im.count = cars.length * meshes.length;
      im.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      m4.makeRotationY(c.yaw).setPosition(c.pos.x, 0.04, c.pos.z);
      blobs.setMatrixAt(i, m4);
      rings.setMatrixAt(i, m4.makeTranslation(c.pos.x, 0.06, c.pos.z));
      for (let k = 0; k < DUST_PER_CAR; k++) {
        const d = c.dust[k], life = 0.9, a = Math.min(1, d.age / life);
        const sc = d.age > life ? 0 : (0.25 + a * 0.9) * (1 - a * 0.6);
        m4.makeScale(sc, sc * 0.6, sc).setPosition(d.p.x, d.p.y + a * 0.5, d.p.z);
        dust.setMatrixAt(i * DUST_PER_CAR + k, m4);
      }
    }
    blobs.count = rings.count = cars.length;
    dust.count = cars.length * DUST_PER_CAR;
    blobs.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = dust.instanceMatrix.needsUpdate = true;
  }

  // Identify outline: an inverted hull of the body in the seat colour, drawn in every tile (master §5.2).
  function setOutlines(seats) {
    outlineGroup.clear();
    for (const seat of seats) {
      const mesh = new THREE.Mesh(outlineGeo, new THREE.MeshBasicMaterial({ color: colors[(seat - 1 + colorOffset) % colors.length], side: THREE.BackSide }));
      mesh.userData.seat = seat;
      mesh.scale.setScalar(1.09);
      outlineGroup.add(mesh);
    }
  }
  function placeOutlines() {
    for (const m of outlineGroup.children) {
      const c = cars[m.userData.seat - 1];
      if (!c) continue;
      const rest = templates[1].parts.core.userData.rest;
      m.position.set(rest[0], rest[1], rest[2]).applyAxisAngle(UP, c.yaw).add(c.pos);
      m.rotation.set(0, c.yaw, 0);
    }
  }

  const cams = [];
  function cameraFor(i, kind, aspect, dt) {
    const c = cars[i];
    const cam = (cams[i] ??= new THREE.PerspectiveCamera(62, 1, 0.1, 1200));
    cam.aspect = aspect;
    if (kind === 'fp') {
      cam.fov = 70;
      // Driver's eye on the right (right-hand drive), just above the bonnet line so its edge shows.
      tmp.crossVectors(UP, c.fwd).normalize();
      cam.position.copy(c.pos).addScaledVector(c.fwd, 0.35).addScaledVector(tmp, 0.38).add(tmp.set(0, 1.58, 0));
      cam.lookAt(tmp.copy(c.pos).addScaledVector(c.fwd, 30).setY(0.2));
    } else if (kind === 'back') {
      cam.fov = 62;
      cam.position.copy(c.pos).addScaledVector(c.fwd, 9).add(tmp.set(0, 2.2, 0));
      cam.lookAt(tmp.copy(c.pos).addScaledVector(c.fwd, 30).setY(1));
    } else {
      cam.fov = 62;
      const want = tmp.copy(c.pos).addScaledVector(c.fwd, -5.2).setY(c.pos.y + 2.05);
      if (!c.camInit) { c.camPos.copy(want); c.camInit = true; }
      c.camPos.lerp(want, Math.min(1, dt * 6));
      cam.position.copy(c.camPos);
      c.camLook.copy(c.pos).addScaledVector(c.fwd, 4).setY(0.95);
      cam.lookAt(c.camLook);
    }
    cam.updateProjectionMatrix();
    return cam;
  }

  const wideCam = new THREE.PerspectiveCamera(48, 1, 0.5, 2000);
  function wideCamera(aspect, kind, t) {
    wideCam.aspect = aspect;
    if (kind === 'overview') {
      wideCam.clearViewOffset();
      // Frame every car's bounding box at a fixed pitch (60°), never rotating (master §6.4).
      const box = new THREE.Box3();
      for (const c of cars) box.expandByPoint(c.pos);
      if (box.isEmpty()) box.expandByPoint(new THREE.Vector3(BOWL.x, 0, BOWL.z));
      box.expandByScalar(9);
      const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      const pitch = (60 * Math.PI) / 180, vfov = (wideCam.fov * Math.PI) / 180;
      const needH = Math.max(size.z * Math.sin(pitch) + 4, size.x / aspect);
      const dist = needH / 2 / Math.tan(vfov / 2) + 6;
      wideCam.position.set(ctr.x, ctr.y + Math.sin(pitch) * dist, ctr.z + Math.cos(pitch) * dist);
      wideCam.lookAt(ctr);
    } else if (kind === 'reel') {
      wideCam.clearViewOffset();
      const c = cars[0] ?? { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
      const a = t * 0.35;
      wideCam.position.copy(c.pos).add(tmp.set(Math.cos(a) * 9, 3.2, Math.sin(a) * 9));
      wideCam.lookAt(tmp.copy(c.pos).setY(1));
    } else {
      // lobby warm-up: a slow crane over the pack
      const lead = cars.reduce((a, b) => (b.s > (a?.s ?? -Infinity) ? b : a), null);
      const c = lead ?? { pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1) };
      const a = t * 0.05;
      wideCam.position.copy(c.pos).addScaledVector(c.fwd, -20).add(tmp.set(Math.cos(a) * 12, 12, Math.sin(a) * 12));
      wideCam.lookAt(tmp.copy(c.pos).addScaledVector(c.fwd, -8).setY(0));
      const fw = aspect * 1000;
      wideCam.setViewOffset(fw, 1000, 0.3 * fw, -280, fw, 1000); // pack at about (20 %, 78 %) of the screen
    }
    wideCam.updateProjectionMatrix();
    return wideCam;
  }

  function showLod(lod) {
    for (const [l, set] of Object.entries(lodSets)) for (const im of set) im.visible = +l === lod;
  }

  /**
   * Draw tiles. views: [{ x, y, w, h (CSS px, top-left origin), seat, kind: 'tp'|'fp'|'back'|'wide'|'overview'|'reel' }]
   */
  function render(views, dt, size, clear = '#fff4de') {
    placeOutlines();
    const H = size.h;
    renderer.setScissorTest(false);
    renderer.setClearColor(clear, 1);
    renderer.clear();
    renderer.setScissorTest(true);
    let draws = 0;
    for (const v of views) {
      if (v.w < 2 || v.h < 2) continue;
      const aspect = v.w / v.h;
      const cam = v.kind === 'wide' || v.kind === 'overview' || v.kind === 'reel' ? wideCamera(aspect, v.kind, simTime) : cameraFor(v.seat - 1, v.kind, aspect, dt);
      showLod(v.h >= 540 ? 0 : v.h >= 200 ? 1 : 2);
      const y = H - v.y - v.h;
      renderer.setViewport(v.x, y, v.w, v.h);
      renderer.setScissor(v.x, y, v.w, v.h);
      renderer.render(scene, cam);
      draws += renderer.info.render.calls;
      v.camera = cam;
    }
    return { draws };
  }

  function project(seat, cam, view) {
    const c = cars[seat - 1];
    if (!c) return null;
    const p = tmp.copy(c.pos).setY(2.3).project(cam);
    return { x: view.x + (p.x * 0.5 + 0.5) * view.w, y: view.y + (-p.y * 0.5 + 0.5) * view.h, z: p.z, dist: cam.position.distanceTo(c.pos), ndc: { x: p.x, y: p.y } };
  }

  function standings() {
    return [...cars].sort((a, b) => b.s - a.s).map((c, i) => ({ seat: c.seat, place: i + 1, lap: Math.min(LAPS, Math.max(1, Math.floor((c.s - trackLen * 3) / trackLen) + 1)), boost: c.boost }));
  }

  function resize(w, h) { renderer.setSize(w, h, false); }

  return { renderer, backend, setCars, setMode, step, render, project, standings, setOutlines, resize, get n() { return n; }, laps: LAPS };
}
