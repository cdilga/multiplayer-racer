#!/usr/bin/env node
// Independent owner-tape/photo cues. This is not calibrated orthographic photo IoU.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = JSON.parse(fs.readFileSync(path.join(DIR, 'refs/measured-reference.json')));
const bounds = vs => vs.length ? [0, 1].map(k => [0, 1, 2].map(j => (k ? Math.max : Math.min)(...vs.map(p => p[j])))) : null;
const inRegion = (uv, r) => uv[0] >= r[0] - 1e-6 && uv[0] <= r[2] + 1e-6 && uv[1] >= r[1] - 1e-6 && uv[1] <= r[3] + 1e-6;

export function measure(parts, atlas, pixels = atlas.drawAtlas()) {
  const tris = id => {
    const p = parts[id], out = []; if (!p) return out;
    for (let i = 0; i < p.positions.length; i += 9) out.push({
      v: [0, 3, 6].map(k => p.positions.slice(i + k, i + k + 3).map((x, j) => x + p.pivot[j])),
      uv: [0, 2, 4].map(k => p.uvs.slice(i / 3 * 2 + k, i / 3 * 2 + k + 2)),
    });
    return out;
  };
  const back = tris('back'), regions = ['canopy', 'canopyRear', 'canopyTop'].map(k => atlas.REGION[k]);
  const canopy = back.filter(t => t.uv.every(uv => regions.some(r => inRegion(uv, r))));
  const chrome = atlas.swatchUV('chrome');
  const deck = back.filter(t => t.v.every(v => v[1] >= 1.039 && v[1] <= 1.091) && t.uv.every(uv => Math.hypot(uv[0] - chrome[0], uv[1] - chrome[1]) < 1e-6));
  const high = tris('core').flatMap(t => t.v);
  const paint = atlas.swatchUV('paint');
  const roof = tris('core').filter(t=>t.uv.every(uv=>Math.hypot(uv[0]-paint[0],uv[1]-paint[1])<1e-6)).flatMap(t=>t.v).filter(v => v[1] >= 1.75 && v[1] <= 1.89 && v[2] > -1.3 && v[2] < .09);
  const roofTexture = back.filter(t => t.uv.every(uv => inRegion(uv, atlas.REGION.canopyTop)));
  const sample = uv => {
    const x = Math.min(pixels.width - 1, Math.max(0, Math.floor(uv[0] * pixels.width)));
    const y = Math.min(pixels.height - 1, Math.max(0, Math.floor((1 - uv[1]) * pixels.height)));
    return Array.from(pixels.base.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3));
  };
  const darkLid = roofTexture.length > 0 && roofTexture.every(t => Math.max(...sample([0, 1].map(j => t.uv.reduce((s, p) => s + p[j], 0) / 3))) < 65);
  return {
    canopy: bounds(canopy.flatMap(t => t.v)), tray: bounds(deck.flatMap(t => t.v)), cabRoof: bounds(roof), darkLid,
    awning: bounds(high.filter(v => v[0] > .73 && v[1] > 1.99 && v[2] < .66 && v[2] > -1.3)),
    snorkel: bounds(high.filter(v => v[0] < -.89 && v[1] > 1.78 && v[2] > .04 && v[2] < .4)),
  };
}

export function evaluate(m) {
  const checks = [], check = (name, pass, actual, expected) => checks.push({ name, pass, actual, expected });
  for (const id of ['tray', 'canopy']) {
    const r = ref.visualOracles[id];
    check(`${id}: tape envelope`, !!m[id] && m[id].every((v, k) => v.every((x, j) => Math.abs(x - r.bounds[k][j]) <= r.tolerance)), m[id], r.bounds);
  }
  check('cab: tapered roof', !!m.cabRoof && m.cabRoof[0][0] >= -.79 && m.cabRoof[1][0] <= .79, m.cabRoof, 'half width <= .79m at y1.75..1.89; newer source estimate .69m + facet tolerance');
  check('canopy: black lid', m.darkLid, m.darkLid, 'UV-selected canopy roof RGB <65');
  check('awning: left roof edge', !!m.awning, m.awning, 'nonempty actual geometry x>.73,y>1.99');
  check('snorkel: right A pillar', !!m.snorkel, m.snorkel, 'nonempty actual geometry x<-.89,y>1.78,z.04...4');
  return checks;
}

export async function runChecks({ sourceDir = DIR, defects = true } = {}) {
  const model = await import(pathToFileURL(path.join(sourceDir, 'model.js')));
  const atlas = await import(pathToFileURL(path.join(sourceDir, 'atlas.js')));
  const p = JSON.parse(fs.readFileSync(path.join(sourceDir, 'params.json'))), pixels = atlas.drawAtlas(), lods = [];
  for (const lod of [0, 1, 2]) {
    const parts = model.soups(p, lod).parts, measurement = measure(parts, atlas, pixels), checks = evaluate(measurement), injections = [];
    if (defects) for (const [name, mutate, expected] of [
      ['canopy raised 15cm', p => { const b = p.back; for (let i = 1; i < b.positions.length; i += 3) if (b.positions[i] + b.pivot[1] > 1.10) b.positions[i] += .15; }, 'canopy: tape envelope'],
      ['tray width enlarged 20%', p => { const b = p.back; for (let i = 0; i < b.positions.length; i += 3) if (b.positions[i + 1] + b.pivot[1] >= 1.039 && b.positions[i + 1] + b.pivot[1] <= 1.091) b.positions[i] *= 1.2; }, 'tray: tape envelope'],
      ['cab roof widened 35%', p => { const b = p.core; for (let i = 0; i < b.positions.length; i += 3) if (b.positions[i + 1] > 1.75 && b.positions[i + 1] < 1.89) b.positions[i] *= 1.35; }, 'cab: tapered roof'],
    ]) {
      const copy = structuredClone(parts); mutate(copy);
      const c = evaluate(measure(copy, atlas, pixels)).find(c => c.name === expected);
      injections.push({ name, detected: !c.pass, gate: expected });
    }
    lods.push({ lod, measurement, checks, injections, pass: checks.every(c => c.pass) && injections.every(i => i.detected) });
  }
  return { sourceSha256: Object.fromEntries(['model.js','atlas.js','params.json'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceDir,f))).digest('hex')])), reference: 'refs/measured-reference.json', candidate: path.relative(DIR, sourceDir) || '.', comparison: 'Independent measured geometry envelopes and photo-derived cues; no old generated-sheet IoU.', lods, pass: lods.every(l => l.pass) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--source');
  const report = await runChecks({ sourceDir: i >= 0 ? path.resolve(process.argv[i + 1]) : DIR });
  console.log(JSON.stringify(report, null, 2)); if (!report.pass) process.exitCode = 1;
}
