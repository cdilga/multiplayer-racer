# Code-first / batch-verify

> **2026-10-02 (R91):** NTM is paused. The same roles run as native Claude Code agents coordinating
> with native messaging; "pane" below means "agent". Agent Mail still handles file reservations and
> the commit guard. The worker hook applies to any Claude agent started with `JJ_ROLE=worker`.

How a small swarm (at most 5 agents, including you and the verifier) ships 0.2 work without
re-running the same expensive pipelines for every bead. Adopted 2026-09-30; worker loop widened
2026-10-02 (owner ruling, below).

> **2026-10-02 (owner ruling): workers get the full development loop.** A worker may do whatever its
> bead needs to get the behaviour right: run local or eris-hosted servers, set up multi-device and
> multi-controller sessions, use the emulators, debug, inspect game state through `jj`, write and run
> the e2e journeys and scenario banks for its area, and loop on game mechanics or on a model with
> visual inspection until it works. What workers **don't** do is the full CI matrix: workspace-wide
> test runs and whole Playwright suites are batched by the verifier across many submitted changes,
> because running them per bead would bury our CPUs. A batch failure keeps the bead open and sends it
> back to its agent with a note. Favour Physical Soccer's style of tests (scenario banks and
> journeys) over piles of unit tests; see the Playtest-1 plan §13 and §13b.

**Verification of the whole is expensive and serial; developing a feature is not.** So workers build,
run and test their own area as much as they need, and the expensive full verification runs once per
*wave* of beads, centrally. "Committed", "verified" and "delivered" stay separate: a bead only counts as done
when a green, revision-bound run exercised its behaviour.

## The loop

```text
open / rework ──claim──> in_progress ──hand-off──> batch_pending ──green + gate──> closed
                              ^                           │
                              └─────── rework <───────────┘   (same assignee, failing assertion attached)
```

`.beads/policy.yaml` enforces this. The only route to `closed` is `batch_pending -> closed`, and it
needs a `batch_verify` gate pass for the current revision, all acceptance items ticked, a close reason
citing `receipt:<file>`, and a closer who didn't claim the bead.

## Roles

| Role | Who | Environment |
|---|---|---|
| Worker | Claude agents (one bead per fresh session) | `JJ_ROLE=worker`; the project hook blocks only the batched verification (workspace-wide test runs, whole Playwright suites, workspace-wide local cargo on the Mac, `batch-verify.sh`) and tracker closes |
| Batch verifier | One pane (or the coordinator) | `JJ_ROLE=verifier` plus `AGENT_NAME=<its Agent Mail name>` |
| Owner | You | Rulings and gates (G-FEEL, G-LOOK, ...); never needs a role |

## Worker loop (Phase 1)

1. `br ready --json`, then claim the top bead: `br update <id> --claim --actor <AgentMailName>`.
   You can hold one bead at a time, and it must already have acceptance criteria.
2. Write the **real code and its real tests** in the same bead. Placeholder tests don't count. Prefer
   behaviour-level tests: scenario-bank cases (versioned fixtures, replayed bit for bit, asserting
   outcome envelopes) for the sim, and Playwright journeys (a real host plus controller contexts
   through the real join path) for anything a player touches. Add a unit test only where the unit
   is the lowest level that shows the behaviour (codecs, goldens, a pure layout kernel).
3. **Develop with the full loop.** Run what the bead needs, preferably on eris (`scripts/remote/eris.sh`,
   `rch exec -- cargo …`): local servers, multi-controller and multi-device sessions, emulators,
   `jj sim`/`jj play` probes, the scenarios and journeys for your area, debuggers, captures and
   visual inspection loops; iterate on mechanics or a model until it meets the bead's goal. Run
   focused checks for what you changed. **Don't** run the batched verification: workspace-wide
   `cargo test`, whole Playwright suites, `batch-verify.sh`. Never wait on remote CI before handing off.
4. Commit immediately. Put the bead ID in the message, e.g. `feat(sim): … (br-xxxx)`.
5. Hand off:
   `br update <id> --status batch_pending --transition-comment "commit:<sha> AC1: tests/…::name, AC2: …"`.
   Only hand off substantively complete work, with every acceptance item mapped to a test. Anything
   known to be incomplete stays `in_progress`.
6. Take the next bead. `rework` beads come back to you through `br ready`, with the failure attached.

Your commit rate is the verifier's saturation signal, never your score. Credit only arrives when your
bead closes green.

## Verifier loop (Phase 2)

Start a wave at the **earliest** of these triggers (never on a quiet commit rate alone):

- the ready pool runs dry
- verification debt reaches its soft cap (8 across `in_progress + batch_pending + rework`)
- a bead that others depend on becomes verifiable
- the wave already spans a lot of the codebase
- a time or risk bound is reached

Then:

1. **Commit-flush.** Ask the panes to commit. `run` refuses a dirty tracked tree unless you pass
   `--allow-dirty`, and then it records the dirt in the receipt.
2. `scripts/beads/batch-verify.sh plan` shows the wave range, the `batch_pending` beads and the
   suites it will run.
3. `scripts/beads/batch-verify.sh run` runs one pass over the union of what changed:
   - Scope comes from `git diff <last receipt head>..HEAD`, never from what agents declare.
   - Compile gates run first. A stack whose compile gate fails skips its tests, because an aborted
     compile can print a misleading green prefix.
   - Rust goes through `rch exec`. Use `--e2e smoke` for the CI smoke spec instead of all of Playwright.
   - It writes `.beads/receipts/wave-NNN.json`: base, head, tree, dirty inventory, toolchain,
     lockfile hashes, exact commands, exit codes, and the beads with their commits. Logs go to
     `.beads/receipts/logs/` (gitignored).
4. **Red:** cluster the failures by file, then send each bead back to its owner:
   `batch-verify.sh rework <id> "FAIL tests/x.rs:42 expected 3 got 2"`. Triage; don't silently finish
   the work yourself. Re-run after the fixes. Every attempt keeps its own receipt, and passing on a
   re-run doesn't prove a failure was a flake.
5. **Green:** for each bead, tick only the acceptance items the run actually exercised
   (`br update <id> --acceptance-criteria '- [x] …'`), then
   `batch-verify.sh close <id> --receipt .beads/receipts/wave-NNN.json`. A bead with an item the run
   didn't cover stays open; never close a bead just because one broad command went green.
6. Commit the receipts and `.beads/issues.jsonl`, and push **once per wave**. GitHub CI then runs
   once per wave instead of once per bead.

Closing unblocks dependents, which refills the ready pool for the next Phase 1 wave. Frequent small
waves keep the swarm fed; one giant end-of-day pass starves it.

## Enforcement layers

| Layer | Stops | Where |
|---|---|---|
| br policy | self-close, skipping `batch_pending`, closing without the gate/receipt/ticked criteria, stale passes after rework, `--bypass-policy`, second claims, claims without criteria | `.beads/policy.yaml` |
| Canary | policy edits or br upgrades that silently stop enforcing | `scripts/beads/canary.sh` (27 checks); run at swarm start and after any change |
| Worker hook | the batched verification (workspace-wide `cargo test`, whole Playwright suites, workspace-wide local cargo on the Mac, `batch-verify.sh`) and `br close/delete/reopen/gate` from workers | `.claude/hooks/worker-guard.sh` (Claude Code panes) |
| Verifier audit | everything self-reported | every wave, see below |

Every wave, the verifier audits:

- `br list --status tombstone`: a worker can still `br delete` a claimed bead, and br doesn't gate
  deletes. The hook blocks this for Claude panes, but not for Codex or other harnesses.
- gate results whose provider isn't `batch-verifier`, since gate reporting is self-attested
- closes by anyone other than the verifier: reopen those with an incident note
- Codex/Gemini agents don't load the Claude hook, so check their shell history for workspace-wide
  test runs and whole-suite Playwright runs (focused runs of their own area are expected)

## Honest credit

- Fixtures never masquerade as live proof.
- Never weaken an assertion or gate to get to green.
- Never move an unmet acceptance item into a follow-up bead just to close the original.
- A bead that only produced a report, scaffolding or a refusal is not a delivered capability.
- Genuinely incomplete work stays `in_progress` or `rework` with a comment. Never false-close it.

Background: the NTM skill's `references/CODE-FIRST-BATCH-VERIFY.md`, and the vibing-with-ntm skill's
HONEST-CREDIT reference (premium; install with `jsm login`).
