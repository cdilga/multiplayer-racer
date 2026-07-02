First read `AGENTS.md` and `README.md` completely and carefully. Keep the project-specific rules in
front of you while working, especially:

- Register with MCP Agent Mail for project key `/Users/cdilga/Documents/dev/multiplayer-racer`.
  If MCP tools are not exposed in your pane, use the local `am` CLI instead:
  `am macros start-session --project /Users/cdilga/Documents/dev/multiplayer-racer --agent-name <YourAgentMailName> --program <claude-code|codex-cli> --model <model> --task "<task>" --json`.
- Use the exact agent name assigned to your pane; if none was assigned, register with an
  auto-generated name and announce it.
- Treat Agent Mail as the primary coordination channel. Use `br comments` only as a temporary
  fallback if both MCP Agent Mail and the `am` CLI are genuinely unavailable from your pane, and say
  so in your NTM output.
- Check Agent Mail before claiming work, before editing, and after every meaningful edit/test cycle.
- Acknowledge ack-required messages with `am mail ack --project
  /Users/cdilga/Documents/dev/multiplayer-racer --agent <YourAgentMailName> <message-id>` before
  treating them as handled.
- Reserve files before editing, with narrow path patterns, and renew or release reservations when
  finished or handing off.
- Post all claim, blocker, ready-for-validation, PASS/BLOCKED, release, and CI notes to the Agent
  Mail thread whose `thread_id` is the bead id. Mirror to `br comments` only when useful.
- Use your registered Agent Mail name as the Beads assignee.
- Use `br`, not `bd`; use `bv --robot-triage`, `bv --robot-next`, or `bv --robot-plan`, never bare
  `bv`.
- The Local-mode host renders the 3D world. Phones and keyboards are controllers with light HUDs.
  Remote mode is the exception where each participant may render their own viewer and must degrade
  gracefully.

Then orient yourself:

1. Run `git status --short` and note existing dirty files. Do not revert unfamiliar changes.
2. Run `br ready --json` and `bv --robot-plan` or `bv --robot-next`.
3. Read the bead you plan to work on with `br show <id>`.
4. Check related docs/plans/tests before editing.
5. If the bead touches vehicle models, model imports, vehicle selection assets, car-model visual
   polish, or balance/model QA, read and follow the required project skills in `.claude/skills/`.

Completion policy:

- A worker may only mark a bead "ready for validation" after implementation, self-review, and
  evidence collection.
- A bead may only be closed after a fresh validator independently checks the diff, the test
  evidence, and the relevant edge cases, then posts a PASS decision in the bead or Agent Mail
  thread.
- If evidence is weak, missing, hand-wavy, or impossible to reproduce, do not close the bead.

Current product invariants to keep in mind:

- Late joins are allowed in every mode and phase. Route them explicitly to active play, spectator,
  waiting-next-round, or results/rematch depending on phase and fairness.
- A late joiner must not auto-win, extend a locked finish timer, or displace locked placements.
- Race results must not wait indefinitely for last place; first finisher should start a visible
  finish-grace timer and unfinished racers should become DNF/progress-ranked on expiry.
- Derby needs a deterministic anti-stalemate rule such as max duration, no-damage timeout, sudden
  death, shrink escalation, or score timeout with tiebreaks.
- Known map and random map selection share one validation gate. Random maps need recorded seed,
  recipe/generator version, terrain modifiers, spawn candidates, jump/hazard placement, and
  validation diagnostics.

Work philosophy:

Fit each bead elegantly into the broader whole. Update adjacent tests, docs, debug tools, fixtures,
or follow-up beads when needed. Do not stop at the bead title if that leaves a brittle or incoherent
system, but also do not make unrelated rewrites.
