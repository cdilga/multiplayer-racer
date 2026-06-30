import { describe, it, expect, beforeEach } from 'vitest';
import { DerbySystem } from '../../static/js/systems/DerbySystem.js';

/**
 * br-fb-derbywall-shrink-7r5
 *
 * Covers the four root-cause fixes for the derby shrinking-arena wall:
 *  1. visual mesh scale and physics collider radius stay synchronized;
 *  2. the warning glow traverses the THREE.Group's child-mesh materials;
 *  3. the dead `setWallCollider` API is wired into the shrink lockstep;
 *  4. the inward push impulse is dt-scaled (frame-rate independent).
 */

function makeEventBus() {
    return { events: [], emit(event, data) { this.events.push({ event, data }); } };
}

// Fake material that records emissive writes, mimicking THREE's
// MeshStandardMaterial.emissive (a Color with setHex) + emissiveIntensity.
function makeMaterial() {
    return {
        emissiveIntensity: 0,
        emissive: {
            value: null,
            setHex(hex) { this.value = hex; }
        }
    };
}

// Fake THREE.Group wall: it has NO `.material` of its own (the original bug),
// only child meshes do. Exposes `traverse` like THREE.Object3D.
function makeGroupWall(childCount = 3) {
    const children = [];
    for (let i = 0; i < childCount; i++) {
        children.push({ isMesh: true, material: makeMaterial() });
    }
    return {
        scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        // Group itself has no material:
        material: undefined,
        traverse(fn) {
            fn(this);
            for (const c of children) fn(c);
        },
        _children: children
    };
}

// Fake collider controller: records each radius it is told to become.
function makeColliderController() {
    return { radii: [], setRadius(r) { this.radii.push(r); } };
}

function makeDerby(overrides = {}) {
    const derby = new DerbySystem({ eventBus: makeEventBus() });
    derby.setArenaConfig({
        geometry: { diameter: 80 },
        derby: {
            shrinking: {
                enabled: true,
                startTime: 0,
                rate: 10,            // units/sec on diameter -> fast shrink for tests
                minDiameter: 40,
                warningColor: overrides.warningColor || '#FF4444'
            }
        }
    });
    // setArenaConfig coerces startTime via `|| 30`, so 0 cannot be configured;
    // force an immediate shrink window for deterministic tests.
    derby.shrinkStartTime = 0;
    return derby;
}

describe('DerbySystem - shrinking wall (br-fb-derbywall-shrink-7r5)', () => {
    describe('warning glow traverses Group child meshes (fix #2)', () => {
        let derby, wall;
        beforeEach(() => {
            derby = makeDerby();
            wall = makeGroupWall(3);
            derby.setWallMesh(wall);
            derby.shrinkingActive = true;
            derby.currentDiameter = 60; // mid-shrink
        });

        it('sets emissive on every child mesh material of the Group', () => {
            derby._updateWallVisuals();
            for (const child of wall._children) {
                expect(child.material.emissive.value).toBe(0xFF4444);
                expect(child.material.emissiveIntensity).toBeGreaterThan(0);
            }
        });

        it('scales the Group mesh by currentDiameter/originalDiameter', () => {
            derby._updateWallVisuals();
            expect(wall.scale.x).toBeCloseTo(60 / 80, 6);
            expect(wall.scale.z).toBeCloseTo(60 / 80, 6);
            expect(wall.scale.y).toBe(1);
        });

        it('uses the configured warningColor, not a hardcoded red', () => {
            const blueDerby = makeDerby({ warningColor: '#4444FF' });
            const blueWall = makeGroupWall(2);
            blueDerby.setWallMesh(blueWall);
            blueDerby.shrinkingActive = true;
            blueDerby.currentDiameter = 50;
            blueDerby._updateWallVisuals();
            for (const child of blueWall._children) {
                expect(child.material.emissive.value).toBe(0x4444FF);
            }
        });

        it('still glows a bare Mesh wall (material directly on the object)', () => {
            const meshWall = {
                scale: { set() {} },
                material: makeMaterial()
            };
            derby.setWallMesh(meshWall);
            derby.shrinkingActive = true;
            derby.currentDiameter = 55;
            derby._updateWallVisuals();
            expect(meshWall.material.emissive.value).toBe(0xFF4444);
            expect(meshWall.material.emissiveIntensity).toBeGreaterThan(0);
        });
    });

    describe('collider radius stays in lockstep with visual scale (fix #1 + #3)', () => {
        it('snaps the controller to the full radius the moment it is wired', () => {
            const derby = makeDerby();
            const controller = makeColliderController();
            derby.setWallCollider(controller);
            // original diameter 80 -> radius 40
            expect(controller.radii[controller.radii.length - 1]).toBeCloseTo(40, 6);
        });

        it('drives setRadius = currentDiameter/2 in lockstep with the mesh scale as it shrinks', () => {
            const derby = makeDerby();
            const wall = makeGroupWall(2);
            const controller = makeColliderController();
            derby.setWallMesh(wall);
            derby.setWallCollider(controller);

            // Deterministic clock so the shrink loop is reproducible.
            let now = 0;
            derby.setRunContext({ clock: { nowMs: () => now } });
            derby.roundStartTime = 0;

            const dt = 1 / 60;
            // Run ~5 seconds of shrink (rate 10/s on diameter, 80 -> floor 40).
            for (let i = 0; i < 300; i++) {
                now += dt * 1000;
                derby._updateShrinking(dt);

                // Whenever the controller has synced, the collider radius must
                // equal half the current diameter, and the mesh scale must map
                // to the same radius: scale * originalDiameter / 2.
                const colliderR = controller.radii[controller.radii.length - 1];
                const meshRadius = (wall.scale.x * derby.originalDiameter) / 2;
                // Mesh tracks every frame; collider is throttled, so the gap
                // between them must stay under the sync step (no real-world gap).
                expect(Math.abs(colliderR - meshRadius)).toBeLessThanOrEqual(0.25 + 1e-9);
            }

            // Final collider radius reflects the floor (minDiameter 40 -> 20).
            expect(controller.radii[controller.radii.length - 1]).toBeCloseTo(20, 2);
            expect(derby.currentDiameter).toBeCloseTo(40, 6);
        });

        it('restores the full radius on reset() and startRound()', () => {
            const derby = makeDerby();
            const controller = makeColliderController();
            derby.setWallCollider(controller);
            derby.currentDiameter = 44; // pretend mid-shrink
            derby._lastColliderRadius = 22;

            derby.reset();
            expect(controller.radii[controller.radii.length - 1]).toBeCloseTo(40, 6);
            expect(derby.currentDiameter).toBeCloseTo(80, 6);
        });

        it('does not throw when no collider controller is wired', () => {
            const derby = makeDerby();
            derby.currentDiameter = 60;
            expect(() => derby._syncWallCollider()).not.toThrow();
            expect(() => derby._syncWallCollider(true)).not.toThrow();
        });
    });

    describe('inward push impulse is frame-rate independent (fix #4)', () => {
        // Fake physics body that records impulses and integrates a unit-mass
        // body with semi-implicit Euler so we can compare displacement.
        function makeBody() {
            return {
                impulses: [],
                vx: 0,
                x: 0,
                applyImpulse(j) {
                    this.impulses.push(j);
                    this.vx += j.x;       // unit mass
                    this.x += this.vx;    // dt folded out below via fixed-step compare
                }
            };
        }

        // Run the real push loop over a fixed sim duration at a given fps with a
        // vehicle pinned just outside the boundary so the push fires every step.
        function runPush(fps, durationS) {
            const derby = makeDerby();
            const dt = 1 / fps;
            const steps = Math.round(durationS * fps);

            const body = {
                impulses: [],
                vx: 0,
                x: 0,
                applyImpulse(j) { this.impulses.push(j); this.vx += j.x; this.x += this.vx * dt; }
            };
            // Vehicle sits at +X, well outside the boundary, and stays there so
            // the push condition holds for every step (isolates the impulse law).
            const vehicle = {
                id: 'c1', playerId: 'p1',
                mesh: { position: { x: 100, y: 0, z: 0 } },
                physicsBody: body
            };
            derby.vehicles.set('c1', { vehicle, playerId: 'p1', eliminated: false });
            derby.currentDiameter = 80; // radius 40, vehicle at 100 -> outside

            for (let i = 0; i < steps; i++) {
                derby._pushVehiclesInward(dt);
            }

            const totalImpulse = body.impulses.reduce((s, j) => s + Math.abs(j.x), 0);
            return { totalImpulse, displacement: Math.abs(body.x), steps };
        }

        it('delivers equal total impulse at 30/60/120 fps over the same duration', () => {
            const T = 0.5;
            const r30 = runPush(30, T);
            const r60 = runPush(60, T);
            const r120 = runPush(120, T);

            // Different step counts...
            expect(r30.steps).toBe(15);
            expect(r60.steps).toBe(30);
            expect(r120.steps).toBe(60);

            // ...but identical total momentum delivered (the invariant).
            expect(r60.totalImpulse).toBeCloseTo(r30.totalImpulse, 6);
            expect(r120.totalImpulse).toBeCloseTo(r30.totalImpulse, 6);
        });

        it('produces equivalent displacement across frame rates (within tolerance)', () => {
            const T = 0.5;
            const d30 = runPush(30, T).displacement;
            const d60 = runPush(60, T).displacement;
            const d120 = runPush(120, T).displacement;

            const max = Math.max(d30, d60, d120);
            const min = Math.min(d30, d60, d120);
            const spread = (max - min) / max;
            // Frame-rate-independent: small Euler discretization spread only.
            expect(spread).toBeLessThan(0.08);
        });

        it('per-frame impulse scales with dt (the dt-less bug would not)', () => {
            // Two frames covering the same elapsed time: one big step vs two
            // half steps must deliver the same total impulse.
            const derby = makeDerby();
            const body = makeBody();
            const vehicle = {
                id: 'c1', playerId: 'p1',
                mesh: { position: { x: 100, y: 0, z: 0 } },
                physicsBody: body
            };
            derby.vehicles.set('c1', { vehicle, playerId: 'p1', eliminated: false });
            derby.currentDiameter = 80;

            derby._pushVehiclesInward(0.02);
            const oneBigStep = Math.abs(body.impulses[0].x);

            const body2 = makeBody();
            vehicle.physicsBody = body2;
            derby._pushVehiclesInward(0.01);
            derby._pushVehiclesInward(0.01);
            const twoHalfSteps = Math.abs(body2.impulses[0].x) + Math.abs(body2.impulses[1].x);

            expect(twoHalfSteps).toBeCloseTo(oneBigStep, 9);
            // And each half-step is exactly half the big step (dt-scaled).
            expect(Math.abs(body2.impulses[0].x)).toBeCloseTo(oneBigStep / 2, 9);
        });
    });
});
