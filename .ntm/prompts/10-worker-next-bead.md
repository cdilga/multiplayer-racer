Reread `AGENTS.md` and the relevant parts of `README.md`. Register/check in with Agent Mail for
project key `/Users/cdilga/Documents/dev/multiplayer-racer`, then respond to anything blocking or
coordination-relevant before claiming work. Prefer MCP Agent Mail tools; if they are not exposed in
your pane, use `am macros start-session --project /Users/cdilga/Documents/dev/multiplayer-racer
--agent-name <YourAgentMailName> --program <claude-code|codex-cli> --model <model> --task "<task>"
--json`. If both MCP Agent Mail and the `am` CLI are unavailable, say so in the NTM output and stop
before substantial edits so the coordinator can repair or reassign the lane. If any inbox item is
ack-required, acknowledge it with `am mail ack --project
/Users/cdilga/Documents/dev/multiplayer-racer --agent <YourAgentMailName> <message-id>` before
treating it as handled.

Pick and claim work:

1. Run `br ready --json`.
2. Run `bv --robot-next` and, if there are several possible workers, `bv --robot-plan`.
3. Choose the most useful ready bead you can complete now.
4. Inspect it with `br show <bead-id>`.
5. Claim it with `br update <bead-id> --status in_progress --assignee <YourAgentMailName>`.
6. Reserve only the files you expect to edit using Agent Mail. CLI fallback:
   `am file_reservations reserve /Users/cdilga/Documents/dev/multiplayer-racer <YourAgentMailName> <paths...> --exclusive --reason <bead-id>`.
7. Announce the claim in Agent Mail using `thread_id=<bead-id>`, including reserved paths and your
   exact registered Agent Mail name. CLI fallback: `am mail send --project
   /Users/cdilga/Documents/dev/multiplayer-racer --from <YourAgentMailName> --to StormyBeaver
   --subject "[<bead-id>] claim" --body "<summary>" --thread-id <bead-id>`. Mirror to a `br`
   comment only if useful.

Before editing, write down the acceptance plan in your working notes or Agent Mail thread:

- What behavior the bead is meant to change.
- Which files and related systems are likely affected.
- The exact tests/checks/manual evidence you expect to run.
- The edge cases you will deliberately cover.
- Which evidence will be visual, numeric, logged, or otherwise independently inspectable.

When relevant, your acceptance plan must explicitly account for these current product invariants:

- Late joins are allowed in every mode and phase, but may be routed to active play, spectator,
  waiting-next-round, or results/rematch by phase and fairness.
- Late joiners must not auto-win, extend locked finish timers, or displace locked placements.
- Race result flow needs first-finisher winner declaration plus visible finish-grace/DNF behavior,
  not indefinite waiting for last place.
- Derby result flow needs a deterministic anti-stalemate rule and tiebreak, not endless passive
  survival.
- Known and random map choices must share validation: recorded seed/recipe/generator version,
  terrain modifiers, spawn capacity, jump/hazard placement, and diagnostics.

Implementation rules:

- Respect existing patterns in the codebase.
- Preserve unfamiliar dirty changes; do not revert another agent or the user's work.
- If the bead's acceptance criteria are underspecified, improve the bead or create a follow-up
  before coding around ambiguity.
- If the narrow bead title is insufficient for a coherent feature, do the small adjacent work that
  makes the change fit the broader game, then document why.
- For JavaScript/CSS browser behavior, run `npm run build` before browser or E2E verification.

Evidence requirements before asking for validation:

- Run the bead's required command(s) plus any broader tests justified by the touched code.
- For UI/3D/visual work, capture screenshots or video and include what each artifact proves.
- For physics, procedural generation, networking, reconnect, late join, timing, performance, or
  determinism work, include non-fudged values from assertions, diagnostics, logs, or metrics.
- Exercise relevant edge cases, not only the happy path.
- Record any untested area honestly with the reason.

Do not close the bead yourself after implementation. Post "ready for fresh validation" with the
evidence package to the Agent Mail bead thread and wait for a validator PASS.
