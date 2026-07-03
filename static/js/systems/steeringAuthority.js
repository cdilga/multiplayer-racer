/**
 * steeringAuthority - progressive steering-authority model for the vehicle.
 *
 * PURE + deterministic: no globals, no time, no RNG, no THREE/Rapier. Given a
 * snapshot of a car's handling state it returns how much steering authority the
 * driver has right now, which factor is limiting it most (for telemetry), and a
 * forgiving side-tilt recovery influence.
 *
 * Why: today PhysicsSystem applies a binary cliff -- full steering when grounded,
 * a flat 0.15 once the front wheels lift (wheelie/airborne), times a bad-landing
 * multiplier. That transition feels like an on/off switch and tilted/side-loaded
 * cars feel dead. This replaces the cliff with progressive curves so authority
 * follows wheel contact, roll angle, speed, wall contact and stunt/recovery
 * state, while keeping the wheelie tradeoff meaningful (you still can't carve a
 * racing line with the front wheels up).
 *
 * Integration (handed to whoever owns PhysicsSystem.js): replace the
 * `steeringAuthority` block at PhysicsSystem.js:962-969 with:
 *
 *   const sa = computeSteeringAuthority({
 *       handlingState: newState,
 *       speedMps: currentSpeed,
 *       rollDeg: <abs roll from upright>,
 *       wallContact: <bool>,
 *       badLanding: { active: this._isBadLandingActive(entity),
 *                     progress: <0..1 recovery> },
 *   }, config.steeringAuthority);
 *   const targetSteer = -(controls.steering || 0) * effectiveMax * sa.authority;
 *   // optional: use sa.recoveryInfluence / sa.wallPeel for righting + peel-away;
 *   // expose sa.dominantLimiter via telemetry.
 *
 * The defaults below intentionally match the current feel at the extremes
 * (grounded = 1.0, bad-landing floor = 0.55) so this is a drop-in that only
 * smooths the middle and adds tilt recovery.
 */

/** Handling states (mirror PhysicsSystem's `newState`). */
export const HANDLING_STATE = Object.freeze({
    GROUNDED: 'grounded',
    FRONT_LIGHT: 'front-light',
    WHEELIE: 'wheelie',
    AIRBORNE: 'airborne'
});

/** Named limiters reported as `dominantLimiter` for telemetry/debug. */
export const LIMITER = Object.freeze({
    NONE: 'none',
    SPEED: 'speed',
    FRONT_LIGHT: 'front-light',
    WHEELIE: 'wheelie',
    AIRBORNE: 'airborne',
    BAD_LANDING: 'bad-landing',
    SIDE_TILT: 'side-tilt'
});

/**
 * Tunable thresholds. Surfaced so they can be wired to config/F2 later.
 * @type {Readonly<object>}
 */
export const DEFAULT_STEERING_AUTHORITY_CONFIG = Object.freeze({
    // State authority anchors (front-wheel contact). grounded is always 1.0.
    frontLightAuthority: 0.7,   // soften BEFORE the wheelie cliff
    wheelieAuthority: 0.18,     // weak body/yaw influence, no carving
    airborneAuthority: 0.08,    // subtle air control, weaker than wheelie

    // Speed: gentle reduction so fast inputs don't spin out. 1.0 at a crawl,
    // easing to highSpeedAuthorityFloor by speedRefMps.
    highSpeedAuthorityFloor: 0.6,
    speedRefMps: 22,

    // Roll: below rollFullAuthorityDeg roll doesn't cut steering; by rollDeadDeg
    // (near on-side) normal tire steering is reduced to sideTiltSteerFloor.
    rollFullAuthorityDeg: 25,
    rollDeadDeg: 75,
    sideTiltSteerFloor: 0.12,

    // Bad landing: authority floor right after a bad landing, ramping back to
    // full as `badLanding.progress` goes 0 -> 1 (no snap from useless to full).
    badLandingAuthority: 0.55,

    // Side-tilt recovery: forgiving yaw/roll/righting influence (NOT an instant
    // reset). Peaks at recoveryMaxInfluence when fully on-side.
    recoveryMaxInfluence: 0.5,

    // Wall contact: never reduces authority (no rail-lock); adds a small bias to
    // help peel away from the barrier.
    wallPeelBias: 0.15
});

/** Clamp `v` to [lo, hi]. */
function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/** Linear 0..1 ramp of `x` across [a, b] (a < b). Outside the range clamps. */
function ramp(x, a, b) {
    if (b <= a) return x >= b ? 1 : 0;
    return clamp((x - a) / (b - a), 0, 1);
}

/**
 * State authority from front-wheel contact. If `frontContact` (0..1) is given it
 * is used as a progressive blend toward 1.0; otherwise the discrete handling
 * state picks an anchor. Ordering guaranteed: grounded >= front-light >= wheelie
 * >= airborne.
 * @returns {{value: number, limiter: string}}
 */
function stateAuthority(handlingState, frontContact, cfg) {
    if (typeof frontContact === 'number') {
        const c = clamp(frontContact, 0, 1);
        // Blend airborne floor -> full as contact rises; below half contact the
        // car is effectively in a wheelie.
        const floor = cfg.airborneAuthority;
        const value = floor + (1 - floor) * c;
        const limiter = c >= 0.999 ? LIMITER.NONE
            : c <= 0.05 ? LIMITER.AIRBORNE
                : c < 0.5 ? LIMITER.WHEELIE : LIMITER.FRONT_LIGHT;
        return { value, limiter };
    }
    switch (handlingState) {
        case HANDLING_STATE.AIRBORNE:
            return { value: cfg.airborneAuthority, limiter: LIMITER.AIRBORNE };
        case HANDLING_STATE.WHEELIE:
            return { value: cfg.wheelieAuthority, limiter: LIMITER.WHEELIE };
        case HANDLING_STATE.FRONT_LIGHT:
            return { value: cfg.frontLightAuthority, limiter: LIMITER.FRONT_LIGHT };
        case HANDLING_STATE.GROUNDED:
        default:
            return { value: 1, limiter: LIMITER.NONE };
    }
}

/**
 * Compute progressive steering authority + recovery info for one car snapshot.
 *
 * @param {Object} state
 * @param {string} [state.handlingState='grounded'] - grounded|front-light|wheelie|airborne
 * @param {number} [state.frontContact] - optional 0..1 front-wheel contact (overrides handlingState curve)
 * @param {number} [state.speedMps=0] - forward speed in m/s
 * @param {number} [state.rollDeg=0] - absolute roll angle from upright, degrees
 * @param {boolean} [state.wallContact=false] - touching a wall/barrier
 * @param {{active?: boolean, progress?: number}} [state.badLanding] - bad-landing recovery (progress 0=just landed .. 1=recovered)
 * @param {Object} [config] - overrides for DEFAULT_STEERING_AUTHORITY_CONFIG
 * @returns {{authority: number, dominantLimiter: string, recoveryInfluence: number, wallPeel: number, factors: object}}
 */
export function computeSteeringAuthority(state = {}, config = {}) {
    const cfg = { ...DEFAULT_STEERING_AUTHORITY_CONFIG, ...config };

    const handlingState = state.handlingState || HANDLING_STATE.GROUNDED;
    const speedMps = Math.max(0, state.speedMps || 0);
    const rollDeg = Math.abs(state.rollDeg || 0);
    const wallContact = !!state.wallContact;
    const badLanding = state.badLanding || {};

    // --- Factor 1: front-wheel contact / handling state ---
    const sa = stateAuthority(handlingState, state.frontContact, cfg);
    const stateFactor = clamp(sa.value, 0, 1);

    // --- Factor 2: speed (gentle) ---
    const speedFactor = 1 - (1 - cfg.highSpeedAuthorityFloor) * ramp(speedMps, 0, cfg.speedRefMps);

    // --- Factor 3: roll / side-tilt ---
    // Normal tire steering fades as the car goes onto two wheels / its side.
    const rollT = ramp(rollDeg, cfg.rollFullAuthorityDeg, cfg.rollDeadDeg);
    const rollFactor = 1 - (1 - cfg.sideTiltSteerFloor) * rollT;

    // --- Factor 4: bad landing (ramps back, no cliff) ---
    let badFactor = 1;
    if (badLanding.active) {
        const progress = clamp(badLanding.progress == null ? 0 : badLanding.progress, 0, 1);
        badFactor = cfg.badLandingAuthority + (1 - cfg.badLandingAuthority) * progress;
    }

    // Wall contact deliberately does NOT reduce authority (no rail-lock); it only
    // adds a peel-away bias the caller can apply.
    const wallPeel = wallContact ? cfg.wallPeelBias : 0;

    const authority = clamp(stateFactor * speedFactor * rollFactor * badFactor, 0, 1);

    // --- Dominant limiter: whichever factor cut authority the most ---
    const reductions = [
        { limiter: sa.limiter === LIMITER.NONE ? LIMITER.NONE : sa.limiter, cut: 1 - stateFactor },
        { limiter: LIMITER.SPEED, cut: 1 - speedFactor },
        { limiter: LIMITER.SIDE_TILT, cut: 1 - rollFactor },
        { limiter: LIMITER.BAD_LANDING, cut: 1 - badFactor }
    ];
    let dominant = { limiter: LIMITER.NONE, cut: 0 };
    for (const r of reductions) {
        if (r.cut > dominant.cut + 1e-9) dominant = r;
    }
    const dominantLimiter = dominant.cut <= 1e-6 ? LIMITER.NONE : dominant.limiter;

    // --- Side-tilt recovery influence: forgiving righting/yaw the player can use
    // when on two wheels / partly on side. Grows with roll, capped (no magic
    // instant reset). Also a small amount during bad-landing recovery. ---
    const tiltRecovery = cfg.recoveryMaxInfluence * rollT;
    const landRecovery = badLanding.active
        ? cfg.recoveryMaxInfluence * 0.4 * (1 - clamp(badLanding.progress || 0, 0, 1))
        : 0;
    const recoveryInfluence = clamp(Math.max(tiltRecovery, landRecovery), 0, cfg.recoveryMaxInfluence);

    return {
        authority,
        dominantLimiter,
        recoveryInfluence,
        wallPeel,
        factors: {
            state: stateFactor,
            speed: speedFactor,
            roll: rollFactor,
            badLanding: badFactor
        }
    };
}

// Non-module global fallback (matches the rest of static/js).
if (typeof window !== 'undefined') {
    window.computeSteeringAuthority = computeSteeringAuthority;
}
