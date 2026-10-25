# Bead workflow

**Owner 2026-10-25 (R140):** one shared loop for Claude Code, Codex and optional OMP GLM.
Usually one session does feature work, CI repair and green closes. When the owner starts a few sessions,
the next available agent claims a failed-batch repair; others continue disjoint work.
This replaces the model-specific worker/verifier/deploy rules and CI waiting instructions.

## Start a session

From the shared repository:

```bash
python3 scripts/agents/start.py claude
python3 scripts/agents/start.py codex
python3 scripts/agents/start.py omp
```

For additional sessions use `--mode worker` before the provider. Provider options follow `--`:

```bash
python3 scripts/agents/start.py --mode worker claude -- --model claude-opus-5-5 --effort medium
python3 scripts/agents/start.py --mode worker codex
python3 scripts/agents/start.py --mode worker omp -- --model zai/glm-5.3 --thinking max
```

The launcher registers a unique identity, exports `AGENT_NAME`, `BR_ACTOR` and `JJ_ROLE`,
pins Node from .nvmrc, and supplies the startup prompt. It does not launch other sessions or choose
a task for you. `--print-command` previews the provider command without registering or running it.
Default Claude/Codex models follow the operator's settings; OMP defaults to GLM-5.3/max.
Existing desktop sessions follow the same rules: register once with MCP, retain that name,
prefix shell mutations with `AGENT_NAME=<name>`, and run pickup before selecting work.
Remote Control is optional visibility for Claude, not a gate on another provider.

## Agent Mail for every provider

Use native Agent Mail MCP tools when available. Otherwise use the running server over HTTP:

```bash
python3 scripts/agents/mail.py fetch_inbox '{"project_key":"/Users/cdilga/Documents/dev/multiplayer-racer","agent_name":"<your-name>","include_bodies":true}'
python3 scripts/agents/mail.py file_reservation_paths '{"project_key":"/Users/cdilga/Documents/dev/multiplayer-racer","agent_name":"<your-name>","paths":["<specific/path>"],"exclusive":true,"reason":"<bead-id>","ttl_seconds":3600}'
python3 scripts/agents/mail.py release_file_reservations '{"project_key":"/Users/cdilga/Documents/dev/multiplayer-racer","agent_name":"<your-name>"}'
```

The bridge reads the existing gitignored HTTP MCP config (.mcp.json or .claude/settings.local.json).
It never starts a second mail runtime or prints credentials/registration tokens. The standalone
`am` database CLI can fail while the server owns its activity lock; don't use it as a fallback.
When other sessions are active, check inbox, reserve narrow paths and announce claims/blockers/completion
in bead-ID threads. Solo skips reservations/announcements. Use Agent Mail across providers.

## The loop

1. **Before picking:** reread AGENTS.md and check inbox, then
   `AGENT_NAME=<name> python3 scripts/ci/pickup.py --claim`.
   It checks CI once. `action: repair` gives you the repair bead: fix it before fresh feature work.
   `repair_owned` means someone else is fixing it; continue disjoint work. No takeover of an active claim.
   The default invocation without `--claim` is read-only. Errors are explicit, never a green verdict.
2. **Settle green handoffs:** inspect `br list --status batch_pending --json --limit 0` and their
   `br comments <id> --json`. For a containing green run, use the recorded tests and SHA:
   `scripts/beads/close.sh <id> --tests "<recorded tests>" --finalize --commit <handoff-sha>`.
   This checks once; pending/red returns immediately. No batch is dispatched. Don't block feature work
   on pending CI. A dedicated deploy session may do this, but solo has no dependency on one.
3. **Pick game work** if no repair is assigned: `br ready --json` or `bv --robot-next`, then
   `br update <id> --claim --actor <name>`. Read the bead contract; reserve its actual files.
   Never steal claims or assume an old assignee is dead. Ask for an explicit handoff before reassignment.
4. **Build and prove:** fixtures/scenarios for simulation, real join-path journeys for player behaviour.
   Reproduce repair failures first. Run focused checks for touched crates through RCH, and touched specs.
   Shared contracts (`jj-types`, `jj-protocol`, `jj-map`, sim core) also earn the RCH workspace check.
   After 2–3 identical remote failures, reproduce in the smallest local harness.
5. **Visual review:** for anything visible, complete docs/process/visual-self-review.md; inspect
   screenshots and commit docs/evidence/<P1-ID>/self-review.md. Required before handoff.
6. **Commit and publish:** name the P1 ID and bead ID; stage specific paths and
   `AGENT_NAME=<name> git commit -- <your paths>`. Keep other sessions' edits out.
   Run `scripts/hooks/install.sh` once after upgrading the workflow. `scripts/push.sh` serializes
   pushes, pins the same SHA for Gitea/GitHub and sends LFS first. The pre-push adapter checks
   each outgoing commit under its own Agent trailer; reservations remain enforced.
7. **Hand off:** `scripts/beads/close.sh <id> --tests "AC1: … AC2: …"` pushes if needed and defaults
   to `batch_pending`, recording the full SHA and tests. `--pending` remains accepted.
   No wait, CI dispatch, automatic acceptance ticking or close happens at handoff.
   For committed owner/deploy/hardware evidence use `--receipt docs/evidence/<ID>/<record>`.
8. **Next:** release reservations when edits are finished, check pickup and take the next useful task.
   A hand-cranked `next` finishes one bead locally and hands it off; `goal: …` repeats to its goal.
   `verify` settles green handoffs and picks up CI repair; `status` reports pickup plus tracker counts.

## CI repairs

One P0 `ci:repair` bead covers the failed branch batch. Pickup deduplicates under a shared-tree lock
and uses Beads' atomic claim. The owner is the agent named on that bead, regardless of provider or
original author. Another free agent does not duplicate the repair. When a repair was handed off and
its next batch fails, pickup returns it to rework and claims it for the next available agent.
An actively claimed repair is never stolen; explicitly hand it back if ending the session.

Read exact assertions and logs, reproduce on eris or locally, fix forward and push the fix.
No diagnostic pushes, speculative retries or broad quarantine. After 2 hours/2 red batches, triage:
a skipped test requires its own P0 restoration bead with cause, owner and restoration condition.
No gameplay acceptance weakening. Publish built images even when CI is red; record preview smoke.
See docs/process/deploy-worker.md for optional maintenance work.

## Optional NTM panes

Native terminal/desktop sessions are enough. For NTM, use its per-pane bootstrap to run this launcher,
so every provider gets the same identity/env rules. For example, create a pane with tmux and run:

```bash
python3 scripts/agents/start.py --mode worker codex
```

If using `ntm spawn` directly, always pass `--no-recovery --no-cass-context`, never `--worktrees`.
The injected startup prompt must require a fresh Agent Mail registration and the loop above;
export `JJ_ROLE=worker` and pin Node before tools. NTM's native agent startup does not run our launcher
automatically. Do not use recovery prompts to adopt an existing session's identity.
An OMP pane uses the HTTP bridge when native MCP tools are unavailable. Claude hooks do not run in
Codex/OMP: the no-workspace-wide-local-cargo and no-`br delete` rules still apply.

## Helpers inside a bead

Sessions may use their provider's helpers when they finish the bead faster or cheaper. Claude may use
Sonnet; Codex uses its own helpers. No provider-specific helper is required.

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
  the parent closes after its children. Split against the current bead's actual scope.
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
