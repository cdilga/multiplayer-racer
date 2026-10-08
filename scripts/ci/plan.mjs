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
import { fileOf, splitTargets } from './targets.mjs';

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
// Host page tests, plus the bug-clip and session-recorder tests (P1-F07, P1-F12) that live beside their code.
const HOST = [...list('web/host/tests'), ...list('web/host/src/clips')];
const TRANSPORT = list('web/shared/transport/tests');
// The journeys and the public smoke flow (P1-D07): WebRTC tests through a local jj-server, one suite here.
const JOURNEYS = [...list('web/tests/journeys'), ...list('web/tests/smoke')];
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
    // `jj-x = { path = … }` or `jj-x.workspace = true` (the workspace's form). Missing the second form made every crate
    // look dependency-free, so a crate change selected only itself (fixed 2026-10-08; P1-F02's dry runs caught it).
    const found = new Set([...toml.matchAll(/^(jj-[a-z0-9-]+)\s*(?:=|\.workspace\b)/gm)].map((m) => m[1]).filter((n) => n !== d));
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
  tools: false,
};
const everything = (why) => {
  sel.reason.push(why);
  sel.rustAll = sel.hostAll = sel.journeysAll = sel.transportAll = true;
  sel.kit = sel.landing = sel.sse = sel.image = sel.tools = true;
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
  [/^\.agents\//, () => {}], // .agents/skills is a link to .claude/skills (P1-F09)
  [/^art\/(audio|references|style)\//, () => {}],
  [/^tools\/(maps|vehicles|turn-guard)\//, () => (sel.tools = true)], // the checks job's bake and validators (lane `tools`)
  [/^scripts\/(beads|emulators|remote)\//, () => {}],
  [/^scripts\/(beads-live|ci-status|doctor|plan-ref|poc-publish|prune-caches|push|reclaim-target|reconcile_[a-z_]+)\.(sh|py|txt)$/, () => {}],
  [/^scripts\/ci\/durations\.(json|mjs)$/, () => {}], // the slot packer's estimates: they move timing, not coverage
  // Deploy code and its workflows (R117): not inputs to the game; their tests and the secret guard are in checks.
  [/^infra\//, () => {}],
  [/^\.gitea\/workflows\/deploy-[a-z0-9-]+\.yml$/, () => {}],
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
  [/^web\/host\/(tests|src\/clips)\/[^/]+\.test\.mjs$/, (p) => sel.host.add(p)],
  [/^web\/host\/tests\//, () => (sel.hostAll = true)],
  [/^web\/tests\/(journeys|smoke)\/[^/]+\.test\.mjs$/, (p) => sel.journeys.add(p)],
  [/^web\/tests\/(journeys|smoke)\//, () => (sel.journeysAll = true)],
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
const given = opt('--changed'); // a dry run: comma-separated paths instead of a diff
const full = args.includes('--full') || process.env.JJ_FULL === 'true'; // schedule and dispatch runs
if (full) everything('full run (schedule or dispatch)');
else {
  if (!base && !given) base = await lastGreen();
  if (!base && !given) everything('no green run of this workflow found');
  else {
    let changed;
    if (given) {
      changed = given.split(',').filter(Boolean);
      base = 'given-paths';
    } else {
      // CI checks out one commit; fetch the base the same way (a tree diff needs no history between them).
      try {
        git('cat-file', '-e', `${base}^{commit}`);
      } catch {
        git('fetch', '-q', '--depth=1', 'origin', base);
      }
      changed = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
    }
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
// 7 slots = the `browser` runners' capacity (4 on triton, 3 on the slower TrueNAS): more SwiftShader pages at once than the
// hosts have cores made every page 2-4x slower and the timing tests fail (run 1461).
const SLOTS = Number(opt('--slots') ?? 7);
let durations = {};
try {
  durations = JSON.parse(readFileSync(join(repoRoot, 'scripts/ci/durations.json'), 'utf8'));
} catch {}
const est = (t) => {
  if (t === SSE) return Number(full ? 300 : 20) + 5;
  if (durations[t] !== undefined) return durations[t];
  const parts = Object.entries(durations).filter(([k]) => k.startsWith(`${t}::`));
  return parts.length ? parts.reduce((a, [, v]) => a + v, 0) : 60;
};
// A file longer than SPLIT_OVER seconds runs as one target per top-level test (scripts/ci/targets.mjs), so no slot
// waits on a whole long file. Each target pays the file's before() (build, server, browser launch) once; that's in
// its measured duration, and an unmeasured one is estimated as its share of the file plus 10 s.
const SPLIT_OVER = 75;
const targets = browser.flatMap((f) => (est(f) > SPLIT_OVER ? splitTargets(repoRoot, durations, f) : [f]));
const estT = (t) => {
  if (durations[t] !== undefined) return durations[t];
  const f = fileOf(t);
  return f === t ? est(f) : est(f) / targets.filter((x) => fileOf(x) === f).length + 10;
};
const load = Array.from({ length: SLOTS }, () => ({ s: 0, t: [] }));
for (const t of [...targets].sort((a, b) => estT(b) - estT(a))) {
  const slot = load.reduce((m, x) => (x.s < m.s ? x : m));
  slot.s += estT(t);
  slot.t.push(t);
}
const used = load.filter((x) => x.t.length).sort((a, b) => b.s - a.s);
const slots = Object.fromEntries(used.map((x, i) => [String(i + 1), x.t]));
// The lanes (P1-F02): names for what a selection runs, the vocabulary of the bead contract, ci-status.sh and
// batch-verify.sh. Every job runs its plan step; a lane is the set of steps the plan turns on:
//   rust        rust-lint (fmt, check, clippy, deny, no-Tokio, jj validate) and rust-test for the selected crates
//   scenarios   the scenario banks: rust-test including jj-sim, jj-map or jj-procgen
//   wasm-parity rust-test's WASM parity in Node (jj-map, jj-procgen) or a jj-wasm-* crate
//   web         the web build and its checks (WASM, typecheck, bundle, tokens, origins) and the host page tests
//   e2e         journeys, transport, landing, UI kit, smoke flow and SSE soak in the browser slots
//   tools       tools/ and art/vehicles changes (the checks job's bake and validators; checks itself always runs)
//   image       the jj-server image
const inCrates = (list) => sel.rustAll || list.some((c) => sel.crates.has(c));
const lanes = [
  crates !== '' && 'rust',
  inCrates(['jj-sim', 'jj-map', 'jj-procgen']) && 'scenarios',
  inCrates(['jj-map', 'jj-procgen', 'jj-wasm-host', 'jj-wasm-input', 'jj-wasm-procgen']) && 'wasm-parity',
  (hostFiles.length > 0 || sel.kit || sel.landing) && 'web',
  (journeyFiles.length > 0 || transportFiles.length > 0 || sel.landing || sel.kit || sel.sse) && 'e2e',
  sel.tools && 'tools',
  sel.image && 'image',
].filter(Boolean);
const out = {
  lanes: lanes.join(','),
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
  // The last green commit this selection diffs from (empty for a full run): the image job re-tags its image for HEAD
  // when nothing the image is built from changed since it.
  base: base && /^[0-9a-f]{7,40}$/.test(base) ? base : '',
};
const short = (f) => (f === KIT ? 'ui-kit' : f === LANDING ? 'landing' : f.replace(/^.*\//, '').replace(/\.test\.mjs$/, ''));
const summary =
  `selected: lanes ${lanes.join(', ') || 'checks only'}; rust(${crates || 'none'}); browser (${browser.length} files as ${targets.length} targets in ${used.length} slots, longest ~${Math.round(used[0]?.s ?? 0)} s): ${browser.length ? browser.map(short).join(', ') : 'none'}; ` +
  `gpu: ${gpu.length ? gpu.map(short).join(', ') : 'none'}; image: ${out.image}; soak: ${out.soak}s ` +
  `[${((r) => (r.length > 12 ? [...r.slice(0, 12), `… ${r.length - 12} more`] : r))([...new Set(sel.reason)]).join('; ')}]`;
console.log(summary);
console.log(JSON.stringify(out, null, 2));
const gh = opt('--github-output');
if (gh) appendFileSync(gh, Object.entries({ ...out, summary }).map(([k, v]) => `${k}=${v}\n`).join(''));

// The head of the newest successful run of this workflow on this branch (all jobs passed or were skipped), from one
// Gitea API call. The diff from it covers everything pushed since, including runs replaced while waiting and red
// runs, so a suite that failed keeps running until it passes. Reads need the job's token (anonymous reads get 403).
async function lastGreen() {
  const api = process.env.GITEA_API ?? `${process.env.GITHUB_SERVER_URL ?? 'http://192.168.11.12:3001'}/api/v1`;
  const repo = process.env.GITHUB_REPOSITORY ?? 'cdilga/multiplayer-racer';
  const branch = process.env.GITHUB_REF_NAME ?? git('rev-parse', '--abbrev-ref', 'HEAD');
  const headers = process.env.GITEA_TOKEN ? { Authorization: `token ${process.env.GITEA_TOKEN}` } : {};
  try {
    const q = `${api}/repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&status=success&limit=20`;
    const r = await fetch(q, { headers });
    if (!r.ok) return undefined;
    const runs = (await r.json()).workflow_runs ?? [];
    const green = runs.find((x) => x.conclusion === 'success' && /^ci\.yml@/.test(x.path ?? '') && x.head_sha !== head);
    return green?.head_sha;
  } catch {
    return undefined;
  }
}

