# Join Route Matrix (woq.11 Slice 1)

Contract for `resolveJoinRoute(...)` in `static/js/engine/joinRouteResolver.js`. This is
the **route-matrix artifact** acceptance item for
`br-captain-call-architecture-hardening-woq.11`. It enumerates every entry case the
resolver must classify deterministically. The resolver consumes the protocol manifest
vocabulary (`ROLE`, `TOPOLOGY`) from `static/js/engine/sessionVocabulary.js` — it does not
invent parallel role/topology names.

## Inputs

`resolveJoinRoute({ via, intent, room, pairToken, reconnectToken, roomState, capability })`

- **via** (typed entry channel): `host_qr` · `pair_qr` · `copied_invite` · `reconnect` · `manual_code`. Unknown/missing ⇒ treated as a context-poor copied invite (safe: chooser).
- **intent** (explicit role choice, from the chooser or encoded in an invite): `screen` · `controller` · `spectator` · `viewer_controller`. Optional.
- **room**: room code string.
- **pairToken** / **reconnectToken**: opaque tokens for the pair-QR and reconnect flows.
- **roomState**: `{ status, topology, capacityStressed, priorRole, priorSeatId, pairTokenValid }`.
  - `status`: `open` · `invalid` · `expired` · `ended` · `revoked`.
  - `topology`: `local` · `remote` · `mixed` (normalized via `normalizeTopology`).
- **capability** (explicit, never user-agent-sniffed here): `{ canRenderViewer, sameDeviceViewerController }`.

## Outputs

`{ entryKind, role, startRenderer, showChooser, pairPrompt, bindToExistingSeat, readOnly, recovery, recoveryKind, capacityStress, degrade, reason, usedUserAgentOnly }`

- **role** is a `ROLE.*` value (`host`/`controller`/`viewer`/`spectator`) or `null` when a chooser/recovery is required.
- **startRenderer** is `true` only for roles that render a local viewer (viewer/screen/same-device/remote-spectator/host restore). Local controllers never start the world renderer.
- **usedUserAgentOnly** is always `false` — a structural guard that this resolver never routes on user-agent alone.

## Decision precedence

1. Dead room (`status` ∈ invalid/expired/ended/revoked) → recovery (beats everything, incl. reconnect).
2. Missing room + no reconnect/pair token → `missing_room` recovery.
3. Reconnect (`via=reconnect` or `reconnectToken`) → restore prior role, else safe-recovery chooser.
4. Pair QR (`via=pair_qr` or `pairToken`) → bind controller to existing seat, else explicit fallback.
5. Host QR (`via=host_qr`) → controller/HUD only.
6. Explicit intent (`controller` / `screen` / `spectator` / `viewer_controller`).
7. Manual code → chooser.
8. Copied invite without intent (and unknown `via`) → chooser.

Capacity stress is an **overlay** on any successful bind: it sets `capacityStress=true, degrade=true` and never converts a bind into a rejection.

## Route matrix

| # | via | intent | roomState | → entryKind | role | startRenderer | showChooser | notes |
|---|-----|--------|-----------|-------------|------|---------------|-------------|-------|
| 1 | host_qr | – | open | `host_qr_controller` | controller | false | false | context-rich; no chooser, no phone renderer |
| 2 | copied_invite | – | open | `copied_invite_chooser` | null | false | **true** | context-poor; ask before binding |
| 3 | manual_code | – | open | `manual_code_chooser` | null | false | **true** | context-poor; ask before binding |
| 4 | copied_invite | screen | remote, canRenderViewer | `remote_screen_viewer` | viewer | **true** | false | `pairPrompt=true` (show pair QR/code) |
| 5 | copied_invite | screen | mixed, canRenderViewer | `remote_screen_viewer` | viewer | **true** | false | `pairPrompt=true` |
| 6 | copied_invite | screen | local (or !canRenderViewer) | `remote_screen_viewer` | viewer | false | false | `degrade=true`, still bound, `pairPrompt=true` |
| 7 | copied_invite | controller | open | `controller_only` | controller | false | false | "driving on another visible screen" |
| 8 | copied_invite | spectator | remote, canRenderViewer | `spectator` | spectator | **true** | false | `readOnly=true` (own read-only view) |
| 9 | copied_invite | spectator | local | `spectator` | spectator | false | false | `readOnly=true` (watches the big screen) |
| 10 | copied_invite | viewer_controller | sameDeviceViewerController=true | `same_device_viewer_controller` | controller | **true** | false | owns a car AND renders own view |
| 11 | copied_invite | viewer_controller | sameDeviceViewerController=false | `copied_invite_chooser` | null | false | **true** | unsupported ⇒ fall back to chooser |
| 12 | pair_qr | – | pairTokenValid=true | `pair_controller` | controller | false | false | `bindToExistingSeat=true`; no new seat |
| 13 | pair_qr | – | pairTokenValid=false | `pair_fallback_join` | null | false | **true** | explicit fallback; NOT a silent duplicate seat |
| 14 | reconnect | – | priorRole=controller | `reconnect_restore` | controller | false | false | restores prior seat/role |
| 15 | reconnect | – | priorRole=viewer | `reconnect_restore` | viewer | **true** | false | viewer restore renders again |
| 16 | reconnect | – | priorRole missing | `reconnect_unrestorable` | null | false | **true** | `recovery=true`, safe copy |
| 17 | any | any | status=invalid | `invalid_room` | null | false | false | `recovery=true` |
| 18 | any | any | status=expired | `expired_room` | null | false | false | `recovery=true` |
| 19 | any | any | status=ended | `room_ended` | null | false | false | `recovery=true` |
| 20 | any | any | status=revoked | `revoked_room` | null | false | false | `recovery=true` |
| 21 | (no room, no tokens) | – | – | `missing_room` | null | false | false | `recovery=true` |
| 22 | host_qr | – | open, capacityStressed=true | `host_qr_controller` | controller | false | false | `capacityStress=true, degrade=true`; **never** a cap reject |
| 23 | copied_invite | screen | remote, capacityStressed=true | `remote_screen_viewer` | viewer | (per capability) | false | overlay adds `degrade`; still binds |

## Acceptance-case coverage checklist

- Host QR direct controller path → rows 1, 22.
- Copied Local / Remote / mixed invite (chooser + screen/controller) → rows 2, 4, 5, 6, 7.
- Manual code → row 3.
- Pair QR (valid + invalid fallback) → rows 12, 13.
- Reconnect (restore + unrestorable) → rows 14, 15, 16.
- Invalid / expired / ended room → rows 17, 18, 19 (+ revoked 20, missing 21).
- High-occupancy / capacity stress (no arbitrary reject) → rows 22, 23.
- Controller-only → rows 7, 1.
- Second-screen / viewer-with-phone-pair → rows 4, 5 (`pairPrompt=true`).
- Same-device viewer + controller (where supported) → rows 10, 11.
- Spectator / viewer-only → rows 8, 9.
- No-user-agent-only guarantee → `usedUserAgentOnly=false` on every output; role is decided by `via`/`intent`, capability only gates rendering.

## Scope boundary

Slice 1 is the pure resolver + this matrix + unit tests only. Slice 2 (held, needs
serialized release of dirty files) wires this into the `/join/<room>` route, the
player-side chooser UI + renderer guard, the pair-QR generation/distinction, and the
E2E/screenshot proofs. Pair-QR generation overlaps dependent bead **woq.12** and must be
de-conflicted before implementation.
