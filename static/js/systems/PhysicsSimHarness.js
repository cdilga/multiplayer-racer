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

export default { DRIVERS, runScenario, sweep, compareToBaseline };
