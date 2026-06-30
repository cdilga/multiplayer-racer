# Socket Protocol Manifest

Machine-readable source of truth: [socket-protocol-manifest.json](./socket-protocol-manifest.json)

This contract locks the current room/session Socket.IO slice used by
`server/app.py` and the join/host flows that already exist in the product.

## Vocabulary

- `topology`: `local`, `remote`, `mixed`
- `ruleset`: `race`, `derby`
- `role`: `host`, `controller`, `viewer`, `spectator`
- `seat`: the room-scoped participant identity

Current seat rule:
- Until the dedicated seat registry lands, the wire-level seat identifier is
  the existing `player_id` on join/lifecycle events and `playerId` inside
  result rows.
- Duplicate-tab takeover and reconnect must preserve that identifier.

## Lanes

- `reliable`
  State-changing or user-visible lifecycle events such as room creation, join,
  host loss, and final results.
- `volatile`
  High-rate controller input and host-authored vehicle snapshots.

Malformed packet policy:
- Reliable lane: reject, coerce safely, or emit a sender-visible `error`.
- Volatile lane: drop silently; do not spam per-packet logs.

## Architecture Guard

The manifest preserves the architecture from `AGENTS.md` and
`br-modes-remote-play-design-48a.1`:

- Local host renders the full 3D world.
- Local phones/keyboards are controllers and HUD only.
- Remote viewers render separately and degrade independently.

## Scope

This bead locks the protocol slice that already exists or is directly implied by
the current client/server code:

- room creation and join lifecycle
- seat identity through late join and duplicate-tab takeover
- host-only volatile snapshots
- controller-only input authority
- host loss
- reliable race and derby result snapshots

Downstream beads can extend this manifest with durable seat tokens, paired
viewer/controller bindings, and richer remote-only events without redefining
the room/topology/ruleset/role vocabulary here.
