/**
 * PhysicsSystem - Manages Rapier physics world
 *
 * Responsibilities:
 * - Initialize and step Rapier world
 * - Create physics bodies for vehicles and track
 * - Apply vehicle controls via DynamicRayCastVehicleController
 * - Emit collision events
 *
 * Usage:
 *   const physics = new PhysicsSystem({ eventBus });
 *   await physics.init();
 *   physics.createVehicleBody(vehicle, vehicleConfig.physics);
 *   // In game loop:
 *   physics.update(dt);
 */

import { buildDunesGrid } from '../resources/terrain.js';
import { buildBowlGrid, bowlCrossSection } from '../resources/bowlProfile.js';
import {
    computeSteeringAuthority,
    DEFAULT_STEERING_AUTHORITY_CONFIG
} from './steeringAuthority.js';
import { computeSteeringAssist } from './steeringAssist.js';

class PhysicsSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.defaultControlStepSeconds = options.controlStepSeconds ?? (1 / 60);
        this._lastUpdateDt = this.defaultControlStepSeconds;

        // Rapier module reference
        this.RAPIER = null;

        // Physics world
        this.world = null;

        // Tracked bodies
        this.vehicleBodies = new Map();  // vehicleId -> { body, controller }
        this.staticBodies = new Map();   // bodyId -> body

        // Arena wall rebuild spec, captured when the shrinking arena wall is
        // built so the collider can be resized in lockstep with the derby
        // shrink. Null when the active track has no resizable arena wall.
        this._arenaWall = null;

        // Collision handling
        this.collisionEvents = [];
        this.eventQueue = null;

        // State
        this.initialized = false;
        this.paused = false;
    }

    /**
     * Initialize Rapier and create world
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        console.log('PhysicsSystem: Initializing...');

        // Wait for Rapier to be available
        this.RAPIER = await this._loadRapier();

        if (!this.RAPIER) {
            throw new Error('PhysicsSystem: Failed to load Rapier');
        }

        // Create world with gravity
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new this.RAPIER.World(gravity);

        // Create event queue for collision detection
        this.eventQueue = new this.RAPIER.EventQueue(true);

        this.initialized = true;
        this._emit('physics:ready');
        console.log('PhysicsSystem: Ready');
    }

    /**
     * Load Rapier module
     * @private
     */
    async _loadRapier() {
        // Check if already loaded globally
        if (window.RAPIER) {
            return window.RAPIER;
        }

        try {
            const rapierModule = await import('@dimforge/rapier3d-compat');
            await rapierModule.init();
            window.RAPIER = rapierModule;
            return rapierModule;
        } catch (error) {
            console.error('PhysicsSystem: Error loading Rapier:', error);
            return null;
        }
    }

    /**
     * Update physics (called each fixed timestep)
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.initialized || this.paused || !this.world) return;
        if (Number.isFinite(dt) && dt > 0) {
            this._lastUpdateDt = dt;
        }

        // Update vehicle controllers (skip disabled/dead bodies)
        for (const [vehicleId, data] of this.vehicleBodies) {
            if (data.controller && (!data.body.isEnabled || data.body.isEnabled())) {
                data.controller.updateVehicle(dt);
            }
        }

        // Step the physics world
        this.world.step(this.eventQueue);

        // Process collision events
        this._processCollisions();

        // Flag wall contact so applyVehicleControls can drop tyre grip and let
        // the car slide along a wall instead of the rail-locked tyres pinning
        // it in place. Polled from the contact graph each step so it self-clears
        // (no reliance on catching every start/stop collision event).
        for (const [vehicleId, data] of this.vehicleBodies) {
            if (!data.entity || !data.chassisCollider) continue;
            let touchingWall = false;
            this.world.contactPairsWith(data.chassisCollider, (other) => {
                if (other?.parent()?.userData?.type === 'barrier') touchingWall = true;
            });
            data.entity.inWallContact = touchingWall;
        }

        // Sync vehicle entities from physics and update state duration
        for (const [vehicleId, data] of this.vehicleBodies) {
            if (data.entity) {
                data.entity.syncEntityFromPhysics();
                data.entity.stateDuration += dt;
                this._updateStuntTimers(data, dt);
            }
        }
    }

    /**
     * Convert local position to world position
     * @private
     */
    _localToWorld(localPos, bodyPos, bodyRot) {
        // Rotate local point by quaternion
        // q * v * q^-1
        const x = localPos.x, y = localPos.y, z = localPos.z;
        const qx = bodyRot.x, qy = bodyRot.y, qz = bodyRot.z, qw = bodyRot.w;

        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;

        const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
        const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
        const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

        return {
            x: rx + bodyPos.x,
            y: ry + bodyPos.y,
            z: rz + bodyPos.z
        };
    }

    /**
     * Create ground physics body
     * @param {Object} config - Ground configuration
     * @returns {Object} Rapier rigid body
     */
    /**
     * Cast a ray straight down from above a point and report the first static hit.
     * Used by host-start arena validation (n47) to prove every spawn has ground
     * beneath it before any car is placed.
     * @param {{x:number,y:number,z:number}} position
     * @param {number} [maxDistance] - how far below the start to accept a hit
     * @param {number} [startAbove] - how far above the point to originate the ray
     * @returns {{hit:boolean, distance:(number|null), point:(Object|null)}|null}
     */
    raycastDown(position, maxDistance = 50, startAbove = 5) {
        if (!this.RAPIER || !this.world) return null;
        const origin = { x: position.x ?? 0, y: (position.y ?? 0) + startAbove, z: position.z ?? 0 };
        const ray = new this.RAPIER.Ray(origin, { x: 0, y: -1, z: 0 });
        const hit = this.world.castRay(ray, maxDistance + startAbove, true);
        if (!hit) return { hit: false, distance: null, point: null };
        const toi = hit.timeOfImpact ?? hit.toi;
        return {
            hit: true,
            distance: toi,
            point: { x: origin.x, y: origin.y - toi, z: origin.z }
        };
    }

    createGroundBody(config = {}) {
        if (!this.RAPIER || !this.world) return null;

        const size = config.size || 200;

        // Create static rigid body for ground
        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, 0, 0);
        const body = this.world.createRigidBody(bodyDesc);

        // Create collider (large flat box)
        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(size / 2, 0.1, size / 2)
            .setFriction(config.friction || 0.8)
            .setRestitution(config.restitution || 0.0);
        this.world.createCollider(colliderDesc, body);

        this.staticBodies.set('ground', body);
        return body;
    }

    /**
     * Create rolling dunes terrain as a static trimesh, plus launch ramps.
     * The trimesh is built from the SAME vertex grid as the visual mesh
     * (resources/terrain.js), so collision matches what the player sees.
     * @param {Object} trackConfig - Track configuration (geometry.type === 'dunes')
     * @returns {Object} Rapier rigid body for the terrain
     */
    createTerrainBody(trackConfig) {
        if (!this.RAPIER || !this.world) return null;

        const geometry = trackConfig.geometry || {};
        const physics = trackConfig.physics || {};
        const { vertices, indices } = buildDunesGrid(geometry);

        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);

        const colliderDesc = this.RAPIER.ColliderDesc
            .trimesh(vertices, indices)
            .setFriction(physics.groundFriction || 0.9)
            .setRestitution(0.0);
        this.world.createCollider(colliderDesc, body);

        this.staticBodies.set('terrain', body);

        // Launch ramps
        const ramps = geometry.ramps || [];
        const base = geometry.base || 0;
        ramps.forEach((ramp, i) => this._createRampCollider(ramp, base, i));

        return body;
    }

    /**
     * Create the derby bowl floor as a static trimesh, built from the SAME
     * vertex grid as the visual mesh (resources/bowlProfile.js) so collision
     * matches what the player sees. Replaces the old flat cuboid ground that
     * had no relation to the concave-looking floor. The moving shrink wall
     * (br-fb-derbywall-shrink-7r5) still owns containment above the rim; this
     * body is only the static driven surface (the static floor->wall join).
     * @param {Object} trackConfig - Track configuration (geometry.type === 'bowl')
     * @returns {Object} Rapier rigid body for the bowl floor
     */
    createBowlBody(trackConfig) {
        if (!this.RAPIER || !this.world) return null;

        const geometry = trackConfig.geometry || {};
        const physics = trackConfig.physics || {};
        const { vertices, indices, params } = buildBowlGrid(geometry);

        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);

        const colliderDesc = this.RAPIER.ColliderDesc
            .trimesh(vertices, indices)
            .setFriction(physics.groundFriction || 0.9)
            .setRestitution(0.0);
        this.world.createCollider(colliderDesc, body);

        this.staticBodies.set('bowl', body);

        // Inspectable diagnostics for the cross-section / debug overlay.
        this._bowlDiagnostics = {
            source: 'bowlProfile.buildBowlGrid',
            colliderType: 'trimesh',
            vertexCount: vertices.length / 3,
            triangleCount: indices.length / 3,
            radius: params.R,
            floorConcavity: params.floorConcavity,
            floorDepth: params.floorDepth,
            filletRadius: params.filletRadius,
            seamRadius: params.r1,
            crossSection: bowlCrossSection(params, 24)
        };

        return body;
    }

    /**
     * Diagnostics for the most recently built bowl floor (collider source,
     * fillet/concavity knobs, cross-section). Null until a bowl is built.
     * @returns {Object|null}
     */
    getBowlDiagnostics() {
        return this._bowlDiagnostics || null;
    }

    /**
     * Create a single ramp wedge collider. Orientation matches the visual
     * ramp mesh in TrackFactory (yaw to heading, then pitch up).
     * @private
     */
    _createRampCollider(ramp, base, idx) {
        const length = ramp.length || 10;
        const width = ramp.width || 7;
        const rise = ramp.rise || 3;
        const thickness = 0.6;
        const pitch = Math.atan2(rise, length);
        const slantLen = Math.sqrt(length * length + rise * rise);

        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);

        // q = yaw(heading) * pitch(-pitch about local X)
        const q = this._quatMul(
            this._quatFromAxisAngle(0, 1, 0, ramp.heading || 0),
            this._quatFromAxisAngle(1, 0, 0, -pitch)
        );

        const colliderDesc = this.RAPIER.ColliderDesc
            .cuboid(width / 2, thickness / 2, slantLen / 2)
            .setTranslation(ramp.x, base + thickness / 2 + rise / 2, ramp.z)
            .setRotation(q)
            .setFriction(0.9)
            .setRestitution(0.1);

        this.world.createCollider(colliderDesc, body);
        this.staticBodies.set(`ramp_${idx}`, body);
    }

    /**
     * Create barrier physics bodies
     * @param {Object} trackConfig - Track configuration
     * @returns {Object[]} Array of rigid bodies
     */
    createBarrierBodies(trackConfig) {
        if (!this.RAPIER || !this.world) return [];

        const barriers = [];
        const geometry = trackConfig.geometry;
        const physics = trackConfig.physics || {};

        // Reset any arena-wall resize spec from a previous track.
        this._arenaWall = null;

        if (geometry.type === 'oval') {
            // Create inner and outer circular barriers
            const innerBarrier = this._createCircularBarrier(
                geometry.innerRadius,
                geometry.barrierHeight || 2,
                geometry.barrierThickness || 0.5,
                physics.barrierRestitution || 0.3,
                'inner'
            );
            const outerBarrier = this._createCircularBarrier(
                geometry.outerRadius,
                geometry.barrierHeight || 2,
                geometry.barrierThickness || 0.5,
                physics.barrierRestitution || 0.3,
                'outer'
            );

            if (innerBarrier) barriers.push(innerBarrier);
            if (outerBarrier) barriers.push(outerBarrier);
        } else if (geometry.type === 'bowl') {
            // Create bowl arena wall - a sloped, climbable bank (matches the
            // visual cone) so cars can ride up the edges and catch air. The
            // steep angle still contains them.
            const diameter = geometry.diameter || 80;
            const radius = diameter / 2;
            const wallHeight = geometry.wallHeight || 15;
            const wallSlope = geometry.wallSlope || 30;

            const bowlRestitution = physics.barrierRestitution || 0.5;
            const bowlWall = this._createBowlWallBarrier(
                radius,
                wallHeight,
                wallSlope,
                bowlRestitution
            );

            if (bowlWall) {
                barriers.push(bowlWall);
                this._arenaWall = {
                    kind: 'bowl', key: 'barrier_bowl_wall', radius,
                    height: wallHeight, slope: wallSlope, restitution: bowlRestitution
                };
            }
        } else if (geometry.type === 'square') {
            const size = geometry.diameter || geometry.size || 70;
            const wallHeight = geometry.wallHeight || geometry.barrierHeight || 12;
            const wallThickness = geometry.barrierThickness || 1;
            const squareRestitution = physics.barrierRestitution || 0.5;
            const squareWall = this._createSquareBarrier(
                size,
                wallHeight,
                wallThickness,
                squareRestitution
            );
            if (squareWall) {
                barriers.push(squareWall);
                this._arenaWall = {
                    kind: 'square', key: 'barrier_square_wall', size,
                    height: wallHeight, thickness: wallThickness, restitution: squareRestitution
                };
            }
        } else if (geometry.type === 'dunes') {
            // Tall containment wall at the dunes arena edge
            const radius = geometry.radius || 70;
            const wallHeight = geometry.wallHeight || 14;
            const dunesRestitution = physics.barrierRestitution || 0.4;
            const dunesWall = this._createBowlWallBarrier(
                radius,
                wallHeight,
                20,
                dunesRestitution
            );
            if (dunesWall) {
                barriers.push(dunesWall);
                this._arenaWall = {
                    kind: 'bowl', key: 'barrier_bowl_wall', radius,
                    height: wallHeight, slope: 20, restitution: dunesRestitution
                };
            }
        } else if (geometry.type === 'spline') {
            // Procedural track: barrier walls along both precomputed edges
            const height = geometry.barrierHeight || 1.5;
            const restitution = physics.barrierRestitution || 0.4;

            const innerBarrier = this._createEdgeBarrier(geometry.leftEdge, height, restitution, 'spline_left');
            const outerBarrier = this._createEdgeBarrier(geometry.rightEdge, height, restitution, 'spline_right');

            if (innerBarrier) barriers.push(innerBarrier);
            if (outerBarrier) barriers.push(outerBarrier);
        }

        // Map-authored ramps use their own static bodies. Dunes create ramp
        // colliders with the terrain body because their base height is raised;
        // other tracks add them alongside barrier creation.
        if (geometry.type !== 'dunes') {
            const base = geometry.base || 0;
            (geometry.ramps || []).forEach((ramp, i) => this._createRampCollider(ramp, base, i));
        }

        // Tag barriers so the wall-slide assist can recognise wall contacts.
        barriers.forEach((b) => { if (b) b.userData = { type: 'barrier' }; });

        return barriers;
    }

    /**
     * Create barrier colliders along a closed loop of edge points
     * @private
     * @param {Object[]} points - [{x, z}, ...] closed loop
     * @param {number} height
     * @param {number} restitution
     * @param {string} key - staticBodies key
     */
    _createEdgeBarrier(points, height, restitution, key) {
        if (!points || points.length < 2) return null;

        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);

        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];

            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const length = Math.sqrt(dx * dx + dz * dz);
            if (length < 0.01) continue;

            const midX = (a.x + b.x) / 2;
            const midZ = (a.z + b.z) / 2;
            // Yaw so the segment's local X axis aligns with the edge tangent.
            const yaw = this._yawFromDirection(dx, dz);

            const colliderDesc = this.RAPIER.ColliderDesc
                .cuboid(length / 2 + 0.3, height / 2, 0.5)
                .setTranslation(midX, height / 2, midZ)
                .setRotation(this._eulerToQuat(0, yaw, 0));
            this._makeWallSlippery(colliderDesc, 0.15, restitution);

            this.world.createCollider(colliderDesc, body);
        }

        this.staticBodies.set(`barrier_${key}`, body);
        return body;
    }

    /**
     * Configure a wall collider so cars glance off it instead of sticking.
     *
     * The chassis collider carries real friction (so car-on-car shoves feel
     * solid), but against a wall we want the contact to slide. Using the Min
     * combine rule makes the wall's low friction win regardless of the
     * chassis value, while Max restitution keeps the bounce lively.
     * @private
     * @param {Object} colliderDesc - Rapier ColliderDesc to mutate
     * @param {number} friction - Low tangential friction for the wall
     * @param {number} restitution - Bounciness of the wall
     */
    _makeWallSlippery(colliderDesc, friction, restitution) {
        colliderDesc
            .setFriction(friction)
            .setRestitution(restitution);

        const rule = this.RAPIER.CoefficientCombineRule;
        if (rule) {
            colliderDesc.setFrictionCombineRule(rule.Min);
            colliderDesc.setRestitutionCombineRule(rule.Max);
        }
    }

    /**
     * Create circular barrier (low curb for driving over)
     * @private
     */
    _createCircularBarrier(radius, height, thickness, restitution, type) {
        const segments = 48;
        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);

        // Create smooth, low curb colliders around the circle
        // Use more segments for smoother feel when driving over
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const segmentLength = (2 * Math.PI * radius) / segments;

            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const radiusLength = Math.hypot(x, z) || 1;
            const tangentX = -z / radiusLength;
            const tangentZ = x / radiusLength;
            const yaw = this._yawFromDirection(tangentX, tangentZ);

            // Use a flatter, wider collider for curb-like behavior
            // Cars can drive over but will get rocked
            // Rotation: segment should be tangent to circle (perpendicular to radius)
            // Derive yaw from the tangent vector so it stays aligned with this
            // file's shared local-X / negative-Z yaw convention.
            const colliderDesc = this.RAPIER.ColliderDesc
                .cuboid(segmentLength / 2, height / 2, thickness / 2)
                .setTranslation(x, height / 2, z)
                .setRotation(this._eulerToQuat(0, yaw, 0));
            this._makeWallSlippery(colliderDesc, 0.15, restitution);

            this.world.createCollider(colliderDesc, body);
        }

        this.staticBodies.set(`barrier_${type}`, body);
        return body;
    }

    /**
     * Create square arena wall colliders.
     * @private
     */
    _createSquareBarrier(size, height, thickness, restitution) {
        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);
        const half = size / 2;
        const wallThickness = Math.max(1, thickness || 1);
        const wallLength = size + wallThickness * 2;
        const specs = [
            {
                hx: wallLength / 2,
                hz: wallThickness / 2,
                x: 0,
                z: -half
            },
            {
                hx: wallLength / 2,
                hz: wallThickness / 2,
                x: 0,
                z: half
            },
            {
                hx: wallThickness / 2,
                hz: wallLength / 2,
                x: -half,
                z: 0
            },
            {
                hx: wallThickness / 2,
                hz: wallLength / 2,
                x: half,
                z: 0
            }
        ];

        specs.forEach((spec) => {
            const colliderDesc = this.RAPIER.ColliderDesc
                .cuboid(spec.hx, height / 2, spec.hz)
                .setTranslation(spec.x, height / 2, spec.z);
            this._makeWallSlippery(colliderDesc, 0.15, restitution);
            this.world.createCollider(colliderDesc, body);
        });

        this.staticBodies.set('barrier_square_wall', body);
        return body;
    }

    /**
     * Create a sloped, climbable wall barrier for an arena (bowl / dunes).
     *
     * Each segment is a thin box leaning outward by `slopeDeg` (measured from
     * vertical), matching the visual cone. Cars can ride up the bank and catch
     * air, but the steep angle and height keep them contained. This replaces
     * the old vertical wall, which looked sloped but physically blocked the
     * car dead - the cause of "can't drive up the derby edges".
     * @private
     * @param {number} radius - bottom radius of the wall
     * @param {number} height - vertical wall height
     * @param {number} slopeDeg - lean from vertical, in degrees
     * @param {number} restitution - bounciness
     */
    _createBowlWallBarrier(radius, height, slopeDeg, restitution) {
        const segments = 64;
        const thickness = 2;
        const slopeRad = (slopeDeg * Math.PI) / 180;
        const slantLen = height / Math.cos(slopeRad);
        const hy = slantLen / 2;
        const sinS = Math.sin(slopeRad);
        const cosS = Math.cos(slopeRad);

        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed();
        const body = this.world.createRigidBody(bodyDesc);

        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const segmentLength = (2 * Math.PI * radius) / segments;

            // Reference (+X side): box leans outward as it rises (tilt about
            // local Z by -slope), tangential axis is world Z. Then yaw to angle.
            const tilt = this._quatFromAxisAngle(0, 0, 1, -slopeRad);
            const yaw = this._quatFromAxisAngle(0, 1, 0, angle);
            const rotation = this._quatMul(yaw, tilt);

            // Centre of the slanted segment, at the reference angle then yawed
            const cx = radius + sinS * hy;
            const cy = cosS * hy;
            const x = cx * Math.cos(angle);
            const z = -cx * Math.sin(angle);

            const colliderDesc = this.RAPIER.ColliderDesc
                .cuboid(thickness / 2, hy, segmentLength / 2)
                .setTranslation(x, cy, z)
                .setRotation(rotation);
            this._makeWallSlippery(colliderDesc, 0.2, restitution);

            this.world.createCollider(colliderDesc, body);
        }

        this.staticBodies.set('barrier_bowl_wall', body);
        return body;
    }

    /**
     * Current radius (world units) of the resizable arena wall, or null when
     * the active track has no resizable arena wall. For a square arena this is
     * half the side length, matching the bowl/dunes radius convention.
     * @returns {number|null}
     */
    getArenaWallRadius() {
        const spec = this._arenaWall;
        if (!spec) return null;
        return spec.kind === 'square' ? spec.size / 2 : spec.radius;
    }

    /**
     * Resize the shrinking-arena wall collider to a new radius, rebuilding it in
     * lockstep with the visual shrink so cars never hit an invisible old wall or
     * phase through the shrunk one.
     *
     * Rapier compound colliders cannot be cheaply scaled in place, so the wall
     * body is removed and rebuilt at the new radius from the spec captured when
     * the track was built. Returns the new wall body, or null when there is no
     * resizable arena wall or the radius is non-positive.
     * @param {number} radius - New arena wall radius in world units.
     * @returns {Object|null}
     */
    setArenaWallRadius(radius) {
        const spec = this._arenaWall;
        if (!spec || !this.world || !this.RAPIER) return null;
        if (!(radius > 0)) return null;

        // Remove the existing wall body before rebuilding under the same key.
        const existing = this.staticBodies.get(spec.key);
        if (existing) {
            this.world.removeRigidBody(existing);
            this.staticBodies.delete(spec.key);
        }

        let body = null;
        if (spec.kind === 'bowl') {
            body = this._createBowlWallBarrier(radius, spec.height, spec.slope, spec.restitution);
            spec.radius = radius;
        } else if (spec.kind === 'square') {
            const size = radius * 2;
            body = this._createSquareBarrier(size, spec.height, spec.thickness, spec.restitution);
            spec.size = size;
        }

        // Preserve the wall-slide tag the original barrier carried.
        if (body) body.userData = { type: 'barrier' };
        return body;
    }

    /**
     * Remove all static bodies (ground and barriers)
     * Called when switching tracks
     */
    removeStaticBodies() {
        if (!this.world) return;

        for (const [key, body] of this.staticBodies) {
            if (body) {
                this.world.removeRigidBody(body);
            }
        }
        this.staticBodies.clear();
        this._arenaWall = null;
        console.log('PhysicsSystem: Removed all static bodies');
    }

    /**
     * Create vehicle physics body with controller
     * @param {Vehicle} vehicle - Vehicle entity
     * @param {Object} physicsConfig - Physics config from vehicle JSON
     * @returns {Object} { body, controller }
     */
    createVehicleBody(vehicle, physicsConfig) {
        if (!this.RAPIER || !this.world) return null;

        const pos = vehicle.position;
        const rot = vehicle.rotation;

        // Create chassis rigid body
        const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation(this._eulerToQuat(rot.x, rot.y, rot.z))
            .setLinearDamping(physicsConfig.linearDamping || 0.2)
            .setAngularDamping(physicsConfig.angularDamping || 0.5)
            .setCanSleep(false);

        const chassisBody = this.world.createRigidBody(bodyDesc);

        // Create chassis collider
        const bodyWidth = vehicle.config?.visual?.body?.width || 2;
        const bodyHeight = vehicle.config?.visual?.body?.height || 1;
        const bodyLength = vehicle.config?.visual?.body?.length || 4;

        // Rounded chassis edges let the car glance off walls and slide along
        // them instead of catching a square corner and wedging. roundCuboid's
        // border radius extends beyond the half-extents, so shrink them to keep
        // the same overall size.
        const borderRadius = physicsConfig.colliderBorderRadius || 0;
        let colliderDesc;
        if (borderRadius > 0) {
            colliderDesc = this.RAPIER.ColliderDesc.roundCuboid(
                Math.max(0.05, bodyWidth / 2 - borderRadius),
                Math.max(0.05, bodyHeight / 2 - borderRadius),
                Math.max(0.05, bodyLength / 2 - borderRadius),
                borderRadius
            );
        } else {
            colliderDesc = this.RAPIER.ColliderDesc.cuboid(bodyWidth / 2, bodyHeight / 2, bodyLength / 2);
        }
        colliderDesc
            .setDensity(physicsConfig.density || 4.0)
            .setFriction(physicsConfig.friction || 0.5)
            .setActiveEvents(this.RAPIER.ActiveEvents.COLLISION_EVENTS);

        // Lower the centre of mass so impacts rock the car instead of rolling
        // it. Inertia is the analytic cuboid tensor about the shifted CoM.
        const com = physicsConfig.centerOfMass;
        if (com) {
            const mass = physicsConfig.mass || 30;
            const inertia = {
                x: mass * (bodyHeight * bodyHeight + bodyLength * bodyLength) / 12,
                y: mass * (bodyWidth * bodyWidth + bodyLength * bodyLength) / 12,
                z: mass * (bodyWidth * bodyWidth + bodyHeight * bodyHeight) / 12
            };
            colliderDesc.setMassProperties(
                mass,
                { x: com.x || 0, y: com.y || 0, z: com.z || 0 },
                inertia,
                { x: 0, y: 0, z: 0, w: 1 }
            );
        }

        const chassisCollider = this.world.createCollider(colliderDesc, chassisBody);

        // Create vehicle controller
        const controller = this.world.createVehicleController(chassisBody);

        // Add wheels
        const wheels = physicsConfig.wheels;
        const suspension = physicsConfig.suspension;
        const wheelPositions = this._getWheelPositions(wheels.positions, bodyWidth, bodyLength);

        wheelPositions.forEach((pos, index) => {
            controller.addWheel(
                pos,
                suspension.direction,
                physicsConfig.axle.direction,
                wheels.suspensionRestLength,
                wheels.radius
            );

            // Configure suspension
            controller.setWheelSuspensionStiffness(index, suspension.stiffness);
            controller.setWheelSuspensionCompression(index, suspension.compression);
            controller.setWheelSuspensionRelaxation(index, suspension.relaxation);
            controller.setWheelMaxSuspensionTravel(index, suspension.maxTravel);
            controller.setWheelFrictionSlip(index, physicsConfig.frictionSlip);
        });

        // Store reference
        const vehicleData = {
            body: chassisBody,
            controller: controller,
            chassisCollider: chassisCollider,
            entity: vehicle,
            config: physicsConfig,
            previousHandlingState: vehicle.handlingState || 'grounded',
            // Reverse state tracking
            brakeStartTime: null,
            isReversing: false,
            reverseDelayMs: 1000,           // 1 second hold before reverse
            reverseForceMultiplier: 0.5,    // Reverse is 50% of forward power
            wheelieIntentHoldMs: 0,
            wheelieIntentReady: false,
            currentWheelieIntent: null
        };

        this.vehicleBodies.set(vehicle.id, vehicleData);

        // Link physics body to vehicle entity
        vehicle.setPhysicsBody(chassisBody, controller);

        chassisBody.userData = {
            entityId: vehicle.id,
            entity: vehicle,
            type: 'vehicle'
        };

        this._emit('physics:vehicleCreated', { vehicleId: vehicle.id });

        return vehicleData;
    }

    /**
     * Get wheel positions from config
     * @private
     */
    _getWheelPositions(positions, bodyWidth, bodyLength) {
        if (positions) {
            return [
                positions.frontLeft,
                positions.frontRight,
                positions.rearLeft,
                positions.rearRight
            ];
        }

        // Default positions
        return [
            { x: -bodyWidth / 2 + 0.2, y: 0, z: bodyLength / 2 - 0.5 },
            { x: bodyWidth / 2 - 0.2, y: 0, z: bodyLength / 2 - 0.5 },
            { x: -bodyWidth / 2 + 0.2, y: 0, z: -bodyLength / 2 + 0.5 },
            { x: bodyWidth / 2 - 0.2, y: 0, z: -bodyLength / 2 + 0.5 }
        ];
    }

    /**
     * Apply controls to a vehicle
     * @param {string} vehicleId
     * @param {Object} controls - { steering, acceleration, braking }
     */
    applyVehicleControls(vehicleId, controls) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data || !data.controller) return;

        const config = data.config;
        const vc = data.controller;
        const entity = data.entity;

        // Detect handling state based on wheel contact
        const numWheels = vc.numWheels ? vc.numWheels() : 4;
        const wheels = [];
        for (let i = 0; i < numWheels; i++) {
            wheels.push(this._isWheelGrounded(vc, i));
        }

        const frontGrounded = wheels[0] || wheels[1];
        const rearGrounded = wheels[2] || wheels[3];
        const allAirborne = wheels.every(g => !g);

        let newState = 'grounded';
        if (allAirborne) {
            newState = 'airborne';
        } else if (!frontGrounded && rearGrounded) {
            newState = 'wheelie';
        } else if (frontGrounded && !rearGrounded) {
            newState = 'front-light';
        }

        const oldState = entity?.handlingState || data.previousHandlingState || 'grounded';
        if (entity && oldState !== newState) {
            entity.handlingState = newState;
            entity.stateDuration = 0;
            this._handleStuntTransition(data, oldState, newState);
        }
        data.previousHandlingState = newState;

        // Dead cars don't drive
        if (entity?.isDead) {
            vc.setWheelEngineForce(2, 0);
            vc.setWheelEngineForce(3, 0);
            vc.setWheelSteering(0, 0);
            vc.setWheelSteering(1, 0);
            return;
        }

        // EMP stun: no engine, no steering until stun expires
        if (entity?.stunned) {
            if (performance.now() >= (entity.stunEndTime || 0)) {
                entity.stunned = false;
            } else {
                vc.setWheelEngineForce(2, 0);
                vc.setWheelEngineForce(3, 0);
                vc.setWheelSteering(0, 0);
                vc.setWheelSteering(1, 0);
                for (let i = 0; i < 4; i++) {
                    vc.setWheelBrake(i, 0);
                }
                return;
            }
        }

        const acceleration = controls.acceleration || 0;
        const braking = controls.braking || 0;
        const controlDtMs = (this._lastUpdateDt || this.defaultControlStepSeconds) * 1000;
        const wheelieCfg = this._getWheelieConfig(config);
        // Nitro and stunt landing boosts both multiply engine force. Keep
        // Nitro's weapon-owned timer intact; stunt boost has its own expiry.
        const boostMultiplier = this._getEngineBoostMultiplier(entity, config);
        const baseEngineForce = (config.engine?.force || 200) * boostMultiplier;

        // Tyre grip drops in two cases:
        // - oil slick: car slides everywhere
        // - wall contact: car slides ALONG the wall instead of the rail-locked
        //   tyres pinning it perpendicular (the "sticks to walls" problem)
        const baseFrictionSlip = config.frictionSlip || 1000;
        const oilGrip = entity?.inOilSlick ? (entity.oilFrictionMultiplier || 0.1) : 1;
        const wallGrip = entity?.inWallContact ? (config.wallSlideGrip ?? 0.2) : 1;
        const gripMultiplier = Math.min(oilGrip, wallGrip);
        if (gripMultiplier !== data.lastGripMultiplier) {
            for (let i = 0; i < 4; i++) {
                vc.setWheelFrictionSlip(i, baseFrictionSlip * gripMultiplier);
            }
            data.lastGripMultiplier = gripMultiplier;
        }

        // Speed threshold for considering the car "stopped"
        const STOP_THRESHOLD = 2.0;
        const currentSpeed = vc.currentVehicleSpeed ? Math.abs(vc.currentVehicleSpeed()) : 0;

        // Determine engine force based on acceleration vs reverse
        let engineForce = 0;

        if (acceleration > 0) {
            // Forward acceleration - reset reverse state
            engineForce = acceleration * baseEngineForce;
            data.brakeStartTime = null;
            data.isReversing = false;
        } else if (braking > 0) {
            // Braking logic with reverse after delay
            // If already reversing, stay in reverse mode as long as brake is held
            if (data.isReversing) {
                engineForce = -braking * baseEngineForce * data.reverseForceMultiplier;
            } else {
                // Not yet reversing - check if we should activate
                const isNearlyStopped = currentSpeed < STOP_THRESHOLD;

                if (isNearlyStopped) {
                    // Car is stopped or nearly stopped while holding brake
                    if (data.brakeStartTime === null) {
                        data.brakeStartTime = Date.now();
                    }

                    const brakeHoldDuration = Date.now() - data.brakeStartTime;

                    if (brakeHoldDuration >= data.reverseDelayMs) {
                        // Activate reverse mode
                        data.isReversing = true;
                        engineForce = -braking * baseEngineForce * data.reverseForceMultiplier;
                    }
                } else {
                    // Still moving forward, apply brakes (don't start reverse timer yet)
                    data.brakeStartTime = null;
                }
            }
        } else {
            // No acceleration or braking - reset reverse state
            data.brakeStartTime = null;
            data.isReversing = false;
        }

        // Apply engine force to rear wheels (RWD)
        vc.setWheelEngineForce(2, engineForce);
        vc.setWheelEngineForce(3, engineForce);

        // Steering on front wheels (negate for correct direction).
        // Two stability aids make the car easier to drive:
        //  - the steering lock tightens as speed rises (twitchy at a crawl,
        //    progressively gentler at speed) so high-speed inputs don't spin out
        //  - the applied angle is smoothed toward the target so a flick of the
        //    joystick ramps in instead of snapping the wheels instantly
        const steerCfg = config.steering || {};
        const maxAngle = steerCfg.maxAngle || 0.5;
        const highSpeedReduction = steerCfg.highSpeedReduction ?? 0;
        const smoothing = steerCfg.smoothing ?? 1;

        const authorityCfg = this._getSteeringAuthorityConfig(config);

        // Speed reduction now lives in the authority helper so the live value,
        // F2 telemetry, and tests all describe the same steering limit.
        authorityCfg.highSpeedAuthorityFloor = authorityCfg.highSpeedAuthorityFloor ??
            Math.max(0, Math.min(1, 1 - highSpeedReduction));
        const effectiveMax = maxAngle;

        const rollDeg = this._getBodyTiltDeg(data.body);
        const authority = computeSteeringAuthority({
            handlingState: newState,
            speedMps: currentSpeed,
            rollDeg,
            wallContact: !!entity?.inWallContact,
            badLanding: this._getBadLandingAuthorityState(entity, config)
        }, authorityCfg);

        // Optional steering assist (br-steering-assist-experiment): DEFAULT OFF.
        // When enabled it eases the car toward its travel direction (counters
        // slide / smooths cornering). Guarded so the default path is unchanged.
        let steeringInput = controls.steering || 0;
        const assistCfg = config.steeringAssist;
        if (assistCfg?.enabled) {
            const heading = this._getBodyHeading(data.body);
            const lv = data.body?.linvel?.() || { x: 0, z: 0 };
            const targetHeading = Math.atan2(lv.x, lv.z);
            const prevHeading = data._assistPrevHeading ?? heading;
            const dtSec = Math.max(1e-3, (this._lastUpdateDt || this.defaultControlStepSeconds));
            const headingRate = ((heading - prevHeading + Math.PI) % (2 * Math.PI) - Math.PI) / dtSec;
            data._assistPrevHeading = heading;
            const assisted = computeSteeringAssist({
                playerSteer: steeringInput,
                headingRad: heading,
                targetHeadingRad: targetHeading,
                speedMps: currentSpeed,
                headingRateRadPerSec: headingRate
            }, assistCfg);
            steeringInput = assisted.steer;
            data._lastSteeringAssist = assisted;
        }

        const targetSteer = -steeringInput * effectiveMax * authority.authority;

        const prevSteer = data.currentSteer || 0;
        data.currentSteer = prevSteer + (targetSteer - prevSteer) * smoothing;
        vc.setWheelSteering(0, data.currentSteer);
        vc.setWheelSteering(1, data.currentSteer);
        data.currentSteeringAuthority = {
            ...authority,
            tuning: authorityCfg,
            effectiveMax,
            inputSteering: controls.steering || 0,
            appliedSteer: data.currentSteer,
            rollDeg,
            handlingState: newState
        };
        this._applyRecoveryInfluence(data, {
            authority,
            steeringInput: controls.steering || 0,
            acceleration,
            braking,
            allAirborne,
            rollDeg
        });

        // Apply a short lift pulse for intentional wheelies during high
        // acceleration. This must not run every tick: repeated impulses turn a
        // launch pop into a full airborne stall where the tyres lose contact.
        const wheelieActivationThrottle = wheelieCfg.activationThrottle;
        const wheelieActivationDwellMs = wheelieCfg.activationDwellMs;
        if (newState === 'grounded' && acceleration >= wheelieActivationThrottle) {
            data.wheelieIntentHoldMs = Math.min(
                wheelieActivationDwellMs,
                (data.wheelieIntentHoldMs || 0) + controlDtMs
            );
        } else {
            data.wheelieIntentHoldMs = 0;
            data.wheelieIntentReady = false;
        }

        const intentReady = (data.wheelieIntentHoldMs || 0) >= wheelieActivationDwellMs;
        let wheeliePulseTriggered = false;
        if (intentReady && newState === 'grounded') {
            const now = performance.now();
            const liftCooldownMs = wheelieCfg.liftCooldownMs;
            const canPulseLift = !data.lastWheelieLiftAt || now - data.lastWheelieLiftAt >= liftCooldownMs;
            if (canPulseLift) {
                data.lastWheelieLiftAt = now;
                data.wheelieIntentHoldMs = 0;
                data.wheelieIntentReady = false;
                wheeliePulseTriggered = true;

                const body = data.body;
                const rot = body.rotation();
                const pos = body.translation();

                // Front-center offset in local space
                const bodyLength = config.visual?.body?.length || 4;
                const localFront = { x: 0, y: 0, z: bodyLength / 2 };
                const worldFront = this._localToWorld(localFront, pos, rot);

                // Calculate lift: stronger if boosting, weaker at high speed to prevent backflips
                const speedClamp = Math.max(0.2, 1.0 - (currentSpeed / 25));
                const liftImpulseScale = wheelieCfg.liftImpulse;
                const liftImpulse = acceleration * liftImpulseScale * boostMultiplier * speedClamp;

                body.applyImpulseAtPoint({ x: 0, y: liftImpulse, z: 0 }, worldFront, true);
            }
        } else if (acceleration < wheelieActivationThrottle) {
            data.lastWheelieLiftAt = 0;
        }

        data.wheelieIntentReady = intentReady && !wheeliePulseTriggered;
        data.currentWheelieIntent = this._buildWheelieIntentTelemetry(data, {
            acceleration,
            boostMultiplier,
            wheelieCfg
        });

        // Braking on all wheels - don't apply brake when reversing
        const brakeForce = (braking > 0 && !data.isReversing) ? braking * (config.engine?.brakeForce || 50) : 0;
        for (let i = 0; i < 4; i++) {
            vc.setWheelBrake(i, brakeForce);
        }
    }

    /**
     * Read wheel contact from the Rapier vehicle controller.
     *
     * Rapier exposes this as wheelIsInContact(); older tests and some local
     * shims used wheelIsGrounded(), so keep a fallback instead of scattering
     * API-version checks through the drive logic.
     * @private
     * @param {Object} controller
     * @param {number} index
     * @returns {boolean}
     */
    _isWheelGrounded(controller, index) {
        if (typeof controller?.wheelIsInContact === 'function') {
            return !!controller.wheelIsInContact(index);
        }
        if (typeof controller?.wheelIsGrounded === 'function') {
            return !!controller.wheelIsGrounded(index);
        }
        return true;
    }

    /**
     * Config defaults for the wheelie/airtime payoff loop.
     * @private
     */
    _getStuntConfig(config = {}) {
        const stunt = config.stunt || {};
        return {
            maxCharge: stunt.maxCharge ?? 1,
            wheelieChargeRate: stunt.wheelieChargeRate ?? 0.55,
            airtimeChargeRate: stunt.airtimeChargeRate ?? 0.75,
            nitroChargeMultiplier: stunt.nitroChargeMultiplier ?? 1.5,
            chargeDecayRate: stunt.chargeDecayRate ?? 0.35,
            minLandingCharge: stunt.minLandingCharge ?? 0.25,
            landingBoostBonus: stunt.landingBoostBonus ?? 0.55,
            landingBoostDuration: stunt.landingBoostDuration ?? 1.25,
            landingRamBonus: stunt.landingRamBonus ?? 18,
            badLandingAngularSpeed: stunt.badLandingAngularSpeed ?? 8,
            badLandingVerticalSpeed: stunt.badLandingVerticalSpeed ?? 9,
            badLandingDuration: stunt.badLandingDuration ?? 0.85,
            badLandingThrottleMultiplier: stunt.badLandingThrottleMultiplier ?? 0.65,
            badLandingSteeringMultiplier: stunt.badLandingSteeringMultiplier ?? 0.55
        };
    }

    /**
     * @private
     */
    _isStuntState(state) {
        return state === 'wheelie' || state === 'airborne';
    }

    /**
     * Config defaults for throttle-shaped wheelie intent.
     * @private
     */
    _getWheelieConfig(config = {}) {
        const wheelie = config.wheelie || {};
        return {
            activationThrottle: wheelie.activationThrottle ?? 0.92,
            activationDwellMs: wheelie.activationDwellMs ?? 280,
            steeringAuthority: wheelie.steeringAuthority ?? 0.15,
            liftImpulse: wheelie.liftImpulse ?? 8.0,
            liftCooldownMs: wheelie.liftCooldownMs ?? 450
        };
    }

    /**
     * Merge legacy steering/wheelie/stunt knobs into the progressive authority
     * model so existing vehicle configs keep their familiar extremes.
     * @private
     */
    _getSteeringAuthorityConfig(config = {}) {
        const steering = config.steering || {};
        const wheelie = this._getWheelieConfig(config);
        const stunt = this._getStuntConfig(config);
        const overrides = config.steeringAuthority || {};
        const clamp01 = (value, fallback) => {
            const n = Number(value);
            if (!Number.isFinite(n)) return fallback;
            return Math.max(0, Math.min(1, n));
        };

        return {
            ...DEFAULT_STEERING_AUTHORITY_CONFIG,
            speedRefMps: overrides.speedRefMps ?? steering.speedRefMps ?? 15,
            highSpeedAuthorityFloor: clamp01(
                overrides.highSpeedAuthorityFloor,
                Math.max(0, Math.min(1, 1 - (steering.highSpeedReduction ?? 0)))
            ),
            frontLightAuthority: clamp01(
                overrides.frontLightAuthority,
                DEFAULT_STEERING_AUTHORITY_CONFIG.frontLightAuthority
            ),
            wheelieAuthority: clamp01(
                overrides.wheelieAuthority ?? wheelie.steeringAuthority,
                DEFAULT_STEERING_AUTHORITY_CONFIG.wheelieAuthority
            ),
            airborneAuthority: clamp01(
                overrides.airborneAuthority ?? config.wheelie?.airborneAuthority,
                DEFAULT_STEERING_AUTHORITY_CONFIG.airborneAuthority
            ),
            rollFullAuthorityDeg: overrides.rollFullAuthorityDeg ??
                DEFAULT_STEERING_AUTHORITY_CONFIG.rollFullAuthorityDeg,
            rollDeadDeg: overrides.rollDeadDeg ??
                DEFAULT_STEERING_AUTHORITY_CONFIG.rollDeadDeg,
            sideTiltSteerFloor: clamp01(
                overrides.sideTiltSteerFloor,
                DEFAULT_STEERING_AUTHORITY_CONFIG.sideTiltSteerFloor
            ),
            badLandingAuthority: clamp01(
                overrides.badLandingAuthority ?? stunt.badLandingSteeringMultiplier,
                DEFAULT_STEERING_AUTHORITY_CONFIG.badLandingAuthority
            ),
            recoveryMaxInfluence: clamp01(
                overrides.recoveryMaxInfluence,
                DEFAULT_STEERING_AUTHORITY_CONFIG.recoveryMaxInfluence
            ),
            recoveryTorqueImpulse: overrides.recoveryTorqueImpulse ?? 0.45,
            recoveryYawImpulse: overrides.recoveryYawImpulse ?? 0.18,
            recoveryCooldownMs: overrides.recoveryCooldownMs ?? 120,
            wallPeelBias: clamp01(
                overrides.wallPeelBias,
                DEFAULT_STEERING_AUTHORITY_CONFIG.wallPeelBias
            )
        };
    }

    /**
     * Absolute body tilt from upright in degrees, derived from local up vs
     * world up. This catches two-wheel and on-side states without needing a
     * Rapier-specific helper.
     * @private
     */
    _getBodyTiltDeg(body) {
        if (!body?.rotation) return 0;
        const q = body.rotation();
        if (!q) return 0;
        const upY = 1 - 2 * ((q.x || 0) * (q.x || 0) + (q.z || 0) * (q.z || 0));
        const clamped = Math.max(-1, Math.min(1, upY));
        return Math.acos(clamped) * 180 / Math.PI;
    }

    /**
     * Yaw heading (radians) from the body's forward vector (local -Z), measured
     * as atan2(forwardX, forwardZ). Used by the optional steering assist.
     * @private
     */
    _getBodyHeading(body) {
        if (!body?.rotation) return 0;
        const q = body.rotation();
        if (!q) return 0;
        const fx = 2 * ((q.x || 0) * (q.z || 0) + (q.w || 1) * (q.y || 0));
        const fz = 1 - 2 * ((q.x || 0) * (q.x || 0) + (q.y || 0) * (q.y || 0));
        return Math.atan2(fx, fz);
    }

    /**
     * Signed side tilt. Positive/negative only selects the recovery torque
     * direction; magnitude comes from the pure authority helper.
     * @private
     */
    _getBodyTiltSign(body) {
        if (!body?.rotation) return 0;
        const q = body.rotation();
        if (!q) return 0;
        const upX = 2 * ((q.x || 0) * (q.y || 0) - (q.w || 1) * (q.z || 0));
        if (Math.abs(upX) < 1e-6) return 0;
        return upX > 0 ? 1 : -1;
    }

    /**
     * Bad-landing progress for steering authority. Physics only stores the end
     * time, so progress is inferred from configured duration.
     * @private
     */
    _getBadLandingAuthorityState(entity, config = {}) {
        if (!this._isBadLandingActive(entity)) {
            return { active: false, progress: 1 };
        }
        const now = performance.now();
        const stunt = this._getStuntConfig(config);
        const durationMs = Math.max(1, (stunt.badLandingDuration || 0.85) * 1000);
        const remainingMs = Math.max(0, (entity.stuntBadLandingUntil || now) - now);
        const progress = Math.max(0, Math.min(1, 1 - remainingMs / durationMs));
        return { active: true, progress };
    }

    /**
     * Limited player-shaped recovery for tilted/bad-landing cars. It is capped,
     * rate-limited, disabled while fully airborne, and requires player input.
     * @private
     */
    _applyRecoveryInfluence(data, context = {}) {
        const body = data?.body;
        if (!body?.applyTorqueImpulse || context.allAirborne) return;
        const authority = context.authority || {};
        const influence = Number(authority.recoveryInfluence || 0);
        if (influence <= 0) return;

        const input = Math.min(1,
            Math.abs(context.steeringInput || 0) +
            Math.max(0, context.acceleration || 0) * 0.35 +
            Math.max(0, context.braking || 0) * 0.25
        );
        if (input <= 0.05) return;

        const tuning = authority.tuning || this._getSteeringAuthorityConfig(data.config || {});
        const now = performance.now();
        const cooldownMs = Math.max(0, tuning.recoveryCooldownMs ?? 120);
        if (data.lastSteeringRecoveryAt && now - data.lastSteeringRecoveryAt < cooldownMs) return;

        const tiltSign = this._getBodyTiltSign(body);
        const rightingDirection = tiltSign === 0
            ? -Math.sign(context.steeringInput || 0)
            : -tiltSign;
        const rollImpulse = (rightingDirection || 0) *
            influence * input * (tuning.recoveryTorqueImpulse ?? 0.45);
        const yawImpulse = (context.steeringInput || 0) *
            influence * (tuning.recoveryYawImpulse ?? 0.18);

        if (Math.abs(rollImpulse) < 1e-5 && Math.abs(yawImpulse) < 1e-5) return;

        body.applyTorqueImpulse({
            x: rollImpulse,
            y: yawImpulse,
            z: 0
        }, true);
        data.lastSteeringRecoveryAt = now;
        data.currentSteeringRecovery = {
            influence,
            input,
            rollImpulse,
            yawImpulse,
            cooldownMs
        };
    }

    /**
     * Build inspectable wheelie-intent telemetry for F2/debug surfaces.
     * @private
     */
    _buildWheelieIntentTelemetry(data, context = {}) {
        const wheelieCfg = context.wheelieCfg || this._getWheelieConfig(data?.config || {});
        const holdMs = data?.wheelieIntentHoldMs || 0;
        const dwellMs = wheelieCfg.activationDwellMs;
        const lastLiftAt = data?.lastWheelieLiftAt || 0;
        const now = performance.now();
        const cooldownRemainingMs = lastLiftAt
            ? Math.max(0, wheelieCfg.liftCooldownMs - Math.max(0, now - lastLiftAt))
            : 0;

        return {
            throttle: context.acceleration || 0,
            threshold: wheelieCfg.activationThrottle,
            holdMs,
            dwellMs,
            progress: dwellMs > 0 ? Math.min(1, holdMs / dwellMs) : 1,
            ready: !!data?.wheelieIntentReady,
            cooldownRemainingMs,
            boostMultiplier: context.boostMultiplier || 1
        };
    }

    /**
     * @private
     */
    _isBadLandingActive(entity) {
        return !!entity?.stuntBadLandingUntil && performance.now() < entity.stuntBadLandingUntil;
    }

    /**
     * @private
     */
    _getEngineBoostMultiplier(entity, config = {}) {
        if (!entity) return 1;

        const stuntCfg = this._getStuntConfig(config);
        const weaponBoost = entity.speedBoost || 1;
        const stuntBoost = performance.now() < (entity.stuntBoostUntil || 0)
            ? (entity.stuntBoostMultiplier || 1)
            : 1;
        const landingPenalty = this._isBadLandingActive(entity)
            ? stuntCfg.badLandingThrottleMultiplier
            : 1;

        return Math.max(weaponBoost, stuntBoost) * landingPenalty;
    }

    /**
     * Build stunt charge while the car is wheelieing or airborne, and expire
     * landing rewards/penalties without touching Nitro's separate weapon timer.
     * @private
     */
    _updateStuntTimers(data, dt) {
        const entity = data.entity;
        if (!entity) return;

        const now = performance.now();
        const cfg = this._getStuntConfig(data.config);

        if (entity.stunned) {
            entity.stuntState = 'idle';
            entity.stuntCharge = 0;
            entity.stuntAirTime = 0;
            entity.stuntBoostMultiplier = 1;
            entity.stuntBoostUntil = 0;
            entity.stuntRamDamageBonus = 0;
            entity.stuntBadLandingUntil = 0;
            return;
        }

        if (entity.stuntBoostUntil && now >= entity.stuntBoostUntil) {
            entity.stuntBoostMultiplier = 1;
            entity.stuntBoostUntil = 0;
            entity.stuntRamDamageBonus = 0;
            if (entity.stuntState === 'reward') entity.stuntState = 'idle';
        }

        if (entity.stuntBadLandingUntil && now >= entity.stuntBadLandingUntil) {
            entity.stuntBadLandingUntil = 0;
            if (entity.stuntState === 'bad-landing') entity.stuntState = 'idle';
        }

        if (this._isStuntState(entity.handlingState)) {
            const rate = entity.handlingState === 'wheelie'
                ? cfg.wheelieChargeRate
                : cfg.airtimeChargeRate;
            const boostFactor = (entity.speedBoost || 1) > 1 ? cfg.nitroChargeMultiplier : 1;
            entity.stuntCharge = Math.min(
                cfg.maxCharge,
                (entity.stuntCharge || 0) + dt * rate * boostFactor
            );
            entity.stuntAirTime = (entity.stuntAirTime || 0) + dt;
            entity.stuntState = 'charging';
        } else if (entity.stuntCharge > 0 && entity.stuntState !== 'reward') {
            entity.stuntCharge = Math.max(0, entity.stuntCharge - dt * cfg.chargeDecayRate);
            if (entity.stuntCharge === 0 && entity.stuntState === 'charging') {
                entity.stuntState = 'idle';
            }
        }
    }

    /**
     * Pay out or penalize the transition from wheelie/airtime back to ground.
     * @private
     */
    _handleStuntTransition(data, oldState, newState) {
        const entity = data.entity;
        if (!entity || !this._isStuntState(oldState) || newState !== 'grounded') return;

        const cfg = this._getStuntConfig(data.config);
        const charge = Math.min(cfg.maxCharge, entity.stuntCharge || 0);
        const normalizedCharge = cfg.maxCharge > 0 ? charge / cfg.maxCharge : 0;

        if (charge < cfg.minLandingCharge) {
            entity.stuntCharge = 0;
            entity.stuntAirTime = 0;
            entity.stuntState = 'idle';
            return;
        }

        const linvel = data.body?.linvel?.() || { x: 0, y: 0, z: 0 };
        const angvel = data.body?.angvel?.() || { x: 0, y: 0, z: 0 };
        const angularSpeed = Math.sqrt(
            angvel.x * angvel.x +
            angvel.y * angvel.y +
            angvel.z * angvel.z
        );
        const downwardSpeed = Math.max(0, -linvel.y);
        const badLanding = !entity.invulnerable && (
            angularSpeed > cfg.badLandingAngularSpeed ||
            downwardSpeed > cfg.badLandingVerticalSpeed
        );

        entity.lastStuntLanding = {
            type: badLanding ? 'bad' : 'clean',
            charge,
            airTime: entity.stuntAirTime || 0,
            angularSpeed,
            downwardSpeed,
            at: performance.now()
        };

        if (badLanding) {
            entity.stuntState = 'bad-landing';
            entity.stuntCharge = 0;
            entity.stuntAirTime = 0;
            entity.stuntBoostMultiplier = 1;
            entity.stuntBoostUntil = 0;
            entity.stuntRamDamageBonus = 0;
            entity.stuntBadLandingUntil = performance.now() + cfg.badLandingDuration * 1000;
            this._emit('vehicle:stuntBadLanding', {
                vehicleId: entity.id,
                playerId: entity.playerId,
                charge,
                angularSpeed,
                downwardSpeed
            });
            return;
        }

        entity.stuntState = 'reward';
        entity.stuntCharge = 0;
        entity.stuntAirTime = 0;
        entity.stuntBoostMultiplier = 1 + cfg.landingBoostBonus * normalizedCharge;
        entity.stuntBoostUntil = performance.now() + cfg.landingBoostDuration * 1000;
        entity.stuntRamDamageBonus = cfg.landingRamBonus * normalizedCharge;
        entity.stuntBadLandingUntil = 0;
        this._emit('vehicle:stuntLanding', {
            vehicleId: entity.id,
            playerId: entity.playerId,
            charge,
            boostMultiplier: entity.stuntBoostMultiplier,
            ramDamageBonus: entity.stuntRamDamageBonus
        });
    }

    /**
     * Reset vehicle to position
     * @param {string} vehicleId
     * @param {Object} position - { x, y, z }
     * @param {number} rotation - Y rotation in radians
     */
    resetVehicle(vehicleId, position, rotation = 0) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data) return;

        const body = data.body;

        body.setTranslation(position, true);
        body.setRotation(this._eulerToQuat(0, rotation, 0), true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        data.brakeStartTime = null;
        data.isReversing = false;
        data.currentSteer = 0;
        data.lastWheelieLiftAt = 0;
        data.wheelieIntentHoldMs = 0;
        data.wheelieIntentReady = false;
        data.currentWheelieIntent = null;
        data.previousHandlingState = 'grounded';

        if (data.controller) {
            data.controller.setWheelEngineForce(2, 0);
            data.controller.setWheelEngineForce(3, 0);
            data.controller.setWheelSteering(0, 0);
            data.controller.setWheelSteering(1, 0);
            const numWheels = data.controller.numWheels ? data.controller.numWheels() : 4;
            for (let i = 0; i < numWheels; i++) {
                data.controller.setWheelBrake(i, 0);
            }
        }
    }

    /**
     * Enable/disable a vehicle's physics body (dead cars become non-solid)
     * @param {string} vehicleId
     * @param {boolean} enabled
     */
    setVehicleEnabled(vehicleId, enabled) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data?.body?.setEnabled) return;
        data.body.setEnabled(enabled);
    }

    /**
     * Remove vehicle from physics world
     * @param {string} vehicleId
     */
    removeVehicle(vehicleId) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data) return;

        this.world.removeRigidBody(data.body);
        this.vehicleBodies.delete(vehicleId);

        this._emit('physics:vehicleRemoved', { vehicleId });
    }

    /**
     * Process collision events
     * @private
     */
    _processCollisions() {
        if (!this.eventQueue) return;

        this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
            const collider1 = this.world.getCollider(handle1);
            const collider2 = this.world.getCollider(handle2);

            if (!collider1 || !collider2) return;

            const body1 = collider1.parent();
            const body2 = collider2.parent();

            if (!body1 || !body2) return;

            const userData1 = body1.userData;
            const userData2 = body2.userData;

            if (started) {
                this._emit('physics:collision', {
                    bodyA: body1,
                    bodyB: body2,
                    entityA: userData1?.entity,
                    entityB: userData2?.entity,
                    typeA: userData1?.type,
                    typeB: userData2?.type
                });
            }
        });
    }

    /**
     * Get vehicle speed
     * @param {string} vehicleId
     * @returns {number} Speed in km/h
     */
    getVehicleSpeed(vehicleId) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data) return 0;

        const vel = data.body.linvel();
        return Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6;
    }

    /**
     * Get vehicle physics body
     * @param {string} vehicleId
     * @returns {Object|null} Rapier rigid body or null
     */
    getVehicleBody(vehicleId) {
        const data = this.vehicleBodies.get(vehicleId);
        return data ? data.body : null;
    }

    /**
     * Pause physics
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume physics
     */
    resume() {
        this.paused = false;
    }

    /**
     * Get physics debug vertices from Rapier world
     * @returns {Object|null} { vertices, colors } from debugRender()
     */
    getDebugVertices() {
        if (!this.world || !this.world.debugRender) {
            return null;
        }
        try {
            return this.world.debugRender();
        } catch (error) {
            console.warn('Error getting debug vertices:', error);
            return null;
        }
    }

    /**
     * Get debug data for a specific vehicle
     * @param {string} vehicleId
     * @returns {Object|null} Debug data with position, velocity, forces
     */
    getVehicleDebugData(vehicleId) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data) return null;

        const body = data.body;
        const pos = body.translation();
        const rot = body.rotation();
        const linvel = body.linvel();
        const angvel = body.angvel();

        // Calculate speed in km/h
        const speedMs = Math.sqrt(linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z);
        const speedKmh = speedMs * 3.6;

        return {
            position: { x: pos.x, y: pos.y, z: pos.z },
            rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
            velocity: { x: linvel.x, y: linvel.y, z: linvel.z },
            angularVelocity: { x: angvel.x, y: angvel.y, z: angvel.z },
            speed: speedKmh,
            isReversing: data.isReversing
        };
    }

    /**
     * Get detailed telemetry for a vehicle
     * @param {string} vehicleId
     * @returns {Object|null}
     */
    getVehicleTelemetry(vehicleId) {
        const data = this.vehicleBodies.get(vehicleId);
        if (!data || !data.body || !data.controller) return null;

        const vc = data.controller;
        const body = data.body;
        const entity = data.entity;

        const wheels = [];
        const numWheels = vc.numWheels();
        for (let i = 0; i < numWheels; i++) {
            wheels.push({
                isGrounded: this._isWheelGrounded(vc, i)
            });
        }

        const linvel = body.linvel();
        const speedKmh = Math.sqrt(linvel.x * linvel.x + linvel.y * linvel.y + linvel.z * linvel.z) * 3.6;

        return {
            speed: speedKmh,
            steerAngle: data.currentSteer || 0,
            throttle: (data.currentWheelieIntent?.throttle ?? entity?.controls?.acceleration) || 0,
            isReversing: data.isReversing,
            inWallContact: entity?.inWallContact || false,
            inOilSlick: entity?.inOilSlick || false,
            speedBoost: entity?.speedBoost || 1,
            stuntState: entity?.stuntState || 'idle',
            stuntCharge: entity?.stuntCharge || 0,
            stuntBoost: entity?.stuntBoostMultiplier || 1,
            stuntRamDamageBonus: entity?.stuntRamDamageBonus || 0,
            badLandingActive: this._isBadLandingActive(entity),
            wheels: wheels,
            handlingState: entity?.handlingState || 'grounded',
            stateDuration: entity?.stateDuration || 0,
            isAirborne: entity?.handlingState === 'airborne',
            isWheelie: entity?.handlingState === 'wheelie',
            steeringAuthority: data.currentSteeringAuthority || null,
            steeringRecovery: data.currentSteeringRecovery || null,
            wheelieIntent: data.currentWheelieIntent || this._buildWheelieIntentTelemetry(data)
        };
    }

    /**
     * Get debug data for all vehicles
     * @returns {Object} Map of vehicleId -> debug data
     */
    getAllVehiclesDebugData() {
        const result = {};
        for (const [vehicleId, data] of this.vehicleBodies) {
            result[vehicleId] = this.getVehicleDebugData(vehicleId);
        }
        return result;
    }

    /**
     * Quaternion from an axis (unit) and angle
     * @private
     */
    _quatFromAxisAngle(ax, ay, az, angle) {
        const h = angle / 2;
        const s = Math.sin(h);
        return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
    }

    /**
     * Hamilton product a * b (apply b first, then a)
     * @private
     */
    _quatMul(a, b) {
        return {
            x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
            z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
            w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
        };
    }

    /**
     * Convert a world-space XZ direction/tangent into the local-X yaw used by
     * barrier colliders and start-line-aligned track geometry.
     * @private
     */
    _yawFromDirection(dx, dz) {
        return Math.atan2(-dz, dx);
    }

    /**
     * Convert euler to quaternion
     * @private
     */
    _eulerToQuat(x, y, z) {
        const c1 = Math.cos(x / 2);
        const c2 = Math.cos(y / 2);
        const c3 = Math.cos(z / 2);
        const s1 = Math.sin(x / 2);
        const s2 = Math.sin(y / 2);
        const s3 = Math.sin(z / 2);

        return {
            x: s1 * c2 * c3 + c1 * s2 * s3,
            y: c1 * s2 * c3 - s1 * c2 * s3,
            z: c1 * c2 * s3 + s1 * s2 * c3,
            w: c1 * c2 * c3 - s1 * s2 * s3
        };
    }

    /**
     * Emit event
     * @private
     */
    _emit(event, data) {
        if (this.eventBus) {
            this.eventBus.emit(event, data);
        }
    }

    /**
     * Destroy physics world
     */
    destroy() {
        if (this.world) {
            this.world.free();
            this.world = null;
        }
        this.vehicleBodies.clear();
        this.staticBodies.clear();
        this.initialized = false;
    }
}

// Export for ES Modules
export { PhysicsSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.PhysicsSystem = PhysicsSystem;
}
