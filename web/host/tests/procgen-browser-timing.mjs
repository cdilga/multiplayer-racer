// P1-M03g ev:hardware: generate + validate in WASM inside a real browser, with the CPU throttled (not a node.js number).
// `jj-wasm-procgen`'s prepare(seed, recipe) (the four-biome lap through the whole fallback ladder) runs on the page's MAIN
// thread here, because Emulation.setCPUThrottlingRate slows the page's main thread and not its workers. Seeds 0..23, at
// no throttle and at 6x (the phone-host stand-in), in headless Chromium with software GL.
//   scripts/build-host-wasm.sh && node web/host/tests/procgen-browser-timing.mjs
// Writes docs/evidence/P1-M03g/browser-timing.json (JJ_EVIDENCE overrides) and fails if the worst unthrottled seed exceeds 1.5 s or the worst 6x seed exceeds 4 s.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repo = resolve(import.meta.dirname, '../../..');
const pkg = join(repo, 'web/host/src/procgen/pkg');
const out = process.env.JJ_EVIDENCE ?? join(repo, 'docs/evidence/P1-M03g/browser-timing.json');
const BUDGET_MS = Number(process.env.JJ_BUDGET_MS ?? 1500); // the laptop budget, unthrottled
const THROTTLED_BUDGET_MS = Number(process.env.JJ_THROTTLED_BUDGET_MS ?? 4000); // the phone-host stand-in at 6x
const SEEDS = 24;
const THROTTLE = Number(process.env.JJ_THROTTLE ?? 6);

const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const server = createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  if (name === '/index.html') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>procgen timing</title>');
  try {
    const body = readFileSync(join(pkg, name));
    res.writeHead(200, { 'content-type': types[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(origin);
await page.evaluate(async (origin) => {
  const m = await import(`${origin}/jj_wasm_procgen.js`);
  await m.default();
  window.__pg = m;
}, origin);
const info = await page.evaluate(() => window.__pg.buildInfo());

async function run(rate) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const rows = await page.evaluate((n) => {
    const recipe = window.__pg.defaultRecipe();
    const rows = [];
    for (let seed = 0; seed < n; seed++) {
      const t = performance.now();
      const p = window.__pg.prepare(seed, recipe);
      rows.push({ seed, ms: Math.round((performance.now() - t) * 10) / 10, plan: p.plan, valid: p.valid, attempts: JSON.parse(p.log).length });
      p.free();
    }
    return rows;
  }, SEEDS);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const ms = rows.map((r) => r.ms);
  return { throttle: rate, worstMs: Math.max(...ms), meanMs: Math.round((ms.reduce((a, b) => a + b, 0) / ms.length) * 10) / 10, allValid: rows.every((r) => r.valid), rows };
}

await run(1); // warm-up: JIT and the wasm instance's first touches
const runs = [await run(1), await run(THROTTLE)];
const result = {
  what: 'jj-wasm-procgen prepare(seed, default four-biome recipe) per seed (generate + validate through the fallback ladder), on the page main thread in Chromium',
  budgetMs: { unthrottled: BUDGET_MS, throttled: THROTTLED_BUDGET_MS },
  browser: `Chromium ${browser.version()} (Playwright headless, software GL)`,
  host: { os: `${platform()}/${arch()}`, cpu: cpus()[0]?.model, cores: cpus().length },
  build: { procgen: info, commit: process.env.JJ_COMMIT ?? null },
  seeds: SEEDS,
  note: `Emulation.setCPUThrottlingRate on the page via CDP; the work runs on the main thread so the throttle applies (it doesn't reach workers)`,
  runs: runs.map(({ rows, ...r }) => ({ ...r, worstSeed: rows.reduce((a, b) => (b.ms > a.ms ? b : a)).seed, plans: Object.fromEntries([...new Set(rows.map((r) => r.plan))].map((p) => [p, rows.filter((r) => r.plan === p).length])) })),
  perSeed: runs.map((r) => ({ throttle: r.throttle, ms: r.rows.map((x) => x.ms) })),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify(result.runs));
await browser.close();
server.close();
if (!runs.every((r) => r.allValid)) throw new Error('a seed produced no valid map');
if (runs[0].worstMs > BUDGET_MS) throw new Error(`worst seed ${runs[0].worstMs} ms unthrottled exceeds the ${BUDGET_MS} ms budget`);
if (runs[1].worstMs > THROTTLED_BUDGET_MS) throw new Error(`worst seed ${runs[1].worstMs} ms at ${THROTTLE}x exceeds the ${THROTTLED_BUDGET_MS} ms budget`);
