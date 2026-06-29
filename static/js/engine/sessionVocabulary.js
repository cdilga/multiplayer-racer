/**
 * Shared session vocabulary for rooms, topologies, rulesets, and roles.
 *
 * Client-side mirror of server/session_vocabulary.py — the single source of
 * truth for the three *orthogonal* axes that describe a game session. Keeping
 * them separate (rather than overloading one "mode" field) is what lets Local
 * and Remote play, deeplink invites, and rejoinable rooms branch cleanly.
 * See docs/plans/game-modes-and-flows.md §3.
 *
 *   TOPOLOGY — a property of the room, fixed at creation. How participants are
 *              distributed and who renders the world.
 *   RULESET  — the game being played (carried on the wire as the legacy `mode`
 *              field for backwards compatibility).
 *   ROLE     — a property of a participant within the room.
 *
 * These three are independent: topology never implies a ruleset, and vice versa.
 */

// --- Topology: a property of the ROOM (fixed at creation) -------------------
export const TOPOLOGY = Object.freeze({
    LOCAL: 'local',    // one big screen renders; phones/keyboards are controllers + HUD only
    REMOTE: 'remote',  // one authoritative host; every participant renders their own viewer
    MIXED: 'mixed'     // some participants co-located, others remote
});

export const ROOM_TOPOLOGIES = Object.freeze([TOPOLOGY.LOCAL, TOPOLOGY.REMOTE, TOPOLOGY.MIXED]);
export const DEFAULT_TOPOLOGY = TOPOLOGY.LOCAL;

// --- Ruleset: the game played in the room (legacy wire key: `mode`) ---------
export const RULESET = Object.freeze({
    RACE: 'race',
    DERBY: 'derby'
});

export const RULESETS = Object.freeze([RULESET.RACE, RULESET.DERBY]);
export const DEFAULT_RULESET = RULESET.RACE;

// --- Role: a property of a PARTICIPANT --------------------------------------
export const ROLE = Object.freeze({
    HOST: 'host',              // runs the authoritative sim + canonical render (one per room)
    CONTROLLER: 'controller',  // owns a car and sends input (the doc's "Driver")
    VIEWER: 'viewer',          // renders a synced view locally (Remote participants)
    SPECTATOR: 'spectator'     // watches only, owns no car
});

export const ROLES = Object.freeze([ROLE.HOST, ROLE.CONTROLLER, ROLE.VIEWER, ROLE.SPECTATOR]);

/**
 * Coerce an incoming topology value to a known one. Unknown / missing values
 * fall back to the default (`local`) so a bad hint can never break Local play.
 * @param {*} value
 * @returns {string}
 */
export function normalizeTopology(value) {
    if (typeof value !== 'string') return DEFAULT_TOPOLOGY;
    const candidate = value.trim().toLowerCase();
    return ROOM_TOPOLOGIES.includes(candidate) ? candidate : DEFAULT_TOPOLOGY;
}

/** True only for an exact, known topology string (no coercion). */
export function isValidTopology(value) {
    return typeof value === 'string' && ROOM_TOPOLOGIES.includes(value);
}
