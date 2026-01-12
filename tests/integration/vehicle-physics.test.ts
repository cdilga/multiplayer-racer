import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';

describe('Vehicle Physics', () => {
    let world: RAPIER.World;
    let vehicleBody: RAPIER.RigidBody;

    beforeAll(async () => {
        await RAPIER.init();
    });

    beforeEach(() => {
        world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

        // Create ground
        const groundDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
        world.createCollider(groundDesc);

        // Create vehicle body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 1, 0);
        vehicleBody = world.createRigidBody(bodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(1, 0.5, 2);
        world.createCollider(colliderDesc, vehicleBody);
    });

    it('should accelerate when force is applied', () => {
        const initialZ = vehicleBody.translation().z;

        // Apply forward force for several physics steps
        for (let i = 0; i < 60; i++) {
            vehicleBody.addForce({ x: 0, y: 0, z: -100 }, true);
            world.step();
        }

        const finalZ = vehicleBody.translation().z;
        expect(finalZ).toBeLessThan(initialZ); // Moved forward (negative Z)
    });

    it('should decelerate when braking force is applied', () => {
        // Give initial velocity
        vehicleBody.setLinvel({ x: 0, y: 0, z: -10 }, true);

        // Apply braking (damping simulation)
        for (let i = 0; i < 60; i++) {
            const vel = vehicleBody.linvel();
            vehicleBody.setLinvel({
                x: vel.x * 0.95,
                y: vel.y,
                z: vel.z * 0.95
            }, true);
            world.step();
        }

        const finalVel = vehicleBody.linvel();
        expect(Math.abs(finalVel.z)).toBeLessThan(5);
    });

    it('should reset position and velocity', () => {
        const spawnPos = { x: 0, y: 1, z: 0 };

        // Move and rotate the vehicle
        vehicleBody.setTranslation({ x: 50, y: 10, z: -100 }, true);
        vehicleBody.setLinvel({ x: 5, y: 2, z: -20 }, true);

        // Reset
        vehicleBody.setTranslation(spawnPos, true);
        vehicleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

        const pos = vehicleBody.translation();
        const vel = vehicleBody.linvel();

        expect(pos.x).toBeCloseTo(spawnPos.x);
        expect(pos.y).toBeCloseTo(spawnPos.y);
        expect(pos.z).toBeCloseTo(spawnPos.z);
        expect(vel.x).toBeCloseTo(0);
        expect(vel.z).toBeCloseTo(0);
    });

    it('should detect upside-down orientation', () => {
        // Initially upright
        const initialRotation = vehicleBody.rotation();

        // Calculate up vector (y-axis transformed by quaternion)
        // For identity quaternion, up is (0, 1, 0)
        const q = initialRotation;
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        expect(upY).toBeGreaterThan(0.5); // Upright

        // Flip upside down (180 degrees around Z axis)
        vehicleBody.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);

        const flippedRotation = vehicleBody.rotation();
        const qFlipped = flippedRotation;
        const upYFlipped = 1 - 2 * (qFlipped.x * qFlipped.x + qFlipped.z * qFlipped.z);
        expect(upYFlipped).toBeLessThan(-0.5); // Upside down
    });

    it('should reset orientation when flipped upside down', () => {
        const spawnPos = { x: 0, y: 1, z: 0 };
        const spawnRotation = { x: 0, y: 0, z: 0, w: 1 }; // Identity quaternion (upright)

        // Move and flip the vehicle upside down
        vehicleBody.setTranslation({ x: 10, y: 5, z: -20 }, true);
        vehicleBody.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // 180 deg around Z
        vehicleBody.setLinvel({ x: 5, y: 2, z: -10 }, true);
        vehicleBody.setAngvel({ x: 1, y: 2, z: 3 }, true);

        // Verify it's upside down before reset
        const flippedQ = vehicleBody.rotation();
        const upYFlipped = 1 - 2 * (flippedQ.x * flippedQ.x + flippedQ.z * flippedQ.z);
        expect(upYFlipped).toBeLessThan(-0.5); // Upside down

        // Reset position, rotation, and velocities (simulates game's resetVehicleToSpawn)
        vehicleBody.setTranslation(spawnPos, true);
        vehicleBody.setRotation(spawnRotation, true);
        vehicleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        vehicleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Verify upright after reset
        const resetQ = vehicleBody.rotation();
        const upYReset = 1 - 2 * (resetQ.x * resetQ.x + resetQ.z * resetQ.z);
        expect(upYReset).toBeGreaterThan(0.5); // Upright

        // Verify position
        const pos = vehicleBody.translation();
        expect(pos.x).toBeCloseTo(spawnPos.x);
        expect(pos.y).toBeCloseTo(spawnPos.y);
        expect(pos.z).toBeCloseTo(spawnPos.z);

        // Verify velocities are zeroed
        const linvel = vehicleBody.linvel();
        const angvel = vehicleBody.angvel();
        expect(linvel.x).toBeCloseTo(0);
        expect(linvel.y).toBeCloseTo(0);
        expect(linvel.z).toBeCloseTo(0);
        expect(angvel.x).toBeCloseTo(0);
        expect(angvel.y).toBeCloseTo(0);
        expect(angvel.z).toBeCloseTo(0);
    });
});
