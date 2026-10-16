// Thumb-to-screen latency stages (P1-FL17, R134): joins the controller's sent batches (seq, touch, send) to the host's
// stamps for the same batch (off the channel on main, into the worker, applied at a tick) and to the first frame drawn at
// or past that tick. Every time is on one shared clock (`performance.timeOrigin + now`, ms), which only holds when the
// controller and the host run on one machine: a cross-device run has to add a clock offset first.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'latency-budget.json'), 'utf8'));

/** The stages in path order: [name, from, to]. */
export const STAGES = [
  ['touchToSend', 'touchAt', 'sentAt'],
  ['network', 'sentAt', 'arrivedAt'],
  ['mainToWorker', 'arrivedAt', 'receivedAt'],
  ['workerToTick', 'receivedAt', 'appliedAt'],
  ['tickToDrawn', 'appliedAt', 'drawnAt'],
  ['total', 'touchAt', 'drawnAt'],
];

/**
 * One row per sent batch that carried a fresh touch and was seen through to a drawn frame.
 * `sent`: [{seq, sentAt, touchAt}] (controller), `net`: [{seq, arrivedAt, receivedAt, appliedAt, tick}] (host worker),
 * `frames`: [{at, tick, newest}] (host renderer, in draw order).
 */
export function joinStages(sent, net, frames) {
  const bySeq = new Map();
  for (const n of net) bySeq.set(n.seq, n); // the newest stamp per wrapping seq; a run is far shorter than 65 536 batches
  const rows = [];
  let f = 0;
  for (const s of sent) {
    if (s.touchAt === null) continue;
    const n = bySeq.get(s.seq);
    if (!n || n.arrivedAt < s.sentAt - 1000) continue; // not this batch (a wrapped seq from long ago)
    while (f < frames.length && frames[f].at < n.appliedAt) f++;
    let g = f;
    while (g < frames.length && frames[g].tick < n.tick) g++;
    if (g >= frames.length) continue;
    rows.push({ seq: s.seq, touchAt: s.touchAt, sentAt: s.sentAt, arrivedAt: n.arrivedAt, receivedAt: n.receivedAt, appliedAt: n.appliedAt, drawnAt: frames[g].at, tick: n.tick });
  }
  return rows;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const round = (v) => Math.round(v * 10) / 10;

/** p50/p99/max per stage (ms), plus how far the drawn tick trails the newest snapshot (ticks). */
export function summarise(rows, frames) {
  const out = { samples: rows.length };
  for (const [name, from, to] of STAGES) {
    const v = rows.map((r) => r[to] - r[from]).sort((a, b) => a - b);
    out[name] = { p50: round(quantile(v, 0.5)), p99: round(quantile(v, 0.99)), max: round(v.at(-1) ?? NaN) };
  }
  const lag = frames.map((fr) => fr.newest - fr.tick).sort((a, b) => a - b);
  const gaps = frames.slice(1).map((fr, i) => fr.at - frames[i].at).sort((a, b) => a - b);
  out.renderLagTicks = { p50: round(quantile(lag, 0.5)), p99: round(quantile(lag, 0.99)) };
  out.frameMs = { p50: round(quantile(gaps, 0.5)), p99: round(quantile(gaps, 0.99)) };
  // The five slowest touches, by their place in the run (a hitch at the start reads differently from one mid-run).
  out.worst = rows.map((r, i) => ({ i, ...Object.fromEntries(STAGES.map(([name, from, to]) => [name, round(r[to] - r[from])])) }))
    .sort((a, b) => b.total - a.total).slice(0, 5);
  return out;
}

/** The host-side stages over their committed budget (CI fails on any): the budget with a real GPU, the regression bound on
 *  a software-rendered runner. */
export function overBudget(summary, gpu = false) {
  const budget = gpu ? BUDGET.hostSideGpu : BUDGET.hostSide;
  const problems = [];
  for (const [stage, limits] of Object.entries(budget)) {
    for (const [q, limit] of Object.entries(limits)) {
      const v = summary[stage]?.[q];
      if (!(v <= limit)) problems.push(`${stage} ${q} ${v} > ${limit}`);
    }
  }
  return problems;
}
