import { describe, it, expect } from 'vitest';
import {
    DEFAULT_STEERING_ASSIST_CONFIG,
    computeSteeringAssist,
    wrapAngle
} from '../../static/js/systems/steeringAssist.js';

/**
 * br-steering-assist-experiment — the pure PD steering-aid decision. The real
 * Rapier sim comparison (assist ON holds the line, converges) lives in
 * tests/integration/steering-assist.test.ts; this proves the control law.
 */

const ON = { enabled: true };

describe('steering assist config', () => {
    it('is DEFAULT OFF (experiment ships disabled)', () => {
        expect(DEFAULT_STEERING_ASSIST_CONFIG.enabled).toBe(false);
    });
});

describe('computeSteeringAssist', () => {
    it('is a pure passthrough when disabled (zero behavioral change)', () => {
        const r = computeSteeringAssist({ playerSteer: 0.3, headingRad: 0, targetHeadingRad: 1, speedMps: 20 });
        expect(r.engaged).toBe(false);
        expect(r.assist).toBe(0);
        expect(r.steer).toBe(0.3);
    });

    it('does not engage below the engage speed', () => {
        const r = computeSteeringAssist({ playerSteer: 0.2, headingRad: 0, targetHeadingRad: 1, speedMps: 1 }, ON);
        expect(r.engaged).toBe(false);
        expect(r.steer).toBe(0.2);
    });

    it('steers toward the target heading (positive steer increases heading)', () => {
        // target ahead of heading (err > 0) -> assist positive (turn toward larger angle).
        const r = computeSteeringAssist({ playerSteer: 0, headingRad: 0, targetHeadingRad: 0.6, speedMps: 20 }, ON);
        expect(r.engaged).toBe(true);
        expect(r.assist).toBeGreaterThan(0);
        expect(r.headingErrorRad).toBeCloseTo(0.6, 6);
        // mirror: target behind -> assist negative.
        const l = computeSteeringAssist({ playerSteer: 0, headingRad: 0, targetHeadingRad: -0.6, speedMps: 20 }, ON);
        expect(l.assist).toBeLessThan(0);
    });

    it('damps: opposes an existing heading rate even with no error', () => {
        // Already on target (err ~0) but yawing positively -> assist negative (brake the swing).
        const r = computeSteeringAssist(
            { playerSteer: 0, headingRad: 0, targetHeadingRad: 0, speedMps: 20, headingRateRadPerSec: 1.0 },
            ON
        );
        expect(r.assist).toBeLessThan(0);
    });

    it('holds a deadband when both error and rate are tiny (no hunting)', () => {
        const r = computeSteeringAssist(
            { playerSteer: 0, headingRad: 0, targetHeadingRad: 0.01, speedMps: 20, headingRateRadPerSec: 0.01 },
            ON
        );
        expect(r.assist).toBe(0);
        expect(r.engaged).toBe(true);
    });

    it('caps the assist contribution at maxAssistSteer', () => {
        const cfg = { enabled: true, strength: 2, maxAssistSteer: 0.5 };
        const r = computeSteeringAssist({ playerSteer: 0, headingRad: 0, targetHeadingRad: Math.PI / 2, speedMps: 20 }, cfg);
        expect(Math.abs(r.assist)).toBeLessThanOrEqual(0.5 + 1e-9);
    });

    it('clamps the final steer into [-1, 1]', () => {
        const cfg = { enabled: true, strength: 2, maxAssistSteer: 0.9 };
        const r = computeSteeringAssist({ playerSteer: 0.8, headingRad: 0, targetHeadingRad: Math.PI / 2, speedMps: 20 }, cfg);
        expect(r.steer).toBeLessThanOrEqual(1);
        expect(r.steer).toBeGreaterThanOrEqual(-1);
    });
});

describe('wrapAngle', () => {
    it('wraps into [-PI, PI]', () => {
        expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 6);
        expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 6);
        expect(wrapAngle(0.5)).toBeCloseTo(0.5, 6);
    });
});
