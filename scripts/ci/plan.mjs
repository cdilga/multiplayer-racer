#!/usr/bin/env node
// CI test selection (docs/infra/ci.md): which suites a push must run, from the paths it changed since the last commit
// CI passed on. Conservative by construction: a path no rule knows selects everything, and a change to a shared
// input (the Cargo workspace, a crate other crates depend on, web/shared, the build config, maps and assets) widens
// to everything that depends on it. The full matrix (every suite, the 5-minute soak) runs on the nightly schedule and
// on a manual dispatch, so the coverage is the same; only the timing moves.
//
// Usage: node scripts/ci/plan.mjs [--full] [--base <sha>] [--head <sha>] [--github-output <file>]
//   --base: the commit to diff from (default: the newest ancestor whose CI lanes all passed, looked up through the
//   Gitea API; none found within 200 first-parent commits selects everything).
//   Prints the selection as one human line plus JSON; with --github-output, writes the job outputs too.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const repoRoot = git('rev-parse', '--show-toplevel');
const head = opt('--head') ?? git('rev-parse', 'HEAD');

// ---- the suites -------------------------------------------------------------------------------------------------
const list = (dir, re = /\.test\.mjs$/) =>
  existsSync(join(repoRoot, dir))
    ? readdirSync(join(repoRoot, dir))
        .filter((f) => re.test(f))
        .sort()
        .map((f) => `${dir}/${f}`)
    : [];
const HOST = list('web/host/tests');
const TRANSPORT = list('web/shared/transport/tests');
const JOURNEYS = list('web/tests/journeys');
// Hardware fact (R93): these measure host frame time or need 24-120 GPU-rendered tiles, so they run on a `gpu` runner
// with JJ_CHROMIUM_GPU=1 (on SwiftShader R06 skips itself and C06's 150 ms identify bound is loose).
const GPU = JOURNEYS.filter((f) => /\/(r06-identify|c06-identify-menu)\.test\.mjs$/.test(f));
const KIT = 'web/shared/ui/tests';
const LANDING = 'web/landing/tests';
const SSE = 'crates/jj-server/tests/sse.test.mjs';

// The crates and who depends on them (normal, dev and build deps alike), from the manifests.
const crateDirs = readdirSync(join(repoRoot, 'crates')).filter((d) => existsSync(join(repoRoot, 'crates', d, 'Cargo.toml')));
const deps = new Map(
  crateDirs.map((d) => {
    const toml = readFileSync(join(repoRoot, 'crates', d, 'Cargo.toml'), 'utf8');
    const found = new Set([...toml.matchAll(/^(jj-[a-z0-9-]+)\s*=/gm)].map((m) => m[1]).filter((n) => n !== d));
    return [d, found];
  }),
);
const dependents = (seeds) => {
  const out = new Set(seeds);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [c, ds] of deps) if (!out.has(c) && [...ds].some((x) => out.has(x))) out.add(c), (grew = true);
  }
  return out;
};
// Crates the browser builds carry (the host's sim, procgen and input WASM) and the native jj the host tests compare
// against: a change to any of them reaches every browser suite. jj-server alone reaches only what serves through it.
const wasmClosure = new Set();
for (const root of ['jj-wasm-host', 'jj-wasm-input', 'jj-wasm-procgen', 'jj-tools']) {
  const stack = [root];
  while (stack.length) {
    const c = stack.pop();
    if (wasmClosure.has(c) || !deps.has(c)) continue;
    wasmClosure.add(c);
    stack.push(...deps.get(c));
  }
}

// ---- the selection --------------------------------------------------------------------------------------------
const sel = {
  reason: [],
  rustAll: false,
  crates: new Set(),
  hostAll: false,
  host: new Set(),
  journeysAll: false,
  journeys: new Set(),
  transportAll: false,
  transport: new Set(),
  kit: false,
  landing: false,
  sse: false,
  image: false,
};
const everything = (why) => {
  sel.reason.push(why);
  sel.rustAll = sel.hostAll = sel.journeysAll = sel.transportAll = true;
  sel.kit = sel.landing = sel.sse = sel.image = true;
};
const browserAll = () => {
  sel.hostAll = sel.journeysAll = sel.transportAll = sel.kit = sel.landing = sel.sse = sel.image = true;
};
const servedAll = () => {
  // What runs through jj-server and the built pages, but not the host's own page tests.
  sel.journeysAll = sel.transportAll = sel.landing = sel.sse = sel.image = true;
};

// Each rule: [regex, action(path, match)]. First match wins; no match selects everything.
const rules = [
  // Never an input to a build or a test (tests write evidence under docs/, they never read it).
  [/^(docs|spikes|\.beads|\.apr|\.ntm)\//, () => {}],
  [/^[^/]+\.md$|^(LICENSE|COPYING|COPYRIGHT_HEADER\.txt|\.python-version|\.gitignore)$/, () => {}],
  [/\.md$/, () => {}],
  [/^\.claude\//, () => {}], // the jammers-look recipe check is in the always-on checks job
  [/^art\/(audio|references|style)\//, () => {}],
  [/^(tools\/(maps|vehicles|turn-guard)|scripts\/(beads|emulators|remote))\//, () => {}], // checks job
  [/^scripts\/(beads-live|ci-status|doctor|plan-ref|poc-publish|prune-caches|push|reclaim-target|reconcile_[a-z_]+)\.(sh|py|txt)$/, () => {}],
  [/^scripts\/ci\/durations\.(json|mjs)$/, () => {}], // the slot packer's estimates: they move timing, not coverage
  // CI's own files: the next run of this workflow is their test; run everything so it's proven end to end.
  [/^(\.gitea\/|scripts\/ci\/)/, (p) => everything(`CI change (${p})`)],
  // The workspace and shared inputs.
  [/^(Cargo\.(toml|lock)|rust-toolchain\.toml|deny\.toml|\.cargo\/|\.nvmrc|package(-lock)?\.json|\.gitattributes|\.dockerignore)/, (p) => everything(`workspace input ${p}`)],
  [/^(maps|assets|scenarios|art\/vehicles|art\/contracts|tools\/net)\//, (p) => everything(`shared data ${p.split('/').slice(0, 2).join('/')}`)],
  [/^scripts\/(build-host-wasm|wasm-test-runner)\.sh$/, (p) => everything(`build script ${p}`)],
  [/^docker\//, () => (sel.image = true)],
  // Rust.
  [/^crates\/jj-server\/tests\/sse\.test\.mjs$/, () => (sel.sse = true)],
  [
    /^crates\/([^/]+)\//,
    (p, m) => {
      const c = m[1];
      if (!deps.has(c)) return everything(`unknown crate dir ${c}`);
      for (const d of dependents([c])) sel.crates.add(d);
      if (wasmClosure.has(c)) browserAll();
      else if (dependents([c]).has('jj-server')) servedAll();
    },
  ],
  // Web: a test file alone selects itself; anything a test file imports widens to its suite.
  [/^web\/host\/tests\/[^/]+\.test\.mjs$/, (p) => sel.host.add(p)],
  [/^web\/host\/tests\//, () => (sel.hostAll = true)],
  [/^web\/tests\/journeys\/[^/]+\.test\.mjs$/, (p) => sel.journeys.add(p)],
  [/^web\/tests\/journeys\//, () => (sel.journeysAll = true)],
  [/^web\/shared\/transport\/tests\/[^/]+\.test\.mjs$/, (p) => sel.transport.add(p)],
  [/^web\/shared\/transport\/tests\//, () => (sel.transportAll = true)],
  [/^web\/shared\/ui\/tests\//, () => (sel.kit = true)],
  [/^web\/landing\/tests\//, () => (sel.landing = true)],
  [/^web\/landing\//, () => ((sel.landing = true), servedAll())],
  // The host and controller apps: every page test, journey and transport test, and the landing build (one Vite build
  // makes every page, and the landing bundle check guards what the host's chunks must not leak into). Not the UI kit,
  // which builds its own bundle from web/shared/ui.
  [/^web\/(host|controller)\//, () => ((sel.hostAll = true), servedAll())],
  [/^art\/ui\/brand\//, () => ((sel.landing = true), (sel.kit = true), (sel.image = true))],
  [/^art\/ui\//, () => browserAll()], // tokens, sheets and POC modules the kit and pages import
  [/^tools\/audio\//, () => ((sel.hostAll = true), (sel.image = true))], // the cue sheet the host and the image bundle
  [/^web\//, () => browserAll()], // host, controller, shared, kit, build config: every page goes through one Vite build
];

let base = opt('--base');
const full = args.includes('--full');
if (full) everything('full run (schedule or dispatch)');
else {
  if (!base) base = await lastGreen();
  if (!base) everything('no green ancestor found');
  else {
    const changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
    sel.reason.push(`diff ${base.slice(0, 10)}..${head.slice(0, 10)}: ${changed.length} paths`);
    for (const p of changed) {
      const rule = rules.find(([re]) => re.test(p));
      if (!rule) everything(`unmapped path ${p}`);
      else rule[1](p, p.match(rule[0]));
    }
  }
}

// ---- outputs ------------------------------------------------------------------------------------------------------
const pick = (all, fileSet, allFiles) => (all ? allFiles : allFiles.filter((f) => fileSet.has(f)));
const hostFiles = pick(sel.hostAll, sel.host, HOST);
const transportFiles = pick(sel.transportAll, sel.transport, TRANSPORT);
const journeyFiles = pick(sel.journeysAll, sel.journeys, JOURNEYS);
const crates = sel.rustAll ? 'all' : [...sel.crates].sort().join(' ');
// The CPU browser targets (every selected file; the GPU-gated journeys run here too, on SwiftShader, as they always
// have: R06 skips itself there and C06's identify bound is loose) and, for gpu.yml, the GPU subset.
const browser = [
  ...hostFiles,
  ...(sel.kit ? [KIT] : []),
  ...(sel.landing ? [LANDING] : []),
  ...transportFiles,
  ...journeyFiles,
  ...(sel.sse ? [SSE] : []),
];
const gpu = journeyFiles.filter((f) => GPU.includes(f));
// Pack the targets into the workflow's static matrix of browser slots (Gitea can't build a matrix from job outputs):
// longest first onto the least-loaded slot, so with enough slots every file gets its own runner. Durations are the
// `slot-timing` lines of earlier runs (scripts/ci/durations.json); an unknown file counts as 60 s.
const SLOTS = Number(opt('--slots') ?? 16);
let durations = {};
try {
  durations = JSON.parse(readFileSync(join(repoRoot, 'scripts/ci/durations.json'), 'utf8'));
} catch {}
const est = (t) => (t === SSE ? Number(full ? 300 : 20) + 5 : (durations[t] ?? 60));
const load = Array.from({ length: SLOTS }, () => ({ s: 0, t: [] }));
for (const t of [...browser].sort((a, b) => est(b) - est(a))) {
  const slot = load.reduce((m, x) => (x.s < m.s ? x : m));
  slot.s += est(t);
  slot.t.push(t);
}
const used = load.filter((x) => x.t.length).sort((a, b) => b.s - a.s);
const slots = Object.fromEntries(used.map((x, i) => [String(i + 1), x.t]));
const out = {
  rust: crates !== '' ? 'true' : 'false',
  crates,
  build: browser.length + gpu.length > 0 ? 'true' : 'false',
  slots: JSON.stringify(slots),
  n: String(used.length),
  gpu: JSON.stringify(gpu),
  gpu_any: gpu.length ? 'true' : 'false',
  image: sel.image ? 'true' : 'false',
  soak: full ? '300' : '20',
  full: full ? 'true' : 'false',
};
const short = (f) => (f === KIT ? 'ui-kit' : f === LANDING ? 'landing' : f.replace(/^.*\//, '').replace(/\.test\.mjs$/, ''));
const summary =
  `selected: rust(${crates || 'none'}); browser (${browser.length} in ${used.length} slots, longest ~${Math.round(used[0]?.s ?? 0)} s): ${browser.length ? browser.map(short).join(', ') : 'none'}; ` +
  `gpu: ${gpu.length ? gpu.map(short).join(', ') : 'none'}; image: ${out.image}; soak: ${out.soak}s ` +
  `[${sel.reason.join('; ')}]`;
console.log(summary);
console.log(JSON.stringify(out, null, 2));
const gh = opt('--github-output');
if (gh) appendFileSync(gh, Object.entries({ ...out, summary }).map(([k, v]) => `${k}=${v}\n`).join(''));

// The newest first-parent ancestor of HEAD whose `CI / …` statuses all passed (skipped counts as passed). Public repo:
// reads need no token, but one is sent when the job has it.
async function lastGreen() {
  const api = process.env.GITEA_API ?? `${process.env.GITHUB_SERVER_URL ?? 'http://192.168.11.12:3001'}/api/v1`;
  const repo = process.env.GITHUB_REPOSITORY ?? 'cdilga/multiplayer-racer';
  const headers = process.env.GITEA_TOKEN ? { Authorization: `token ${process.env.GITEA_TOKEN}` } : {};
  let shas;
  try {
    shas = git('rev-list', '--first-parent', '--max-count=200', `${head}~1`).split('\n').filter(Boolean);
  } catch {
    return undefined; // shallow history
  }
  for (const sha of shas) {
    let statuses;
    try {
      const r = await fetch(`${api}/repos/${repo}/commits/${sha}/statuses?limit=100`, { headers });
      if (!r.ok) return undefined;
      statuses = await r.json();
    } catch {
      return undefined;
    }
    const latest = new Map();
    for (const s of statuses) if (s.context?.startsWith('CI /') && !latest.has(s.context)) latest.set(s.context, s.status ?? s.state);
    if (latest.size && [...latest.values()].every((st) => st === 'success' || st === 'skipped')) return sha;
  }
  return undefined;
}
