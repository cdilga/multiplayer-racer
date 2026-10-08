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
4a. **Visual self-review (`visual` beads; owner 2026-10-04).** If the outcome is something you can see, run the loop in
   `docs/process/visual-self-review.md` first: capture the device/state matrix (`node art/ui/lib/live-check.mjs`), **look at
   every screenshot**, fix, repeat, and commit `docs/evidence/<P1-ID>/self-review.md` with the images. `close.sh` refuses a
   `visual` bead without it. The owner reviews taste, not breakage.
   For TV/design beads the self-look run is `node art/ui/lib/live-check.mjs --local --tv --fullscreen` (every TV state on phone, tablet and TV, rechecked after a resize; it fails on text or controls cut off by the screen edge).
5. **Close on green, in one command:** `scripts/beads/close.sh <id> --tests "AC1: <test> AC2: <test> …"`
   (run it in the background and keep working). It pushes the commit and `git lfs push --all`, waits on
   `scripts/ci/green-for.py <commit> --wait` (green = any completed, successful ci.yml run on a commit that contains
   yours: waiting runs are replaced by newer pushes, so your own commit may never get a run), ticks the acceptance boxes, records the gate
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

- close `batch_pending` beads whose commits went green on CI (`scripts/ci/green-for.py <commit>`: a green run on a
  commit containing theirs counts; a cancelled run on their own commit decides nothing);
- turn a red CI lane into `rework` for the bead that caused it, with the failing assertion and file:line;
- run the CI lanes locally when CI is down or not built yet, and close on that receipt:
  `scripts/beads/batch-verify.sh plan --base <ref>` shows the lanes CI's planner (`scripts/ci/plan.mjs`) picks for the
  range; `run` runs them on eris with CI's own scripts (`scripts/ci/verify-lanes.sh` through `scripts/remote/eris.sh`;
  `--local` for this machine, but keep the Mac light) and writes `.beads/receipts/wave-NNN.json`; `close <bead>
  --receipt <wave.json>` closes a `batch_pending` bead whose commits it covered;
- evidence closes: `scripts/beads/batch-verify.sh close <bead> --evidence docs/evidence/<ID>/<record>.md` checks the
  record against `docs/evidence/README.md` and closes through `close.sh --receipt`;
- `status` summaries.

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

## Sonnet subagents: use them when they make the work faster (owner, 2026-10-04)

Opus workers (and the solo session) are **permitted and encouraged** to spawn their own Sonnet 5.5 subagents (the Agent
tool with `model: "sonnet"`) whenever that finishes the bead faster or cheaper than doing it inline. Don't ask first.

**Good uses:** code and doc search across many files; running a test or build matrix and summarising failures; reading long
logs and reporting the first real error; scaffolding tests, fixtures and boilerplate to a spec you give; mechanical edits
across many files; generating or capturing the screenshot/device matrix for a visual bead and listing what looks wrong;
cross-checking a diff against the acceptance list; independent parallel pieces of one bead with disjoint files. Run
independent subagents in parallel (several Agent calls in one message).

**Not for subagents:** deciding scope, reading rulings into the design, picking or claiming beads, anything that needs the
owner's rulings judged, and the final close. Never delegate honesty about evidence: a result you didn't see isn't proof.

**Ground rules (they protect the shared tree):**
- A subagent is a helper inside **your** bead. It doesn't register with Agent Mail, claim beads, commit, push, run
  `close.sh` or edit `.beads/`. You commit, push and close, under your name. Your file reservations cover its edits.
- One shared working tree: no worktrees, no `isolation: "worktree"`, no extra clones. Parallel subagents get **disjoint
  files** (say which paths each may touch); anything else is read-only.
- Brief it like a new colleague: the bead ID and goal, the exact paths, what "done" looks like, what not to touch, the
  constraints that matter (no CDNs, no caps, native resolution, Rust through RCH), and the form of the answer (short:
  findings with file:line, or a diff summary). Ask for a short report, not a transcript.
- Verify what comes back before relying on it: read the diff it made, rerun the check that decides the outcome, and spot-check
  its claims. You remain responsible for correctness.
- For visual beads a Sonnet subagent may capture the matrix and look at the screenshots, but **you open the key images
  yourself** before writing `self-review.md`, since the loop is only real if someone who knows the intent looked.
- Keep the token win: don't spawn for something a single grep or edit does, and don't spawn a subagent that re-reads the
  whole project. Never more subagents than the work has independent pieces.

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
ntm spawn multiplayer-racer --omp=2:zai/glm-5.3:max --no-recovery --no-cass-context --ready-timeout 3m \
  --prompt "You are a NEW OMP worker joining this repo. Read AGENTS.md, then the 'OMP workers' section of docs/process/bead-workflow.md, and follow it: create your own new Agent Mail identity first (never reuse an existing name), then take an unclaimed ready bead."
```

(`ntm add` has no `--no-recovery`, so grow by killing and respawning the NTM session rather than adding to it.)

- `--omp=N:model:thinking` runs N OMP panes as `omp --auto-approve --model zai/glm-5.3 --thinking max`.
- Never add `--worktrees`.
- **Always pass `--no-recovery` and `--no-cass-context`.** Without them, NTM injects "continue where
  you left off" plus the project's in-progress beads. On 2026-10-03 that made a new worker adopt the
  solo session's identity and its claimed bead.
- Watch them with `ntm attach multiplayer-racer`. Remote Control is Claude-only.

**If you're an OMP worker**, you don't get Claude Code's hooks. You may get Agent Mail's MCP tools; the
`am` CLI below always works. Before the loop above:

1. **Identity:** create a new one; never take over an existing name, even the one on a claimed bead.
   ```bash
   am agents create --project /Users/cdilga/Documents/dev/multiplayer-racer --program omp --model glm-5.3 --task "<bead or goal>"
   ```
   It prints your name. Prefix every commit, push and `scripts/beads/close.sh` with `AGENT_NAME=<name>`,
   and use the name as `--actor` for `br`. A bead claimed by someone else isn't yours: take another.
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
| Git hook | a commit changing another bead's `docs/evidence/<ID>/` without naming it (or `Recapture:`) | `scripts/hooks/commit-msg`; install once per clone with `scripts/hooks/install.sh` |
| Evidence check | evidence closes on uncommitted, malformed, wrong-bead or incomplete records | `scripts/beads/evidence-check.py` (canaried) |

## Honest credit

- A bead closes only on a green check of a commit that contains it, citing the run.
- Fixtures never masquerade as live proof; never weaken an assertion or gate to get to green.
- Never move an unmet acceptance item into a follow-up bead just to close the original.
- A bead that only produced a report, scaffolding or a refusal is not a delivered capability.
- Genuinely incomplete work stays `in_progress` or `rework` with a comment. Never false-close it.

## The G-DESIGN rework loop (owner, 2026-10-04)

The design gate (P1-U04) is blocked by every bead labelled `gate:g-design`; find them with `br list --label gate:g-design`. Fix them first, each with its visual self-review (`docs/process/visual-self-review.md`); the gallery republishes on push and you run `node art/ui/lib/live-check.mjs` on the live URL. Owner review comes after, and owner feedback on the POC becomes new `gate:g-design` beads added as blockers of P1-U04 (labels `drop:POC` and `gate:g-design`, parent the round's epic), never closed in place.
