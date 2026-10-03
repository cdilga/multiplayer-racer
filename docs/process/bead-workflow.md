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
4. **Commit and push.** Commit with the P1 ID and the bead ID in the message; push to Gitea, then
   `git lfs push --all <remote> <branch>`.
5. **Close on green.** Run `scripts/ci-status.sh --wait` in the background (exit 0 pass, 1 fail,
   2 pending) and keep working. When CI is green on a commit containing your bead: tick the acceptance
   items the tests covered (`br update <id> --acceptance-criteria '- [x] …'`), record the gate
   (`br gate report <id> --gate batch_verify --provider gitea-ci --status pass --to closed --note "run:<url> commit:<sha>"`)
   and close (`br close <id> --reason "receipt:<CI run url> AC1: <test> …" --transition-comment "<one line>"`).
   A red lane on your change is yours to fix. To move on without waiting, set the bead to
   `batch_pending` with `--transition-comment "commit:<sha> AC1: <test> …"`; the verifier closes it
   when CI goes green.
6. **Evidence that isn't a CI run** (`ev:owner`, `ev:deploy-repo`, `ev:hardware`): commit an evidence
   record under `docs/evidence/<P1-ID>/` and close with `receipt:<that file>` (the evidence close,
   P1-F02).
7. **Repair beads reproduce first:** a probe that fails before the fix, then the same probe passing.
   After 2–3 identical remote or CI failures, stop retrying and reproduce in the smallest local harness.

**Before CI exists** (until P1-D01 and P1-F02 land), close on the local check with a committed receipt
(the exact commands and their output) under `docs/evidence/<P1-ID>/`, gate provider `local`. The
bootstrap beads F01, D01 and F02 close that way.

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

## Lean by default

- No routine review rounds: CI and the bead's tests are the check. Review only when the same area fails
  twice or the owner asks.
- The bead is the contract. Don't read the whole plan; open only the sections a bead cites
  (`scripts/plan-ref.sh P1-XXX` once P1-F04 lands).
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
