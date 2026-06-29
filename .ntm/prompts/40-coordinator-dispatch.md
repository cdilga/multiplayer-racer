# Coordinator Dispatch Checklist

Use this when steering an active NTM swarm.

## Start

```bash
SESSION=jj-bead-swarm
ntm spawn "$SESSION" --cc=3 --cod=2 --agy=1
ntm send "$SESSION" --all "$(cat .ntm/prompts/00-bootstrap-all-agents.md)"
```

Add one low-cost release manager pane after the initial agents are oriented. Prefer Claude Haiku if
available; otherwise use the cheapest configured Codex lane with the same prompt.

```bash
ntm add multiplayer-racer --label bead-swarm --cc=1:haiku --prompt "$(cat .ntm/prompts/60-release-manager.md)"
```

After agents register:

```bash
br ready --json
bv --robot-plan
ntm --robot-status
ntm --robot-snapshot
```

## Worker Assignment

Send workers:

```bash
ntm send "$SESSION" --all "$(cat .ntm/prompts/10-worker-next-bead.md)"
```

Prefer unblocking foundational beads before broad polish. In this repo that often means protocol,
room/seat lifecycle, determinism, map validity, debug-lab evidence tooling, and first-run flow
before cosmetic tuning.

## Validation Assignment

When a worker posts "ready for fresh validation":

1. Pick an agent that did not implement that bead and has enough context room.
2. If necessary, add a fresh pane: `ntm add "$SESSION" --cod=1` or `ntm add "$SESSION" --cc=1`.
3. Send the validator prompt with the target bead id appended.

```bash
printf "\n\nTarget bead: <bead-id>\n" | cat .ntm/prompts/30-fresh-validator.md - > /tmp/validator-prompt.md
ntm send "$SESSION" --cod "$(cat /tmp/validator-prompt.md)"
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
