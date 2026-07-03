/**
 * steeringAssist (br-steering-assist-experiment) — an OPTIONAL, feature-flagged
 * steering aid that eases a car toward a target heading (e.g. the centerline
 * tangent / corner exit), blended with the player's own input.
 *
 * PURE + deterministic: no globals, time, RNG, THREE or Rapier. Given the car's
 * heading, a target heading and speed, it returns the assisted steering value and
 * how much of it was assist (for telemetry / sim comparison).
 *
 * DEFAULT OFF. This is an experiment: it ships disabled and a blind playtest must
 * prefer it before it can become the default. The sim harness
 * (PhysicsSimHarness.runSteeringScenario) proves that, when ON, bots hold the
 * line with less deviation than when OFF.
 *
 * Convention: headings are radians where a POSITIVE steer value increases heading
 * (turns toward larger angle). Callers map their own yaw convention onto this.
 */

/** Tunable config. `enabled:false` is the whole point — default OFF. */
export const DEFAULT_STEERING_ASSIST_CONFIG = Object.freeze({
    enabled: false,            // FEATURE FLAG — default OFF (playtest earns default-on)
    strength: 0.4,             // P gain: how strongly to blend toward the target heading
    damping: 0.6,              // D gain: opposes the heading rate to prevent overshoot
    maxAssistSteer: 0.8,       // cap on the assist's steering contribution
    engageSpeedMps: 3.0,       // below this speed there is no assist (parking/crawl)
    headingDeadbandRad: 0.03   // ignore tiny errors so the wheel doesn't hunt
});

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/** Wrap an angle into [-PI, PI]. */
export function wrapAngle(a) {
    let x = a;
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    return x;
}

/**
 * @param {Object} inputs
 * @param {number} [inputs.playerSteer=0] - raw driver steering in [-1, 1]
 * @param {number} [inputs.headingRad=0] - car's current heading (radians)
 * @param {number} [inputs.targetHeadingRad=0] - desired heading (centerline tangent)
 * @param {number} [inputs.speedMps=0] - current speed
 * @param {number} [inputs.headingRateRadPerSec=0] - current yaw/heading rate (for damping)
 * @param {Object} [config=DEFAULT_STEERING_ASSIST_CONFIG]
 * @returns {{steer:number, assist:number, engaged:boolean, headingErrorRad:number}}
 */
export function computeSteeringAssist(inputs = {}, config = DEFAULT_STEERING_ASSIST_CONFIG) {
    const { playerSteer = 0, headingRad = 0, targetHeadingRad = 0, speedMps = 0, headingRateRadPerSec = 0 } = inputs;
    const cfg = { ...DEFAULT_STEERING_ASSIST_CONFIG, ...config };

    // OFF, or too slow to matter: pure passthrough (zero behavioral change).
    if (!cfg.enabled || speedMps < cfg.engageSpeedMps) {
        return { steer: playerSteer, assist: 0, engaged: false, headingErrorRad: 0 };
    }

    const err = wrapAngle(targetHeadingRad - headingRad);
    if (Math.abs(err) < cfg.headingDeadbandRad && Math.abs(headingRateRadPerSec) < 0.05) {
        return { steer: playerSteer, assist: 0, engaged: true, headingErrorRad: err };
    }

    // PD control toward the target heading (both terms normalized by a 90deg
    // reference). The damping term opposes the current heading rate so the car
    // eases onto the line instead of overshooting to the other side.
    const errNorm = err / (Math.PI / 2);
    const errRateNorm = (-headingRateRadPerSec) / (Math.PI / 2);
    const raw = (errNorm * cfg.strength) + (errRateNorm * cfg.damping);
    const assist = clamp(raw, -cfg.maxAssistSteer, cfg.maxAssistSteer);
    const steer = clamp(playerSteer + assist, -1, 1);
    return { steer, assist, engaged: true, headingErrorRad: err };
}

export default { DEFAULT_STEERING_ASSIST_CONFIG, computeSteeringAssist, wrapAngle };
