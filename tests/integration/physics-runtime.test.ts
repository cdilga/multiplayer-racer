import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsRuntime, SimVehicleAdapter } from '../../static/js/systems/PhysicsRuntime.js';

/**
 * br-physics-runtime-extract — headless, injectable-clock, DETERMINISTIC Rapier
 * stepping. Same seed+inputs -> same trajectory, in Node (no browser/wall clock).
 */

beforeAll(async () => {
    await RAPIER.init();
});

// Deterministic scripted control per tick (pure function of tick).
function scriptedControls(tick: number) {
    const phase = tick % 90;
    return {
        acceleration: phase < 60 ? 1 : 0.2,
        braking: 0,
        steering: Math.sin(tick / 30) * 0.6
    };
}

function runTrajectory(steps: number) {
    const runtime = new PhysicsRuntime({ RAPIER, fixedDt: 1 / 60 });
    // A ground plane so the car has something to drive on.
    const ground = runtime.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    runtime.world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0), ground);

    const car = new SimVehicleAdapter(runtime, { position: { x: 0, y: 1, z: 0 } });
    const trajectory: any[] = [];
    for (let t = 0; t < steps; t++) {
        car.applyControls(scriptedControls(t));
        runtime.step();
        if (t % 15 === 0) trajectory.push({ tick: runtime.tick, ...car.getState() });
    }
    const final = car.getState();
    runtime.free();
    return { trajectory, final, simTimeMs: runtime.simTimeMs };
}

describe('PhysicsRuntime headless determinism (physics-runtime-extract)', () => {
    it('steps headlessly under an injected fixed clock (no wall time)', () => {
        const runtime = new PhysicsRuntime({ RAPIER, fixedDt: 1 / 60 });
        expect(runtime.nowMs()).toBe(0);
        runtime.stepMany(60);
        expect(runtime.tick).toBe(60);
        // 60 fixed steps @ 1/60s = exactly 1000ms of sim time (clock from ticks).
        expect(runtime.nowMs()).toBeCloseTo(1000, 6);
        runtime.free();
    });

    it('produces an IDENTICAL trajectory for the same seed + inputs', () => {
        const a = runTrajectory(180);
        const b = runTrajectory(180);
        // Byte-identical trajectory hashes: determinism holds across runs.
        expect(JSON.stringify(a.trajectory)).toBe(JSON.stringify(b.trajectory));
        expect(a.final).toEqual(b.final);
        expect(a.simTimeMs).toBe(b.simTimeMs);
    });

    it('actually moves the car (the sim is doing work, not frozen)', () => {
        const { trajectory, final } = runTrajectory(180);
        expect(trajectory.length).toBeGreaterThan(1);
        // Under throttle the car travels a non-trivial distance from the origin.
        expect(Math.hypot(final.x, final.z)).toBeGreaterThan(1);
    });
});
