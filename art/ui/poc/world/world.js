// world.js — the in-world comic look (P1-U05), live, built only from the jammers-look skill's tested module (vendored as
// ../vendor/look/look.js) and Spike J's Cruz Missile. One WebGPURenderer; every tile is a sub-camera of one ArrayCamera, so the
// whole grid is ONE scene pass into the shared MRT targets and the comic post chain (outlines, halftone, bloom, grade) runs
// ONCE over the screen (jammers-look "Per-tile cost rules"). The track layout matches the TV mocks (../tv/world.js).
import * as THREE from 'three/webgpu';
import { color, texture, positionWorld, vertexColor, vec2, vec3, float, abs, mix, smoothstep, length } from 'three/tsl';
import { build, DEFAULT_P } from '../vendor/cruz/model.js';
import { makeAtlas } from '../vendor/cruz/atlas.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLook, addDayRig, tierFor, applyTier, updateLookCamera, addCarAttributes, paintKey, damageCreep, makeComicMaterial, comicPipeline, aCar, aState } from '../vendor/look/look.js';
export const FRAMING = await (await fetch(new URL('../shared/framing.json', import.meta.url))).json();

const UP = new THREE.Vector3(0, 1, 0);
const TRACK_PTS = [[0, 0], [120, -10], [200, 40], [210, 120], [150, 170], [80, 140], [20, 190], [-80, 200], [-150, 140], [-160, 50], [-110, -20]];
const ROAD_W = 14;
const RED_EARTH = '#C8622E';
export const BOWL = { x: 2000, z: 0, r: 58 };

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

// Graphic sky (master 12.1, H4): festival blue fading to the haze at the horizon, with small hand-inked cumulus 6–18 degrees up.
// An equirect background texture, so the sky stays at depth 1 and the post chain still classifies it as sky (jammers-look trap 4).
function paintSky() {
  const W = 4096, H = 2048; // 2:1, as equirect mapping expects, so puffs stay round
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#2F7BCB'); grad.addColorStop(0.36, '#4E9BDE'); grad.addColorStop(0.462, '#A4CFEC'); grad.addColorStop(0.495, '#F4DDB0'); grad.addColorStop(1, '#F4DDB0');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const R = rng(7);
  const blob = (x, y, puffs, grow) => { g.beginPath(); for (const [dx, dy, r] of puffs) { g.moveTo(x + dx + r + grow, y + dy); g.arc(x + dx, y + dy, r + grow, 0, Math.PI * 2); } g.fill(); };
  for (let k = 0; k < 30; k++) {
    const w = 60 + R() * 150, h = w * (0.32 + R() * 0.1); // about 5-18 degrees wide
    const x = 120 + (k / 30) * (W - 240) + (R() - 0.5) * 90, base = H * (0.4 + R() * 0.065);
    const n = 4 + Math.floor(R() * 4), puffs = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1), r = h * (0.32 + Math.sin(t * Math.PI) * 0.42) * (0.8 + R() * 0.3); puffs.push([(t - 0.5) * w * 0.78, -r * 0.55, r]); }
    g.save(); g.beginPath(); g.rect(x - w, base - h * 3, w * 2, h * 3 + 3); g.clip();
    g.fillStyle = '#15203A'; blob(x, base, puffs, 3);   // ink rim, and a flat inked base
    g.restore();
    g.save(); g.beginPath(); g.rect(x - w, base - h * 3, w * 2, h * 3); g.clip();
    g.fillStyle = '#FFFDF5'; blob(x, base, puffs, 0);   // body
    g.beginPath(); g.rect(x - w, base - h * 0.32, w * 2, h); g.clip();
    g.fillStyle = '#E4D9C8'; blob(x, base, puffs, 0);   // warm-grey belly
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// The ground's painted patches: two layers of smooth value noise (R, G) in a mipmapped texture over the 2400 m ground, so each
// ground pixel costs one texture fetch rather than noise maths.
function patchTexture(size = 512) {
  const R = rng(11), data = new Uint8Array(size * size * 4);
  const layer = (cells) => {
    const n = cells + 1, g = Array.from({ length: n * n }, () => R());
    const at = (i, j) => g[(j % n) * n + (i % n)];
    return (x, y) => {
      const fx = x * cells, fy = y * cells, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx, b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const a1 = layer(26), a2 = layer(61), b1 = layer(53), b2 = layer(117);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, k = (y * size + x) * 4;
    data[k] = Math.round((a1(u, v) * 0.65 + a2(u, v) * 0.35) * 255);
    data[k + 1] = Math.round((b1(u, v) * 0.65 + b2(u, v) * 0.35) * 255);
    data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function canvasTexture(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 4;
  return t;
}

export async function createWorld(canvas, { colors, tileHeight = 270, mode = 'full', forceWebGL = false, trackTimestamp = false, overrides = {} }) {
  // trackTimestamp: GPU timestamp queries for the cost table (needs the 'timestamp-query' feature; ?ts=1 on the page).
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL, trackTimestamp });
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 (WebGPURenderer fallback)';
  let adapterInfo = '';
  try { adapterInfo = renderer.backend.device ? (await navigator.gpu?.requestAdapter())?.info?.description || (await navigator.gpu?.requestAdapter())?.info?.vendor || '' : ''; } catch { /* optional */ }

  const scene = new THREE.Scene();
  const sun = addDayRig(scene, { sunAz: -40 });
  scene.fog = new THREE.Fog('#F4DDB0', 140, 560);
  scene.background = paintSky();
  // A track-wide shadow frustum (the skill's +/-9 m rig is for one car); R10 replaces this with cascades.
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 900 });
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.25;
  const sunDir = sun.position.clone().normalize();
  const placeSun = (at) => { sun.position.copy(at).addScaledVector(sunDir, 400); sun.target.position.copy(at); sun.target.updateMatrixWorld(); sun.shadow.camera.updateProjectionMatrix(); };
  placeSun(new THREE.Vector3(25, 0, 95));

  const look = createLook(tierFor(tileHeight));
  const flat = (hex, grit = {}) => makeComicMaterial(look, { colorNode: color(hex), grit });
  const vcol = (grit = {}) => makeComicMaterial(look, { colorNode: vertexColor(), grit });

  // ---- ground, track, kerbs, edge lines ----
  // Painted patches of lighter and darker earth: flat colour from noise, so the ground reads hand-painted without adding a
  // single ink line (the horizon clumping came from far-away props, not from colour).
  const patches = texture(patchTexture(), positionWorld.xz.div(2400).add(0.5));
  const groundColor = mix(mix(color(RED_EARTH), color('#DB8F55'), smoothstep(0.56, 0.59, patches.r)), color('#A84F27'), smoothstep(0.6, 0.63, patches.g));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), makeComicMaterial(look, { colorNode: groundColor, grit: { space: positionWorld, cell: 28, patchFreq: 0.35 } }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const curve = new THREE.CatmullRomCurve3(TRACK_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const trackLen = curve.getLength();
  const SAMPLES = 700;
  const frames = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = (i / SAMPLES) % 1, p = curve.getPointAt(u), t = curve.getTangentAt(u);
    frames.push({ p, t, n: new THREE.Vector3().crossVectors(UP, t).normalize(), u });
  }
  function ribbon(off0, off1, y, colorAt, hard = false) {
    // hard: every segment gets its own four vertices, so colour changes are crisp blocks (kerbs), not blends between samples
    const pos = [], col = [], idx = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const { p, n } = frames[i];
      if (hard) {
        if (i === SAMPLES) break;
        const q = frames[i + 1], c = colorAt(i), a = pos.length / 3;
        for (const f of [frames[i], q]) for (const o of [off0, off1]) { pos.push(f.p.x + f.n.x * o, y, f.p.z + f.n.z * o); col.push(c.r, c.g, c.b); }
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        continue;
      }
      const c = colorAt(i);
      for (const o of [off0, off1]) { pos.push(p.x + n.x * o, y, p.z + n.z * o); col.push(c.r, c.g, c.b); }
      if (i < SAMPLES) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, vcol({ space: positionWorld, cell: 24, patchFreq: 0.5 }));
    m.receiveShadow = true;
    return m;
  }
  const C = (h) => new THREE.Color(h);
  const dirt = C('#D39A62'), rut = C('#BC834F'), red = C('#D8382C'), white = C('#F4EFE4'), line = C('#FFF4DE');
  const track = new THREE.Group();
  track.add(ribbon(-ROAD_W / 2, ROAD_W / 2, 0.02, () => dirt));
  track.add(ribbon(-3.2, -2.2, 0.03, () => rut), ribbon(2.2, 3.2, 0.03, () => rut));
  track.add(ribbon(-ROAD_W / 2 + 0.35, -ROAD_W / 2 + 0.6, 0.035, () => line), ribbon(ROAD_W / 2 - 0.6, ROAD_W / 2 - 0.35, 0.035, () => line)); // route edges
  track.add(ribbon(-ROAD_W / 2 - 1.3, -ROAD_W / 2, 0.06, (i) => ((i >> 1) & 1 ? red : white), true));
  track.add(ribbon(ROAD_W / 2, ROAD_W / 2 + 1.3, 0.06, (i) => ((i >> 1) & 1 ? red : white), true));
  scene.add(track);

  // ---- in-world graphics (P1-U05.3, owner round 2): the finish banner, corner chevron posts, W-beam guard rail ----
  // R106: no "Checkpoint N" gantries. Lap-validity checkpoints stay as invisible gameplay (plan §8) until the owner decides.
  const graphics = { finish: null, checkpoints: [], chevrons: [], barriers: [], terminals: [], dressing: [] };
  const chequer = canvasTexture(64, 16, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#15203A' : '#FFF4DE'; g.fillRect(x * 4, y * 4, 4, 4); } });
  chequer.wrapS = chequer.wrapT = THREE.RepeatWrapping;
  const texMat = (tex, emissive = null) => makeComicMaterial(look, { colorNode: texture(tex).rgb, emissiveNode: emissive });

  // R104: corners get a ROW of posts, each carrying one chevron (the Australian chevron alignment marker), facing the
  // approaching cars on the outside of the bend. References: art/references/australia/raw/chevrons-*.jpg.
  const chevronTex = canvasTexture(96, 128, (g, w, h) => {
    g.fillStyle = '#FFD23F'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#15203A';
    g.beginPath(); g.moveTo(22, 14); g.lineTo(62, 64); g.lineTo(22, 114); g.lineTo(46, 114); g.lineTo(84, 64); g.lineTo(46, 14); g.closePath(); g.fill();
    g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  });
  const chevMat = texMat(chevronTex), chevPost = flat('#3A3F47');
  for (let i = 0; i < SAMPLES; i += 6) {
    const a = frames[i].t, b = frames[(i + 12) % SAMPLES].t;
    const turn = a.x * b.z - a.z * b.x;
    if (Math.abs(turn) < 0.12) continue;
    const side = turn > 0 ? 1 : -1; // outside of the bend
    const f = frames[i];
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.55, 0.1), chevPost);
    post.position.copy(f.p).addScaledVector(f.n, side * (ROAD_W / 2 + 3.3)).setY(0.78);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.82, 0.05), chevMat);
    board.position.copy(post.position).setY(1.25);
    board.rotation.y = Math.atan2(f.t.x, f.t.z) + Math.PI;
    if (side < 0) board.scale.x = -1; // the chevron points the way the road turns
    board.castShadow = post.castShadow = true;
    scene.add(post, board);
    graphics.chevrons.push(board);
  }

  // R105: tyre walls and tyre rails become Australian steel guard rail: a galvanised W-beam on posts, with flared
  // terminals at the ends of each run and yellow delineators. Continuous on the outside of bends and on both sides of the
  // straights (where the tyre walls and rails were). References: art/references/australia/raw/wbeam-*.jpg and
  // generated/biome-outback-dirt-and-bitumen.png. Tyres stay only as derby dressing.
  const wProfile = new THREE.Shape([[0, 0], [0.05, 0.05], [0.05, 0.11], [0, 0.16], [0.05, 0.21], [0.05, 0.27], [0, 0.32], [-0.025, 0.32], [0.025, 0.27], [0.025, 0.21], [-0.025, 0.16], [0.025, 0.11], [0.025, 0.05], [-0.025, 0]].map(([x, y]) => new THREE.Vector2(x * 1.2, y * 1.2))); // 20% over life size so it reads at chase distance
  const beamMat = flat('#D3D9DE'), railPost = flat('#8E979F'), delineator = makeComicMaterial(look, { colorNode: color('#FFD23F'), emissiveNode: vec3(0.35, 0.28, 0.05) });
  const RAIL_OFF = ROAD_W / 2 + 2.4, RAIL_Y = 0.48, STEP = 2;
  const basis = new THREE.Matrix4(), out = new THREE.Vector3();
  const railOn = (i, side) => {
    const a = frames[i % SAMPLES].t, b = frames[(i + 10) % SAMPLES].t, turn = a.x * b.z - a.z * b.x;
    return Math.abs(turn) < 0.08 || (turn > 0 ? 1 : -1) === side;
  };
  const railPoint = (i, side, flare = 0) => frames[i % SAMPLES].p.clone().addScaledVector(frames[i % SAMPLES].n, side * (RAIL_OFF + flare));
  function beam(p0, p1, side) {
    const len = p0.distanceTo(p1);
    if (len < 0.05) return;
    const geo = new THREE.ExtrudeGeometry(wProfile, { depth: len + 0.06, bevelEnabled: false });
    const t = p1.clone().sub(p0).normalize();
    out.crossVectors(UP, t).multiplyScalar(-side); // the W faces the road
    basis.makeBasis(out, UP, t).setPosition(p0.x, RAIL_Y, p0.z);
    const m = new THREE.Mesh(geo, beamMat);
    m.applyMatrix4(basis);
    m.castShadow = true;
    scene.add(m);
  }
  let runs = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < SAMPLES; i += STEP) {
      if (!railOn(i, side)) continue;
      const startsRun = !railOn(i - STEP + SAMPLES, side), endsRun = !railOn(i + STEP, side);
      // the run's ends flare away from the road into a terminal
      const p0 = railPoint(i, side, startsRun ? 1.4 : 0), p1 = railPoint(i + STEP, side, endsRun ? 1.4 : 0);
      beam(p0, p1, side);
      if (startsRun) { runs++; graphics.terminals.push({ p: p0.clone(), i, side }); }
      if ((i / STEP) % 2 === 0 || startsRun) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.82, 0.15), railPost);
        post.position.copy(p0).setY(0.41);
        post.castShadow = true;
        scene.add(post);
        if ((i / STEP) % 6 === 0) {
          const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), delineator);
          d.position.copy(p0).setY(0.92);
          scene.add(d);
        }
      }
      if (startsRun || endsRun) { // the end terminal: a rounded cap on the flared end
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 10), beamMat);
        cap.position.copy(startsRun ? p0 : p1).setY(RAIL_Y + 0.16);
        scene.add(cap);
      }
    }
  }
  graphics.barriers.push({ kind: 'w-beam', runs });
  const tyreGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.42, 10); // tyres stay only as derby dressing (the bowl below)

  // R106 / POC2-04: the start-finish line is a race banner across the track, in the language of
  // art/ui/refs/owner-2026-10-03/world-finish-gantry-tatts-finke.png (never its sponsors or words) with R102's slants
  // and contrast: a long ink banner on a light truss frame, big paper type with a saffron accent, slanted end panels and
  // a chequered flag.
  const bannerW = ROAD_W + 12, bannerH = 2.1;
  const finishBanner = canvasTexture(2048, Math.round((2048 * bannerH) / bannerW), (g, w, h) => {
    g.fillStyle = '#15203A'; g.fillRect(0, 0, w, h);
    const skew = h * 0.22;
    // left end panel: saffron, slanted, our own name
    g.fillStyle = '#FFB400'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.2 + skew, 0); g.lineTo(w * 0.2, h); g.lineTo(0, h); g.closePath(); g.fill();
    g.fillStyle = '#15203A'; g.font = `900 italic ${Math.round(h * 0.36)}px "Barlow Condensed", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('JOYSTICK', w * 0.1, h * 0.33); g.fillText('JAMMERS', w * 0.1, h * 0.7);
    // right end panel: a chequer, slanted
    const x0 = w * 0.82;
    g.save(); g.beginPath(); g.moveTo(x0 + skew, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(x0, h); g.closePath(); g.clip();
    const cs = h / 4;
    for (let x = 0; x * cs < w - x0 + skew; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#15203A' : '#FFF4DE'; g.fillRect(x0 + x * cs, y * cs, cs, cs); }
    g.restore();
    // the big words, paper with a saffron accent
    g.font = `900 italic ${Math.round(h * 0.62)}px "Barlow Condensed", system-ui, sans-serif`;
    g.textAlign = 'center';
    const cx = w * 0.51;
    const a = 'START  ·  ', b2 = 'FINISH';
    const wa = g.measureText(a).width, wb = g.measureText(b2).width;
    g.fillStyle = '#FFF4DE'; g.textAlign = 'left'; g.fillText(a, cx - (wa + wb) / 2, h * 0.54);
    g.fillStyle = '#FFB400'; g.fillText(b2, cx - (wa + wb) / 2 + wa, h * 0.54);
    g.lineWidth = 10; g.strokeStyle = '#FFF4DE'; g.strokeRect(5, 5, w - 10, h - 10);
  });
  function finishGantry(f) {
    const g = new THREE.Group();
    const half = bannerW / 2;
    const truss = flat('#D9DEE3');
    for (const s of [-1, 1]) { // light truss uprights: two poles and braces
      for (const dz of [-0.3, 0.3]) { const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 7.2, 0.14), truss); pole.position.set(s * (half + 0.3), 3.6, dz); pole.castShadow = true; g.add(pole); }
      for (let k = 0; k < 6; k++) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.06), truss); br.position.set(s * (half + 0.3), 0.7 + k * 1.15, 0); br.rotation.x = k % 2 ? 0.75 : -0.75; g.add(br); }
    }
    for (const dy of [7.0, 6.55]) { const top = new THREE.Mesh(new THREE.BoxGeometry(bannerW + 1.2, 0.12, 0.12), truss); top.position.set(0, dy, 0); g.add(top); }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(bannerW, bannerH, 0.08), texMat(finishBanner));
    banner.position.set(0, 6.45 - bannerH / 2, 0); banner.castShadow = true; g.add(banner);
    // a chequered flag on a pole by the line
    const flagPole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.4, 0.08), flat('#3A3F47'));
    flagPole.position.set(half - 2, 1.7, 1.2); g.add(flagPole);
    const flagGeo = new THREE.PlaneGeometry(1.6, 1.05, 8, 1);
    const pos = flagGeo.attributes.position;
    for (let v = 0; v < pos.count; v++) pos.setZ(v, Math.sin((pos.getX(v) + 0.8) * 3.2) * 0.12); // a fold, not a flutter
    flagGeo.computeVertexNormals();
    const flagTex = chequer.clone(); flagTex.repeat.set(1.6, 2); flagTex.needsUpdate = true;
    const flagMat = makeComicMaterial(look, { colorNode: texture(flagTex).rgb });
    flagMat.side = THREE.DoubleSide;
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(half - 2 - 0.84, 2.9, 1.2); g.add(flag);
    // the chequered line on the road
    const lineTex = chequer.clone(); lineTex.repeat.set(ROAD_W / 1.6, 2); lineTex.needsUpdate = true;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 1.6), texMat(lineTex));
    strip.rotation.x = -Math.PI / 2; strip.position.y = 0.045; strip.receiveShadow = true; g.add(strip);
    g.position.copy(f.p);
    g.rotation.y = Math.atan2(f.t.x, f.t.z);
    scene.add(g);
    return g;
  }
  graphics.finish = finishGantry(frames[10]);
  const bannerTex = (text, bg, fg) => canvasTexture(512, 96, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = '900 italic 64px "Barlow Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
    g.lineWidth = 8; g.strokeStyle = '#15203A'; g.strokeRect(4, 4, w - 8, h - 8);
  });

  // ---- scenery: mesas, spinifex, gum trees ----
  const R = rng(42);
  const offRoad = (minD, maxD) => {
    for (;;) {
      const a = R() * Math.PI * 2, d = minD + R() * (maxD - minD);
      const x = 25 + Math.cos(a) * d, z = 95 + Math.sin(a) * d;
      let near = Infinity;
      for (let i = 0; i < SAMPLES; i += 7) near = Math.min(near, Math.hypot(frames[i].p.x - x, frames[i].p.z - z));
      if (near > ROAD_W + 4) return [x, z];
    }
  };
  const inst = (geo, mat, count, place, shadow = true) => {
    const im = new THREE.InstancedMesh(geo, mat, count), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) { place(m, i); im.setMatrixAt(i, m); }
    im.castShadow = shadow; im.receiveShadow = true; scene.add(im);
    return im;
  };
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  inst(new THREE.CylinderGeometry(0.75, 1, 1, 7), flat('#B9572C'), 14, (m, i) => {
    const a = (i / 14) * Math.PI * 2 + R() * 0.3, d = 420 + R() * 120;
    s.set(40 + R() * 60, 26 + R() * 40, 40 + R() * 60);
    m.compose(v.set(25 + Math.cos(a) * d, s.y / 2, 95 + Math.sin(a) * d), q.setFromAxisAngle(UP, R() * 3), s);
  }, false);
  const nearRoad = (minOff, maxOff) => { // a point minOff..maxOff metres beyond the road edge, clear of every part of the track
    for (;;) {
      const f = frames[Math.floor(R() * SAMPLES)], side = R() < 0.5 ? -1 : 1, o = ROAD_W / 2 + minOff + R() * (maxOff - minOff);
      const x = f.p.x + f.n.x * o * side, z = f.p.z + f.n.z * o * side;
      let near = Infinity;
      for (let i = 0; i < SAMPLES; i += 4) near = Math.min(near, Math.hypot(frames[i].p.x - x, frames[i].p.z - z));
      if (near > ROAD_W / 2 + minOff - 0.5) return [x, z];
    }
  };
  const tuft = new THREE.IcosahedronGeometry(1, 0); tuft.scale(1, 0.55, 1);
  inst(tuft, flat('#8C9046'), 360, (m) => {
    const [x, z] = nearRoad(3.5, 45); s.set(0.8 + R() * 0.9, 0.8 + R() * 0.5, 0.8 + R() * 0.9); m.compose(v.set(x, s.y * 0.35, z), q.setFromAxisAngle(UP, R() * 3), s);
  });
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 7, 6); trunk.translate(0, 3.5, 0);
  const crown = new THREE.IcosahedronGeometry(3.4, 0); crown.translate(0, 8.4, 0);
  const trees = Array.from({ length: 40 }, () => nearRoad(9, 80));
  inst(trunk, flat('#E9E2D6'), trees.length, (m, i) => m.compose(v.set(trees[i][0], 0, trees[i][1]), q.identity(), s.setScalar(1)));
  inst(crown, flat('#7D8E57'), trees.length, (m, i) => m.compose(v.set(trees[i][0], 0, trees[i][1]), q.setFromAxisAngle(UP, i), s.setScalar(0.85 + (i % 5) / 10)));

  // ---- outback dressing (H4): windmills, a water tower, tin sheds, bunting and hand-painted signs, all clear of the road ----
  const dressing = { fans: [] };
  const staticStats = { meshes: 0, merged: 0 };
  const galv = flat('#9AA2AB'), cream = flat('#F4EFE4'), signRed = flat('#D8382C'), navy = flat('#15203A');
  const corrugTex = canvasTexture(64, 8, (g) => { for (let x = 0; x < 64; x += 4) { g.fillStyle = (x / 4) % 2 ? '#8B939B' : '#AEB5BC'; g.fillRect(x, 0, 4, 8); } });
  corrugTex.wrapS = THREE.RepeatWrapping; corrugTex.repeat.set(6, 1);
  const tin = texMat(corrugTex);
  const at = (i, off) => { const f = frames[i % SAMPLES]; return [f.p.x + f.n.x * off, f.p.z + f.n.z * off, Math.atan2(f.t.x, f.t.z)]; };
  function windmill(x, z, yaw, h = 13) {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 1.5, h, 4), galv); tower.position.y = h / 2; tower.castShadow = true; g.add(tower);
    const fan = new THREE.Group(); fan.position.set(0, h + 0.1, 0.7); fan.userData.live = true; // turns, so it isn't baked
    for (let k = 0; k < 12; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.2, 0.06), k % 4 ? cream : signRed); b.geometry.translate(0, 1.55, 0); b.rotation.z = (k / 12) * Math.PI * 2; b.castShadow = true; fan.add(b); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.4, 8), navy); hub.rotation.x = Math.PI / 2; fan.add(hub);
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 2.8), signRed); vane.position.set(0, h + 0.1, -1.9); g.add(vane, fan);
    g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g); dressing.fans.push(fan);
  }
  function waterTower(x, z, yaw, text) {
    const g = new THREE.Group();
    for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), galv); leg.position.set(lx, 4, lz); leg.castShadow = true; g.add(leg); }
    const tankTex = canvasTexture(1024, 160, (c, w, h) => { c.fillStyle = '#B9572C'; c.fillRect(0, 0, w, h); c.fillStyle = '#FFF4DE'; c.font = '900 italic 96px "Barlow Condensed", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w * 0.25, h / 2 + 4); c.fillText(text, w * 0.75, h / 2 + 4); });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4.2, 16), texMat(tankTex)); tank.position.y = 10.1; tank.castShadow = true; g.add(tank);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.4, 16), flat('#8E4423')); roof.position.y = 12.9; roof.castShadow = true; g.add(roof);
    g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
  }
  function shed(x, z, yaw, w = 9, d = 6) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d), tin); body.position.y = 1.6; body.castShadow = body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.25, d + 0.8), flat('#C9CED3')); roof.position.y = 3.45; roof.rotation.x = 0.08; roof.castShadow = true; g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 0.08), flat('#A9542A')); door.position.set(-w * 0.2, 1.2, d / 2 + 0.05); g.add(door);
    g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
  }
  function sign(x, z, yaw, text) {
    const g = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.0, 0.15), texMat(bannerTex(text, '#FFF4DE', '#15203A'))); board.position.y = 2.2; board.castShadow = true; g.add(board);
    for (const px of [-2, 2]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), navy); post.position.set(px, 1.1, -0.1); g.add(post); }
    g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
  }
  const flagMat = vcol(); flagMat.side = THREE.DoubleSide;
  const FLAGS = ['#FFB400', '#1E5BFF', '#D8382C', '#FFF4DE', '#00B5B8'].map((h) => new THREE.Color(h));
  function bunting(points, top = 4.6) {
    const pos = [], col = [];
    let k = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.floor(len / 1.1));
      for (let j = 0; j < n; j++) {
        const t0 = j / n, t1 = (j + 0.75) / n, tm = (t0 + t1) / 2, sag = (t) => top - Math.sin(t * Math.PI) * 0.9;
        const c = FLAGS[k++ % FLAGS.length];
        pos.push(ax + (bx - ax) * t0, sag(t0), az + (bz - az) * t0, ax + (bx - ax) * t1, sag(t1), az + (bz - az) * t1, ax + (bx - ax) * tm, sag(tm) - 0.75, az + (bz - az) * tm);
        for (let r = 0; r < 3; r++) col.push(c.r, c.g, c.b);
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, top + 0.2, 6), navy); pole.position.set(ax, (top + 0.2) / 2, az); scene.add(pole);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, flagMat); m.castShadow = true; scene.add(m);
  }
  {
    // start straight: bunting both sides, a sign; landmarks out on the plain where chase cameras see them
    for (const side of [-1, 1]) bunting(Array.from({ length: 8 }, (_, j) => at(2 + j * 7, side * 14)));
    const [s1x, s1z, s1y] = at(28, 13); sign(s1x, s1z, s1y + Math.PI / 2, 'SEND IT!');
    const [s2x, s2z, s2y] = at(262, -13); sign(s2x, s2z, s2y - Math.PI / 2, "G'DAY");
    const [s3x, s3z, s3y] = at(610, 13); sign(s3x, s3z, s3y + Math.PI / 2, 'SEND IT!');
    for (const [i, off] of [[70, 34], [300, -42], [455, 38], [640, -36]]) { const [x, z, y] = at(i, off); windmill(x, z, y + 0.6); }
    { const [x, z, y] = at(125, -36); waterTower(x, z, y, 'JAMMERS'); }
    for (const [i, off] of [[40, -30], [205, 32], [420, -30], [560, 33]]) { const [x, z, y] = at(i, off); shed(x, z, y + (off > 0 ? 0.2 : -0.2)); }
  }

  // ---- derby bowl (Overview reference): tyre-stack wall, hay bales, debris left where it fell, parked utes, outback dressing ----
  const bowl = new THREE.Group();
  {
    let loops = float(0); // donut marks: a few overlapping tyre loops, painted a little darker
    for (const [cx, cz, r] of [[-14, 8, 9], [10, -12, 7], [18, 14, 11], [-22, -16, 8], [2, 24, 6], [-4, -30, 10]]) loops = loops.max(float(1).sub(smoothstep(0.3, 0.65, abs(length(positionWorld.xz.sub(vec2(BOWL.x + cx, BOWL.z + cz))).sub(r)))));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(BOWL.r, 48), makeComicMaterial(look, { colorNode: mix(color('#D39A62'), color('#B07A4C'), loops.mul(0.8)), grit: { space: positionWorld, cell: 28 } }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.03; floor.receiveShadow = true; bowl.add(floor);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(BOWL.r + 2, 2.2, 6, 48), flat('#B9572C'));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.6; lip.castShadow = lip.receiveShadow = true; bowl.add(lip);
    bowl.position.set(BOWL.x, 0, BOWL.z);
    scene.add(bowl);
    const ring = [];
    for (let k = 0; k < 96; k++) if (k % 12 !== 11) for (const h of [0.21, 0.63, 1.05]) ring.push([(k / 96) * Math.PI * 2, h, k]);
    const ringMat = [flat('#26282C'), flat('#D8382C'), flat('#F4EFE4')];
    for (const [mi, pick] of [[0, (k) => k % 4 !== 1 && k % 4 !== 3], [1, (k) => k % 4 === 1], [2, (k) => k % 4 === 3]]) {
      const list = ring.filter(([, , k]) => pick(k));
      inst(tyreGeo, ringMat[mi], list.length, (m, i) => { const [a, h] = list[i]; m.compose(v.set(BOWL.x + Math.cos(a) * (BOWL.r - 0.6), h, BOWL.z + Math.sin(a) * (BOWL.r - 0.6)), q.identity(), s.setScalar(1)); });
    }
    const bales = [];
    for (const a0 of [0.4, 1.9, 3.3, 4.6]) for (let j = 0; j < 4; j++) bales.push([a0 + j * 0.045, j % 2 ? 1.35 : 0.45]);
    inst(new THREE.BoxGeometry(1.8, 0.9, 1.2), flat('#E3C16F'), bales.length, (m, i) => { const [a, y] = bales[i]; m.compose(v.set(BOWL.x + Math.cos(a) * (BOWL.r + 4.5), y, BOWL.z + Math.sin(a) * (BOWL.r + 4.5)), q.setFromAxisAngle(UP, -a), s.setScalar(1)); });
    // debris that stays where it fell: doors and bumpers in the identity paints (white material x instanceColor), loose wheels;
    // kept out of the paint line-up's strip in front of the camera
    const DR = rng(9), spot = () => { for (;;) { const a = DR() * Math.PI * 2, r = 6 + DR() * (BOWL.r - 10), x = Math.cos(a) * r, z = Math.sin(a) * r; if (!(Math.abs(z) < 7 && Math.abs(x) < 24) && z < BOWL.r - 6) return [x, z]; } };
    const white = makeComicMaterial(look, { colorNode: color('#ffffff') });
    for (const [geo, n, lie] of [[new THREE.BoxGeometry(1.1, 0.75, 0.07), 18, true], [new THREE.BoxGeometry(1.7, 0.3, 0.35), 12, false]]) {
      const im = inst(geo, white, n, (m) => { const [x, z] = spot(); m.compose(v.set(BOWL.x + x, lie ? 0.07 : 0.18, BOWL.z + z), q.setFromEuler(new THREE.Euler(lie ? -Math.PI / 2 + (DR() - 0.5) * 0.3 : 0, DR() * 6, 0)), s.setScalar(1)); });
      for (let i = 0; i < n; i++) im.setColorAt(i, new THREE.Color(colors[Math.floor(DR() * colors.length)]));
    }
    inst(tyreGeo, ringMat[0], 8, (m) => { const [x, z] = spot(); m.compose(v.set(BOWL.x + x, 0.22, BOWL.z + z), q.setFromEuler(new THREE.Euler(Math.PI / 2, DR() * 6, 0)), s.setScalar(1)); });
    // parked utes on the far rim
    const uteMats = ['#A9542A', '#5E7FA8', '#E8E4DA', '#6F7A3C'].map((h) => flat(h));
    for (let u = 0; u < 4; u++) {
      const g = new THREE.Group(), mat = uteMats[u];
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), mat); cab.position.set(0, 1.25, 1.2); g.add(cab);
      const tray = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 2.8), mat); tray.position.set(0, 0.85, -1.2); g.add(tray);
      for (const [wx, wz] of [[-1, 1.4], [1, 1.4], [-1, -1.6], [1, -1.6]]) { const w = new THREE.Mesh(tyreGeo, ringMat[0]); w.rotation.z = Math.PI / 2; w.position.set(wx, 0.62, wz); g.add(w); }
      g.traverse((o) => { o.castShadow = true; });
      g.position.set(BOWL.x - 21 + u * 14, 0, BOWL.z - BOWL.r - 14 - (u % 2) * 3); g.rotation.y = 0.3 + u * 0.5; scene.add(g);
    }
    windmill(BOWL.x + 38, BOWL.z - BOWL.r - 24, 0.5, 15);
    shed(BOWL.x - 46, BOWL.z - BOWL.r - 18, 0.2, 11, 7);
    sign(BOWL.x + 6, BOWL.z - BOWL.r - 9, 0, 'SEND IT!');
    // POC2-08 (P1-U05.4, R107): an arena designed for the near-fixed Overview camera. It looks north over the bowl at a fixed
    // 60° pitch and never rotates, so the far side (−z) fills the top of every frame: a range of Olgas-style domes there
    // (Kata Tjuta's rounded red heads), quarry faces stepping up on both flanks, all placed from a seed. Which of them the
    // camera keeps in view is recorded by capture-overview (the zones for P1-M10).
    const OG = rng(23);
    const domeGeo = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMats = ['#B4552E', '#A2492A', '#C0623A'].map((h) => flat(h));
    for (let k = 0; k < 9; k++) {
      const x = -76 + k * 19 + (OG() - 0.5) * 8, z = -BOWL.r - 20 - OG() * 18, r = 8 + OG() * 7, h = r * (1.4 + OG() * 0.6);
      const dome = new THREE.Mesh(domeGeo, domeMats[k % 3]);
      dome.scale.set(r, h, r * (0.8 + OG() * 0.4));
      dome.position.set(BOWL.x + x, 0, BOWL.z + z);
      dome.castShadow = dome.receiveShadow = true;
      scene.add(dome);
      graphics.dressing.push({ kind: 'olgas dome', x: +x.toFixed(1), z: +z.toFixed(1), h: +h.toFixed(1) });
    }
    for (const side of [-1, 1]) for (let t = 0; t < 3; t++) {
      const h = 4 + t * 4, x = side * (BOWL.r + 20 + t * 7), z = -18 + (OG() - 0.5) * 10;
      const face = new THREE.Mesh(new THREE.BoxGeometry(8, h, 46 - t * 6), flat(t % 2 ? '#C98A55' : '#B5763F'));
      face.position.set(BOWL.x + x, h / 2, BOWL.z + z);
      face.castShadow = face.receiveShadow = true;
      scene.add(face);
      graphics.dressing.push({ kind: `quarry terrace ${t + 1}`, x: +x.toFixed(1), z: +z.toFixed(1), h });
    }
    graphics.dressing.push({ kind: 'windmill', x: 38, z: -BOWL.r - 24, h: 15 }, { kind: 'shed', x: -46, z: -BOWL.r - 18, h: 7 }, { kind: 'sign', x: 6, z: -BOWL.r - 9, h: 3.5 });
    for (let u = 0; u < 4; u++) graphics.dressing.push({ kind: 'parked ute', x: -21 + u * 14, z: -BOWL.r - 14 - (u % 2) * 3, h: 2 });
    for (const a0 of [0.4, 1.9, 3.3, 4.6]) graphics.dressing.push({ kind: 'hay bales', x: +(Math.cos(a0) * (BOWL.r + 4.5)).toFixed(1), z: +(Math.sin(a0) * (BOWL.r + 4.5)).toFixed(1), h: 1.8 });
    bunting(Array.from({ length: 11 }, (_, j) => { const a = -Math.PI * 0.9 + j * (Math.PI * 0.8 / 10); return [BOWL.x + Math.cos(a) * (BOWL.r + 7.5), BOWL.z + Math.sin(a) * (BOWL.r + 7.5)]; }), 5);
  }

  // ---- bake: static props are built as plain meshes (readable above), then merged into one mesh per material, so the 24-tile
  // ArrayCamera pass (one draw per object per tile) issues tens of draws per tile instead of hundreds. Turning fans stay live.
  {
    scene.updateMatrixWorld(true);
    const buckets = new Map(), baked = [];
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      for (let p = o; p; p = p.parent) if (p.userData.live) return;
      const g = o.geometry, key = [o.material.uuid, o.castShadow, o.receiveShadow, !!g.index, Object.keys(g.attributes).sort().join()].join('|');
      if (!buckets.has(key)) buckets.set(key, { material: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] });
      const c = g.clone().applyMatrix4(o.matrixWorld);
      if (o.matrixWorld.determinant() < 0 && c.index) { const ix = c.index.array; for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]]; }
      buckets.get(key).geos.push(c);
      baked.push(o);
    });
    for (const o of baked) o.removeFromParent();
    for (const b of buckets.values()) {
      const m = new THREE.Mesh(mergeGeometries(b.geos, false), b.material);
      m.castShadow = b.cast; m.receiveShadow = b.receive; scene.add(m);
    }
    staticStats.meshes = baked.length; staticStats.merged = buckets.size;
  }

  // ---- cars: one InstancedMesh per part type, paint and id on instanced attributes (skill 'wiring') ----
  let P = DEFAULT_P;
  try { P = await (await fetch('../vendor/cruz/params.json')).json(); } catch { /* defaults */ }
  const atlas = makeAtlas({ paint: '#ffffff', pink: '#FFF4DE', lime: '#15203A' }); // livery bolts cream and navy: only the paint carries identity
  const texel = texture(atlas.map).rgb;
  const carMaterial = makeComicMaterial(look, { colorNode: damageCreep(paintKey(texel), texel), emissiveNode: texture(atlas.emissiveMap).rgb.mul(1.6), dynamicId: aCar.w, grit: { dust: aState.y } });
  const groups = {};
  for (const [name, mesh] of Object.entries(build(P, 1).parts)) (groups[name.startsWith('wheel') ? 'wheel' : name] ??= []).push(mesh);
  const parts = [];
  const cars = [];
  function setCars(list) {
    for (const im of parts) { scene.remove(im); im.dispose(); }
    parts.length = 0;
    cars.length = 0;
    list.forEach((c, i) => cars.push({ ...c, id: i + 1, pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), yaw: 0, s: c.s ?? 0, lane: c.lane ?? 0, speed: 0, spin: 0 }));
    for (const [key, meshes] of Object.entries(groups)) {
      const geo = meshes[0].geometry.clone();
      const im = new THREE.InstancedMesh(geo, carMaterial, Math.max(1, cars.length) * meshes.length);
      const per = [];
      cars.forEach((c) => meshes.forEach(() => per.push({ paint: c.paint, id: c.id, damage: c.damage ?? 0, dust: c.dust ?? 0.15 })));
      addCarAttributes(geo, per.length ? per : [{ paint: '#ffffff', id: 1 }]);
      im.userData = { key, meshes };
      im.castShadow = im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im);
      parts.push(im);
    }
  }

  const m4 = new THREE.Matrix4(), carM = new THREE.Matrix4(), off = new THREE.Matrix4(), spinM = new THREE.Matrix4(), mirror = new THREE.Matrix4().makeRotationY(Math.PI), tmp = new THREE.Vector3();
  let simTime = 0;
  function step(dt, mode = 'race') {
    simTime += dt;
    for (const fan of dressing.fans) fan.rotation.z += dt * 1.4;
    for (const c of cars) {
      if (c.fixed) { c.pos.set(c.x, 0, c.z); c.yaw = c.yaw0 ?? 0; c.fwd.set(Math.sin(c.yaw), 0, Math.cos(c.yaw)); continue; }
      if (mode === 'overview') {
        c.wander ??= { x: 0, z: 0, t: 0 };
        if (!c.init) { const a = c.id * 2.399; c.pos.set(BOWL.x + Math.cos(a) * 25, 0, BOWL.z + Math.sin(a) * 25); c.yaw = a; c.init = true; }
        const w = c.wander; w.t -= dt;
        const dx = BOWL.x + w.x - c.pos.x, dz = BOWL.z + w.z - c.pos.z;
        if (w.t <= 0 || Math.hypot(dx, dz) < 4) { const a = Math.random() * Math.PI * 2, d = Math.random() * (BOWL.r - 10); w.x = Math.cos(a) * d; w.z = Math.sin(a) * d; w.t = 3 + Math.random() * 3; }
        let dy = Math.atan2(dx, dz) - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yaw += Math.max(-1.6 * dt, Math.min(1.6 * dt, dy));
        c.fwd.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        c.speed = 11; c.pos.addScaledVector(c.fwd, c.speed * dt);
      } else {
        const u = ((c.s % trackLen) + trackLen) % trackLen / trackLen;
        const t0 = curve.getTangentAt(u), t1 = curve.getTangentAt((u + 0.02) % 1);
        const bend = Math.acos(Math.min(1, t0.dot(t1)));
        c.speed += ((34 - bend * 120) * (c.skill ?? 1) - c.speed) * Math.min(1, dt * 1.5);
        c.s += Math.max(12, c.speed) * dt;
        const uu = ((c.s % trackLen) + trackLen) % trackLen / trackLen;
        const p = curve.getPointAt(uu), t = curve.getTangentAt(uu);
        tmp.crossVectors(UP, t).normalize();
        c.pos.copy(p).addScaledVector(tmp, c.lane);
        c.fwd.copy(t); c.yaw = Math.atan2(t.x, t.z);
      }
      c.spin += (c.speed / 0.38) * dt;
    }
    for (const im of parts) {
      const { key, meshes } = im.userData;
      cars.forEach((c, i) => {
        carM.makeRotationY(c.yaw).setPosition(c.pos);
        meshes.forEach((pm, k) => {
          off.makeTranslation(...pm.userData.rest);
          if (key === 'wheel') { if (pm.name.endsWith('L')) off.multiply(mirror); off.multiply(spinM.makeRotationX(pm.name.endsWith('L') ? -c.spin : c.spin)); }
          im.setMatrixAt(i * meshes.length + k, m4.multiplyMatrices(carM, off));
        });
      });
      im.count = cars.length * meshes.length;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- cameras: one ArrayCamera, one sub-camera per tile; the post chain sees one camera ----
  const array = new THREE.ArrayCamera([]);
  array.near = 0.1; array.far = 900;
  const postFor = new Map();
  let current = null;
  function setTiles(rects) { // rects in canvas pixels, top-left origin: [{x, y, w, h}]
    while (array.cameras.length < rects.length) array.cameras.push(new THREE.PerspectiveCamera(60, 1, 0.1, 900));
    array.cameras.length = rects.length;
    rects.forEach((r, i) => {
      const cam = array.cameras[i];
      cam.viewport = new THREE.Vector4(r.x, r.y, r.w, r.h); // WebGPU viewports: top-left origin
      cam.aspect = r.w / r.h; cam.near = 0.1; cam.far = 900; cam.updateProjectionMatrix();
    });
    const minH = Math.min(...rects.map((r) => r.h));
    applyTier(look, tierFor(minH));
    updateLookCamera(look, array.cameras[0] ?? array);
    look.aspect.value = renderer.domElement.width / renderer.domElement.height;
    const key = `${mode}:${tierFor(minH).name}:${rects.length <= 4}:${JSON.stringify(overrides)}`;
    if (!postFor.has(key)) {
      const t = tierFor(minH);
      // Measured (docs/evidence/P1-U05/world/perf.json, GPU timestamp queries): at 24 tiles r182's bloom + FXAA add ~72 ms of GPU
      // at 1080p and ~192 ms at 4K (FXAA alone ~7 ms at 1080p), while toon + ink + halftone + grade cost under 1 ms over no post. So the
      // grid look runs without bloom (emissives keep their bright colour, no halo) and without FXAA (the ink outlines carry the
      // edges); both stay for 4 tiles or fewer.
      const opts = mode === 'plain' ? { bloom: false, halftone: false, outline: false, speedLines: false, fxaa: false }
        : { bloom: t.bloom > 0 && rects.length <= 4, halftone: t.halftone > 0, speedLines: false, outline: mode === 'ids' ? 'ids' : true, fxaa: rects.length <= 4 };
      Object.assign(opts, overrides); // ?bloom=0&halftone=0&fxaa=0 isolate one effect's cost
      postFor.set(key, comicPipeline(renderer, scene, array, look, opts).post);
    }
    current = postFor.get(key);
  }
  // Race-tile framing (P1-U05.2, R98) from ../shared/framing.json, shared with the TV mock: `dist` is a preset name
  // (near, mid, far) or 'round0' for the old rig.
  const chase = new THREE.Vector3(), lookAt = new THREE.Vector3();
  function aimTile(i, c, kind = 'tp', dist = FRAMING.distance.default) {
    const cam = array.cameras[i];
    if (kind === 'fp') {
      const F = FRAMING.firstPerson;
      tmp.crossVectors(UP, c.fwd).normalize();
      cam.position.copy(c.pos).addScaledVector(c.fwd, F.eye.forwardM).addScaledVector(tmp, F.eye.rightM).setY(F.eye.upM);
      if (cam.fov !== F.fovDeg) { cam.fov = F.fovDeg; cam.updateProjectionMatrix(); }
      cam.lookAt(lookAt.copy(c.pos).addScaledVector(c.fwd, F.lookAheadM).setY(F.lookUpM));
    } else {
      const R = dist === 'round0' ? FRAMING.round0 : FRAMING.chase[dist] ?? FRAMING.chase[FRAMING.distance.default];
      if (cam.fov !== R.fovDeg) { cam.fov = R.fovDeg; cam.updateProjectionMatrix(); }
      chase.copy(c.pos).addScaledVector(c.fwd, -R.backM).setY(R.upM);
      cam.position.lerp(chase, cam.userData.init ? 0.2 : 1); cam.userData.init = true;
      cam.lookAt(lookAt.copy(c.pos).addScaledVector(c.fwd, R.lookAheadM).setY(R.lookUpM));
    }
    cam.updateMatrixWorld();
  }
  function aimFixed(i, pos, at, fov = 50) {
    const cam = array.cameras[i];
    cam.position.copy(pos); cam.fov = fov; cam.updateProjectionMatrix(); cam.lookAt(at); cam.updateMatrixWorld();
  }
  function render() { current.render(); }
  function resize(w, h) { renderer.setSize(w, h, false); }

  return { renderer, backend, adapterInfo, scene, look, frames, graphics, trackLen, setCars, step, setTiles, aimTile, aimFixed, render, resize, placeSun, cars, array, colors, BOWL, staticStats };
}
