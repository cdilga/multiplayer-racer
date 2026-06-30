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

function makeBody() {
    return {
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
        translation: () => ({ x: 0, y: 0, z: 0 }),
        linvel: () => ({ x: 0, y: 0, z: 0 }),
        angvel: () => ({ x: 0, y: 0, z: 0 }),
        applyImpulseAtPoint: vi.fn()
    };
}

function createSimHarness() {
    const mapper = new ControlMapper({
        steeringDeadZone: 0,
        steeringCurveExponent: 1,
        steeringSnapThreshold: 0,
        steeringFilterLagMs: 0,
        touchAccelerationRampUpMs: 220,
        touchAccelerationRampDownMs: 90
    });
    const physics = new PhysicsSystem({ controlStepSeconds: 0.1 });
    const vehicle = new Vehicle({ playerId: 'p1' });
    const controller = makeController();
    const body = makeBody();

    physics.vehicleBodies.set(vehicle.id, {
        body,
        controller,
        entity: vehicle,
        config: {
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
            }
        },
        previousHandlingState: 'grounded'
    });

    function advance({ steering = 0, acceleration = 0, braking = 0, dtMs = 100 }) {
        mapper.setTouchInput(steering, acceleration, braking);
        mapper.step(dtMs);
        physics.applyVehicleControls(vehicle.id, mapper.getControls());
        return {
            controls: mapper.getControls(),
            telemetry: physics.getVehicleTelemetry(vehicle.id)
        };
    }

    return { body, advance };
}

describe('wheelie intent sim proof', () => {
    it('keeps feathered cornering below wheelie intent while sustained full throttle still lifts', () => {
        const { body, advance } = createSimHarness();

        const feathered = [
            advance({ steering: 0.65, acceleration: 1, dtMs: 200 }),
            advance({ steering: 0.65, acceleration: 0, dtMs: 100 }),
            advance({ steering: 0.65, acceleration: 1, dtMs: 200 }),
            advance({ steering: 0.65, acceleration: 0, dtMs: 100 })
        ];

        expect(feathered.every((frame) => frame.telemetry.wheelieIntent.holdMs === 0)).toBe(true);
        expect(feathered.some((frame) => frame.controls.acceleration >= frame.telemetry.wheelieIntent.threshold)).toBe(false);
        expect(body.applyImpulseAtPoint).not.toHaveBeenCalled();

        const sustained = [
            advance({ steering: 0, acceleration: 1, dtMs: 100 }),
            advance({ steering: 0, acceleration: 1, dtMs: 100 }),
            advance({ steering: 0, acceleration: 1, dtMs: 100 }),
            advance({ steering: 0, acceleration: 1, dtMs: 100 }),
            advance({ steering: 0, acceleration: 1, dtMs: 100 })
        ];

        expect(sustained[2].controls.acceleration).toBeCloseTo(1, 6);
        expect(sustained[2].telemetry.wheelieIntent.holdMs).toBe(100);
        expect(sustained[3].telemetry.wheelieIntent.holdMs).toBe(200);
        expect(body.applyImpulseAtPoint).toHaveBeenCalledTimes(1);
        expect(sustained[4].telemetry.wheelieIntent.holdMs).toBe(0);
    });
});
