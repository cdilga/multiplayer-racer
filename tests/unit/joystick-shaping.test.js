import { describe, it, expect, beforeEach } from 'vitest';
import { ControlMapper } from '../../static/js/input/ControlMapper.js';

describe('Joystick Input Shaping', () => {
    let mapper;

    beforeEach(() => {
        mapper = new ControlMapper({
            steeringDeadZone: 0.1,
            steeringCurveExponent: 1.5,
            steeringSnapThreshold: 0.03,
            steeringFilterLagMs: 50
        });
    });

    describe('Dead Zone', () => {
        it('should suppress small inputs below threshold', () => {
            // 0.05 < 0.1 threshold → should snap to 0
            mapper.setTouchInput(0.05, 0, 0);
            expect(mapper.getControls().steering).toBe(0);
        });

        it('should start responding above threshold', () => {
            // Just above threshold
            mapper.setTouchInput(0.11, 0, 0);
            const value = mapper.getControls().steering;
            expect(Math.abs(value)).toBeGreaterThan(0);
        });

        it('should scale above-threshold inputs with dead zone remapping', () => {
            // At 0.2: (0.2-0.1)/(1-0.1) = 0.111, then apply curve: 0.111^1.5 = 0.037
            // Then filter: output = 0.25 * 0.037 = 0.009 (first frame)
            mapper.setTouchInput(0.2, 0, 0);
            const value = mapper.getControls().steering;
            const postDeadZone = (0.2 - 0.1) / (1 - 0.1); // 0.111
            const postCurve = Math.pow(postDeadZone, 1.5); // 0.037
            const filtered = 0.25 * postCurve; // ~0.009
            expect(Math.abs(value)).toBeCloseTo(filtered, 1);
        });

        it('should preserve sign', () => {
            mapper.setTouchInput(-0.2, 0, 0);
            const value = mapper.getControls().steering;
            expect(value).toBeLessThan(0);
        });

        it('should reach strong authority at high deflection (after filtering)', () => {
            // High sustained input converges to high output
            mapper.setTouchInput(0.9, 0, 0);
            for (let i = 0; i < 10; i++) {
                mapper.setTouchInput(0.9, 0, 0);
            }
            const value = mapper.getControls().steering;
            // At 0.9: (0.9-0.1)/(1-0.1) = 0.889, then 0.889^1.5 = 0.837, converged by filter
            expect(Math.abs(value)).toBeGreaterThan(0.7);
        });

        it('should reach full authority at full deflection (after filtering)', () => {
            mapper.setTouchInput(1.0, 0, 0);
            // Sustained full input converges to ~1.0
            for (let i = 0; i < 10; i++) {
                mapper.setTouchInput(1.0, 0, 0);
            }
            const value = mapper.getControls().steering;
            // At 1.0: (1.0-0.1)/(1-0.1) = 1.0, then 1.0^1.5 = 1.0
            expect(Math.abs(value)).toBeCloseTo(1.0, 1);
        });
    });

    describe('Response Curve', () => {
        it('should apply power curve to scale steering authority', () => {
            // Demonstrates that medium deflections are reduced relative to full lock
            mapper.setTouchInput(0.5, 0, 0);
            const value = mapper.getControls().steering;
            // Medium input should be less than half full authority (due to curve)
            expect(Math.abs(value)).toBeLessThan(0.3);
        });

        it('should preserve sign through curve', () => {
            mapper.setTouchInput(-0.5, 0, 0);
            const value = mapper.getControls().steering;
            expect(value).toBeLessThan(0);
        });

        it('should make full lock still reachable after sustained input', () => {
            // Sustained full input will converge to full lock through the filter
            mapper.setTouchInput(1.0, 0, 0);
            for (let i = 0; i < 10; i++) {
                mapper.setTouchInput(1.0, 0, 0);
            }
            const value = mapper.getControls().steering;
            expect(Math.abs(value)).toBeCloseTo(1.0, 1);
        });
    });

    describe('Low-Pass Filter', () => {
        it('should smooth rapid changes over time', () => {
            // Set to a high value
            mapper.setTouchInput(0.8, 0, 0);
            const value1 = mapper.getControls().steering;

            // Immediately drop to 0
            mapper.setTouchInput(0.0, 0, 0);
            const value2 = mapper.getControls().steering;

            // Due to filtering, value2 should not drop all the way to 0
            expect(Math.abs(value2)).toBeLessThan(Math.abs(value1));
            expect(Math.abs(value2)).toBeGreaterThan(0);
        });

        it('should converge to new target over multiple steps', () => {
            // Set initial value
            mapper.setTouchInput(1.0, 0, 0);
            const initial = mapper.getControls().steering;
            expect(initial).toBeGreaterThan(0);

            // Switch to zero and step multiple times
            mapper.setTouchInput(0.0, 0, 0);
            let current = mapper.getControls().steering;
            const afterFirstZero = current;
            expect(afterFirstZero).toBeLessThan(initial); // Should start converging down

            // After 20 more steps, should converge further towards zero
            for (let i = 0; i < 20; i++) {
                mapper.setTouchInput(0.0, 0, 0);
                current = mapper.getControls().steering;
            }

            // Current should be much closer to zero than the initial step
            expect(Math.abs(current)).toBeLessThan(Math.abs(afterFirstZero) * 0.5);
        });

        it('should reset filter state on reset()', () => {
            mapper.setTouchInput(0.8, 0, 0);
            const beforeReset = mapper._steeringFilteredValue;
            expect(beforeReset).toBeGreaterThan(0);

            mapper.reset();
            expect(mapper._steeringFilteredValue).toBe(0);
        });
    });

    describe('Full Pipeline Determinism', () => {
        it('should produce identical output for identical input sequence', () => {
            const sequence = [0.05, 0.2, 0.5, 1.0, 0.5, 0.2, 0.0];
            const results1 = [];
            const results2 = [];

            // First run
            mapper.reset();
            for (const input of sequence) {
                mapper.setTouchInput(input, 0, 0);
                results1.push(mapper.getControls().steering);
            }

            // Second run
            mapper.reset();
            for (const input of sequence) {
                mapper.setTouchInput(input, 0, 0);
                results2.push(mapper.getControls().steering);
            }

            // All values should match exactly
            for (let i = 0; i < results1.length; i++) {
                expect(results2[i]).toBe(results1[i]);
            }
        });
    });

    describe('Touch Input Behavior', () => {
        it('should clamp final output to [-1, 1]', () => {
            mapper.setTouchInput(1.5, 0, 0);
            expect(mapper.getControls().steering).toBeLessThanOrEqual(1.0);

            mapper.setTouchInput(-1.5, 0, 0);
            expect(mapper.getControls().steering).toBeGreaterThanOrEqual(-1.0);
        });

        it('should keep acceleration out of steering shaping and ramp it separately', () => {
            mapper.setTouchInput(0, 0.5, 0);
            expect(mapper.getDebugValues().touchRaw.acceleration).toBe(0.5);
            expect(mapper.getControls().acceleration).toBe(0);
            mapper.step(110);
            expect(mapper.getControls().acceleration).toBe(0.5);
        });

        it('should not apply shaping to braking', () => {
            mapper.setTouchInput(0, 0, 0.7);
            expect(mapper.getControls().braking).toBe(0.7);
        });

        it('should preserve fire button state', () => {
            mapper.setTouchInput(0, 0, 0, true);
            expect(mapper.getControls().fire).toBe(true);

            mapper.setTouchInput(0, 0, 0, false);
            expect(mapper.getControls().fire).toBe(false);
        });
    });

    describe('Multitouch Compatibility', () => {
        it('should not affect keyboard input', () => {
            mapper.setKeyboardKeys(['KeyD']); // Right
            mapper.step(16.667);
            const keyboardSteering = mapper.getControls().steering;

            // Set touch input
            mapper.setTouchInput(0.5, 0, 0);
            const blended = mapper.getControls().steering;

            // Keyboard should dominate
            expect(blended).toBe(keyboardSteering);
        });
    });

    describe('Edge Cases', () => {
        it('should handle zero input', () => {
            mapper.setTouchInput(0, 0, 0);
            expect(mapper.getControls().steering).toBe(0);
        });

        it('should handle repeated same value and converge', () => {
            mapper.setTouchInput(0.5, 0, 0);
            const value1 = mapper.getControls().steering;
            mapper.setTouchInput(0.5, 0, 0);
            const value2 = mapper.getControls().steering;
            // After filtering, repeated input should converge towards steady state
            // value2 should be greater than value1 (asymptotically approaching target)
            expect(value2).toBeGreaterThanOrEqual(value1);
        });

        it('should handle extreme dead zone', () => {
            const extremeMapper = new ControlMapper({
                steeringDeadZone: 0.5,
                steeringCurveExponent: 1.5,
                steeringSnapThreshold: 0.03,
                steeringFilterLagMs: 50
            });
            extremeMapper.setTouchInput(0.4, 0, 0);
            expect(extremeMapper.getControls().steering).toBe(0);

            extremeMapper.setTouchInput(0.6, 0, 0);
            expect(extremeMapper.getControls().steering).toBeGreaterThan(0);
        });

        it('should handle rapid alternation smoothly', () => {
            // Rapid left-right should filter smoothly, not jump
            mapper.reset();
            mapper.setTouchInput(-0.5, 0, 0);
            const left1 = mapper.getControls().steering;
            mapper.setTouchInput(0.5, 0, 0);
            const right1 = mapper.getControls().steering;

            // Due to filtering, right1 should be closer to left1 (not opposite)
            // rather than immediately swinging to opposite
            expect(Math.abs(right1 - left1)).toBeLessThan(Math.abs(left1) * 1.5);
        });
    });

    describe('Blind-operable steering constraint', () => {
        it('should support medium confidence steering to adjust heading', () => {
            // A player holding 0.5 should get some steering output
            mapper.setTouchInput(0.5, 0, 0);
            const medium = mapper.getControls().steering;
            // After dead zone and curve: (0.5-0.1)/(1-0.1) = 0.444, 0.444^1.5 = 0.296
            // After filter (first frame): 0.25 * 0.296 = 0.074
            expect(Math.abs(medium)).toBeGreaterThan(0);
            expect(Math.abs(medium)).toBeLessThan(0.296); // Less than raw curve output due to filter
        });

        it('should reach full lock after sustained input', () => {
            // Held input should asymptotically approach full authority
            mapper.setTouchInput(1.0, 0, 0);
            let fullLock = mapper.getControls().steering;

            // After several frames of holding 1.0, should converge to ~1.0
            for (let i = 0; i < 10; i++) {
                mapper.setTouchInput(1.0, 0, 0);
                fullLock = mapper.getControls().steering;
            }

            expect(Math.abs(fullLock)).toBeGreaterThan(0.9);
        });
    });
});
