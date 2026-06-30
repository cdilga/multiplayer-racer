# NTM Bead Swarm Runbook

This directory contains repo-local prompts for running a Joystick Jammers bead swarm through NTM.
The prompts are intentionally stricter than the generic swarm prompts: no bead is closed until
there is convincing test evidence and a fresh validator has checked that evidence independently.

## Quick Start

```bash
SESSION=multiplayer-racer--bead-swarm

ntm spawn "$SESSION" --cc=3 --cod=2
ntm send "$SESSION" --all "$(cat .ntm/prompts/00-bootstrap-all-agents.md)"

# Add one low-cost release manager pane for commits, pushes, and CI follow-up.
# The current swarm is a labeled session: multiplayer-racer--bead-swarm.
# Prefer Claude Haiku if the local Claude CLI profile supports it; otherwise use the
# cheapest configured Codex lane and the same prompt.
ntm add multiplayer-racer --label bead-swarm --cc=1:haiku --prompt "$(cat .ntm/prompts/60-release-manager.md)"

# After agents are registered and oriented, keep workers moving:
ntm send "$SESSION" --cc --panes=<idle-claude-panes> --file .ntm/prompts/10-worker-next-bead.md
ntm send "$SESSION" --cod --panes=<idle-codex-panes> --file .ntm/prompts/10-worker-next-bead.md

# When one worker says implementation is complete, send one fresh agent a target bead:
{ cat .ntm/prompts/30-fresh-validator.md; printf "\n\nTarget bead: <bead-id>\n"; } > /tmp/jj-validator.md
ntm send "$SESSION" --cod "$(cat /tmp/jj-validator.md)"
```

Use robot views for coordination:

```bash
ntm --robot-status
ntm --robot-plan
ntm --robot-snapshot
ntm --robot-tail="$SESSION"
ntm locks list "$SESSION" --all-agents
bv --robot-plan
bv --robot-next
br ready --json
```

Never run bare `bv`; it opens an interactive TUI and can block an agent pane.
If NTM reports Agent Mail unavailable for lock listing, fall back to the MCP Agent Mail tools before
editing; do not treat the failed lock listing as permission to ignore reservations.

## Active Swarm Posture

Keep at least two Claude lanes and two Codex lanes assigned to useful non-blocked beads whenever
there is ready work. Prefer targeted sends to idle panes over broad rebroadcasts once a swarm is
already active:

```bash
ntm status "$SESSION"
br ready --json
bv --robot-next --format json

ntm send "$SESSION" --pane=<idle-claude-pane> --file .ntm/prompts/10-worker-next-bead.md
ntm send "$SESSION" --pane=<idle-codex-pane> --file .ntm/prompts/10-worker-next-bead.md
```

If all ready beads are blocked by validation findings, dispatch repair prompts to the current
assignee or claim the smallest concrete unblocker. Do not mark a bead done just because the visible
title is satisfied; the close gate is the broader player flow working coherently with evidence.

## Prompt Index

- `00-bootstrap-all-agents.md` - send once to every new agent.
- `10-worker-next-bead.md` - send to workers that should claim and implement the next useful bead.
- `20-worker-completion-self-review.md` - send before a worker asks for validation.
- `30-fresh-validator.md` - send to a fresh, unentangled agent to validate one completed bead.
- `40-coordinator-dispatch.md` - coordinator checklist for assigning workers and validators.
- `50-context-rotation-recovery.md` - send after compaction, pane restart, or context rotation.
- `60-release-manager.md` - send to a low-cost pane that creates scoped commits, pushes validated
  slices, watches GitHub CI, and reopens/creates Beads with Agent Mail notes when CI fails.

## Completion Gate

The swarm uses this lifecycle:

```text
open -> in_progress(worker) -> implementation complete, evidence proposed
     -> fresh validator PASS -> br close
     -> release manager commit/push/CI watch
     -> fresh validator BLOCKED or CI failed -> stays/reopens open/in_progress/blocked with concrete fixes
```

The worker may say "ready for validation." The worker must not say "done" or close the bead until
another fresh agent validates it.

The release manager does not replace validation. It packages only validator-passed slices into
reasonable commits, pushes them, watches CI, and routes failures back through Agent Mail and Beads.

## Evidence Standard

Every close note must include evidence that another engineer can inspect or reproduce:

- Exact commands run, with meaningful pass output or summarized assertions.
- Screenshots, video, diagnostics JSON, or canvas-pixel checks for visual/3D/UI changes.
- Numeric values for performance, physics, map validity, networking, latency, determinism, or
  controller timing when those behaviors are touched.
- Edge cases tried, including negative cases where malformed input, late joins, reconnects, host
  loss, duplicate tabs, weak devices, or extreme player counts are relevant.
- A clear statement of what was not tested and why, if a manual or external gate remains.

"Looks good," "works locally," a green build alone, or a screenshot without identifying what it
proves is not enough for bead closure.

## Current Product Invariants

Give every worker and validator these invariants when their bead touches joins, results, maps,
race/derby flow, or room lifecycle:

- Late joins are allowed in every mode and phase. They may be routed to active play, spectator,
  waiting-next-round, or results/rematch, but the state must be explicit and tested.
- A late joiner must not auto-win, extend a locked finish timer, or displace locked placements.
- Race results should not wait forever for last place: first finisher starts a visible finish-grace
  timer, then unfinished racers become DNF/progress-ranked.
- Derby needs a deterministic anti-stalemate rule: max duration, no-damage timeout, sudden death,
  shrink escalation, or score timeout with tiebreaks.
- Known maps and random maps share the same choose-time validation gate. Random means recorded seed,
  recipe, generator version, terrain modifiers, spawn candidates, jump/hazard placement, and
  validation diagnostics, not untracked `Math.random`.

## Bead Philosophy

Do not stop at a literal bead boundary if the implementation would land awkwardly in the broader
game. The right behavior is to fit the bead into the whole system: update adjacent docs, tests,
fixtures, protocol examples, debug tools, and follow-up beads where that is necessary for the work
to make sense. Keep scope disciplined, but do not leave sharp integration edges just because the
title was narrow.

## Repository-Specific Reminders

- Read `AGENTS.md` and `README.md` at the start of every session and after compaction.
- Register with Agent Mail using project key `/Users/cdilga/Documents/dev/multiplayer-racer`.
- Reserve files before editing and release reservations after completion.
- Use `br`, not `bd`; use `bv --robot-*`, never bare `bv`.
- If JavaScript or CSS changes need browser verification, run `npm run build` before browser or
  E2E checks because the Flask server serves `dist/` when it exists.
- In Local mode, the host renders the full 3D world; phones and keyboards are controllers with a
  light HUD. Remote mode is the exception where participants render their own viewer.
