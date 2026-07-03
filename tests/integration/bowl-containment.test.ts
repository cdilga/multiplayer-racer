import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildBowlGrid, resolveBowlParams, bowlProfile } from '../../static/js/resources/bowlProfile.js';

/**
 * br-bowl-containment-lip — REAL Rapier containment sim (not geometry-only).
 *
 * Builds the bowl trimesh (the same buildBowlGrid that feeds the render mesh) and
 * fires car-sized bodies at the rim from many angles/speeds. With the vertical
 * wall + flat lip, the vast majority must NOT escape over the rim. This is the
 * behavioral proof the anti-narrowing clause demands.
 */

const BOWL = { diameter: 80, floorConcavity: 0.1, filletRadius: 8, wallHeight: 15, lipWidth: 2.5 };

beforeAll(async () => {
    await RAPIER.init();
});

function makeWorld() {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const grid = buildBowlGrid(BOWL);
    const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
        RAPIER.ColliderDesc.trimesh(grid.vertices, grid.indices).setFriction(0.9).setRestitution(0.1),
        floor
    );
    return world;
}

/** Fire one car-sized body outward at the rim; return true if it stays contained. */
function launchAndCheck(world: RAPIER.World, angleRad: number, speed: number, rp: any) {
    const carRadius = 1.2;
    const startR = rp.R - 4;                 // just inside the rim
    const rimY = bowlProfile(rp.R, rp);
    const x = Math.cos(angleRad) * startR;
    const z = Math.sin(angleRad) * startR;
    const y = rimY + 3;

    const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true)
    );
    world.createCollider(RAPIER.ColliderDesc.ball(carRadius).setRestitution(0.2), body);
    // Hurl it outward (radially) and slightly up, like a rammed car.
    body.setLinvel({ x: Math.cos(angleRad) * speed, y: speed * 0.4, z: Math.sin(angleRad) * speed }, true);

    let escaped = false;
    const escapeR = rp.R + rp.lipWidth + carRadius + 4; // clearly past the lip
    for (let step = 0; step < 180; step++) {
        world.step();
        const p = body.translation();
        const horiz = Math.hypot(p.x, p.z);
        if (horiz > escapeR || p.y > rimY + rp.wallHeight + 8) {
            escaped = true;
            break;
        }
    }
    world.removeRigidBody(body);
    return !escaped;
}

describe('bowl containment sim (bowl-containment-lip)', () => {
    it('the built profile has a vertical wall and a flat lip past the rim', () => {
        const rp = resolveBowlParams(BOWL);
        const grid = buildBowlGrid(BOWL);
        let maxY = -Infinity;
        let maxR = 0;
        for (let i = 0; i < grid.vertices.length; i += 3) {
            maxY = Math.max(maxY, grid.vertices[i + 1]);
            maxR = Math.max(maxR, Math.hypot(grid.vertices[i], grid.vertices[i + 2]));
        }
        // Wall rises a full wallHeight above the rim; the lip extends past R.
        expect(maxY).toBeGreaterThan(bowlProfile(rp.R, rp) + rp.wallHeight - 0.01);
        expect(maxR).toBeGreaterThan(rp.R);
    });

    it('contains the vast majority of rim impacts (>= 80%)', () => {
        const rp = resolveBowlParams(BOWL);
        const angles = 16;
        const speeds = [22, 30, 38];
        let contained = 0;
        let total = 0;
        for (let a = 0; a < angles; a++) {
            const angle = (a / angles) * Math.PI * 2;
            for (const speed of speeds) {
                const world = makeWorld();
                if (launchAndCheck(world, angle, speed, rp)) contained += 1;
                total += 1;
                world.free();
            }
        }
        const rate = contained / total;
        // Behavioral pass rate: the wall + lip keep almost all rammed cars in.
        expect(rate).toBeGreaterThanOrEqual(0.8);
    });
});
