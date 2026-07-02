# Coordinator Dispatch Checklist

Use this when steering an active NTM swarm.

## Start

```bash
SESSION=multiplayer-racer--bead-swarm
ntm spawn "$SESSION" --cc=2 --cod=2
ntm send "$SESSION" --skip-first "$(cat .ntm/prompts/00-bootstrap-all-agents.md)"
```

Keep the session at no more than five panes total, including the user pane. The normal target is
four agent panes plus the user. Reuse or replace an idle pane for release management; do not add a
release manager if that would exceed the cap.

```bash
ntm send "$SESSION" --pane=<idle-pane> --file .ntm/prompts/60-release-manager.md
```

After agents register:

```bash
br ready --json
bv --robot-plan
ntm --robot-status
ntm --robot-snapshot
```

Before assigning any pane, confirm the prompt tells the agent to register/check in with Agent Mail,
using MCP tools if exposed or the local `am` CLI otherwise. The agent must use its Agent Mail name
as the Beads assignee, reserve files before edits, and post all claim, blocker,
ready-for-validation, validation, release, and CI notes to the Agent Mail thread whose `thread_id`
is the bead id. Ack-required coordination notes must be acknowledged with `am mail ack` or the MCP
equivalent before the pane takes new work. If a pane reports both MCP Agent Mail and `am`
unavailable, treat that as a coordination blocker for substantial edits and repair or reassign the
lane.

Do not use `ntm send --all` for ordinary live coordination: NTM includes the user shell pane in
that target set. Use default agent targeting, `--skip-first`, or an explicit `--pane=<agent-pane>`
instead.

## Worker Assignment

Send workers:

```bash
ntm status "$SESSION"
ntm send "$SESSION" --pane=<idle-pane> --file .ntm/prompts/10-worker-next-bead.md
```

Maintain at most four active agent lanes while ready work exists. Use Codex and Claude deliberately:
Codex lanes are good for implementation/test repair loops; Claude lanes are good for requirements
synthesis, validation, UI/UX review, and cross-flow consistency. Either kind of agent may implement
or validate, but a validator must not be the worker who produced the slice being validated.

Prefer unblocking foundational beads before broad polish. In this repo that often means protocol,
room/seat lifecycle, determinism, map validity, debug-lab evidence tooling, and first-run flow
before cosmetic tuning.

For join/result/map beads, include the current product invariants in the assignment: late joins are
allowed in every mode/phase; late joiners cannot auto-win or alter locked results; race needs a
finish-grace/DNF timer instead of waiting for last place; derby needs an anti-stalemate/tiebreak
rule; known and random maps share recorded seed/recipe validation.

## Validation Assignment

When a worker posts "ready for fresh validation":

1. Pick an agent that did not implement that bead and has enough context room.
2. Prefer an idle existing pane. If a genuinely fresh lane is necessary, scale down or retire an
   idle pane before adding a replacement so the session stays at the five-pane cap.
3. Send the validator prompt with the target bead id appended.

```bash
printf "\n\nTarget bead: <bead-id>\n" | cat .ntm/prompts/30-fresh-validator.md - > /tmp/validator-prompt.md
ntm send "$SESSION" --pane=<idle-pane> "$(cat /tmp/validator-prompt.md)"
```

Do not let the worker close the bead before validator PASS.

## Release Assignment

When a validator posts PASS and the slice is coherent enough to ship:

1. Send or point the release manager to the bead id and validator PASS message.
2. Confirm the release manager stages only the files belonging to that validated slice.
3. Confirm `git diff --cached --check` and relevant post-validation commands pass before commit.
4. Let the release manager create a small feature commit and push.
5. Require the release manager to watch GitHub CI for the pushed SHA.
6. If CI fails, require an Agent Mail failure note plus `br reopen <bead-id>` or a new bug bead
   with the failed check, URL, log excerpt, SHA, and reproduction command.

The release manager is not a worker and not a validator. If it edits code to fix CI, it becomes a
worker and needs fresh validation before another release.

## Close Gate

Before any close:

- `br show <bead-id>` acceptance criteria are all addressed.
- The worker evidence package includes commands, artifacts, edge cases, and honest gaps.
- A fresh validator posted PASS in Agent Mail or a bead comment.
- The validator checked the current product invariants when the bead touches joins, results, maps,
  race/derby flow, or room lifecycle.
- Relevant tests/builds pass after all worker and validator changes.
- File reservations are released or intentionally renewed for follow-up work.

Close reason should mention the independent validation:

```bash
br close <bead-id> --reason "Completed and independently validated: <commands/artifacts summary>"
```

After close, the release manager may package and push the validated slice. A pushed commit is not
the final word: CI failures must reopen or create Beads with concrete notes.

## Health Checks

Use these periodically:

```bash
ntm --robot-status
ntm --robot-context="$SESSION"
ntm --robot-files="$SESSION"
ntm --robot-tail="$SESSION"
ntm locks list "$SESSION" --all-agents
br dep cycles --blocking-only --json
bv --robot-triage
```

If an agent is compacted, crashed, or confused, send `50-context-rotation-recovery.md`.
If `ntm locks list` cannot reach Agent Mail, use the MCP Agent Mail reservation tools before
editing or assigning overlapping files. A lock-list failure is not evidence that files are free.
