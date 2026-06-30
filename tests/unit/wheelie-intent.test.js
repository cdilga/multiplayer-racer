import { describe, expect, it, vi } from 'vitest';
import { ControlMapper } from '../../static/js/input/ControlMapper.js';
import { Vehicle } from '../../static/js/entities/Vehicle.js';
import { PhysicsSystem } from '../../static/js/systems/PhysicsSystem.js';

function makeController(wheelGrounded = [true, true, true, true]) {
    return {
        numWheels: () => wheelGrounded.length,
        wheelIsGrounded: (index) => wheelGrounded[index],
        currentVehicleSpeed: () => 0,
        setWheelEngineForce: vi.fn(),
        setWheelFrictionSlip: vi.fn(),
        setWheelSteering: vi.fn(),
        setWheelBrake: vi.fn()
    };
}

function makeBody(overrides = {}) {
    return {
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
        translation: () => ({ x: 0, y: 0, z: 0 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
        angvel: () => ({ x: 0, y: 0, z: 0 }),
        applyImpulseAtPoint: vi.fn(),
        ...overrides
    };
}

function makeConfig(overrides = {}) {
    return {
        engine: { force: 100 },
        frictionSlip: 1000,
        steering: {
            maxAngle: 0.5,
            highSpeedReduction: 0,
            smoothing: 1
        },
        wheelie: {
            activationThrottle: 0.92,
            activationDwellMs: 280,
            steeringAuthority: 0.15,
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
            badLandingThrottleMultiplier: 0.5,
            badLandingSteeringMultiplier: 0.5
        },
        ...overrides
    };
}

function createHarness({
    controlStepSeconds = 0.1,
    mapperOptions = {},
    configOverrides = {},
    vehicleOverrides = {},
    wheelGrounded = [true, true, true, true],
    bodyOverrides = {}
} = {}) {
    const mapper = new ControlMapper({
        steeringDeadZone: 0,
        steeringCurveExponent: 1,
        steeringSnapThreshold: 0,
        steeringFilterLagMs: 0,
        ...mapperOptions
    });
    const physics = new PhysicsSystem({ controlStepSeconds });
    const vehicle = Object.assign(new Vehicle({ playerId: 'p1' }), vehicleOverrides);
    const controller = makeController(wheelGrounded);
    const body = makeBody(bodyOverrides);
    const config = makeConfig(configOverrides);

    physics.vehicleBodies.set(vehicle.id, {
        body,
        controller,
        entity: vehicle,
        config,
        previousHandlingState: vehicle.handlingState || 'grounded'
    });

    function applyFrame({ steering = 0, acceleration = null, braking = 0, dtMs = 100 } = {}) {
        mapper.setTouchInput(steering, acceleration ?? mapper.touchInput.acceleration, braking);
        mapper.step(dtMs);
        physics.applyVehicleControls(vehicle.id, mapper.getControls());
        return physics.getVehicleTelemetry(vehicle.id);
    }

    return { mapper, physics, vehicle, controller, body, config, applyFrame };
}

describe('wheelie intent gating', () => {
    it('requires sustained shaped throttle before lift and records threshold/dwell telemetry', () => {
        const { body, applyFrame, config } = createHarness();

        let telemetry = applyFrame({ acceleration: 1, dtMs: 100 });
        expect(telemetry.wheelieIntent.threshold).toBe(config.wheelie.activationThrottle);
        expect(telemetry.wheelieIntent.dwellMs).toBe(config.wheelie.activationDwellMs);
        expect(telemetry.wheelieIntent.holdMs).toBe(0);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        telemetry = applyFrame({ acceleration: 1, dtMs: 100 });
        expect(telemetry.wheelieIntent.holdMs).toBe(0);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        telemetry = applyFrame({ acceleration: 1, dtMs: 100 });
        expect(telemetry.wheelieIntent.holdMs).toBe(100);
        expect(telemetry.wheelieIntent.progress).toBeCloseTo(100 / 280, 6);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        telemetry = applyFrame({ acceleration: 1, dtMs: 100 });
        expect(telemetry.wheelieIntent.holdMs).toBe(200);
        expect(telemetry.wheelieIntent.ready).toBe(false);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        telemetry = applyFrame({ acceleration: 1, dtMs: 100 });
        expect(body.applyImpulseAtPoint).toHaveBeenCalledTimes(1);
        expect(body.applyImpulseAtPoint).toHaveBeenCalledWith(
            expect.objectContaining({ y: 8 }),
            expect.objectContaining({ z: 2 }),
            true
        );
        expect(telemetry.wheelieIntent.holdMs).toBe(0);
        expect(telemetry.wheelieIntent.ready).toBe(false);
        expect(telemetry.wheelieIntent.cooldownRemainingMs).toBeGreaterThan(0);
    });

    it('does not arm wheelies on short feathered throttle bursts through a cornering sequence', () => {
        const { body, applyFrame } = createHarness();

        const burst1 = applyFrame({ steering: 0.6, acceleration: 1, dtMs: 200 });
        expect(burst1.wheelieIntent.holdMs).toBe(0);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        const release1 = applyFrame({ steering: 0.6, acceleration: 0, dtMs: 100 });
        expect(release1.wheelieIntent.holdMs).toBe(0);

        const burst2 = applyFrame({ steering: 0.6, acceleration: 1, dtMs: 200 });
        expect(burst2.wheelieIntent.holdMs).toBe(0);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        const release2 = applyFrame({ steering: 0.6, acceleration: 0, dtMs: 100 });
        expect(release2.wheelieIntent.holdMs).toBe(0);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();
    });

    it('preserves landing/boost engine-force payoff below the wheelie gate', () => {
        const { vehicle, controller, body, applyFrame } = createHarness({
            vehicleOverrides: {
                stuntBoostMultiplier: 1.5,
                stuntBoostUntil: performance.now() + 1000
            }
        });

        const telemetry = applyFrame({ acceleration: 0.5, dtMs: 100 });

        const [, appliedForce] = controller.setWheelEngineForce.mock.calls.at(-1);
        expect(controller.setWheelEngineForce.mock.calls.at(-1)?.[0]).toBe(3);
        expect(appliedForce).toBeCloseTo(telemetry.wheelieIntent.throttle * 100 * 1.5, 9);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();
        expect(telemetry.wheelieIntent.boostMultiplier).toBeCloseTo(1.5);
        expect(vehicle.stuntBoostMultiplier).toBeCloseTo(1.5);
    });
});
