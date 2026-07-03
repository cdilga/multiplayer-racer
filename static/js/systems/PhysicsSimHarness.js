/**
 * PhysicsSimHarness (br-physics-sim-harness) — the measurement rig the feel-tuning
 * beads depend on: "measure feel, don't tune by vibes" (CLAUDE.md).
 *
 * Bot drivers run scripted maneuvers on the headless deterministic PhysicsRuntime;
 * the harness records per-run metrics (peak/retained speed, distance, wall
 * deflection angle, time-to-recover), and runs parameter SWEEPS producing a
 * comparable metric table against a saved baseline. All deterministic (fixed dt +
 * seeded scripts), so a sweep is reproducible.
 */
import { PhysicsRuntime, SimVehicleAdapter } from './PhysicsRuntime.js';
import { computeSteeringAssist, wrapAngle } from './steeringAssist.js';

/** Scripted bot drivers: (tick) => controls. Pure, deterministic. */
export const DRIVERS = {
    fullThrottle: () => ({ acceleration: 1, braking: 0, steering: 0 }),
    slalom: (tick) => ({ acceleration: 1, braking: 0, steering: Math.sin(tick / 18) * 0.8 }),
    // Accelerate straight into a wall placed ahead, then keep driving into it.
    wallCharge: () => ({ acceleration: 1, braking: 0, steering: 0 })
};

function speedOf(state) {
    return Math.hypot(state.vx, state.vz);
}

/**
 * Run one scripted scenario and return its metrics.
 * @param {Object} opts
 * @param {Object} opts.RAPIER
 * @param {function(number):Object} opts.driver
 * @param {number} [opts.steps=180]
 * @param {Object} [opts.vehicle] - SimVehicleAdapter options (engineForce, etc.)
 * @param {number} [opts.wallZ] - if set, place a wall at this +Z distance (deflection test)
 * @returns {Object} metrics
 */
export function runScenario({ RAPIER, driver, steps = 180, vehicle = {}, wallZ = null }) {
    const runtime = new PhysicsRuntime({ RAPIER, fixedDt: 1 / 60 });
    const ground = runtime.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    runtime.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0), ground);
    if (wallZ != null) {
        const wall = runtime.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        runtime.world.createCollider(RAPIER.ColliderDesc.cuboid(50, 5, 0.5).setTranslation(0, 2.5, wallZ), wall);
    }

    const car = new SimVehicleAdapter(runtime, { position: { x: 0, y: 1, z: 0 }, ...vehicle });
    let peakSpeed = 0;
    let peakTick = 0;
    let minSpeedAfterPeak = Infinity;
    const start = car.getState();

    for (let t = 0; t < steps; t++) {
        car.applyControls(driver(t));
        runtime.step();
        const st = car.getState();
        const sp = speedOf(st);
        if (sp > peakSpeed) { peakSpeed = sp; peakTick = t; }
        if (t > peakTick) minSpeedAfterPeak = Math.min(minSpeedAfterPeak, sp);
    }

    const end = car.getState();
    const finalSpeed = speedOf(end);
    // Time (in ticks) to recover to 80% of peak after the post-peak dip.
    let recoverTicks = null;
    if (Number.isFinite(minSpeedAfterPeak) && peakSpeed > 0) {
        recoverTicks = finalSpeed >= 0.8 * peakSpeed ? (steps - peakTick) : null;
    }
    const round = (n) => Math.round(n * 1000) / 1000;
    const metrics = {
        peakSpeed: round(peakSpeed),
        finalSpeed: round(finalSpeed),
        speedRetention: round(peakSpeed > 0 ? finalSpeed / peakSpeed : 0),
        distance: round(Math.hypot(end.x - start.x, end.z - start.z)),
        // Deflection: heading of the velocity at the end (radians); on a wall
        // charge, a good "redirect" bends the path rather than dead-stopping.
        deflectionAngle: round(Math.atan2(end.vx, end.vz)),
        minSpeedAfterPeak: round(Number.isFinite(minSpeedAfterPeak) ? minSpeedAfterPeak : peakSpeed),
        recoverTicks
    };
    runtime.free();
    return metrics;
}

/**
 * Sweep one vehicle parameter across values, returning a comparable metric table.
 * @param {Object} opts
 * @returns {{param:string, driver:string, rows: Array<{value:number, metrics:Object}>}}
 */
export function sweep({ RAPIER, driver = DRIVERS.fullThrottle, driverName = 'fullThrottle', param, values, steps = 180, wallZ = null }) {
    const rows = values.map((value) => ({
        value,
        metrics: runScenario({ RAPIER, driver, steps, wallZ, vehicle: { [param]: value } })
    }));
    return { param, driver: driverName, steps, rows };
}

/**
 * Compare a sweep table to a saved baseline within tolerance. Returns per-row
 * deltas + an overall pass flag (so a feel change is a measurable regression).
 */
export function compareToBaseline(table, baseline, tolerance = 0.05) {
    const rows = table.rows.map((row, i) => {
        const base = baseline?.rows?.[i]?.metrics || {};
        const deltas = {};
        let withinTol = true;
        for (const key of Object.keys(row.metrics)) {
            if (typeof row.metrics[key] !== 'number' || typeof base[key] !== 'number') continue;
            const d = row.metrics[key] - base[key];
            deltas[key] = Math.round(d * 1000) / 1000;
            const scale = Math.max(1e-6, Math.abs(base[key]));
            if (Math.abs(d) / scale > tolerance) withinTol = false;
        }
        return { value: row.value, deltas, withinTol };
    });
    return { ok: rows.every((r) => r.withinTol), rows };
}

/**
 * br-steering-assist-experiment — drive a bot that starts off-heading (models a
 * bump / entering a corner off the line) straight ahead, and measure how far it
 * drifts off the centerline. With the steering assist ON it should hold the line
 * (less lateral deviation, smaller final heading error) than with it OFF.
 *
 * Runs on the REAL Rapier PhysicsRuntime.
 *
 * @returns {{maxLateral:number, finalX:number, finalHeadingErr:number, avgHeadingErr:number}}
 */
export function runSteeringScenario({
    RAPIER, assistConfig, steps = 180, initialHeadingRad = 0.35, targetHeadingRad = 0, vehicle = {}
}) {
    const runtime = new PhysicsRuntime({ RAPIER, fixedDt: 1 / 60 });
    const ground = runtime.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    runtime.world.createCollider(RAPIER.ColliderDesc.cuboid(400, 0.5, 400).setTranslation(0, -0.5, 0), ground);

    const car = new SimVehicleAdapter(runtime, { position: { x: 0, y: 1, z: 0 }, ...vehicle });
    // Kick the car off-heading before it sets off (a bump / off-line corner entry).
    const half = initialHeadingRad / 2;
    car.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);

    const dt = 1 / 60;
    let maxLateral = 0;
    let headingErrSum = 0;
    let prevHeading = car.getHeading();
    for (let t = 0; t < steps; t++) {
        const heading = car.getHeading();
        const headingRate = wrapAngle(heading - prevHeading) / dt;
        prevHeading = heading;
        const st = car.getState();
        const speed = Math.hypot(st.vx, st.vz);
        const result = computeSteeringAssist(
            { playerSteer: 0, headingRad: heading, targetHeadingRad, speedMps: speed, headingRateRadPerSec: headingRate },
            assistConfig
        );
        // The assist convention is "positive steer increases heading"; the sim's
        // yaw torque makes positive steer DECREASE heading, so map by negating.
        car.applyControls({ acceleration: 1, braking: 0, steering: -result.steer });
        runtime.step();
        const p = car.getState();
        maxLateral = Math.max(maxLateral, Math.abs(p.x));
        headingErrSum += Math.abs(wrapAngle(targetHeadingRad - car.getHeading()));
    }

    const lastHeading = car.getHeading();
    const end = car.getState();
    const round = (n) => Math.round(n * 1000) / 1000;
    runtime.free();
    return {
        maxLateral: round(maxLateral),
        finalX: round(end.x),
        finalHeadingErr: round(Math.abs(wrapAngle(targetHeadingRad - lastHeading))),
        avgHeadingErr: round(headingErrSum / steps)
    };
}

/**
 * Run the steering scenario with assist OFF and ON and report the improvement.
 * @returns {{off:Object, on:Object, lateralImprovement:number, headingImprovement:number}}
 */
export function compareSteeringAssist({ RAPIER, onConfig, steps = 180, initialHeadingRad = 0.35, engineForce = 400 } = {}) {
    const vehicle = { engineForce };
    const off = runSteeringScenario({ RAPIER, assistConfig: { enabled: false }, steps, initialHeadingRad, vehicle });
    const on = runSteeringScenario({
        RAPIER,
        assistConfig: { enabled: true, ...(onConfig || {}) },
        steps,
        initialHeadingRad,
        vehicle
    });
    const ratio = (a, b) => (b > 0 ? (b - a) / b : 0);
    return {
        off,
        on,
        lateralImprovement: Math.round(ratio(on.maxLateral, off.maxLateral) * 1000) / 1000,
        headingImprovement: Math.round(ratio(on.finalHeadingErr, off.finalHeadingErr) * 1000) / 1000
    };
}

export default { DRIVERS, runScenario, sweep, compareToBaseline, runSteeringScenario, compareSteeringAssist };
