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

function rotateVectorByQuat(
    q: { x: number; y: number; z: number; w: number },
    v: { x: number; y: number; z: number }
) {
    const qv = { x: q.x, y: q.y, z: q.z };
    const cross1 = {
        x: qv.y * v.z - qv.z * v.y,
        y: qv.z * v.x - qv.x * v.z,
        z: qv.x * v.y - qv.y * v.x
    };
    const t = { x: 2 * cross1.x, y: 2 * cross1.y, z: 2 * cross1.z };
    const cross2 = {
        x: qv.y * t.z - qv.z * t.y,
        y: qv.z * t.x - qv.x * t.z,
        z: qv.x * t.y - qv.y * t.x
    };

    return {
        x: v.x + q.w * t.x + cross2.x,
        y: v.y + q.w * t.y + cross2.y,
        z: v.z + q.w * t.z + cross2.z
    };
}

function normalizeXZ(v: { x: number; z: number }) {
    const length = Math.hypot(v.x, v.z) || 1;
    return { x: v.x / length, z: v.z / length };
}

function dotXZ(a: { x: number; z: number }, b: { x: number; z: number }) {
    return a.x * b.x + a.z * b.z;
}

function getBodyColliders(body: RAPIER.RigidBody) {
    const colliders: RAPIER.Collider[] = [];
    for (let i = 0; i < body.numColliders(); i++) {
        colliders.push(body.collider(i));
    }
    return colliders;
}

function getNonDegenerateSegments(points: { x: number; z: number }[]) {
    const segments: Array<{
        index: number;
        a: { x: number; z: number };
        b: { x: number; z: number };
        dx: number;
        dz: number;
    }> = [];

    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (Math.hypot(dx, dz) < 0.01) continue;
        segments.push({ index: i, a, b, dx, dz });
    }

    return segments;
}

function computeEdgesFromCenterline(centerline: { x: number; z: number }[], halfWidth: number) {
    const leftEdge: { x: number; z: number }[] = [];
    const rightEdge: { x: number; z: number }[] = [];

    for (let i = 0; i < centerline.length; i++) {
        const prev = centerline[(i - 1 + centerline.length) % centerline.length];
        const next = centerline[(i + 1) % centerline.length];
        const tangent = normalizeXZ({ x: next.x - prev.x, z: next.z - prev.z });
        const leftNormal = { x: -tangent.z, z: tangent.x };
        const point = centerline[i];

        leftEdge.push({
            x: point.x + leftNormal.x * halfWidth,
            z: point.z + leftNormal.z * halfWidth
        });
        rightEdge.push({
            x: point.x - leftNormal.x * halfWidth,
            z: point.z - leftNormal.z * halfWidth
        });
    }

    return { leftEdge, rightEdge };
}

function makeSimpleSplineConfig() {
    const centerline = [
        { x: -28, z: -12 },
        { x: -12, z: -20 },
        { x: 12, z: -20 },
        { x: 28, z: -12 },
        { x: 28, z: 12 },
        { x: 12, z: 20 },
        { x: -12, z: 20 },
        { x: -28, z: 12 }
    ];
    const { leftEdge, rightEdge } = computeEdgesFromCenterline(centerline, 6);

    return {
        geometry: {
            type: 'spline',
            centerline,
            leftEdge,
            rightEdge,
            barrierHeight: 1.4
        },
        physics: {
            barrierRestitution: 0.4
        }
    };
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

    it('keeps circular curb colliders tangent to the oval radius', () => {
        const physics = makePhysics();
        physics.createBarrierBodies(loadTrackConfig('oval'));

        for (const key of ['barrier_inner', 'barrier_outer']) {
            const body = physics.staticBodies.get(key);
            expect(body, `${key} should exist`).toBeTruthy();

            const colliders = getBodyColliders(body!);
            expect(colliders).toHaveLength(48);

            for (const collider of colliders) {
                const position = collider.translation();
                const radius = normalizeXZ({ x: position.x, z: position.z });
                const longAxis = normalizeXZ(
                    rotateVectorByQuat(collider.rotation(), { x: 1, y: 0, z: 0 })
                );
                const tangent = normalizeXZ({ x: -radius.z, z: radius.x });

                expect(Math.abs(dotXZ(longAxis, radius))).toBeLessThan(1e-5);
                expect(Math.abs(dotXZ(longAxis, tangent))).toBeGreaterThan(0.99999);
            }
        }
    });

    it('keeps spline barrier tangents aligned and normals pointed at the drivable side', () => {
        const physics = makePhysics();
        const config = makeSimpleSplineConfig();
        physics.createBarrierBodies(config);

        const cases = [
            {
                key: 'barrier_spline_left',
                points: config.geometry.leftEdge,
                expectedNormalSign: -1
            },
            {
                key: 'barrier_spline_right',
                points: config.geometry.rightEdge,
                expectedNormalSign: 1
            }
        ];

        for (const { key, points, expectedNormalSign } of cases) {
            const body = physics.staticBodies.get(key);
            expect(body, `${key} should exist`).toBeTruthy();

            const segments = getNonDegenerateSegments(points);
            const colliders = getBodyColliders(body!);
            expect(colliders).toHaveLength(segments.length);

            segments.forEach((segment, index) => {
                const collider = colliders[index];
                const longAxis = normalizeXZ(
                    rotateVectorByQuat(collider.rotation(), { x: 1, y: 0, z: 0 })
                );
                const normalAxis = normalizeXZ(
                    rotateVectorByQuat(collider.rotation(), { x: 0, y: 0, z: 1 })
                );
                const segmentDirection = normalizeXZ({ x: segment.dx, z: segment.dz });
                const edgeMidpoint = {
                    x: (segment.a.x + segment.b.x) / 2,
                    z: (segment.a.z + segment.b.z) / 2
                };
                const centerA = config.geometry.centerline[segment.index];
                const centerB = config.geometry.centerline[(segment.index + 1) % config.geometry.centerline.length];
                const centerMidpoint = {
                    x: (centerA.x + centerB.x) / 2,
                    z: (centerA.z + centerB.z) / 2
                };
                const toCenterline = normalizeXZ({
                    x: centerMidpoint.x - edgeMidpoint.x,
                    z: centerMidpoint.z - edgeMidpoint.z
                });
                const sideDot = dotXZ(normalAxis, toCenterline) * expectedNormalSign;

                expect(dotXZ(longAxis, segmentDirection)).toBeGreaterThan(0.9999);
                expect(sideDot).toBeGreaterThan(0.95);
            });
        }
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

    describe('derby shrink wall collider resize (br-fb-derbywall-shrink-7r5)', () => {
        function colliderRadialCenters(body: RAPIER.RigidBody) {
            return getBodyColliders(body).map((c) => {
                const t = c.translation();
                return Math.hypot(t.x, t.z);
            });
        }

        it('rebuilds the bowl wall collider ring in lockstep with the requested radius (no gap)', () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-bowl');
            physics.createBarrierBodies(config);

            const fullRadius = (config.geometry.diameter as number) / 2; // 40
            expect(physics.getArenaWallRadius()).toBeCloseTo(fullRadius, 6);

            const fullBody = physics.staticBodies.get('barrier_bowl_wall')!;
            const fullCenters = colliderRadialCenters(fullBody);
            expect(fullCenters.length).toBe(64);
            // Every segment centre sits at the same radial distance (the ring).
            const fullRing = fullCenters[0];
            for (const r of fullCenters) expect(r).toBeCloseTo(fullRing, 4);
            // Constant offset between collider ring and the wall radius (slope/height).
            const offset = fullRing - fullRadius;

            // Walk several shrink stages (early / mid / late).
            for (const radius of [38, 30, 22]) {
                const body = physics.setArenaWallRadius(radius)!;
                expect(body).toBeTruthy();
                expect(physics.getArenaWallRadius()).toBeCloseTo(radius, 6);

                const centers = colliderRadialCenters(body);
                expect(centers.length).toBe(64);
                for (const r of centers) {
                    // Ring radius tracks the requested radius 1:1 (same offset),
                    // i.e. the collider moved inward with the visual wall - no
                    // invisible old wall left behind, no phase-through gap.
                    expect(r - radius).toBeCloseTo(offset, 3);
                }
                // The body is still tagged for the wall-slide assist.
                expect(body.userData).toMatchObject({ type: 'barrier' });
                // Exactly one wall body remains under the key (old one removed).
                expect(physics.staticBodies.get('barrier_bowl_wall')).toBe(body);
            }
        });

        it('rebuilds the square arena wall at the requested half-size', () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-arena'); // type: square, diameter 70
            physics.createBarrierBodies(config);

            const fullRadius = (config.geometry.diameter as number) / 2; // 35
            expect(physics.getArenaWallRadius()).toBeCloseTo(fullRadius, 6);

            for (const radius of [30, 24, 18]) {
                const body = physics.setArenaWallRadius(radius)!;
                expect(body).toBeTruthy();
                expect(physics.getArenaWallRadius()).toBeCloseTo(radius, 6);

                // Each of the 4 walls is centred at half-size (== radius) on one axis.
                for (const collider of getBodyColliders(body)) {
                    const t = collider.translation();
                    const half = Math.max(Math.abs(t.x), Math.abs(t.z));
                    expect(half).toBeCloseTo(radius, 4);
                }
                expect(body.userData).toMatchObject({ type: 'barrier' });
            }
        });

        it('returns null and is inert when the track has no resizable arena wall', () => {
            const physics = makePhysics();
            physics.createBarrierBodies(loadTrackConfig('oval'));
            expect(physics.getArenaWallRadius()).toBeNull();
            expect(physics.setArenaWallRadius(20)).toBeNull();
        });

        it('ignores non-positive radii', () => {
            const physics = makePhysics();
            physics.createBarrierBodies(loadTrackConfig('derby-bowl'));
            expect(physics.setArenaWallRadius(0)).toBeNull();
            expect(physics.setArenaWallRadius(-5)).toBeNull();
        });
    });

    describe('Spawn validation (no modulo wrapping)', () => {
        it('track spawn positions are defined', () => {
            const config = loadTrackConfig('oval');
            const spawnCount = config.spawn?.positions?.length ?? 0;

            expect(spawnCount).toBeGreaterThan(0);
        });

        it('spawn set contains expected spawn structure', () => {
            const config = loadTrackConfig('oval');
            const spawns = config.spawn?.positions || [];

            expect(spawns.length).toBeGreaterThan(0);

            // Each spawn should have x, z position
            spawns.forEach((spawn: any, idx: number) => {
                expect(spawn.x).toBeDefined();
                expect(spawn.z).toBeDefined();
                expect(typeof spawn.x).toBe('number');
                expect(typeof spawn.z).toBe('number');
            });
        });

        it('spawn positions are distinct (not all at same location)', () => {
            const config = loadTrackConfig('derby-dunes');
            const spawns = config.spawn?.positions || [];

            expect(spawns.length).toBeGreaterThan(1);

            // Compute pairwise distances
            let allIdentical = true;
            for (let i = 0; i < spawns.length; i++) {
                for (let j = i + 1; j < spawns.length; j++) {
                    const dx = spawns[i].x - spawns[j].x;
                    const dz = spawns[i].z - spawns[j].z;
                    const dist = Math.hypot(dx, dz);
                    if (dist > 0.1) {
                        allIdentical = false;
                    }
                }
            }

            // Spawns should not all be identical
            expect(allIdentical).toBe(false);
        });

        it('all shipped tracks have spawn positions', () => {
            const trackIds = ['oval', 'derby-dunes', 'derby-arena'];

            trackIds.forEach(trackId => {
                const config = loadTrackConfig(trackId);
                const spawns = config.spawn?.positions || [];
                expect(spawns.length).toBeGreaterThan(0);
            });
        });
    });
});
