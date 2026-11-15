// br-8h3u.4: look at a generated loop from six sides (left, right, front, back, above, low) through __jjRender.peek.
//   node <this> <outdir> [recipe] [seedFrom]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, mkdtempSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const R = process.cwd();
const { chromium } = await import(`${R}/node_modules/playwright/index.mjs`);
const { build, serve } = await import(`${R}/web/landing/tests/lib/site.mjs`);
const { chromiumArgs } = await import(`${R}/web/tests/journeys/lib/chromium.mjs`);

const out = process.argv[2], recipe = process.argv[3] ?? 'rocks', from = +(process.argv[4] ?? 1);
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'jj-loopview-'));
symlinkSync(resolve('assets'), join(scratch, 'assets'), 'dir');
const dir = join(scratch, 'map');
let map, loop, seed;
for (seed = from; seed < from + 30 && !loop; seed++) {
  execFileSync('cargo', ['run', '--locked', '-q', '-p', 'jj-tools', '--bin', 'jj', '--', 'procgen', '--seed', String(seed), '--recipe', recipe, '--loops', '1', '--out', dir, '--json']);
  map = JSON.parse(readFileSync(join(dir, 'map.json'), 'utf8'));
  loop = map.features.find((f) => f.kind === 'loop');
}
seed--;
const mapJson = JSON.stringify(map);
const p = loop.params, P = map.route.points, m = (q) => [q.x / 1000, q.y / 1000, q.z / 1000];
const e = m(P[p.entry]), x = m(P[p.exit]);
const c = [(e[0] + x[0]) / 2, (e[1] + x[1]) / 2 + p.radiusMm / 1000, (e[2] + x[2]) / 2];
const fwd = [x[0] - e[0], x[2] - e[2]], fl = Math.hypot(...fwd), f = [fwd[0] / fl, fwd[1] / fl], l = [f[1], -f[0]];
const R0 = p.radiusMm / 1000;
console.log(JSON.stringify({ seed, recipe, entry: p.entry, exit: p.exit, radius: R0, c }));
const server = await serve(build('./', 'loopview'), '/p/loopview/', { JJ_STUN_URLS: '' });
const browser = await chromium.launch({ args: chromiumArgs });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.route('**/loopview.json', (r) => r.fulfill({ contentType: 'application/json', body: mapJson }));
await page.goto(`${server.origin}/p/loopview/host?test&look=on&res=1&autores=off&mapUrl=${encodeURIComponent(server.origin + '/loopview.json')}`);
await page.waitForFunction(() => window.__jjTest && window.__jjRender);
const fixture = { scenario: 'loopview', what: 'look at a loop', map: 'x', seed, ticks: 10, cars: [{ routePoint: Math.max(0, p.entry - 40), lift: 0.3 }], race: { laps: 1, atTick: 0 }, seats: [], inputs: [], expect: [] };
await page.evaluate(async ({ fixture, mapJson }) => { window.__jjRender.hold(); await window.__jjTest.load(fixture, mapJson); }, { fixture, mapJson });
await page.evaluate(() => window.__jjTest.step(2));
await page.evaluate(() => window.__jjRender.frame());
await page.waitForTimeout(1500);
const d = R0 * 3.2;
const views = {
  left: [c[0] + l[0] * d, c[1] + R0 * 0.3, c[2] + l[1] * d],
  right: [c[0] - l[0] * d, c[1] + R0 * 0.3, c[2] - l[1] * d],
  front: [c[0] - f[0] * d * 1.3 + l[0] * 4, c[1] + R0 * 0.2, c[2] - f[1] * d * 1.3 + l[1] * 4],
  back: [c[0] + f[0] * d * 1.3 - l[0] * 4, c[1] + R0 * 0.2, c[2] + f[1] * d * 1.3 - l[1] * 4],
  above: [c[0] + 0.01, c[1] + R0 * 5, c[2] + 0.01],
  lowleft: [c[0] + l[0] * d * 0.8 + f[0] * R0, e[1] + 1.5, c[2] + l[1] * d * 0.8 + f[1] * R0],
};
for (const [name, eye] of Object.entries(views)) {
  await page.evaluate(({ eye, c }) => window.__jjRender.peek(eye, c, 55), { eye, c: [c[0], c[1] - R0 * 0.4, c[2]] });
  await page.screenshot({ path: join(out, `${recipe}-${seed}-${name}.jpg`), type: 'jpeg', quality: 80 });
}
await browser.close();
await server.close();
