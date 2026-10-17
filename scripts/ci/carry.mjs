// What CI still has to prove (docs/infra/ci.md, br-15gd): the base a selective run diffs from, and what an earlier run
// selected but didn't pass. scripts/ci/plan.mjs adds the diff's selection to it.
//
// The rule, by induction over completed runs: after run P, everything is proven green at P's head except what P selected
// and didn't pass. So run N selects diff(P.head..N.head) plus P's unproven set, where P is the newest completed run
// before N. The old rule diffed from the last *green* run, and while any test stayed red every run diffed hundreds of
// paths and ran the full matrix (runs 5153-5438, all from 9f63c12b).
//
// A run whose plan or job results can't be read, or that was cancelled, is skipped: the diff from an older run is wider
// and still sound. Nothing readable within MAX_BACK runs returns undefined, and plan.mjs falls back to the last green
// run.
//
// What a failed job leaves unproven:
//   rust-lint  the lint (it always covers the whole workspace);
//   rust-test  the crates of nextest's failing tests, plus the -p crates of any other failing step (doc tests, the
//              `testing` build, WASM parity); all of P's crates when that can't be read from the log;
//   browser k  P's slot-k targets without a `slot-timing: … pass <target>` line, as whole files;
//   image      the image;
//   checks and build carry nothing: checks always runs, and a failed build fails every slot that needed it.
import { execFileSync } from 'node:child_process';
import { fileOf } from './targets.mjs';

const MAX_BACK = 10;
const SETTLED = new Set(['success', 'skipped']);

/** GET a Gitea API path: with the job's token inside CI, through `tea api` (the gitea-lan login) elsewhere. */
export function giteaGet(path, { text = false } = {}) {
  if (process.env.GITEA_TOKEN && process.env.GITHUB_ACTIONS) {
    const api = process.env.GITEA_API ?? `${process.env.GITHUB_SERVER_URL ?? 'http://192.168.11.12:3001'}/api/v1`;
    return fetch(`${api}${path}`, { headers: { Authorization: `token ${process.env.GITEA_TOKEN}` } }).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return text ? r.text() : r.json();
    });
  }
  const out = execFileSync('tea', ['api', '--login', 'gitea-lan', path], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return Promise.resolve(text ? out : JSON.parse(out));
}

const strip = (l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '').replace(/\x1b\[[0-9;]*m/g, '');
const lines = (log) => log.split('\n').map(strip);

/** The plan a job printed (plan.mjs's JSON after its `selected:` line), or undefined. */
export function planFromLog(log) {
  const L = lines(log);
  const one = L.find((l) => l.startsWith('plan-json: '));
  if (one) return JSON.parse(one.slice('plan-json: '.length));
  const at = L.findIndex((l) => l.startsWith('selected: '));
  if (at < 0 || L[at + 1] !== '{') return undefined;
  const end = L.indexOf('}', at + 1);
  if (end < 0) return undefined;
  return JSON.parse(L.slice(at + 1, end + 1).join('\n'));
}

const cratesOf = (cmd) => {
  if (/--workspace\b/.test(cmd)) return 'all';
  return [...cmd.matchAll(/(?:^|\s)-p\s+(\S+)/g)].map((m) => m[1]);
};

/** The crates a failed rust-test job left unproven, from its log: a list, or 'all' (P's whole selection). */
export function rustUnproven(log) {
  const L = lines(log);
  const steps = L.map((l) => /^rust-test: \d+s exit (\d+)\s+(.*)$/.exec(l)).filter(Boolean);
  const main = steps.find(([, , cmd]) => /cargo nextest run/.test(cmd) && !/--features/.test(cmd));
  if (!main) return 'all'; // it never got as far as the tests: nothing was proven
  const out = new Set();
  if (main[1] !== '0') {
    const failed = L.map((l) => /^\s+(FAIL|TIMEOUT|SIG[A-Z]+|ABORT|LEAK-FAIL)\s+\[[^\]]*\]\s+(?:\([^)]*\)\s+)?(\S+)\s/.exec(l)).filter(Boolean);
    if (!failed.length) return 'all'; // a build error or a crash nextest didn't attribute
    for (const m of failed) out.add(m[2].split('::')[0]);
  }
  for (const [, rc, cmd] of steps) {
    if (rc === '0' || cmd === main[2]) continue;
    const c = cratesOf(cmd);
    if (c === 'all' || !c.length) return 'all';
    c.forEach((x) => out.add(x));
  }
  return [...out].sort();
}

/** The targets a browser slot's log shows passing. */
export function passedTargets(log) {
  return new Set(lines(log).map((l) => /slot-timing: [\d.]+s pass (.+)$/.exec(l)?.[1]).filter(Boolean));
}

/**
 * The newest completed run before this one whose results are readable, as
 * { run, base, crates: 'all' | string[], lint, image, files: string[], reason }, or undefined.
 */
export async function carryForward({ repo, branch, runId, get = giteaGet }) {
  const runs = (await get(`/repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&limit=${MAX_BACK + 5}`)).workflow_runs ?? [];
  const done = runs
    .filter((r) => /^ci\.yml@/.test(r.path ?? '') && String(r.id) !== String(runId) && r.status === 'completed')
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_BACK);
  const skipped = [];
  for (const r of done) {
    try {
      const c = await unproven(r, repo, get);
      if (c) return { ...c, reason: `carry from run ${r.id} (${r.conclusion})${skipped.length ? `, skipped ${skipped.join(', ')}` : ''}: ${describe(c)}` };
      skipped.push(`${r.id} (${r.conclusion})`);
    } catch (e) {
      skipped.push(`${r.id} (${e.message})`);
    }
  }
  return undefined;
}

const describe = (c) =>
  [
    c.crates === 'all' ? 'all crates' : c.crates.length ? `crates ${c.crates.join(' ')}` : '',
    c.lint ? 'lint' : '',
    c.files.length ? `${c.files.length} browser files` : '',
    c.image ? 'image' : '',
  ]
    .filter(Boolean)
    .join(', ') || 'nothing unproven';

async function unproven(run, repo, get) {
  const base = run.head_sha;
  if (!/^[0-9a-f]{40}$/.test(base ?? '')) return undefined;
  const empty = { run: run.id, base, crates: [], lint: false, image: false, files: [] };
  if (run.conclusion === 'success') return empty;
  if (run.conclusion !== 'failure') return undefined; // cancelled, timed out, …: skip to an older run
  const jobs = (await get(`/repos/${repo}/actions/runs/${run.id}/jobs?limit=100`)).jobs ?? [];
  if (!jobs.length || jobs.some((j) => j.status !== 'completed')) return undefined;
  const failed = jobs.filter((j) => !SETTLED.has(j.conclusion));
  const log = (j) => get(`/repos/${repo}/actions/jobs/${j.id}/logs`, { text: true });
  // The plan P ran with: from any job that ran its plan step (rust-lint's log is the smallest).
  const planned = [...jobs].sort((a, b) => (a.name === 'rust-lint' ? -1 : b.name === 'rust-lint' ? 1 : 0)).filter((j) => j.name !== 'checks' && j.conclusion !== 'skipped');
  let plan;
  for (const j of planned) {
    plan = planFromLog(await log(j));
    if (plan) break;
  }
  if (!plan && failed.some((j) => j.name !== 'checks')) return undefined;
  const out = { ...empty };
  const slots = plan ? JSON.parse(plan.slots || '{}') : {};
  const files = new Set();
  for (const j of failed) {
    if (j.name === 'rust-lint') out.lint = true;
    else if (j.name === 'image') out.image = true;
    else if (/^rust-test( \(\d+\))?$/.test(j.name)) {
      // rust-test runs as nextest partitions (`rust-test (k)`): what any of them left unproven carries.
      const c = rustUnproven(await log(j));
      const all = plan.crates === 'all' ? 'all' : plan.crates.split(' ').filter(Boolean);
      const add = c === 'all' ? all : c;
      if (add === 'all' || out.crates === 'all') out.crates = 'all';
      else out.crates = [...new Set([...(Array.isArray(out.crates) ? out.crates : []), ...add])].sort();
    } else if (/^browser \(\d+\)$/.test(j.name)) {
      const k = /\((\d+)\)/.exec(j.name)[1];
      const pass = passedTargets(await log(j));
      for (const t of slots[k] ?? []) if (!pass.has(t)) files.add(fileOf(t));
    } else if (j.name !== 'checks' && j.name !== 'build') return undefined; // a job this rule doesn't know: skip P
  }
  out.files = [...files].sort();
  return out;
}
