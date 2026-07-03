import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_STEERING_ASSIST_CONFIG } from '../../static/js/systems/steeringAssist.js';
import { runSteeringScenario, compareSteeringAssist } from '../../static/js/systems/PhysicsSimHarness.js';

/**
 * br-steering-assist-experiment — real-Rapier sim comparison (anti-narrowing).
 *
 * The assist is a feature-flagged experiment, DEFAULT OFF. On the real headless
 * Rapier sim, a bot kicked off-heading and told to drive straight holds the line
 * much better with the assist ON than OFF (less lateral drift, smaller final
 * heading error). A blind playtest is still required before it can ship default.
 */

const artifactDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../artifacts/br-steering-assist-experiment-x4re');

beforeAll(async () => {
    await RAPIER.init();
});

describe('steering assist experiment (steering-assist-experiment)', () => {
    it('is DEFAULT OFF (zero behavioral change unless explicitly enabled)', () => {
        expect(DEFAULT_STEERING_ASSIST_CONFIG.enabled).toBe(false);
        // With the default config the scenario is a pure no-assist run.
        const off = runSteeringScenario({ RAPIER, assistConfig: DEFAULT_STEERING_ASSIST_CONFIG, steps: 150 });
        const explicitOff = runSteeringScenario({ RAPIER, assistConfig: { enabled: false }, steps: 150 });
        expect(off).toEqual(explicitOff);
    });

    it('holds the line better with assist ON (real Rapier sim comparison)', () => {
        const cmp = compareSteeringAssist({ RAPIER, steps: 180, initialHeadingRad: 0.35 });
        // OFF: kicked off-heading, no steering -> heading never recovers (~0.35 rad).
        expect(cmp.off.finalHeadingErr).toBeGreaterThan(0.3);
        // ON: the assist eases the car back onto the line and CONVERGES (small
        // final heading error, no overshoot to the other side).
        expect(cmp.on.finalHeadingErr).toBeLessThan(0.1);
        // Tracks the target heading far better on average across the whole run.
        expect(cmp.on.avgHeadingErr).toBeLessThan(cmp.off.avgHeadingErr * 0.7);
        // And drifts off the centerline meaningfully less (not rounding noise).
        expect(cmp.on.maxLateral).toBeLessThan(cmp.off.maxLateral);
        expect(cmp.lateralImprovement).toBeGreaterThan(0.15);
    });

    it('is deterministic (same config -> identical metrics)', () => {
        const a = compareSteeringAssist({ RAPIER, steps: 150 });
        const b = compareSteeringAssist({ RAPIER, steps: 150 });
        expect(a).toEqual(b);
    });

    it('persists a comparison artifact', () => {
        const cmp = compareSteeringAssist({ RAPIER, steps: 180, initialHeadingRad: 0.35 });
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(resolve(artifactDir, 'sim-comparison.json'), JSON.stringify(cmp, null, 2) + '\n');
        expect(existsSync(resolve(artifactDir, 'sim-comparison.json'))).toBe(true);
    });
});
