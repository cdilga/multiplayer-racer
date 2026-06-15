import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PhysicsSystem } from '../../static/js/systems/PhysicsSystem.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const trackDir = resolve(__dirname, '../../static/assets/tracks');

function loadTrackConfig(trackId: string) {
    return JSON.parse(readFileSync(resolve(trackDir, `${trackId}.json`), 'utf8'));
}

function makePhysics() {
    const physics = new PhysicsSystem();
    physics.RAPIER = RAPIER;
    physics.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    return physics;
}

describe('track physics', () => {
    beforeAll(async () => {
        await RAPIER.init();
    });

    it('creates static square wall colliders for Iron Cage', () => {
        const physics = makePhysics();
        const barriers = physics.createBarrierBodies(loadTrackConfig('derby-arena'));

        expect(barriers).toHaveLength(1);
        expect(physics.staticBodies.has('barrier_square_wall')).toBe(true);
        expect(barriers[0].userData).toMatchObject({ type: 'barrier' });
    });

    it('creates oval ramp colliders alongside race barriers', () => {
        const physics = makePhysics();
        const barriers = physics.createBarrierBodies(loadTrackConfig('oval'));

        expect(barriers).toHaveLength(2);
        expect(physics.staticBodies.has('barrier_inner')).toBe(true);
        expect(physics.staticBodies.has('barrier_outer')).toBe(true);
        expect(physics.staticBodies.has('ramp_0')).toBe(true);
        expect(physics.staticBodies.has('ramp_1')).toBe(true);
    });

    it('creates matching dunes terrain and ramp colliders', () => {
        const physics = makePhysics();
        const config = loadTrackConfig('derby-dunes');
        const terrainBody = physics.createTerrainBody(config);
        const rampCount = config.geometry.ramps.length;

        expect(terrainBody).toBeTruthy();
        expect(physics.staticBodies.has('terrain')).toBe(true);
        for (let i = 0; i < rampCount; i++) {
            expect(physics.staticBodies.has(`ramp_${i}`)).toBe(true);
        }
    });
});
