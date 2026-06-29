# Joystick Jammers User-Flow Database

> Status: v1, created for `br-user-flow-database-1vr` on 2026-06-29.
> Scope: durable flow map for Local, Remote, mixed-device play, reconnect/failure states,
> race/derby win conditions, and the user journeys that were implicit or contradictory in
> the existing plans/code.

This directory is intended to be the reusable flow database. Start here for human reading, and use
`flow-database.json` when a future agent needs structured lookup by flow, issue, decision, or test.

## Vocabulary

The word "mode" is overloaded in the current docs and code. Use these terms in new beads:

| Term | Values | Meaning |
|---|---|---|
| `topology` | `local`, `remote`, `mixed` | Where the world is rendered and how devices are arranged. |
| `ruleset` | `race`, `derby` | The game being played. |
| `role` | `host`, `driver`, `controller`, `viewer`, `spectator` | What a participant/device does. |
| `seat` | one player identity/car | A durable player slot that may have one controller and zero-or-more viewers. |

Source tension: README calls Race/Derby the two ways to play, while the Remote plan calls
Local/Remote modes. The database therefore avoids `mode` except when quoting current code.

## Critical Findings

1. **Race currently waits for last place.** `RaceSystem._isRaceComplete()` only ends when every
   registered vehicle has finished. Desired party-game flow: first finisher declares the winner,
   starts a visible grace timer, then unfinished racers are DNF-ranked by progress.
2. **Server finished state is probably unreachable.** The host emits `end_game`, but no server
   handler was found; late joins are blocked only when the server room is `finished`.
3. **Host-loss behavior contradicts the Remote/rejoin plan.** The plan wants a grace/reclaim window;
   current server behavior deletes the room immediately on host disconnect.
4. **Local vs Remote and Race vs Derby need separate axes.** Without this, join routing and tests
   become ambiguous.
5. **Mixed topology needs a seat model.** A laptop viewer plus phone controller must bind to one
   seat; the current server model is one socket equals one player.
6. **Derby needs stall policy.** Rounds end only when survivors are `<= 1`; late joins, disconnects,
   ties, and passive standoffs are under-specified.
7. **Phone/controller terminal states are incomplete.** Host shows results and lobby transitions;
   controllers do not clearly handle `game_end` or `returned_to_lobby`.
8. **Security/abuse are user-flow problems, not only backend chores.** Remote/mixed play needs seat
   ownership, input spoof rejection, name sanitization, rate limits, and moderator controls.

## Flow Index

| ID | Title | Topology | Ruleset | Status |
|---|---|---|---|---|
| `UF-ENTRY-LOCAL-HOST` | Host creates a Local TV room | local | any | current |
| `UF-ENTRY-REMOTE-HOST-DRIVER` | Host creates Remote room as driver-viewer | remote | any | planned |
| `UF-JOIN-LOCAL-QR-CODE` | Same-room phone joins as controller | local | any | current with gap |
| `UF-JOIN-LOCAL-MANUAL-CODE` | Manual room-code join | local | any | current with gap |
| `UF-JOIN-REMOTE-LINK-CHOOSER` | Invite link chooses controller/viewer/spectator | remote/mixed | any | planned |
| `UF-JOIN-MIXED-PAIR-PHONE` | Laptop viewer pairs with phone controller | mixed | any | planned |
| `UF-JOIN-SPECTATOR` | Pure viewer/spectator joins | remote/mixed | any | underspecified |
| `UF-LOBBY-READY-START` | Lobby readiness, settings, min-player gates | any | any | gap |
| `UF-IDENTITY-SEAT-CAR` | Name/color/number/car identity mirrored everywhere | any | any | planned |
| `UF-ONBOARD-FIRST-RUN-SCHEME` | First-run controls tutorial and scheme choice | any | any | planned |
| `UF-CONTROLLER-CONFIDENCE` | Input confidence, sleep/reconnect, zero-on-blur | any | any | current with gap |
| `UF-ROUND-COUNTDOWN-ALL-ROLES` | Countdown visible to host/controllers/viewers | any | any | current with gap |
| `UF-JOIN-LATE-RACE-ACTIVE` | Late join before first finisher | any | race | current with gap |
| `UF-JOIN-LATE-RACE-FINISH-GRACE` | Late join during finish grace/results | any | race | missing |
| `UF-RACE-FIRST-FINISH-GRACE-DNF` | First finisher starts grace, DNF resolves results | any | race | missing |
| `UF-RACE-TIE-DEADHEAT` | Finish-time ties and deterministic ranking | any | race | missing |
| `UF-DERBY-ROUND-ELIMINATION` | Last vehicle standing round loop | any | derby | current with gap |
| `UF-DERBY-LATE-NEXT-ROUND` | Late derby join waits/spectates until next round | any | derby | recommended |
| `UF-DERBY-STALEMATE-SUDDEN-DEATH` | Passive/stuck derby round reaches sudden death | any | derby | missing |
| `UF-DERBY-ALL-ELIMINATED-TIE` | Simultaneous elimination tie handling | any | derby | missing |
| `UF-RESULTS-REMATCH-RITUAL` | Podium, social stats, rematch/back-to-lobby | any | any | current with gap |
| `UF-SPECTATOR-ELIMINATED-FINISHED` | Spectating after elimination/finish | any | any | underspecified |
| `UF-FAIL-HOST-LOSS-GRACE` | Host drops, room pauses, reclaim/timeout | remote/mixed | any | contradiction |
| `UF-FAIL-PLAYER-LEAVE-VS-DROP` | Intentional leave vs transient disconnect | any | any | contradiction |
| `UF-FAIL-DUPLICATE-TAB` | Same seat opened in two tabs/devices | any | any | missing |
| `UF-FAIL-INVALID-ROOM` | Invalid, expired, ended, full room handling | any | any | current with gap |
| `UF-GRIEF-MODERATE-ROOM` | Kick, name abuse, reset spam, spoofing, AFK | remote/mixed | any | missing |
| `UF-END-SESSION-ROOM-TTL` | Host closes, room expires, useful CTAs | any | any | missing |
| `UF-HOST-DESTRUCTIVE-ACTIONS` | Restart/back-to-lobby/reset-all confirmation | any | any | gap |

## Contradiction Register

| ID | Severity | Summary | Drives |
|---|---|---|---|
| `UF-GAP-001` | high | `mode` means Local/Remote in plans and Race/Derby in code/UI. | Use `topology` + `ruleset`. |
| `UF-GAP-002` | critical | Race waits for every vehicle before results. | `UF-RACE-FIRST-FINISH-GRACE-DNF`. |
| `UF-GAP-003` | critical | Host emits `end_game`; server has no matching handler. | Finished-room and late-join tests. |
| `UF-GAP-004` | critical | Planned host-loss grace conflicts with immediate room deletion. | `UF-FAIL-HOST-LOSS-GRACE`. |
| `UF-GAP-005` | high | Reconnect promise conflicts with host removing player vehicles. | Seat/ghost reconnect beads. |
| `UF-GAP-006` | high | QR first-run can auto-join before player chooses name. | First-run Local join. |
| `UF-GAP-007` | critical | Remote viewer lacks seed/full transforms/ViewerGameHost. | Remote play implementation. |
| `UF-GAP-008` | high | Mixed Local+Remote friend conflicts with room-wide topology model. | Seat capability decision. |
| `UF-GAP-009` | critical | Two-device one-seat requires seat registry, not socket=player. | Pairing and auth. |
| `UF-GAP-010` | critical | Control updates trust client-supplied `player_id`. | Public Remote security. |
| `UF-GAP-011` | high | Derby late join currently enters active round. | Queue/spectate until next round. |
| `UF-GAP-012` | high | Derby disconnect may leave stale survivor registration. | Derby disconnect policy. |
| `UF-GAP-013` | high | Derby has no stalemate/no-damage timer. | Sudden death flow. |
| `UF-GAP-014` | medium | Derby tie resolution is not explicitly correct/deterministic. | Tie tests. |
| `UF-GAP-015` | high | Controllers lack clear game-end/lobby transition handling. | Phone terminal states. |
| `UF-GAP-016` | medium | Results show player IDs, not names/colors/numbers. | Social results readability. |
| `UF-GAP-017` | medium | Host restart/back-to-lobby/reset-all are immediate actions. | Confirmation and announcements. |
| `UF-GAP-018` | medium | Spectator role is implied but not defined. | Viewer/spectator routing. |
| `UF-GAP-019` | low | Room-code copy alternates between letters-only and alphanumeric. | Join copy/tests. |
| `UF-GAP-020` | high | Finished-late-join E2E is explicitly skipped. | Results/join cutoff. |
| `UF-GAP-021` | medium | Keyboard handling is duplicated and not a first-class scheme. | ControlMapper/scheme beads. |
| `UF-GAP-022` | high | Public Remote has no rate limit/name sanitation/moderation flow. | Security hardening. |
| `UF-GAP-023` | medium | One-player Derby can trivially end; min-player gate unspecified. | Lobby readiness. |
| `UF-GAP-024` | high | Late join after first finisher must not affect podium/winner. | Finish-grace rules. |

## Test Index

The highest-value missing tests are:

| ID | Target |
|---|---|
| `T-RACE-DNF-GRACE` | First finisher starts a visible grace timer; AFK/stuck last place gets DNF by progress. |
| `T-ROOM-FINISHED-BLOCKS-LATE-JOIN` | Server room enters `finished`; late join after results is rejected, queued, or spectator-only. |
| `T-HOST-LOSS-GRACE` | Host disconnect pauses room; host reclaim restores players before timeout. |
| `T-PLAYER-DROP-GHOST-REJOIN` | Mid-race player drop shows transparent/away car and reconnect restores the same seat. |
| `T-REMOTE-TWO-SCREENS-SAME-WORLD` | Remote viewers render the same seeded world and transforms as host. |
| `T-MIXED-PAIR-PHONE-SEAT` | Laptop viewer and phone controller share one seat; only phone input is authoritative. |
| `T-DERBY-STANDOFF-ENDS` | Two passive derby survivors reach shrink/sudden death/results instead of infinite combat. |
| `T-DERBY-LATE-JOIN-NEXT-ROUND` | Mid-round derby join spectates/waits; it does not enter the live round unfairly. |
| `T-DERBY-DISCONNECT-NO-IMMORTAL` | Derby disconnect cannot leave an unkillable counted survivor. |
| `T-QR-NO-PREMATURE-NAME` | First-run QR/code flow gives the player a chance to confirm/change name. |
| `T-PHONE-RESULTS-LOBBY-TRANSITION` | Controllers move to results/lobby states when host does. |
| `T-SPOOF-REJECTED` | A socket cannot drive another player by sending a forged `player_id`. |
| `T-RESULTS-SHOW-IDENTITY` | Results show names, colors, numbers, and DNF status, not only `playerId`. |
| `T-HOST-DESTRUCTIVE-CONFIRM` | Restart/back-to-lobby/reset-all require confirmation/announce state. |

## Source Notes

This v1 integrates six read-only subagent reports:

- Local couch flow
- Remote driver/viewer flow
- Mixed topology and two-device-one-seat
- Race/derby lifecycle and win conditions
- Reconnect/error/abuse states
- Expert-design missing-case pass

The most relevant source plans are:

- `docs/plans/feedback-design-pass.md`
- `docs/plans/game-modes-and-flows.md`
- `docs/plans/gaps/remote-screen-topology.md`

The main current-code anchors are:

- `static/js/systems/RaceSystem.js`
- `static/js/systems/DerbySystem.js`
- `static/js/systems/NetworkSystem.js`
- `static/js/GameHost.js`
- `static/js/player.js`
- `server/app.py`

## Maintenance Rules

- Add new user flows to `flow-database.json` first, then mirror the high-level row in this README.
- Every flow should have a stable ID, actors/devices, preconditions, happy path, branches, terminal
  states, known gaps, and tests.
- If a flow is contradicted by code, mark it `contradiction`, not `planned`.
- If implementation changes remove a contradiction, update both the issue entry and tests.
- Do not reuse `mode` in new flow text without qualifying whether it means topology or ruleset.
