/**
 * Join-route resolver — deterministic entry routing for br-captain-call-architecture-hardening-woq.11.
 *
 * Slice 1 (this file): the PURE decision core. Given a typed description of HOW a
 * device arrived (`via`), any explicit `intent` it carries, and the target
 * `roomState`, it decides the participant `role`, whether to start a local world
 * renderer, and whether the UI must show the screen/controller/spectator chooser.
 *
 * It has NO dependency on the DOM, navigator, sockets, or the renderer — the
 * `/join` route + player entry (Slice 2) call this and apply the result. Keeping
 * it pure makes the whole route matrix unit-testable and deterministic.
 *
 * Design rules (from the bead):
 *   - Entry intent is EXPLICIT typed state (`via`/`intent`), never user-agent
 *     sniffing as the sole signal. `capability` is an explicit input and only
 *     ever GATES rendering; it never decides role on its own.
 *   - Consume the protocol manifest vocabulary (ROLE/TOPOLOGY) from
 *     sessionVocabulary.js — do not invent parallel role/topology names.
 *   - Host-lobby QR is context-rich (player sees the screen) => controller/HUD
 *     only, no chooser, no renderer.
 *   - Copied/shared invites are context-poor => show the chooser unless the
 *     intent is already encoded.
 *   - Pair QR binds a phone as controller for an already-open seat; an
 *     invalid/expired/reused pair token requires an EXPLICIT fallback join, never
 *     a silent duplicate seat.
 *   - Capacity stress is best-effort: keep binding + degrade + diagnose; never a
 *     routine arbitrary-cap rejection.
 */

import { ROLE, TOPOLOGY, normalizeTopology } from './sessionVocabulary.js';

/** How the device reached the app (typed route state — the bead's `via`). */
export const VIA = Object.freeze({
    HOST_QR: 'host_qr',           // scanned the host/lobby QR (near a visible screen)
    PAIR_QR: 'pair_qr',           // scanned a pair QR to control an already-open viewer seat
    COPIED_INVITE: 'copied_invite', // opened a copied/shared link (context-poor)
    RECONNECT: 'reconnect',       // opened a reconnect link/token
    MANUAL_CODE: 'manual_code'    // typed a room code in by hand (context-poor)
});

export const VIAS = Object.freeze(Object.values(VIA));

/** Explicit role intent, usually from the chooser or encoded in an invite. */
export const ENTRY_INTENT = Object.freeze({
    SCREEN: 'screen',                       // "use this device as my screen" (second-screen viewer)
    CONTROLLER: 'controller',               // "I can see the game screen" (controller/HUD only)
    SPECTATOR: 'spectator',                 // "watch only"
    VIEWER_CONTROLLER: 'viewer_controller'  // same-device viewer + controller (where supported)
});

export const ENTRY_INTENTS = Object.freeze(Object.values(ENTRY_INTENT));

/** Canonical classification of the resolved entry (the bead's `entryKind`). */
export const ENTRY_KIND = Object.freeze({
    HOST_QR_CONTROLLER: 'host_qr_controller',
    COPIED_INVITE_CHOOSER: 'copied_invite_chooser',
    MANUAL_CODE_CHOOSER: 'manual_code_chooser',
    REMOTE_SCREEN_VIEWER: 'remote_screen_viewer',
    CONTROLLER_ONLY: 'controller_only',
    SPECTATOR: 'spectator',
    SAME_DEVICE_VIEWER_CONTROLLER: 'same_device_viewer_controller',
    PAIR_CONTROLLER: 'pair_controller',
    PAIR_FALLBACK_JOIN: 'pair_fallback_join',
    RECONNECT_RESTORE: 'reconnect_restore',
    RECONNECT_UNRESTORABLE: 'reconnect_unrestorable',
    INVALID_ROOM: 'invalid_room',
    EXPIRED_ROOM: 'expired_room',
    ROOM_ENDED: 'room_ended',
    REVOKED_ROOM: 'revoked_room',
    MISSING_ROOM: 'missing_room'
});

/** Room lifecycle states the resolver understands (roomState.status). */
export const ROOM_STATUS = Object.freeze({
    OPEN: 'open',
    INVALID: 'invalid',
    EXPIRED: 'expired',
    ENDED: 'ended',
    REVOKED: 'revoked'
});

const RECOVERY_STATUS_TO_KIND = Object.freeze({
    [ROOM_STATUS.INVALID]: ENTRY_KIND.INVALID_ROOM,
    [ROOM_STATUS.EXPIRED]: ENTRY_KIND.EXPIRED_ROOM,
    [ROOM_STATUS.ENDED]: ENTRY_KIND.ROOM_ENDED,
    [ROOM_STATUS.REVOKED]: ENTRY_KIND.REVOKED_ROOM
});

function normStr(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Base decision object; individual branches override what they need. */
function decision(overrides) {
    return {
        entryKind: null,
        role: null,
        startRenderer: false,
        showChooser: false,
        pairPrompt: false,          // show a pair QR/code so a phone can control this seat
        bindToExistingSeat: false,  // pair QR: bind to the open seat, do NOT create a new one
        readOnly: false,            // spectator / viewer-only
        recovery: false,            // dead/unroutable room or unrestorable reconnect
        recoveryKind: null,
        capacityStress: false,      // high-occupancy: bound anyway, degraded
        degrade: false,
        reason: '',
        // Guard marker: this resolver never decides on user-agent alone.
        usedUserAgentOnly: false,
        ...overrides
    };
}

/** True when a remote/mixed participant can actually render a local viewer. */
function canRenderViewer(topology, capability) {
    const remoteish = topology === TOPOLOGY.REMOTE || topology === TOPOLOGY.MIXED;
    return remoteish && capability.canRenderViewer !== false;
}

/**
 * Resolve a join entry to a concrete routing decision. Pure + deterministic.
 *
 * @param {Object} input
 * @param {string} [input.via] - How the device arrived (VIA.*). Unknown/missing
 *   is treated as a context-poor copied invite (safe: shows the chooser).
 * @param {string} [input.intent] - Explicit ENTRY_INTENT.* choice, if any.
 * @param {string} [input.room] - Room code.
 * @param {string} [input.pairToken] - Pair-QR token, if this is a pair entry.
 * @param {string} [input.reconnectToken] - Reconnect token, if this is a rejoin.
 * @param {Object} [input.roomState] - Target room facts:
 *   { status, topology, capacityStressed, priorRole, priorSeatId, pairTokenValid }.
 * @param {Object} [input.capability] - Device capability (explicit, never UA-sniffed
 *   here): { canRenderViewer, sameDeviceViewerController }.
 * @returns {Object} routing decision (see `decision()` for shape).
 */
export function resolveJoinRoute(input = {}) {
    const via = normStr(input.via);
    const intent = normStr(input.intent);
    const room = typeof input.room === 'string' ? input.room.trim() : '';
    const pairToken = input.pairToken || null;
    const reconnectToken = input.reconnectToken || null;
    const roomState = input.roomState || {};
    const capability = input.capability || {};
    const topology = normalizeTopology(roomState.topology);
    const status = normStr(roomState.status) || ROOM_STATUS.OPEN;
    const capacityStressed = roomState.capacityStressed === true;

    // Apply the capacity-stress overlay to any *successful bind* decision. Never
    // turns a bind into a rejection — only marks degrade/diagnose.
    const withCapacity = (d) => {
        if (capacityStressed && !d.recovery) {
            d.capacityStress = true;
            d.degrade = true;
            d.reason = `${d.reason}+capacity_stress_degrade`;
        }
        return d;
    };

    // 1. Dead / unroutable room takes precedence over everything (even reconnect):
    //    you cannot bind into an invalid/expired/ended/revoked room.
    if (RECOVERY_STATUS_TO_KIND[status]) {
        return decision({
            entryKind: RECOVERY_STATUS_TO_KIND[status],
            recovery: true,
            recoveryKind: status,
            reason: `room_${status}_recovery`
        });
    }

    // 1b. No room and nothing to bind to => must recover with a code prompt.
    if (!room && !reconnectToken && !pairToken) {
        return decision({
            entryKind: ENTRY_KIND.MISSING_ROOM,
            recovery: true,
            recoveryKind: 'missing_room',
            reason: 'missing_room_code'
        });
    }

    // 2. Reconnect: restore the prior role/seat where valid; else safe recovery.
    if (via === VIA.RECONNECT || reconnectToken) {
        const priorRole = normStr(roomState.priorRole);
        if (priorRole && ROLE[priorRole.toUpperCase()] === priorRole) {
            return withCapacity(decision({
                entryKind: ENTRY_KIND.RECONNECT_RESTORE,
                role: priorRole,
                startRenderer: priorRole === ROLE.VIEWER || priorRole === ROLE.HOST,
                reason: 'reconnect_restored'
            }));
        }
        // Role cannot be restored -> safe recovery copy + chooser, never a guess.
        return decision({
            entryKind: ENTRY_KIND.RECONNECT_UNRESTORABLE,
            showChooser: true,
            recovery: true,
            recoveryKind: 'role_unrestorable',
            reason: 'reconnect_role_unrestorable_safe_recovery'
        });
    }

    // 3. Pair QR: bind a controller to the already-open viewer/screen seat.
    if (via === VIA.PAIR_QR || pairToken) {
        const tokenValid = roomState.pairTokenValid !== false && !!pairToken;
        if (tokenValid) {
            return withCapacity(decision({
                entryKind: ENTRY_KIND.PAIR_CONTROLLER,
                role: ROLE.CONTROLLER,
                startRenderer: false,
                bindToExistingSeat: true,
                reason: 'pair_bind_existing_seat'
            }));
        }
        // Invalid/expired/reused pair token: explicit fallback join, NOT a silent
        // duplicate seat. Surface the chooser so the user decides.
        return decision({
            entryKind: ENTRY_KIND.PAIR_FALLBACK_JOIN,
            showChooser: true,
            bindToExistingSeat: false,
            reason: 'pair_token_invalid_explicit_fallback'
        });
    }

    // 4. Host QR: context-rich, the player can see the screen -> controller/HUD
    //    only. No chooser, no world renderer on the phone.
    if (via === VIA.HOST_QR) {
        return withCapacity(decision({
            entryKind: ENTRY_KIND.HOST_QR_CONTROLLER,
            role: ROLE.CONTROLLER,
            startRenderer: false,
            reason: 'host_qr_controller_default'
        }));
    }

    // 5. Explicit intent (from the chooser or an intent-encoded invite).
    if (intent === ENTRY_INTENT.CONTROLLER) {
        return withCapacity(decision({
            entryKind: ENTRY_KIND.CONTROLLER_ONLY,
            role: ROLE.CONTROLLER,
            startRenderer: false,
            reason: 'controller_only_other_screen'
        }));
    }

    if (intent === ENTRY_INTENT.SCREEN) {
        const render = canRenderViewer(topology, capability);
        return withCapacity(decision({
            entryKind: ENTRY_KIND.REMOTE_SCREEN_VIEWER,
            role: ROLE.VIEWER,
            startRenderer: render,
            pairPrompt: true,              // show a pair QR/code so a phone drives this seat
            degrade: !render,              // couldn't render locally -> degrade, still bound
            reason: render ? 'screen_viewer_with_pair' : 'screen_viewer_degraded_no_render'
        }));
    }

    if (intent === ENTRY_INTENT.SPECTATOR) {
        const render = canRenderViewer(topology, capability);
        return withCapacity(decision({
            entryKind: ENTRY_KIND.SPECTATOR,
            role: ROLE.SPECTATOR,
            startRenderer: render,         // remote spectators render their own read-only view
            readOnly: true,
            reason: 'spectator_read_only'
        }));
    }

    if (intent === ENTRY_INTENT.VIEWER_CONTROLLER) {
        if (capability.sameDeviceViewerController === true) {
            return withCapacity(decision({
                entryKind: ENTRY_KIND.SAME_DEVICE_VIEWER_CONTROLLER,
                role: ROLE.CONTROLLER,   // owns a car AND renders its own view
                startRenderer: true,
                reason: 'same_device_viewer_plus_controller'
            }));
        }
        // Not supported on this device -> fall back to the chooser, don't guess.
        return decision({
            entryKind: ENTRY_KIND.COPIED_INVITE_CHOOSER,
            showChooser: true,
            reason: 'same_device_unsupported_show_chooser'
        });
    }

    // 6. Manual code: context-poor -> chooser (unless intent already handled above).
    if (via === VIA.MANUAL_CODE) {
        return decision({
            entryKind: ENTRY_KIND.MANUAL_CODE_CHOOSER,
            showChooser: true,
            reason: 'manual_code_needs_intent'
        });
    }

    // 7. Copied/shared invite without intent (also the default for unknown `via`):
    //    ambiguous -> show the chooser before binding a role.
    return decision({
        entryKind: ENTRY_KIND.COPIED_INVITE_CHOOSER,
        showChooser: true,
        reason: via === VIA.COPIED_INVITE ? 'copied_invite_needs_intent' : 'unknown_via_defaults_to_chooser'
    });
}
