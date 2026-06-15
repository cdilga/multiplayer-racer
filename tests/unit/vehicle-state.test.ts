import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Vehicle } from '../../static/js/entities/Vehicle.js';
import { DamageSystem } from '../../static/js/systems/DamageSystem.js';
import { PhysicsSystem } from '../../static/js/systems/PhysicsSystem.js';
import { RenderSystem } from '../../static/js/systems/RenderSystem.js';

function makeController(wheelGrounded: boolean[]) {
    return {
        numWheels: () => wheelGrounded.length,
        wheelIsGrounded: (index: number) => wheelGrounded[index],
        currentVehicleSpeed: () => 0,
        setWheelEngineForce: vi.fn(),
        setWheelFrictionSlip: vi.fn(),
        setWheelSteering: vi.fn(),
        setWheelBrake: vi.fn()
    };
}

function makeBody(overrides: Record<string, unknown> = {}) {
    return {
        rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
        translation: () => ({ x: 0, y: 0, z: 0 }),
        linvel: () => ({ x: 0, y: -2, z: 0 }),
        angvel: () => ({ x: 0, y: 0, z: 0 }),
        applyImpulseAtPoint: vi.fn(),
        ...overrides
    };
}

function makePhysicsConfig(overrides: Record<string, unknown> = {}) {
    return {
        engine: { force: 100 },
        frictionSlip: 1000,
        steering: {
            maxAngle: 0.5,
            highSpeedReduction: 0,
            smoothing: 1
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

describe('Vehicle state regressions', () => {
    it('keeps rigidBody as a compatibility alias for physicsBody', () => {
        const vehicle = new Vehicle({ playerId: 'p1' });
        const body = { userData: {} };

        vehicle.setPhysicsBody(body);

        expect(vehicle.physicsBody).toBe(body);
        expect(vehicle.rigidBody).toBe(body);
        expect(body.userData).toMatchObject({
            entityId: vehicle.id,
            entity: vehicle
        });
    });

    it('enters wheelie when front wheels are up, then recovers steering when grounded', () => {
        const physics = new PhysicsSystem();
        const vehicle = new Vehicle({ playerId: 'p1' });
        const wheelGrounded = [false, false, true, true];
        const controller = makeController(wheelGrounded);

        physics.vehicleBodies.set(vehicle.id, {
            body: {},
            controller,
            entity: vehicle,
            config: {
                engine: { force: 100 },
                frictionSlip: 1000,
                steering: {
                    maxAngle: 0.5,
                    highSpeedReduction: 0,
                    smoothing: 1
                }
            }
        });

        physics.applyVehicleControls(vehicle.id, {
            steering: 1,
            acceleration: 0,
            braking: 0
        });

        expect(vehicle.handlingState).toBe('wheelie');
        expect(controller.setWheelSteering).toHaveBeenLastCalledWith(1, -0.075);

        wheelGrounded[0] = true;
        wheelGrounded[1] = true;

        physics.applyVehicleControls(vehicle.id, {
            steering: 1,
            acceleration: 0,
            braking: 0
        });

        expect(vehicle.handlingState).toBe('grounded');
        expect(controller.setWheelSteering).toHaveBeenLastCalledWith(1, -0.5);
    });

    it('uses high acceleration to apply a front lift impulse for intentional wheelies', () => {
        const physics = new PhysicsSystem();
        const vehicle = new Vehicle({ playerId: 'p1' });
        const controller = makeController([true, true, true, true]);
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
                    activationThrottle: 0.7,
                    steeringAuthority: 0.15,
                    liftImpulse: 8
                }
            }
        });

        physics.applyVehicleControls(vehicle.id, {
            steering: 0,
            acceleration: 1,
            braking: 0
        });

        expect(body.applyImpulseAtPoint).toHaveBeenCalledWith(
            expect.objectContaining({ y: 8 }),
            expect.objectContaining({ z: 2 }),
            true
        );
    });

    it('accepts Rapier wheelIsInContact as the production wheel contact API', () => {
        const physics = new PhysicsSystem();
        const vehicle = new Vehicle({ playerId: 'p1' });
        const controller = {
            ...makeController([false, false, false, false]),
            wheelIsGrounded: undefined,
            wheelIsInContact: (index: number) => [true, true, true, true][index]
        };

        physics.vehicleBodies.set(vehicle.id, {
            body: makeBody(),
            controller,
            entity: vehicle,
            config: makePhysicsConfig()
        });

        physics.applyVehicleControls(vehicle.id, {
            steering: 0,
            acceleration: 0,
            braking: 0
        });

        expect(vehicle.handlingState).toBe('grounded');
    });

    it('toggles reusable stunt visual cues and disposes them on reset', () => {
        const previousThree = (globalThis as Record<string, unknown>).THREE;
        (globalThis as Record<string, unknown>).THREE = THREE;

        try {
            const vehicle = new Vehicle({
                playerId: 'p1',
                config: {
                    visual: {
                        body: { width: 2, height: 1, length: 4 },
                        wheels: { radius: 0.35 }
                    }
                }
            });
            vehicle.setMesh(new THREE.Group());

            vehicle.handlingState = 'wheelie';
            vehicle.stuntState = 'charging';
            vehicle.stuntCharge = 0.8;
            vehicle.updateEffects(0.016);

            expect(vehicle.stuntEffect).toBeTruthy();
            expect(vehicle.stuntChargeRing?.visible).toBe(true);

            vehicle.handlingState = 'grounded';
            vehicle.stuntState = 'reward';
            vehicle.stuntBoostMultiplier = 1.4;
            vehicle.lastStuntLanding = { type: 'clean', at: performance.now() };
            vehicle.updateEffects(0.016);

            expect(vehicle.stuntBoostFlares.every((flare) => flare.visible)).toBe(true);
            expect(vehicle.stuntLandingBurst?.visible).toBe(true);

            vehicle.stuntState = 'bad-landing';
            vehicle.stuntBoostMultiplier = 1;
            vehicle.stuntBadLandingUntil = performance.now() + 1000;
            vehicle.updateEffects(0.016);

            expect(vehicle.stuntBadCue?.visible).toBe(true);

            vehicle.reset({ x: 0, y: 1.5, z: 0, rotation: 0 });
            expect(vehicle.stuntEffect).toBeNull();
            expect(vehicle.stuntBoostFlares).toEqual([]);
        } finally {
            if (previousThree) {
                (globalThis as Record<string, unknown>).THREE = previousThree;
            } else {
                delete (globalThis as Record<string, unknown>).THREE;
            }
        }
    });

    it('charges wheelie time into a clean landing boost and ram bonus', () => {
        const physics = new PhysicsSystem();
        const vehicle = new Vehicle({ playerId: 'p1' });
        const wheelGrounded = [false, false, true, true];
        const controller = makeController(wheelGrounded);
        const body = makeBody();

        physics.vehicleBodies.set(vehicle.id, {
            body,
            controller,
            entity: vehicle,
            config: makePhysicsConfig(),
            previousHandlingState: 'grounded'
        });

        physics.applyVehicleControls(vehicle.id, { steering: 0, acceleration: 0, braking: 0 });
        expect(vehicle.handlingState).toBe('wheelie');

        const data = physics.vehicleBodies.get(vehicle.id);
        // @ts-ignore - private helper is covered directly for deterministic timing
        physics._updateStuntTimers(data, 0.5);
        expect(vehicle.stuntCharge).toBeCloseTo(0.5);
        expect(vehicle.stuntState).toBe('charging');

        wheelGrounded[0] = true;
        wheelGrounded[1] = true;
        physics.applyVehicleControls(vehicle.id, { steering: 0, acceleration: 1, braking: 0 });

        expect(vehicle.lastStuntLanding).toMatchObject({ type: 'clean' });
        expect(vehicle.stuntState).toBe('reward');
        expect(vehicle.stuntBoostMultiplier).toBeCloseTo(1.25);
        expect(vehicle.stuntRamDamageBonus).toBeCloseTo(10);
        expect(controller.setWheelEngineForce).toHaveBeenLastCalledWith(3, 125);
    });

    it('penalizes hard landings briefly without awarding stunt boost', () => {
        const physics = new PhysicsSystem();
        const vehicle = new Vehicle({ playerId: 'p1' });
        const wheelGrounded = [false, false, true, true];
        const controller = makeController(wheelGrounded);
        const body = makeBody({
            linvel: () => ({ x: 0, y: -12, z: 0 }),
            angvel: () => ({ x: 9, y: 0, z: 0 })
        });

        physics.vehicleBodies.set(vehicle.id, {
            body,
            controller,
            entity: vehicle,
            config: makePhysicsConfig(),
            previousHandlingState: 'grounded'
        });

        physics.applyVehicleControls(vehicle.id, { steering: 0, acceleration: 0, braking: 0 });
        const data = physics.vehicleBodies.get(vehicle.id);
        // @ts-ignore - private helper is covered directly for deterministic timing
        physics._updateStuntTimers(data, 0.5);

        wheelGrounded[0] = true;
        wheelGrounded[1] = true;
        physics.applyVehicleControls(vehicle.id, { steering: 1, acceleration: 1, braking: 0 });

        expect(vehicle.lastStuntLanding).toMatchObject({ type: 'bad' });
        expect(vehicle.stuntState).toBe('bad-landing');
        expect(vehicle.stuntBoostMultiplier).toBe(1);
        expect(vehicle.stuntRamDamageBonus).toBe(0);
        expect(controller.setWheelEngineForce).toHaveBeenLastCalledWith(3, 50);
        expect(controller.setWheelSteering).toHaveBeenLastCalledWith(1, -0.25);
    });
});

describe('Damage regressions', () => {
    it('includes the strongest nitro or stunt ram bonus in vehicle collision damage', () => {
        const damage = new DamageSystem({ collisionDamageMultiplier: 1 });
        const vehicleA = new Vehicle({ playerId: 'p1' });
        const vehicleB = new Vehicle({ playerId: 'p2' });

        vehicleA.velocity = { x: 10, y: 0, z: 0 };
        vehicleB.velocity = { x: 0, y: 0, z: 0 };
        vehicleA.stuntRamDamageBonus = 20;
        vehicleB.ramDamageBonus = 5;

        // @ts-ignore - private method is deterministic and cheaper than forcing a collision graph
        expect(damage._calculateCollisionDamage(vehicleA, vehicleB)).toBeCloseTo(32.5);
    });
});

describe('Camera mode regressions', () => {
    it('cycles party, chase, and hood modes without accepting invalid modes', () => {
        const render = new RenderSystem({ container: {} });

        expect(render.getCameraModeInfo().mode).toBe('party');
        expect(render.setCameraMode('banana')).toBe(false);
        expect(render.getCameraModeInfo().mode).toBe('party');

        expect(render.cycleCameraMode()).toBe('chase');
        expect(render.cycleCameraMode()).toBe('hood');
        expect(render.cycleCameraMode()).toBe('party');

        expect(render.setCameraMode('hood')).toBe(true);
        expect(render.getCameraModeInfo().mode).toBe('hood');
    });

    it('keeps a valid focus target as players are added, cycled, and removed', () => {
        const render = new RenderSystem({ container: {} });
        const first = { id: 1, playerId: 1, playerName: 'First' };
        const second = { id: 2, playerId: 2, playerName: 'Second' };

        render.addCameraTarget(first);
        render.addCameraTarget(second);
        expect(render.getCameraModeInfo()).toMatchObject({
            focusId: 1,
            focusName: 'First',
            targetCount: 2
        });

        render.setCameraFocus(2);
        expect(render.getCameraModeInfo()).toMatchObject({
            focusId: 2,
            focusName: 'Second'
        });

        render.cycleCameraFocus(1);
        expect(render.getCameraModeInfo().focusId).toBe(1);

        render.removeCameraTarget(first);
        expect(render.getCameraModeInfo()).toMatchObject({
            focusId: 2,
            targetCount: 1
        });

        render.clearCameraTargets();
        expect(render.getCameraModeInfo()).toMatchObject({
            focusId: null,
            targetCount: 0
        });
    });
});
