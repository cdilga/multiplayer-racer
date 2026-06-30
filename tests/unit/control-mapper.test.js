import { beforeEach, describe, expect, it } from 'vitest';
import { ControlMapper } from '../../static/js/input/ControlMapper.js';

describe('ControlMapper', () => {
    let mapper;

    beforeEach(() => {
        mapper = new ControlMapper();
    });

    it('keeps raw touch input canonical/clamped while exposing separate shaped output', () => {
        mapper.setTouchInput(1.5, -0.4, 2, true);

        expect(mapper.touchInput).toEqual({
            steering: 1,
            acceleration: 0,
            braking: 1,
            fire: true
        });
        expect(mapper.getDebugValues().touchRaw).toEqual({
            steering: 1,
            acceleration: 0,
            braking: 1,
            fire: true
        });
        expect(mapper.getDebugValues().touchShaped.steering).toBeGreaterThan(0);
        expect(mapper.getDebugValues().touchShaped.steering).toBeLessThanOrEqual(1);
        expect(mapper.getControls()).toEqual({
            steering: mapper.getDebugValues().touchShaped.steering,
            acceleration: 0,
            braking: 1,
            fire: true
        });
    });

    it('ramps keyboard steering over time instead of snapping to full lock', () => {
        mapper.setKeyboardKeys(new Set(['KeyD', 'KeyW']));

        expect(mapper.getControls()).toEqual({
            steering: 0,
            acceleration: 1,
            braking: 0,
            fire: false
        });

        mapper.step(125);
        expect(mapper.getControls().steering).toBeCloseTo(0.5, 4);

        mapper.step(125);
        expect(mapper.getControls().steering).toBeCloseTo(1, 4);
    });

    it('ramps touch acceleration over explicit up/down windows', () => {
        mapper.setTouchInput(0, 1, 0);
        expect(mapper.getControls().acceleration).toBe(0);

        mapper.step(110);
        expect(mapper.getControls().acceleration).toBeCloseTo(0.5, 4);

        mapper.step(110);
        expect(mapper.getControls().acceleration).toBeCloseTo(1, 4);

        mapper.setTouchAcceleration(0);
        mapper.step(45);
        expect(mapper.getControls().acceleration).toBeCloseTo(0.5, 4);

        mapper.step(45);
        expect(mapper.getControls().acceleration).toBeCloseTo(0, 4);
    });

    it('neutralizes opposite steering keys and ramps back to center', () => {
        mapper.setKeyboardKeys(new Set(['KeyA']));
        mapper.step(250);
        expect(mapper.getControls().steering).toBeCloseTo(-1, 4);

        mapper.setKeyboardKeys(new Set(['KeyA', 'KeyD']));
        expect(mapper.getDebugValues().keyboardTarget.steering).toBe(0);

        mapper.step(100);
        expect(mapper.getControls().steering).toBeCloseTo(-0.4, 4);

        mapper.step(100);
        expect(mapper.getControls().steering).toBeCloseTo(0, 4);
    });

    it('falls back to shaped touch controls once keyboard input is inactive', () => {
        mapper.setTouchInput(0.3, 0.7, 0.2);
        mapper.step(220);
        const shapedTouch = mapper.getDebugValues().touchShaped;

        mapper.setKeyboardKeys(new Set(['KeyD']));
        mapper.step(250);
        expect(mapper.getControls().steering).toBeCloseTo(1, 4);

        mapper.setKeyboardKeys(new Set());
        mapper.step(200);

        const resumedTouch = mapper.getDebugValues().touchShaped;
        expect(mapper.getControls()).toEqual({
            steering: resumedTouch.steering,
            acceleration: resumedTouch.acceleration,
            braking: resumedTouch.braking,
            fire: false
        });
    });

    it('treats fire as a press edge for both keyboard and touch', () => {
        mapper.setKeyboardFire(true);
        expect(mapper.consumeFirePressed()).toBe(true);
        expect(mapper.consumeFirePressed()).toBe(false);

        mapper.setKeyboardFire(false);
        mapper.setTouchFire(true);
        expect(mapper.consumeFirePressed()).toBe(true);
        expect(mapper.consumeFirePressed()).toBe(false);
    });

    it('resets controls and debug state for visibility or touch-cancel release', () => {
        mapper.setTouchInput(0.5, 1, 0.2, true);
        mapper.step(220);
        mapper.setKeyboardKeys(new Set(['KeyD', 'KeyW']));
        mapper.setKeyboardFire(true);
        mapper.step(125);

        mapper.reset();

        expect(mapper.getControls()).toEqual({
            steering: 0,
            acceleration: 0,
            braking: 0,
            fire: false
        });
        expect(mapper.getDebugValues()).toMatchObject({
            touchRaw: { steering: 0, acceleration: 0, braking: 0, fire: false },
            touchShaped: { steering: 0, acceleration: 0, braking: 0, fire: false },
            keyboardRaw: { steering: 0, acceleration: 0, braking: 0, fire: false },
            keyboardTarget: { steering: 0, acceleration: 0, braking: 0 },
            merged: { steering: 0, acceleration: 0, braking: 0, fire: false },
            gamepadRaw: {
                steering: 0,
                acceleration: 0,
                braking: 0,
                fire: false,
                connected: false,
                mapping: null,
                sourceId: 'standard'
            },
            activeSource: 'touch',
            tuning: {
                touchAccelerationRampUpMs: 220,
                touchAccelerationRampDownMs: 90,
                steeringDeadZone: 0.1,
                steeringCurveExponent: 1.5,
                steeringSnapThreshold: 0.03,
                steeringFilterLagMs: 50,
                gamepadDeadZone: 0.15
            }
        });
        expect(mapper.consumeFirePressed()).toBe(false);
    });

    it('wires snap-to-zero into the shaped steering output', () => {
        const snapMapper = new ControlMapper({
            steeringDeadZone: 0,
            steeringCurveExponent: 1,
            steeringSnapThreshold: 0.05,
            steeringFilterLagMs: 0
        });

        snapMapper.setTouchInput(0.04, 0, 0);

        expect(snapMapper.touchInput.steering).toBeCloseTo(0.04, 6);
        expect(snapMapper.getControls().steering).toBe(0);
        expect(snapMapper.getDebugValues().touchShaped.steering).toBe(0);
    });

    it('exposes raw, shaped, target, and merged values plus tuning for overlays/tests', () => {
        mapper.setTouchInput(0.25, 0.8, 0.1);
        mapper.step(220);
        mapper.setKeyboardKeys(new Set(['KeyD']));
        mapper.step(125);

        const debug = mapper.getDebugValues();

        expect(debug.touchRaw).toEqual({
            steering: 0.25,
            acceleration: 0.8,
            braking: 0.1,
            fire: false
        });
        expect(debug.touchShaped.acceleration).toBeCloseTo(0.8, 4);
        expect(debug.keyboardTarget).toEqual({
            steering: 1,
            acceleration: 0,
            braking: 0
        });
        expect(debug.keyboardRaw.steering).toBeCloseTo(0.5, 4);
        expect(debug.merged.steering).toBeCloseTo(0.5, 4);
        expect(debug.tuning.touchAccelerationRampUpMs).toBe(220);
        expect(debug.tuning.touchAccelerationRampDownMs).toBe(90);
        expect(debug.tuning.steeringSnapThreshold).toBe(0.03);
    });
});
