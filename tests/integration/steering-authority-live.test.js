import { describe, expect, it, vi } from 'vitest';
import { Vehicle } from '../../static/js/entities/Vehicle.js';
import { PhysicsSystem } from '../../static/js/systems/PhysicsSystem.js';

function quatZ(deg) {
    const half = (deg * Math.PI / 180) / 2;
    return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

function makeController({ wheelGrounded = [true, true, true, true], speed = 0 } = {}) {
    return {
        numWheels: () => wheelGrounded.length,
        wheelIsGrounded: (index) => wheelGrounded[index],
        currentVehicleSpeed: () => speed,
        setWheelEngineForce: vi.fn(),
        setWheelFrictionSlip: vi.fn(),
        setWheelSteering: vi.fn(),
        setWheelBrake: vi.fn()
    };
}

function makeBody({ rollDeg = 0 } = {}) {
    return {
        rotation: () => quatZ(rollDeg),
        translation: () => ({ x: 0, y: 0, z: 0 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
        angvel: () => ({ x: 0, y: 0, z: 0 }),
        applyImpulseAtPoint: vi.fn(),
        applyTorqueImpulse: vi.fn()
    };
}

function makeConfig(overrides = {}) {
    return {
        engine: { force: 100, brakeForce: 50 },
        frictionSlip: 1000,
        steering: {
            maxAngle: 0.5,
            highSpeedReduction: 0,
            smoothing: 1
        },
        wheelie: {
            activationThrottle: 0.92,
            activationDwellMs: 280,
            steeringAuthority: 0.18,
            airborneAuthority: 0.08,
            liftImpulse: 8,
            liftCooldownMs: 450
        },
        stunt: {
            maxCharge: 1,
            wheelieChargeRate: 1,
            airtimeChargeRate: 1,
            minLandingCharge: 0.25,
            landingBoostBonus: 0.5,
            landingBoostDuration: 1,
            landingRamBonus: 20,
            badLandingAngularSpeed: 8,
            badLandingVerticalSpeed: 9,
            badLandingDuration: 1,
            badLandingThrottleMultiplier: 0.65,
            badLandingSteeringMultiplier: 0.55
        },
        ...overrides
    };
}

function createHarness({ wheelGrounded, speed, rollDeg, vehicleOverrides = {}, configOverrides = {} } = {}) {
    const physics = new PhysicsSystem({ controlStepSeconds: 0.1 });
    const vehicle = Object.assign(new Vehicle({ playerId: 'p1' }), vehicleOverrides);
    const controller = makeController({ wheelGrounded, speed });
    const body = makeBody({ rollDeg });
    const config = makeConfig(configOverrides);

    physics.vehicleBodies.set(vehicle.id, {
        body,
        controller,
        entity: vehicle,
        config,
        previousHandlingState: vehicle.handlingState || 'grounded',
        currentSteer: 0
    });

    function apply(controls = { steering: 1, acceleration: 0, braking: 0 }) {
        physics.applyVehicleControls(vehicle.id, controls);
        return physics.getVehicleTelemetry(vehicle.id);
    }

    function lastSteer() {
        return controller.setWheelSteering.mock.calls.at(-1)?.[1];
    }

    return { physics, vehicle, controller, body, config, apply, lastSteer };
}

describe('PhysicsSystem live steering-authority integration', () => {
    it('uses the progressive helper in applyVehicleControls for grounded/front-light/wheelie/airborne states', () => {
        const grounded = createHarness({ wheelGrounded: [true, true, true, true] });
        const frontLight = createHarness({ wheelGrounded: [true, true, false, false] });
        const wheelie = createHarness({ wheelGrounded: [false, false, true, true] });
        const airborne = createHarness({ wheelGrounded: [false, false, false, false] });

        const g = grounded.apply();
        const fl = frontLight.apply();
        const w = wheelie.apply();
        const a = airborne.apply();

        expect(g.steeringAuthority.authority).toBeCloseTo(1, 6);
        expect(fl.steeringAuthority.authority).toBeGreaterThan(w.steeringAuthority.authority);
        expect(fl.steeringAuthority.authority).toBeLessThan(g.steeringAuthority.authority);
        expect(w.steeringAuthority.authority).toBeGreaterThan(a.steeringAuthority.authority);

        expect(grounded.lastSteer()).toBeCloseTo(-0.5, 6);
        expect(frontLight.lastSteer()).toBeCloseTo(-0.5 * fl.steeringAuthority.authority, 6);
        expect(wheelie.lastSteer()).toBeCloseTo(-0.5 * w.steeringAuthority.authority, 6);
        expect(airborne.lastSteer()).toBeCloseTo(-0.5 * a.steeringAuthority.authority, 6);
    });

    it('reports dominant limiter, factors, and bad-landing progress in telemetry', () => {
        const now = performance.now();
        const harness = createHarness({
            vehicleOverrides: {
                stuntBadLandingUntil: now + 1000
            },
            configOverrides: {
                stunt: {
                    badLandingDuration: 1,
                    badLandingSteeringMultiplier: 0.55
                }
            }
        });

        const tel = harness.apply({ steering: 1, acceleration: 0, braking: 0 });

        expect(tel.steeringAuthority.dominantLimiter).toBe('bad-landing');
        expect(tel.steeringAuthority.authority).toBeGreaterThanOrEqual(0.54);
        expect(tel.steeringAuthority.authority).toBeLessThan(0.7);
        expect(tel.steeringAuthority.factors).toMatchObject({
            state: 1,
            speed: 1
        });
        expect(tel.steeringAuthority.factors.badLanding).toBeLessThan(0.7);
        expect(tel.steeringAuthority.tuning.badLandingAuthority).toBeCloseTo(0.55, 6);
    });

    it('applies capped side-tilt recovery torque only with player input and not while airborne', () => {
        const tilted = createHarness({ rollDeg: 90 });
        const tel = tilted.apply({ steering: 1, acceleration: 0.5, braking: 0 });

        expect(tel.steeringAuthority.dominantLimiter).toBe('side-tilt');
        expect(tel.steeringAuthority.recoveryInfluence).toBeGreaterThan(0);
        expect(tilted.body.applyTorqueImpulse).toHaveBeenCalledTimes(1);
        const [impulse, wake] = tilted.body.applyTorqueImpulse.mock.calls[0];
        expect(wake).toBe(true);
        expect(Math.abs(impulse.x)).toBeGreaterThan(0);
        expect(Math.abs(impulse.x)).toBeLessThanOrEqual(0.45);
        expect(Math.abs(impulse.y)).toBeLessThanOrEqual(0.18);

        const noInput = createHarness({ rollDeg: 90 });
        noInput.apply({ steering: 0, acceleration: 0, braking: 0 });
        expect(noInput.body.applyTorqueImpulse).not.toHaveBeenCalled();

        const airborne = createHarness({ rollDeg: 90, wheelGrounded: [false, false, false, false] });
        airborne.apply({ steering: 1, acceleration: 1, braking: 0 });
        expect(airborne.body.applyTorqueImpulse).not.toHaveBeenCalled();
    });

    it('wall contact does not reduce steering authority or add extra steering loss', () => {
        const clean = createHarness();
        const wall = createHarness({
            vehicleOverrides: {
                inWallContact: true
            }
        });

        const cleanTel = clean.apply({ steering: 1, acceleration: 0, braking: 0 });
        const wallTel = wall.apply({ steering: 1, acceleration: 0, braking: 0 });

        expect(wallTel.steeringAuthority.authority).toBeCloseTo(cleanTel.steeringAuthority.authority, 9);
        expect(wall.lastSteer()).toBeCloseTo(clean.lastSteer(), 9);
        expect(wallTel.steeringAuthority.wallPeel).toBeGreaterThan(0);
    });
});
