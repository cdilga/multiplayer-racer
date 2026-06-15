import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Track } from '../../static/js/entities/Track.js';
import { TrackFactory } from '../../static/js/resources/TrackFactory.js';
import { WeaponSystem } from '../../static/js/systems/WeaponSystem.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const trackDir = resolve(__dirname, '../../static/assets/tracks');
const reviewedTracks = ['oval', 'derby-bowl', 'derby-arena', 'derby-coliseum', 'derby-dunes'];

function loadTrackConfig(trackId: string) {
    return JSON.parse(readFileSync(resolve(trackDir, `${trackId}.json`), 'utf8'));
}

function makeFactory() {
    return new TrackFactory({
        resourceLoader: {
            loadTrack: async (trackId: string) => loadTrackConfig(trackId)
        }
    });
}

function hasUserData(root: THREE.Object3D, key: string, value: unknown) {
    let found = false;
    root.traverse((child) => {
        if (child.userData?.[key] === value) found = true;
    });
    return found;
}

describe('track validation', () => {
    const previousThree = (globalThis as Record<string, unknown>).THREE;

    beforeAll(() => {
        (globalThis as Record<string, unknown>).THREE = THREE;
    });

    afterAll(() => {
        (globalThis as Record<string, unknown>).THREE = previousThree;
    });

    it.each(reviewedTracks)('creates a visible surface and barriers for %s', async (trackId) => {
        const factory = makeFactory();
        const trackData = await factory.create(trackId);

        expect(trackData.mesh).toBeInstanceOf(THREE.Group);
        expect(hasUserData(trackData.mesh, 'isTrackSurface', true)).toBe(true);
        expect(trackData.barriers.length).toBeGreaterThan(0);
    });

    it('renders the Iron Cage square arena as an arena floor with square walls', async () => {
        const factory = makeFactory();
        const trackData = await factory.create('derby-arena');

        expect(hasUserData(trackData.mesh, 'isSquareArena', true)).toBe(true);
        expect(trackData.barriers.some((barrier: THREE.Object3D) => barrier.userData?.barrierType === 'square-wall')).toBe(true);
    });

    it('renders oval stunt ramps as non-barrier track objects', async () => {
        const factory = makeFactory();
        const trackData = await factory.create('oval');
        const rampObjects = trackData.barriers.filter((object: THREE.Object3D) => object.userData?.isRamp);

        expect(rampObjects).toHaveLength(2);
        expect(rampObjects.every((object: THREE.Object3D) => !object.userData?.isBarrier)).toBe(true);
    });

    it.each(reviewedTracks)('keeps all configured spawns inside %s bounds', (trackId) => {
        const config = loadTrackConfig(trackId);
        const track = new Track({ config });

        for (const spawn of track.getAllSpawnPositions()) {
            expect(track.isOutOfBounds(spawn, 0), `${trackId} spawn ${JSON.stringify(spawn)}`).toBe(false);
        }
    });

    it('spawns Iron Cage pickups inside the square arena footprint', () => {
        const weaponSystem = new WeaponSystem();
        weaponSystem.setArenaConfig(loadTrackConfig('derby-arena'));

        expect(weaponSystem.spawnArea).toMatchObject({
            type: 'box',
            halfSize: 29
        });

        for (let i = 0; i < 50; i++) {
            const position = weaponSystem._getRandomSpawnPosition();
            expect(Math.abs(position.x)).toBeLessThanOrEqual(29);
            expect(Math.abs(position.z)).toBeLessThanOrEqual(29);
        }
    });
});
