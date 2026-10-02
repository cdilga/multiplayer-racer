// capture.mjs — every evidence image for the spike, deterministic. node capture.mjs [only=hero,parts,checks,swap,ladder,field]
// Renders tiles into out/tiles/, then compose.py assembles the sheets.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { open, close, OUT } from './lib.mjs';
const only = (process.argv.find((a) => a.startsWith('only=')) ?? '').slice(5).split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
fs.mkdirSync(OUT + 'tiles', { recursive: true });
const meta = {};

const page = await open(1400, 900);
const run = (code, arg) => page.evaluate(async ([c, a]) => { const D = window.__demo; return await (new Function('D', 'A', `return (async()=>{${c}})()`))(D, a); }, [code, arg]);
async function tile(name, w, h, setup, cam, arg) {
  await page.setViewportSize({ width: w, height: h }); await run(`D.setSize(${w}, ${h});`);
  await run(setup, arg); await run(`D.look(...A); D.render();`, cam);
  await page.screenshot({ path: `${OUT}tiles/${name}.png` });
}
const ALL_DENTS = `{dent_door_L:1,dent_door_R:1,dent_door_rear_L:1,dent_door_rear_R:1,dent_bonnet:1,dent_boot:1,dent_bumper_front:1,dent_bumper_rear:1}`;

// ── A. decision-standard shots ──────────────────────────────────────────────────────────────────────────────────────────
if (want('hero')) {
  const W = 1200, H = 800;
  await tile('hero_intact', W, H, `await D.scene('single',{lod:0});`, [[0, 0.72, 0.1], 34, 15, 7.2, 28]);
  await tile('hero_intact_rear', W, H, `await D.scene('single',{lod:0});`, [[0, 0.72, -0.1], 148, 15, 6.9, 28]);
  await tile('hero_crushed', W, H, `await D.scene('single',{lod:0, channels:{damage_FL:1, damage_FR:0.45, damage_ROOF:0.8, damage_RL:0.3, dent_door_L:1, dent_bonnet:1, dent_bumper_front:1}, open:{door_L:0.55, bonnet:0.35}, smash:true, lamps:['light_head_L']});`, [[0, 0.7, 0.2], 32, 16, 7.4, 28]);
  await tile('hero_missing_door_bonnet', W, H, `await D.scene('single',{lod:0, remove:['door_L','bonnet'], channels:{damage_FL:0.5, dent_door_rear_L:0.6}});`, [[0, 0.7, 0.2], 38, 20, 7.2, 28]);
  await tile('hero_door_upside_down', W, H, `await D.clear(); D.showPart('door_L',{lod:0, deform:1, zones:0.5, rot:[0,0.5,-Math.PI/2]});`, [[0, 0.1, 0], 30, 28, 3.2, 28]);
}

// ── B. per-part damage sheet: on the car (intact / max deform / open-or-loose / removed) + detached from 5 sides ─────────────
if (want('parts')) {
  const W = 420, H = 315;
  const PARTS = {
    door_L: { t: [0.95, 0.85, 0.2], az: 78, el: 12, d: 4.2, open: 0.7, n: [1, 0, 0] },
    door_rear_L: { t: [0.95, 0.85, -0.45], az: 100, el: 12, d: 4.2, open: 0.7, n: [1, 0, 0] },
    bonnet: { t: [0, 0.95, 1.3], az: 25, el: 42, d: 4.2, open: 0.8, n: [0, 1, 0] },
    boot: { t: [0, 1.0, -1.7], az: 160, el: 38, d: 4.0, open: 0.8, n: [0, 1, 0] },
    bumper_front: { t: [0, 0.6, 1.7], az: 22, el: 12, d: 4.4, n: [0, 0, 1] },
    bumper_rear: { t: [0, 0.65, -1.9], az: 158, el: 12, d: 4.4, n: [0, 0, -1] },
    light_head_L: { t: [0.62, 0.75, 1.75], az: 25, el: 8, d: 2.2, n: [0, 0, 1] },
    wheel_FL: { t: [0.85, 0.42, 1.15], az: 72, el: 8, d: 3.2, n: [1, 0, 0] },
    mirror_L: { t: [1.0, 1.08, 0.58], az: 55, el: 14, d: 1.6, n: [1, 0, 0] },
  };
  meta.parts = Object.keys(PARTS);
  for (const [id, P] of Object.entries(PARTS)) {
    const dent = id.startsWith('door') || id === 'bonnet' || id === 'boot' || id.startsWith('bumper') ? `{dent_${id}:1, damage_FL:${id === 'door_rear_L' || id.includes('rear') || id === 'boot' ? 0 : 1}, damage_RL:${id.includes('rear') || id === 'boot' ? 1 : 0}}` : `{damage_FL:1}`;
    const cam = [P.t, P.az, P.el, P.d, 30];
    await tile(`part_${id}_0_intact`, W, H, `await D.scene('single',{lod:0});`, cam);
    await tile(`part_${id}_1_maxdeform`, W, H, `await D.scene('single',{lod:0, channels:${dent}});`, cam);
    if (P.open) await tile(`part_${id}_2_loose`, W, H, `await D.scene('single',{lod:0, channels:${dent}, open:{${id}:${P.open}}});`, cam);
    else await tile(`part_${id}_2_loose`, W, H, `await D.scene('single',{lod:0, channels:${dent}, remove:['${id}']}); const v=D.cars[0].v;`, [P.t, P.az + 25, P.el + 5, P.d, 30]);
    await tile(`part_${id}_3_removed`, W, H, `await D.scene('single',{lod:0, channels:${dent}, remove:['${id}']});`, cam);
    // detached, at full deformation, from five sides; "under" is the part flipped over and seen from above
    const views = [['4_outside', 0, 10], ['5_inside', 180, 10], ['6_edge', 90, 6], ['7_top', 0, 85], ['8_under', 0, 85]];
    const yawOut = Math.atan2(P.n[0], P.n[2]) * 180 / Math.PI;
    for (const [v, daz, el] of views) {
      const flip = v === '8_under' ? 'Math.PI' : '0';
      await tile(`part_${id}_${v}`, W, H, `await D.clear(); A.size = D.showPart('${id}', {lod:0, deform:1, zones:${id === 'wheel_FL' || id.startsWith('light') || id.startsWith('mirror') ? 0.7 : 0.6}, rot:[${flip},0,0], lift:0.4});`, [[0, 0.3, 0], yawOut + daz, el, id.startsWith('light') || id.startsWith('mirror') ? 1.3 : 3.0, 30], {});
    }
  }
}

// ── C. explicit failure checks (the list from the brief) ───────────────────────────────────────────────────────────────
if (want('checks')) {
  const W = 560, H = 400, C = [];
  const add = (name, setup, cam) => C.push([name, setup, cam]);
  add('door_exterior_up', `await D.clear(); D.showPart('door_L',{lod:0, deform:1, zones:0.6, rot:[0,0,Math.PI/2]});`, [[0, 0.1, 0], 25, 35, 3.0, 30]);
  add('door_interior_up', `await D.clear(); D.showPart('door_L',{lod:0, deform:1, zones:0.6, rot:[0,0,-Math.PI/2]});`, [[0, 0.1, 0], 25, 35, 3.0, 30]);
  add('bonnet_upside_down', `await D.clear(); D.showPart('bonnet',{lod:0, deform:1, zones:0.8, rot:[Math.PI,0,0]});`, [[0, 0.1, 0], 30, 35, 3.2, 30]);
  add('bumper_from_behind', `await D.clear(); D.showPart('bumper_front',{lod:0, deform:1, zones:0.8});`, [[0, 0.3, 0], 180, 18, 3.2, 30]);
  add('max_FL_crush', `await D.scene('single',{lod:0, channels:{damage_FL:1}});`, [[0, 0.7, 0.4], 35, 18, 6.6, 30]);
  add('max_roof_crush', `await D.scene('single',{lod:0, channels:{damage_ROOF:1}});`, [[0, 0.8, -0.2], 120, 12, 6.8, 30]);
  add('FL_plus_left_door', `await D.scene('single',{lod:0, channels:{damage_FL:1, dent_door_L:1}});`, [[0, 0.7, 0.4], 62, 14, 6.4, 30]);
  add('detached_keeps_damage', `await D.clear(); D.showPart('door_L',{lod:0, deform:1, zones:1, rot:[0,0.0,0]});`, [[0, 0.5, 0], 90, 10, 3.0, 30]);
  add('cavity_door_removed', `await D.scene('single',{lod:0, remove:['door_L','door_rear_L']});`, [[0.3, 0.85, -0.1], 80, 12, 4.4, 30]);
  add('cavity_bonnet_removed', `await D.scene('single',{lod:0, remove:['bonnet']});`, [[0, 0.8, 1.2], 15, 40, 4.2, 30]);
  add('wheel_detached', `await D.scene('single',{lod:0, remove:['wheel_FL'], channels:{damage_FL:0.6}}); const w=D.showPart('wheel_FL',{lod:0, zones:0.6, rot:[0,0,1.3]}); D.stage.scene.children.at(-1).position.set(2.0,0,2.2);`, [[0.8, 0.5, 1.3], 55, 14, 5.4, 30]);
  add('complete_wreck', `await D.scene('single',{lod:0, channels:{damage_FL:1,damage_FR:0.7,damage_RL:0.5,damage_RR:0.9,damage_ROOF:1, ...${ALL_DENTS}}, remove:['door_R','bonnet','bumper_rear','wheel_RR'], open:{door_L:0.9, boot:0.6}, smash:true, lamps:['light_head_L','light_brake_R']});`, [[0, 0.7, 0], 145, 22, 7.6, 30]);
  meta.checks = C.map((c) => c[0]);
  for (const [n, s, c] of C) await tile('check_' + n, W, H, s, c);
}

// ── D. swap identity: intact fast path vs the assembly at zero damage, same camera, every LOD ───────────────────────────────
if (want('swap')) {
  meta.swap = [];
  for (const lod of [0, 1, 2, 3]) for (const [az, el] of [[34, 15], [148, 15], [90, 3]]) {
    const d = [6.4, 9, 18, 34][lod], W = 700, H = 450, cam = [[0, 0.72, 0], az, el, d, 28];
    await tile(`swap_L${lod}_${az}_intact`, W, H, `await D.scene('single',{lod:${lod}});`, cam);
    await tile(`swap_L${lod}_${az}_assembly`, W, H, `await D.scene('single',{lod:${lod}}); D.cars[0].v.wake();`, cam);
    const a = PNG.sync.read(fs.readFileSync(`${OUT}tiles/swap_L${lod}_${az}_intact.png`)), b = PNG.sync.read(fs.readFileSync(`${OUT}tiles/swap_L${lod}_${az}_assembly.png`));
    let diff = 0, maxd = 0, n = a.width * a.height; for (let i = 0; i < a.data.length; i += 4) { const dd = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2])); maxd = Math.max(maxd, dd); if (dd > 12) diff++; }
    meta.swap.push({ lod, az, pctPixelsOver12: +(100 * diff / n).toFixed(4), maxDelta: maxd });
  }
}

// ── E. LOD ladder at the projected sizes each rung is used at (car bounding-sphere diameter in px) ─────────────────────────
if (want('ladder')) {
  meta.ladder = [];
  const SIZES = [[0, 1, 520], [1, 2, 190], [2, 3, 70], [1, 2, 120], [2, 3, 40]];   // [coarser-at-this-size vs finer] at the switch size and well inside the rung
  for (const state of ['intact', 'damaged']) for (const [a, b, px] of SIZES) for (const l of [a, b]) {
    const W = Math.max(64, Math.round(px * 1.5)), H = Math.max(48, Math.round(px * 1.1)), fov = 28, dist = (2 * 2.35) / (2 * Math.tan((fov * Math.PI) / 360) * (px / H));
    const setup = state === 'intact' ? `await D.scene('single',{lod:${l}});` : `await D.scene('single',{lod:${l}, channels:{damage_FL:1, damage_ROOF:0.7, dent_door_L:1}, remove:['bonnet','door_rear_L']});`;
    await tile(`ladder_${state}_${px}_L${l}`, W, H, setup, [[0, 0.75, 0], 34, 18, dist, fov]);
    meta.ladder.push({ state, px, lod: l, pair: [a, b] });
  }
}

// ── F. field: persistent wrecks + debris ───────────────────────────────────────────────────────────────────────────────
if (want('field')) {
  await tile('field_overview', 1600, 1000, `await D.scene('field',{active:16, wrecks:10, settle:6}); D.updateLods();`, [[0, 0, 0], 30, 55, 42, 40]);
  await tile('field_pile', 1600, 1000, `D.updateLods();`, [[0, 0.5, 0], 200, 28, 17, 40]);
  await tile('field_pile_close', 1600, 1000, `D.updateLods();`, [[1, 0.5, 1], 130, 22, 10, 40]);
  meta.field = await run(`return D.sim.stats();`);
}

fs.writeFileSync(OUT + 'capture-meta.json', JSON.stringify({ ...JSON.parse(fs.existsSync(OUT + 'capture-meta.json') ? fs.readFileSync(OUT + 'capture-meta.json') : '{}'), ...meta }, null, 1));
console.log(JSON.stringify(meta.swap ?? {}, null, 0));
await close();
