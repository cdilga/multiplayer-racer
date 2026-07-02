# NTM Bead Swarm Runbook

This directory contains repo-local prompts for running a Joystick Jammers bead swarm through NTM.
The prompts are intentionally stricter than the generic swarm prompts: no bead is closed until
there is convincing test evidence and a fresh validator has checked that evidence independently.

## Quick Start

```bash
SESSION=multiplayer-racer--bead-swarm

ntm spawn "$SESSION" --cc=2 --cod=2
ntm send "$SESSION" --skip-first "$(cat .ntm/prompts/00-bootstrap-all-agents.md)"

# Keep the session small: at most five panes total, including the user pane.
# Reuse or replace an idle worker pane for release management; do not add a
# release manager if that would exceed the cap.
ntm send "$SESSION" --pane=<idle-pane> --file .ntm/prompts/60-release-manager.md

# After agents are registered and oriented, keep workers moving:
ntm send "$SESSION" --pane=<idle-pane> --file .ntm/prompts/10-worker-next-bead.md

# When one worker says implementation is complete, send one fresh agent a target bead:
{ cat .ntm/prompts/30-fresh-validator.md; printf "\n\nTarget bead: <bead-id>\n"; } > /tmp/jj-validator.md
ntm send "$SESSION" --pane=<idle-pane> "$(cat /tmp/jj-validator.md)"
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
Avoid `ntm send --all` during live coordination unless you explicitly want to type into the user
shell pane too. For swarm-wide agent prompts, use the default agent targeting or `--skip-first`;
for bead assignments, prefer `--pane=<agent-pane>`.
If NTM reports Agent Mail unavailable for lock listing, fall back to the MCP Agent Mail tools before
editing; do not treat the failed lock listing as permission to ignore reservations.

## Agent Mail Requirement

Agent Mail is available for this repo and is the primary swarm coordination channel. Prefer the MCP
Agent Mail tools when the pane exposes them. If a Claude/Codex pane does not expose those tools, use
the local `am` CLI; it talks to the same Agent Mail service and is acceptable for NTM coordination.
Every NTM assignment should require the receiving pane to do the following before claiming or
editing:

- Register/check in with Agent Mail for project key `/Users/cdilga/Documents/dev/multiplayer-racer`.
- Use the exact assigned Agent Mail name if one was provided; otherwise register with an
  auto-generated name and announce that name back to the coordinator.
- Check inbox and the target bead thread before claiming work, before editing, and after each
  meaningful edit/test cycle.
- Acknowledge any ack-required Agent Mail message with `am mail ack`; do not treat it as handled
  just because it disappeared from the pane scrollback.
- Reserve only the paths it expects to edit before touching them. Renew reservations while active
  and release them when the work is handed off or complete.
- Post claim, blocker, ready-for-validation, validation PASS/BLOCKED, release, and CI notes to the
  Agent Mail thread whose `thread_id` is the bead id. A `br` comment may mirror the note, but it is
  not a substitute while Agent Mail is available.
- Use the registered Agent Mail name as the `br update --assignee` value.

CLI fallback examples:

```bash
am macros start-session \
  --project /Users/cdilga/Documents/dev/multiplayer-racer \
  --agent-name <AgentMailName> \
  --program claude-code \
  --model claude-opus-4-8 \
  --task "NTM worker check-in" \
  --json

am mail send \
  --project /Users/cdilga/Documents/dev/multiplayer-racer \
  --from <AgentMailName> \
  --to StormyBeaver \
  --subject "Agent Mail check-in" \
  --body "Registered and waiting for scoped assignment." \
  --thread-id swarm-coordination

am mail ack \
  --project /Users/cdilga/Documents/dev/multiplayer-racer \
  --agent <AgentMailName> \
  <message-id>

am file_reservations reserve \
  /Users/cdilga/Documents/dev/multiplayer-racer \
  <AgentMailName> path/to/file.js --exclusive --reason <bead-id>
```

If an agent cannot access Agent Mail through either MCP tools or `am`, it must say that explicitly
in the NTM pane output and use `br comments` only as a temporary fallback. The coordinator should
repair the pane or reassign the work before any substantial edits continue.

## Active Swarm Posture

Keep the live swarm at no more than five panes total, including the user pane. The normal target is
four agent panes plus the user. If a different model lane is needed, replace or repurpose an idle
pane instead of adding capacity. Prefer targeted sends to idle panes over broad rebroadcasts once a
swarm is already active:

```bash
ntm status "$SESSION"
br ready --json
bv --robot-next --format json

ntm send "$SESSION" --pane=<idle-pane> --file .ntm/prompts/10-worker-next-bead.md
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
