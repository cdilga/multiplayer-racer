# Bead workflow

> **2026-10-03 (owner): Physical Soccer's model.** A session takes a bead, builds it with its tests,
> checks its own area, pushes, and **closes the bead itself once Gitea CI is green** on a commit that
> contains it. A verifier stays on call for what CI can't do alone. This replaces the 2026-09-30
> code-first/batch-verify doctrine (waves, `batch_pending` as the only route to closed, a dedicated
> closer). Where older docs or the plan say "batch verifier", "wave" or `ev:wave`, read this file.

## The loop (every session: solo or worker)

1. **Pick.** `br ready --json`, or `bv --robot-next` for the graph's top pick. Claim with
   `br update <id> --claim --actor <AgentMailName>` (the bead must have acceptance criteria). A session
   may work one bead or a **goal** spanning several (R93): claim each as you start it.
2. **Build it with its real tests.** Scenario banks for the sim (`scenarios/<area>/*.json` replayed bit
   for bit by `crates/<crate>/tests/<area>.rs`), Playwright journeys through the real join path for
   anything a player touches, unit tests only where the unit is the lowest level that shows the
   behaviour (codecs, goldens, pure kernels). Hand mechanical work to Sonnet 5.5 subagents.
3. **Check your own area before committing.** The checks for the paths you changed plus one fast smoke
   of the feature: affected crates through RCH (`rch exec -- cargo test -p <crate>`), the specs and
   scenarios you touched. Leave the workspace-wide matrix to CI, unless you changed a shared contract
   (`jj-types`, `jj-protocol`, `jj-map`, the `jj-sim` core): then also run the workspace check through RCH.
4. **Commit.** Commit with the P1 ID and the bead ID in the message.
5. **Close on green, in one command:** `scripts/beads/close.sh <id> --tests "AC1: <test> AC2: <test> …"`
   (run it in the background and keep working). It pushes the commit and `git lfs push --all`, waits on
   `scripts/ci-status.sh --wait`, ticks the acceptance boxes, records the gate
   (`br gate report <id> --gate batch_verify --provider gitea-ci --status pass --to closed`) and closes
   with the CI run as the receipt. Exit 1 means CI is red: a red lane on your change is yours to fix.
   To move on without waiting, add `--pending`: the bead goes to `batch_pending` with the commit and
   tests, and the verifier closes it when CI goes green.
6. **Evidence that isn't a CI run** (`ev:owner`, `ev:deploy-repo`, `ev:hardware`): commit an evidence
   record under `docs/evidence/<P1-ID>/` and close with
   `scripts/beads/close.sh <id> --tests "…" --receipt docs/evidence/<P1-ID>/<file>` (the evidence close,
   P1-F02).
7. **Repair beads reproduce first:** a probe that fails before the fix, then the same probe passing.
   After 2–3 identical remote or CI failures, stop retrying and reproduce in the smallest local harness.

**Before CI exists** (until P1-D01 and P1-F02 land), close on the local check with a committed receipt
(the exact commands and their output) under `docs/evidence/<P1-ID>/`:
`scripts/beads/close.sh <id> --tests "…" --receipt docs/evidence/<P1-ID>/<file>` (gate provider `local`).
The bootstrap beads F01, D01 and F02 close that way.

## The verifier on call

A Claude session you start when you want it, for the things CI doesn't do by itself:

- close `batch_pending` beads whose commits went green on CI;
- turn a red CI lane into `rework` for the bead that caused it, with the failing assertion and file:line;
- run the CI lanes locally (`scripts/beads/batch-verify.sh run`, across RCH, eris and the Mac) when CI is
  down or not built yet, and close on that receipt;
- evidence closes, and `status` summaries.

Start it with `JJ_ROLE=verifier AGENT_NAME=<name> claude --remote-control "jj-verifier" --model claude-sonnet-5-5 --effort medium`.
It's **on demand only**: no timers, `/loop` or heartbeat. It acts when a worker messages it or you say
`verify` or `status`, reports in a few lines and goes idle, and an idle session costs nothing. In solo
mode the solo session does all of this itself.

## Modes and models (owner, 2026-10-03)

Scale in steps when you're happy: **solo → 2 workers → 4 workers** (no cap, R93).

| Mode | Start |
|---|---|
| **Solo (hand crank)** | `JJ_ROLE=solo AGENT_NAME=<name> claude --remote-control "jj-solo" --model claude-opus-5-5 --effort medium` |
| **Workers** | `JJ_ROLE=worker AGENT_NAME=<name> claude --model claude-opus-5-5 --effort medium`, plus the verifier on call above |

Every mode commits, pushes and closes on its own (AGENTS.md, Code rules): the solo session needs no
orchestrator or verifier to land its work, and it also commits anything else in the tree that's ready.

Workers and the solo session run Opus 5.5 at medium effort and hand mechanical work to Sonnet 5.5
subagents (the Agent tool with `model: "sonnet"`): code search, long logs, test scaffolding, capture
review notes. Subagents help inside a bead; more beads in parallel means more worker sessions, each
with its own Agent Mail name and file reservations. Any session that verifies registers with Remote
Control so you can watch it.

**Hand-cranking.** The session stops after each instruction unless it's on a goal:

| Say | The session |
|---|---|
| `next` / `next P1-XXX` | takes the top ready bead (or the named one), builds it with its tests, checks its area, commits, pushes, and reports in three lines; it closes the bead when CI goes green |
| `goal: <what>` | works the beads that get there, one after another, and stops at the end or when blocked |
| `verify` | closes whatever is green, turns red into rework (fixing it in solo mode), and reports |
| `status` | ready count, beads waiting on CI, the next three picks |

With one agent, skip Agent Mail reservations and announcements; register only for the commit guard.
As soon as a second session runs (another Claude, or OMP workers), every session reserves files,
the solo one included.

## OMP workers (GLM-5.3 through NTM)

Start them from the repo:

```bash
ntm spawn multiplayer-racer --omp=2:zai/glm-5.3:max \
  --prompt "Read AGENTS.md, then the 'OMP workers' section of docs/process/bead-workflow.md, and start."
```

- `--omp=N:model:thinking` runs N OMP panes as `omp --auto-approve --model zai/glm-5.3 --thinking max`.
- Never add `--worktrees`.
- Watch them with `ntm attach multiplayer-racer`. Remote Control is Claude-only.

**If you're an OMP worker**, you have no MCP and none of Claude Code's hooks. So, before the loop above:

1. **Identity:** create it once.
   ```bash
   am agents create --project /Users/cdilga/Documents/dev/multiplayer-racer --program omp --model glm-5.3 --task "<bead or goal>"
   ```
   It prints your name. Prefix every commit, push and `scripts/beads/close.sh` with `AGENT_NAME=<name>`,
   and use the name as `--actor` for `br`.
2. **Reservations:** reserve before editing.
   ```bash
   am file_reservations reserve /Users/cdilga/Documents/dev/multiplayer-racer <name> <paths…> --exclusive --reason <bead-id>
   ```
   Release with `am file_reservations release /Users/cdilga/Documents/dev/multiplayer-racer <name>` when done.
   Read and send mail with `am mail inbox` and `am mail send`, in a thread named after the bead.
3. **The hooks' rules, by hand:**
   - No workspace-wide cargo on the Mac: Rust goes through `rch exec -- cargo …`.
   - Never `br delete`.
   - The pinned Node is `.nvmrc` (26.10.0): put `$HOME/.nvm/versions/node/v26.10.0/bin` first on `PATH`
     for npm, npx and Vite.

Then run the loop like everyone else: `bv --robot-next`, claim, build with tests, commit, `scripts/beads/close.sh`.

## Lean by default

- No routine review rounds: CI and the bead's tests are the check. Review only when the same area fails
  twice or the owner asks.
- The bead is the contract. Don't read the whole plan; open only what a bead cites, and only through
  `scripts/plan-ref.sh` (`P1-XXX` for a task and its cited sections, `13b.2` for a section,
  `--rulings R93`, `--master 10.6`, `--toc`).
- Keep output small: focused tests, long logs to files, read summaries.
- Commit only the evidence the acceptance names; recapture only what changed.
- **Split a bead that's too big for a session**, Physical Soccer style: child beads with
  `br create --parent <id>` for the remaining slices, acceptance moved over verbatim (never weakened);
  the parent closes after its children. The heaviest beads today are U01, N03, U02, F02 and F06.
- Milestone smokes and the full platform matrix run when that milestone is claimed, not on every bead.

## Enforcement

| Layer | Stops | Where |
|---|---|---|
| br policy | closing without a `batch_verify` gate pass, a `receipt:` reference and every acceptance item ticked; claims without criteria; `--bypass-policy`; stale gate passes after rework | `.beads/policy.yaml` |
| Canary | policy edits or br upgrades that silently stop enforcing | `scripts/beads/canary.sh`; run after any policy edit or br upgrade |
| Hook | workspace-wide local cargo on the Mac (disk) and `br delete` from agents | `.claude/hooks/worker-guard.sh` (`JJ_ROLE=worker` or `solo`) |

## Honest credit

- A bead closes only on a green check of a commit that contains it, citing the run.
- Fixtures never masquerade as live proof; never weaken an assertion or gate to get to green.
- Never move an unmet acceptance item into a follow-up bead just to close the original.
- A bead that only produced a report, scaffolding or a refusal is not a delivered capability.
- Genuinely incomplete work stays `in_progress` or `rework` with a comment. Never false-close it.
