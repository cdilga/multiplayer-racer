"""Shared session vocabulary for rooms, topologies, rulesets, and roles.

This module is the single source of truth for the three *orthogonal* axes that
describe a game session. Keeping them separate (rather than overloading one
"mode" field) is what lets Local and Remote play, deeplink invites, and
rejoinable rooms branch cleanly. See docs/plans/game-modes-and-flows.md §3.

  TOPOLOGY  — a property of the *room*, fixed at creation, never changed
              mid-session. How participants are physically distributed and who
              renders the world.
  RULESET   — the game being played in the room (stored on the room as the
              legacy ``mode`` key for backwards compatibility).
  ROLE      — a property of a *participant* within the room.

These three are independent: a `local` room can run the `race` ruleset with one
`host` and several `controller`s; a `remote` room can run `derby` with
`viewer`s. Nothing about topology implies a ruleset and vice versa.
"""

# --- Topology: a property of the ROOM (fixed at creation) -------------------
TOPOLOGY_LOCAL = 'local'    # one big screen renders; phones/keyboards are controllers + HUD only
TOPOLOGY_REMOTE = 'remote'  # one authoritative host; every participant renders their own viewer
TOPOLOGY_MIXED = 'mixed'    # some participants co-located on a shared screen, others remote

ROOM_TOPOLOGIES = frozenset({TOPOLOGY_LOCAL, TOPOLOGY_REMOTE, TOPOLOGY_MIXED})
DEFAULT_TOPOLOGY = TOPOLOGY_LOCAL

# --- Ruleset: the game played in the room (legacy room key: ``mode``) -------
RULESET_RACE = 'race'
RULESET_DERBY = 'derby'

RULESETS = frozenset({RULESET_RACE, RULESET_DERBY})
DEFAULT_RULESET = RULESET_RACE

# --- Role: a property of a PARTICIPANT --------------------------------------
ROLE_HOST = 'host'              # runs the authoritative sim + canonical render (exactly one per room)
ROLE_CONTROLLER = 'controller'  # owns a car and sends input (the doc's "Driver")
ROLE_VIEWER = 'viewer'          # renders a synced view locally (Remote participants)
ROLE_SPECTATOR = 'spectator'    # watches only, owns no car

ROLES = frozenset({ROLE_HOST, ROLE_CONTROLLER, ROLE_VIEWER, ROLE_SPECTATOR})


def normalize_topology(value):
    """Coerce an incoming topology value to a known one.

    Unknown / missing values fall back to the default (``local``) so a bad or
    absent client hint can never break the Local path. Comparison is
    case-insensitive and whitespace-tolerant.
    """
    if not isinstance(value, str):
        return DEFAULT_TOPOLOGY
    candidate = value.strip().lower()
    return candidate if candidate in ROOM_TOPOLOGIES else DEFAULT_TOPOLOGY


def is_valid_topology(value):
    """True only for an exact, known topology string (no coercion)."""
    return isinstance(value, str) and value in ROOM_TOPOLOGIES


def _ordered_unique(items):
    """De-duplicate while preserving first-seen order."""
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def participant_roles(topology, is_host=False, can_render=False, is_spectator=False):
    """Capability roles for one participant, as an ordered, de-duplicated list.

    Roles are *capabilities*, not a single collapsed label: one participant can
    be both a ``controller`` (drives a car) and a ``viewer`` (renders its own
    view). That is how the design's combined roles work -- a Remote
    "driver-viewer" is ``[controller, viewer]`` and a "host-driver" is
    ``[host, controller, viewer]``. Collapsing every non-local join to a single
    ``viewer`` would lose this, so callers should use the full list.

    Topology shapes the capabilities:

      * local  -- ARCHITECTURE GUARD: phones/keyboards are controllers + HUD
                  only; only the host renders the shared world. ``can_render``
                  is deliberately ignored so a stale/rogue client can never turn
                  a Local phone into a renderer.
      * remote -- host-as-player: every participant drives AND renders its own
                  viewer.
      * mixed  -- some participants are co-located Local-style controllers
                  (HUD-only), others render their own viewer; the participant
                  declares whether it renders via ``can_render``. The host
                  always renders.
    """
    topology = normalize_topology(topology)
    roles = []

    if is_host:
        roles.append(ROLE_HOST)

    if is_spectator:
        # Watches only, owns no car. Renders its own view only where
        # participants render at all (remote/mixed); in a local room everyone
        # watches the shared screen, so a local spectator has no viewer role.
        if topology != TOPOLOGY_LOCAL:
            roles.append(ROLE_VIEWER)
        return _ordered_unique(roles)

    if topology == TOPOLOGY_LOCAL:
        if not is_host:
            roles.append(ROLE_CONTROLLER)  # controller/HUD-only; host renders
    elif topology == TOPOLOGY_REMOTE:
        roles.append(ROLE_CONTROLLER)
        roles.append(ROLE_VIEWER)
    else:  # mixed
        roles.append(ROLE_CONTROLLER)
        if can_render or is_host:
            roles.append(ROLE_VIEWER)

    return _ordered_unique(roles)


def primary_role(topology, is_host=False, can_render=False, is_spectator=False):
    """The single most-significant role for a participant (host > controller >
    viewer > spectator). Backwards-compatible scalar companion to
    :func:`participant_roles`; consumers that care about combined capabilities
    should use the list."""
    roles = participant_roles(topology, is_host, can_render, is_spectator)
    for candidate in (ROLE_HOST, ROLE_CONTROLLER, ROLE_VIEWER):
        if candidate in roles:
            return candidate
    return ROLE_SPECTATOR
