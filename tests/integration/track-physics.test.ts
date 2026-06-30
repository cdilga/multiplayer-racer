import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PhysicsSystem } from '../../static/js/systems/PhysicsSystem.js';
import { buildBowlGrid, bowlProfile } from '../../static/js/resources/bowlProfile.js';
import { generateTrackConfig } from '../../static/js/resources/ProceduralTrackGenerator.js';
import { generateSpawnsForTrack } from '../../static/js/resources/SpawnGenerator.js';
import { Track } from '../../static/js/entities/Track.js';
import { GameRunContext } from '../../static/js/engine/GameRunContext.js';

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

function makeRunContext(seed: number, ruleset: string = 'race') {
    return GameRunContext.create({
        seed,
        deterministic: true,
        ruleset
    });
}

function setupSpawnValidationPhysics(config: any) {
    const physics = makePhysics();

    if (config.geometry?.type === 'dunes') {
        physics.createTerrainBody(config);
    } else if (config.geometry?.type === 'bowl') {
        physics.createBowlBody(config);
    } else {
        physics.createGroundBody({
            size: config.visual?.ground?.size || 200,
            friction: config.physics?.groundFriction || 0.8
        });
    }

    physics.createBarrierBodies(config);
    physics.world.step();
    return physics;
}

function isSpawnWithinTrack(config: any, spawn: any) {
    const geometry = config.geometry || {};
    const x = spawn.position?.x ?? spawn.x ?? 0;
    const z = spawn.position?.z ?? spawn.z ?? 0;

    switch (geometry.type) {
        case 'oval': {
            const radius = Math.hypot(x, z);
            return radius >= geometry.innerRadius && radius <= geometry.outerRadius;
        }
        case 'square': {
            const half = (geometry.diameter || geometry.size || 70) / 2;
            return Math.abs(x) <= half && Math.abs(z) <= half;
        }
        case 'bowl': {
            const radius = (geometry.diameter || 80) / 2;
            return Math.hypot(x, z) <= radius;
        }
        case 'dunes': {
            return Math.hypot(x, z) <= (geometry.rimStart || geometry.radius || 70);
        }
        default:
            return true;
    }
}

function raycastSpawnSupport(physics: PhysicsSystem, spawn: any) {
    const origin = {
        x: spawn.position.x,
        y: spawn.position.y + 20,
        z: spawn.position.z
    };
    const ray = new RAPIER.Ray(origin, { x: 0, y: -1, z: 0 });
    const hit = physics.world.castRayAndGetNormal(ray, 80, true);

    if (!hit) return null;

    return {
        timeOfImpact: hit.timeOfImpact,
        point: ray.pointAt(hit.timeOfImpact),
        normal: hit.normal
    };
}

function maybeWriteSpawnEvidence(trackId: string, playerCount: number, payload: any) {
    const evidenceDir = process.env.SPAWN_EVIDENCE_DIR;
    if (!evidenceDir) return;

    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
        join(evidenceDir, `${trackId}-${playerCount}.json`),
        JSON.stringify(payload, null, 2)
    );
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

    describe('derby bowl floor trimesh (br-fb-bowltransition-3ij)', () => {
        function colliderShapeTypes(body: RAPIER.RigidBody) {
            return getBodyColliders(body).map((c) => c.shape.type);
        }

        it('builds the bowl floor as a single trimesh from the revolved profile (no flat cuboid)', () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-bowl');
            const body = physics.createBowlBody(config);

            expect(body).toBeTruthy();
            expect(physics.staticBodies.has('bowl')).toBe(true);
            // The floor collider is a trimesh, NOT the old flat cuboid ground.
            const shapes = colliderShapeTypes(body!);
            expect(shapes).toContain(RAPIER.ShapeType.TriMesh);
            expect(shapes).not.toContain(RAPIER.ShapeType.Cuboid);
            // GameHost routes 'bowl' to createBowlBody, so the flat ground body
            // is never registered for a bowl.
            expect(physics.staticBodies.has('ground')).toBe(false);
        });

        it('exposes diagnostics: concave (centre below rim), fillet/concavity knobs, collider source', async () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-bowl');
            physics.createBowlBody(config);

            const diag = physics.getBowlDiagnostics()!;
            expect(diag.colliderType).toBe('trimesh');
            expect(diag.source).toContain('buildBowlGrid');
            expect(diag.filletRadius).toBeGreaterThan(0);
            expect(diag.floorConcavity).toBeGreaterThan(0);
            expect(diag.triangleCount).toBeGreaterThan(0);

            const xs = diag.crossSection;
            const centre = xs[0];
            const rim = xs[xs.length - 1];
            // Concave bowl: centre sits BELOW the rim (not an inverted dome).
            expect(centre.y).toBeLessThan(rim.y);
            // Floor->fillet seam is flat on both sides (C1, no crease).
            expect(Math.abs(centre.slope)).toBeLessThan(1e-6);

            // Optional inspectable artifact (cross-section render data).
            const evidenceDir = process.env.BOWL_EVIDENCE_DIR;
            if (evidenceDir) {
                const { mkdirSync, writeFileSync } = await import('node:fs');
                const { join } = await import('node:path');
                mkdirSync(evidenceDir, { recursive: true });
                writeFileSync(join(evidenceDir, 'derby-bowl-diagnostics.json'), JSON.stringify(diag, null, 2));
            }
        });

        it('a ball dropped on the dish settles ON the trimesh (no fall-through) at the concave height', async () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-bowl');
            physics.createBowlBody(config);
            const { params } = buildBowlGrid(config.geometry);

            const radius = 0.6;
            const r0 = 10; // on the dish, well inside the seam
            const startY = bowlProfile(r0, params) + 6;
            const ballDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(r0, startY, 0);
            const ball = physics.world.createRigidBody(ballDesc);
            physics.world.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0.9), ball);

            for (let i = 0; i < 240; i++) physics.world.step();

            const t = ball.translation();
            const floorY = bowlProfile(Math.hypot(t.x, t.z), params);
            // Rests on the surface, not through it or at -infinity.
            expect(t.y).toBeGreaterThan(floorY - 0.2);
            expect(t.y).toBeLessThan(floorY + radius + 0.6);
            expect(Number.isFinite(t.y)).toBe(true);
        });

        it('is a real BOWL: a ball at rest on the slope rolls toward the centre, not outward', async () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-bowl');
            physics.createBowlBody(config);
            const { params } = buildBowlGrid(config.geometry);

            const radius = 0.6;
            const r0 = 22; // mid dish, on the inward-sloping floor
            const ballDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(r0, bowlProfile(r0, params) + radius + 0.05, 0)
                .setLinearDamping(0.2);
            const ball = physics.world.createRigidBody(ballDesc);
            physics.world.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0.9), ball);

            for (let i = 0; i < 240; i++) physics.world.step();

            const t = ball.translation();
            // Concave: gravity pulls the ball down-slope toward the centre, so
            // its radial distance shrinks. A dome (the old bug) would push it out.
            expect(Math.hypot(t.x, t.z)).toBeLessThan(r0 - 0.5);
        });

        it('retains speed crossing the floor->fillet seam - no dead-stop crease', async () => {
            const physics = makePhysics();
            const config = loadTrackConfig('derby-bowl');
            physics.createBowlBody(config);
            const { params } = buildBowlGrid(config.geometry);

            const radius = 0.6;
            const r0 = params.r1 - 3; // start just inside the seam on the flat dish
            const launchSpeed = 14;
            const ballDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(r0, bowlProfile(r0, params) + radius, 0)
                .setLinvel(launchSpeed, 0, 0); // driving outward toward the rim
            const ball = physics.world.createRigidBody(ballDesc);
            physics.world.createCollider(RAPIER.ColliderDesc.ball(radius).setFriction(0.9), ball);

            // Speed at the instant the ball crosses the seam radius r1 - the exact
            // spot the old hard crease (a ~60deg dihedral against a vertical lip)
            // dead-stopped cars. A smooth C1 join must let it pass with most of
            // its speed intact (it has only crossed ~3u of near-flat dish, so
            // friction/climb losses are tiny here).
            let speedAtSeam = -1;
            for (let i = 0; i < 120 && speedAtSeam < 0; i++) {
                physics.world.step();
                if (ball.translation().x >= params.r1) {
                    const v = ball.linvel();
                    speedAtSeam = Math.hypot(v.x, v.z);
                }
            }

            expect(speedAtSeam).toBeGreaterThan(0); // reached the seam at all
            // Retained the large majority of launch speed across the seam.
            expect(speedAtSeam).toBeGreaterThan(launchSpeed * 0.7);
        });
    });

    describe('Spawn validation (br-fb-spawncap-qi9)', () => {
        it('generates 32 and 64 validated spawns on shipped maps with real ground raycast support', () => {
            const trackIds = ['oval', 'derby-arena', 'derby-bowl', 'derby-coliseum', 'derby-dunes'];

            for (const trackId of trackIds) {
                const config = loadTrackConfig(trackId);
                const ruleset = config.type === 'derby' ? 'derby' : 'race';

                for (const playerCount of [32, 64]) {
                    const physics = setupSpawnValidationPhysics(config);
                    const track = new Track({ config });
                    const seed = 0x5A17 + playerCount + trackId.length;
                    const result = generateSpawnsForTrack(track, playerCount, makeRunContext(seed, ruleset));

                    expect(result.valid, `${trackId} ${playerCount} result.valid`).toBe(true);
                    expect(result.spawns).toHaveLength(playerCount);
                    expect(result.diagnostics.validation.valid, `${trackId} ${playerCount} kernel validation`).toBe(true);
                    expect(result.diagnostics.validation.minPairDistance, `${trackId} ${playerCount} min pair distance`)
                        .toBeGreaterThanOrEqual(3.5 - 0.01);

                    const evidence = {
                        trackId,
                        ruleset,
                        playerCount,
                        seed,
                        minPairDistance: result.diagnostics.validation.minPairDistance,
                        rejectedCandidates: result.diagnostics.rejectedCandidates,
                        spawns: [] as any[]
                    };

                    result.spawns.forEach((spawn: any, index: number) => {
                        expect(isSpawnWithinTrack(config, spawn), `${trackId} ${playerCount} spawn ${index} bounds`).toBe(true);
                        expect(Number.isFinite(spawn.headingRad), `${trackId} ${playerCount} spawn ${index} heading`).toBe(true);
                        expect(spawn.clearance, `${trackId} ${playerCount} spawn ${index} clearance`).toBeGreaterThanOrEqual(2 - 0.01);
                        expect(spawn.support.hit, `${trackId} ${playerCount} spawn ${index} support flag`).toBe(true);

                        const hit = raycastSpawnSupport(physics, spawn);
                        expect(hit, `${trackId} ${playerCount} spawn ${index} raycast hit`).not.toBeNull();
                        expect(hit!.normal.y, `${trackId} ${playerCount} spawn ${index} upward normal`).toBeGreaterThan(0.2);
                        expect(spawn.position.y - hit!.point.y, `${trackId} ${playerCount} spawn ${index} lift above ground`).toBeGreaterThan(0.5);

                        evidence.spawns.push({
                            id: spawn.id,
                            position: spawn.position,
                            headingRad: spawn.headingRad,
                            clearance: spawn.clearance,
                            support: spawn.support,
                            groundRaycast: {
                                hit: true,
                                timeOfImpact: hit!.timeOfImpact,
                                point: hit!.point,
                                normal: hit!.normal
                            }
                        });
                    });

                    maybeWriteSpawnEvidence(trackId, playerCount, evidence);
                }
            }
        });

        it('does not modulo-wrap and only serves player 17+ from a validated generated set', () => {
            const track = new Track({ config: loadTrackConfig('derby-arena') });
            expect(track.getSpawnPosition(16)).toBeNull();

            const generation = generateSpawnsForTrack(track, 64, makeRunContext(424242, 'derby'));
            expect(generation.valid).toBe(true);
            expect(track.setGeneratedSpawns(generation)).toBe(true);

            const spawn0 = track.getSpawnPosition(0)!;
            const spawn16 = track.getSpawnPosition(16)!;
            expect(Math.hypot(spawn16.x - spawn0.x, spawn16.z - spawn0.z)).toBeGreaterThan(1);
            expect(track.getSpawnPosition(64)).toBeNull();
        });
    });

    describe('Checkpoint gate integration (br-fb-checkpt-orient-0d9)', () => {
        it('derives sane fallback tangents and height bands for legacy oval checkpoints', () => {
            const track = new Track({ config: loadTrackConfig('oval') });
            const expectations = [
                { index: 0, tangent: { x: 1, z: 0 } },
                { index: 1, tangent: { x: 0, z: 1 } },
                { index: 2, tangent: { x: -1, z: 0 } },
                { index: 3, tangent: { x: 0, z: -1 } }
            ];

            expectations.forEach(({ index, tangent }) => {
                const checkpoint = track.getCheckpoint(index)!;
                expect(dotXZ(normalizeXZ(checkpoint.tangent), tangent)).toBeGreaterThan(0.999);
                expect(checkpoint.heightBand.min).toBeLessThan(checkpoint.heightBand.max);
            });
        });

        it('stores unit tangents and height bands for procedural checkpoints across curved seeds', () => {
            for (const seed of [12345, 54321, 20260630]) {
                const config = generateTrackConfig(undefined, makeRunContext(seed));
                expect(config.checkpoints.length).toBeGreaterThan(0);

                let curvedCheckpointCount = 0;
                for (const checkpoint of config.checkpoints) {
                    const tangentLength = Math.hypot(checkpoint.tangent.x, checkpoint.tangent.z);
                    expect(tangentLength).toBeCloseTo(1, 6);
                    expect(checkpoint.heightBand.min).toBeLessThan(checkpoint.heightBand.max);
                    if (Math.abs(checkpoint.tangent.x) > 0.1 && Math.abs(checkpoint.tangent.z) > 0.1) {
                        curvedCheckpointCount++;
                    }
                }
                expect(curvedCheckpointCount).toBeGreaterThan(0);
            }
        });

        it('bot following the centerline crosses checkpoints in order across curved procedural seeds', () => {
            for (const seed of [12345, 24680, 424242]) {
                const config = generateTrackConfig(undefined, makeRunContext(seed));
                const track = new Track({ config });
                const centerline = config.geometry.centerline;
                const checkpointCount = track.getCheckpointCount();

                expect(centerline.length).toBeGreaterThan(checkpointCount);

                const crossed: number[] = [];
                let prev = {
                    x: centerline[centerline.length - 1].x,
                    y: 1,
                    z: centerline[centerline.length - 1].z
                };

                for (const point of centerline) {
                    const curr = { x: point.x, y: 1, z: point.z };
                    const hits: number[] = [];

                    for (let checkpointIndex = 0; checkpointIndex < checkpointCount; checkpointIndex++) {
                        if (track.checkCrossing(prev, curr, checkpointIndex)) {
                            hits.push(checkpointIndex);
                        }
                    }

                    expect(hits.length).toBeLessThanOrEqual(1);
                    if (hits.length === 1) crossed.push(hits[0]);
                    prev = curr;
                }

                expect(crossed).toEqual(Array.from({ length: checkpointCount }, (_, i) => i));
            }
        });
    });
});
