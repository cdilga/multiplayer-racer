# NTM Bead Swarm Operations

Date: 2026-06-29

## Purpose

This is the repo-local operating policy for using NTM to run a swarm through Joystick Jammers
Beads. It exists because generic "keep moving" swarm prompts are not strict enough for this
project. The game has visual, physics, networking, late-join, procedural-map, and controller
edge cases where a bead can look finished while still being under-tested.

The matching prompt templates live in `.ntm/prompts/`.

## Non-Negotiables

- Every agent reads `AGENTS.md` and `README.md` at session start and after compaction.
- Every editing agent registers with Agent Mail, checks inbox, reserves files, announces bead
  claims, and releases reservations.
- Every worker uses `br` and `bv --robot-*`; no bare `bv`.
- No bead closes on the implementer's word alone.
- No bead closes without evidence that is concrete enough for a different agent to inspect or
  reproduce.
- A fresh validator must check the work and post PASS before closure.
- Commits and pushes should be handled by a low-cost release-manager pane after validation, not by
  implementation workers opportunistically bundling their own changes.

## Current Product Invariants

These are active planning decisions, not optional flavor. Workers and validators must apply them
whenever a bead touches joins, results, maps, race/derby flow, or room lifecycle:

- **Late joins are allowed in every mode and phase.** The implementation may route a late joiner to
  active play, spectator, waiting-next-round, or results/rematch depending on phase and mode, but it
  must define the state explicitly and test it. A late joiner must not become a winner merely by
  arriving late, must not extend a locked finish timer, and must not displace already locked
  placements.
- **Race results cannot wait indefinitely for last place.** The first finisher should establish the
  current winner and start a visible finish-grace timer; unfinished racers become DNF/progress-ranked
  when the timer expires.
- **Derby cannot run forever by passive survival.** Derby needs a max-duration, no-damage, sudden
  death, shrink escalation, or score-timeout rule with deterministic tiebreaks.
- **Known and random maps share one validation gate.** At choose time, the host can select a known
  map or a random seeded recipe; both must produce a recorded map instance and pass the same
  ruleset/player-count/late-join spawn validation.
- **Procedural maps are recipe driven.** Race and derby generation should expose seed, generator
  version, terrain modifiers, spawn candidates, checkpoints/arena boundary, jump/hazard placements,
  and validation diagnostics. Derby arenas do not need to be perfectly bowl-shaped, but the chosen
  geometry must satisfy the derby rules and explain where pressure boundaries, walls, ramps, jumps,
  and safe late spawns live.

## Roles

Worker:
- Claims a ready bead.
- Reserves files and announces the claim.
- Implements the change in sympathy with the broader game, not only the shortest title reading.
- Runs tests and collects evidence.
- Posts "ready for fresh validation" but does not close the bead.

Fresh validator:
- Starts from `AGENTS.md`, `README.md`, `br show <id>`, Agent Mail, and the diff.
- Re-runs or independently inspects the strongest evidence.
- Checks edge cases and broader integration.
- Posts PASS or BLOCKED.
- If the validator edits the implementation, they become a worker for those edits and must request
  another fresh validation pass.

Coordinator:
- Spawns NTM sessions, sends prompt templates, watches reservations, and assigns validators.
- Keeps agents out of communication-only loops by dispatching ready work.
- Does not allow closure before the evidence gate.

Release manager:
- Prefer a smaller/cheaper model lane, such as `ntm add multiplayer-racer --label bead-swarm --cc=1:haiku --prompt "$(cat .ntm/prompts/60-release-manager.md)"` when the local Claude CLI supports Haiku. If not, use the cheapest configured Codex lane with the same prompt.
- Does not implement features and does not validate its own work.
- Waits for fresh-validator PASS or explicit coordinator release approval before packaging a slice.
- Stages only files belonging to that validated slice, creates a reasonable feature commit, pushes,
  then watches GitHub CI for the pushed SHA.
- If CI fails, posts the failing check/logs to Agent Mail and reopens the owning bead or creates a
  new bug bead with enough reproduction context for a worker to pick it up.

## Bead State Machine

Use Beads status plus Agent Mail notes to represent this lifecycle:

```text
open
  -> in_progress(worker claimed)
  -> in_progress(worker says "ready for fresh validation")
  -> closed(validator PASS and close reason cites evidence)
  -> committed/pushed(release manager packages validated slice)
  -> open/in_progress/blocked(validator BLOCKED or CI failed and fixes are explicit)
```

There is deliberately no "done except validation" close state. Until validation passes, the bead is
not done.

There is also no "pushed means done" state. If CI later fails, the release manager must route that
failure back into Beads and Agent Mail with concrete evidence.

## Evidence Levels

Use the strongest applicable evidence type for the behavior touched:

- Unit/integration assertions for pure logic, protocol validation, procedural generation,
  deterministic clocks/RNG, payload schemas, scoring, and result timing.
- E2E scripts for join, reconnect, late join, host/client routing, first-run onboarding, room
  lifecycle, race, derby, and results.
- Visual artifacts for UI/3D/model/map/camera work: screenshots, videos, diagnostics, canvas-pixel
  checks, material/lighting dumps, or car-viewer/map-lab evidence bundles.
- Numeric metrics for physics, performance, timing, determinism, networking, control latency, map
  validity, spawn clearance, and high-player soak behavior.
- Manual human notes only where the bead explicitly requires human taste or external approval.

Weak evidence examples:
- "Looks good."
- "Seems fixed."
- "Build passed" as the only proof of visual, physics, or networking behavior.
- A screenshot with no statement of what it proves.
- A log value that was manually invented rather than generated by code/test output.

## Edge-Case Checklist

Validators choose the relevant cases rather than every case every time:

- Local mode: host renders, phones/keyboards only control.
- Remote mode: each participant may render a viewer, with graceful degradation.
- All players in one room, some remote, mixed viewer/controller roles.
- Late join before start, during race, after first finisher, during race finish grace, during derby
  combat, between derby rounds, and on results screens. Late join must be admitted but may be routed
  to a non-winning spectator/waiting/results state when active scoring would be unfair.
- Reconnect, duplicate tab takeover, host loss, room reclaim, and stale seat binding.
- Random map, known map, derby arena, race track, invalid seed/spec, and procedural modifiers.
- Procedural map choice-time flow: known map vs random seed, recipe versioning, terrain modifiers,
  spawn capacity, jump/hazard placement, arena pressure boundary, and validation failure UI.
- High player count, weak host, weak remote viewer, controller latency, and lost/duplicated input.
- Ties, timeouts, DNF, stalled last-place player, derby stalemate, and result finalization timer.
- Malformed client payloads, spoofed roles, unsafe names/model ids, and XSS-like labels.

## Close Note Template

```markdown
Completed and independently validated.

Worker: <agent>
Validator: <agent>

Evidence:
- `<command>` -> <meaningful result>
- `<artifact path>` -> <what it proves>
- `<metric/diagnostic>` -> <value and threshold>

Edge cases:
- <case> -> <result>

Known gaps:
- <none, or explicit follow-up bead/manual gate>
```

## Prompt Flow

1. Spawn a session and send `.ntm/prompts/00-bootstrap-all-agents.md`.
2. Send `.ntm/prompts/10-worker-next-bead.md` to active workers.
3. When a worker is nearly done, send `.ntm/prompts/20-worker-completion-self-review.md`.
4. Assign a different or fresh agent with `.ntm/prompts/30-fresh-validator.md`.
5. Close only after validator PASS.
6. Send `.ntm/prompts/60-release-manager.md` to the low-cost release pane to create scoped commits,
   push validated slices, watch CI, and reopen/create Beads on failure.
7. Use `.ntm/prompts/50-context-rotation-recovery.md` after compaction or pane restart.

## Release Manager Lane

Add one low-cost release pane to the grid once workers and validators are active:

```bash
ntm add multiplayer-racer --label bead-swarm --cc=1:haiku --prompt "$(cat .ntm/prompts/60-release-manager.md)"
```

Fallback if Haiku is unavailable in this environment:

```bash
ntm add multiplayer-racer --label bead-swarm --cod=1:<cheapest-configured-model> --prompt "$(cat .ntm/prompts/60-release-manager.md)"
```

The release manager watches for validator PASS messages, scoped release requests, and GitHub CI
results. It must not sweep unrelated dirty files into commits. It must not force-push, rebase, or
merge to repair a moved remote without coordinator direction. Its value is keeping validated work
flowing into small commits while preserving a clear audit trail from bead -> validation -> commit ->
CI result.

## Reservation Checks

Use the current NTM lock syntax when checking reservations:

```bash
ntm locks list "$SESSION" --all-agents
```

If that command reports Agent Mail unavailable, fall back to the MCP Agent Mail reservation tools
or direct Agent Mail coordination before editing. A tooling failure to list locks is not permission
to assume files are unreserved.

## Go-The-Extra-Mile Scope Rule

The bead boundary is a coordination tool, not a permission to leave a half-integrated system. If the
implementation reveals a nearby missing test, stale doc, broken debug tool, unclear protocol term,
or follow-up risk that materially affects the bead, handle it or create a follow-up bead with clear
dependencies. Keep the work coherent and defensible, but avoid unrelated refactors.
