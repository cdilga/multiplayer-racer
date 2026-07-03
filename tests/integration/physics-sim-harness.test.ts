import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { DRIVERS, runScenario, sweep, compareToBaseline } from '../../static/js/systems/PhysicsSimHarness.js';

/**
 * br-physics-sim-harness — bot drivers + metrics + parameter sweeps + baseline,
 * on the real headless Rapier PhysicsRuntime. This is the "measure feel" rig.
 */

const artifactDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../artifacts/br-physics-sim-harness-4taq');

beforeAll(async () => {
    await RAPIER.init();
});

describe('physics sim harness (physics-sim-harness)', () => {
    it('a bot driver produces per-run metrics on the headless sim', () => {
        const m = runScenario({ RAPIER, driver: DRIVERS.fullThrottle, steps: 180 });
        expect(m).toHaveProperty('peakSpeed');
        expect(m).toHaveProperty('speedRetention');
        expect(m).toHaveProperty('distance');
        expect(m).toHaveProperty('deflectionAngle');
        // Full throttle actually builds speed and travels.
        expect(m.peakSpeed).toBeGreaterThan(1);
        expect(m.distance).toBeGreaterThan(1);
    });

    it('metrics are deterministic (same driver+params -> same metrics)', () => {
        const a = runScenario({ RAPIER, driver: DRIVERS.slalom, steps: 150 });
        const b = runScenario({ RAPIER, driver: DRIVERS.slalom, steps: 150 });
        expect(a).toEqual(b);
    });

    it('a parameter sweep yields a comparable metric table (engineForce -> speed)', () => {
        const table = sweep({
            RAPIER, driver: DRIVERS.fullThrottle, driverName: 'fullThrottle',
            param: 'engineForce', values: [400, 800, 1200], steps: 150
        });
        expect(table.rows).toHaveLength(3);
        // More engine force -> higher peak speed (a sane, measurable relationship).
        expect(table.rows[2].metrics.peakSpeed).toBeGreaterThan(table.rows[0].metrics.peakSpeed);

        // A re-run within tolerance of itself proves the baseline comparison works.
        const rerun = sweep({
            RAPIER, driver: DRIVERS.fullThrottle, driverName: 'fullThrottle',
            param: 'engineForce', values: [400, 800, 1200], steps: 150
        });
        expect(compareToBaseline(rerun, table).ok).toBe(true);
    });

    it('persists a sweep artifact + committed baseline', () => {
        const table = sweep({
            RAPIER, driver: DRIVERS.fullThrottle, driverName: 'fullThrottle',
            param: 'engineForce', values: [400, 800, 1200, 1600], steps: 180
        });
        // Also a wall-charge sweep so deflection/recovery are captured.
        const wall = sweep({
            RAPIER, driver: DRIVERS.wallCharge, driverName: 'wallCharge',
            param: 'engineForce', values: [800, 1600], steps: 150, wallZ: 30
        });
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(resolve(artifactDir, 'baseline.json'), JSON.stringify({ engineForceSweep: table, wallChargeSweep: wall }, null, 2) + '\n');
        expect(existsSync(resolve(artifactDir, 'baseline.json'))).toBe(true);
        expect(table.rows.every((r) => Number.isFinite(r.metrics.peakSpeed))).toBe(true);
    });
});
