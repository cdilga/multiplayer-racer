#!/usr/bin/env node
// Writes crates/jj-map/tests/fixtures/broken/*.json (P1-M01): each is the greybox plus one mistake, as JSON-pointer
// patch ops (and optional extra kit-piece registry entries), and names the rule the validator must report.
// Positions are computed from maps/greybox-loop.json, so rerun this after regenerating the greybox.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const map = JSON.parse(readFileSync(join(repo, 'maps', 'greybox-loop.json'), 'utf8'));
const dir = join(repo, 'crates', 'jj-map', 'tests', 'fixtures', 'broken');
mkdirSync(dir, { recursive: true });

const pts = map.route.points;
const heading = (i) => { const a = pts[i], b = pts[(i + 1) % pts.length]; return Math.atan2(b.z - a.z, b.x - a.x); };
// A pose `lateral` mm off the centerline at point i (the validator's + side is (−tz, tx)).
const at = (i, lateral = 0, ahead = 0) => {
  const h = heading(i), p = pts[i];
  return { x: Math.round(p.x + Math.cos(h) * ahead - Math.sin(h) * lateral), y: 0, z: Math.round(p.z + Math.sin(h) * ahead + Math.cos(h) * lateral), yaw: Math.round((((h * 180) / Math.PI + 360) % 360) * 100) };
};
const nearestPoint = (x, z) => pts.reduce((best, p, i) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(pts[best].x - x, pts[best].z - z) ? i : best), 0);
const jumpIdx = map.features.findIndex((f) => f.kind === 'jump');
const kerbIdx = map.features.findIndex((f) => f.kind === 'kerb');
const jump = map.features[jumpIdx];
const jumpPoint = nearestPoint(jump.pose.x, jump.pose.z);
const finishIdx = map.route.gates.findIndex((g) => g.finish);
const start = map.route.start;
const half = (i) => pts[i].width / 2;

const fixtures = {
  'unknown-kit-piece': { why: 'a dressing piece names an id the registry lacks', ops: [{ op: 'replace', path: '/dressing/0/kitPiece', value: 'generic/fountain' }] },
  'registry-collider': { why: 'a registry entry has no collider proxy', registry: [{ id: 'test/no-collider', json: { id: 'test/no-collider', version: 1, lod: { simplifyBeyondMm: 1000 } } }], ops: [] },
  'registry-schema': { why: "a registry entry's collider uses a param it doesn't declare", registry: [{ id: 'test/bad-param', json: { id: 'test/bad-param', version: 1, collider: { box: { x: { param: 'lengthMm' }, y: 1000, z: 500 } }, lod: { simplifyBeyondMm: 1000 } } }], ops: [] },
  'drivable-width': { why: 'the road narrows to 5 m', ops: [{ op: 'replace', path: '/route/points/10/width', value: 5000 }] },
  'wall-thickness': {
    why: 'a colliding fence 10 cm thick',
    registry: [{ id: 'test/thin-fence', json: { id: 'test/thin-fence', version: 1, collider: { box: { x: 4000, y: 900, z: 100 } }, lod: { simplifyBeyondMm: 1000 } } }],
    ops: [{ op: 'add', path: '/dressing/-', value: { kitPiece: 'test/thin-fence', pose: map.dressing[0].pose, params: {}, collides: true } }],
  },
  gates: { why: 'no gate is the finish line', ops: [{ op: 'replace', path: `/route/gates/${finishIdx}/finish`, value: false }] },
  'route-obstructed': { why: 'a building stands on the road', ops: [{ op: 'add', path: '/dressing/-', value: { kitPiece: 'generic/box-building', pose: at(30), params: {}, collides: true } }] },
  'landing-envelope': { why: 'a bin sits on the jump landing', ops: [{ op: 'add', path: '/props/-', value: { kitPiece: 'generic/bin', pose: at(jumpPoint, 2500, 18000), params: {} } }] },
  'jump-bypass': { why: 'the ramp takes the whole road', ops: [{ op: 'replace', path: `/features/${jumpIdx}/params/rampWidthMm`, value: 10000 }] },
  'start-corridor': { why: 'a cone stands in the start corridor', ops: [{ op: 'add', path: '/props/-', value: { kitPiece: 'generic/cone', pose: at(start.at - 8), params: {} } }] },
  'camera-clearance': { why: 'a 4.5 m building 1 m off the road edge', ops: [{ op: 'add', path: '/dressing/-', value: { kitPiece: 'generic/box-building', pose: at(20, -(half(20) + 1000 + 3000)), params: { widthMm: 9000, depthMm: 6000, heightCm: 450 }, collides: false } }] },
  'kit-params': { why: 'a barrier 100 m tall', ops: [{ op: 'replace', path: '/dressing/0/params/heightCm', value: 9999 }] },
  schema: { why: 'an unknown field on the route', ops: [{ op: 'add', path: '/route/surfaceSpeed', value: 3 }] },
  version: { why: 'a future version string', ops: [{ op: 'replace', path: '/header/version', value: 'jj.map.v2' }] },
  'feature-params': { why: 'a kerb 50 cm high', ops: [{ op: 'replace', path: `/features/${kerbIdx}/params/heightCm`, value: 50 }] },
  bounds: { why: 'a cone far outside the bounds', ops: [{ op: 'add', path: '/props/-', value: { kitPiece: 'generic/cone', pose: { x: map.header.bounds.maxX + 50000, y: 0, z: 0, yaw: 0 }, params: {} } }] },
  terrain: { why: 'one height missing from the grid', ops: [{ op: 'remove', path: '/terrain/heights/0' }] },
  recovery: { why: 'nowhere to respawn', ops: [{ op: 'replace', path: '/route/recovery', value: [] }] },
  'ref-lap': { why: 'a zero reference lap', ops: [{ op: 'replace', path: '/header/refLapMs', value: 0 }] },
  'gameplay-hash': { why: 'a stored hash that does not match', ops: [{ op: 'replace', path: '/header/gameplayHash', value: '00' }] },
  segments: { why: 'a named segment past the end of the route', ops: [{ op: 'replace', path: '/route/segments/0/span/to', value: pts.length + 10 }] },
};
for (const [rule, f] of Object.entries(fixtures)) {
  writeFileSync(join(dir, `${rule}.json`), `${JSON.stringify({ expect: rule, why: f.why, registry: f.registry ?? [], ops: f.ops }, null, 1)}\n`);
}
console.log(`broken fixtures: ${Object.keys(fixtures).length} in ${dir}`);
