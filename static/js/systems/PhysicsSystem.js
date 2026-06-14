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

class PhysicsSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        // Rapier module reference
        this.RAPIER = null;

        // Physics world
        this.world = null;

        // Tracked bodies
        this.vehicleBodies = new Map();  // vehicleId -> { body, controller }
        this.staticBodies = new Map();   // bodyId -> body

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

        // Sync vehicle entities from physics
        for (const [vehicleId, data] of this.vehicleBodies) {
            if (data.entity) {
                data.entity.syncEntityFromPhysics();
            }
        }
    }

    /**
     * Create ground physics body
     * @param {Object} config - Ground configuration
     * @returns {Object} Rapier rigid body
     */
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

            const bowlWall = this._createBowlWallBarrier(
                radius,
                wallHeight,
                wallSlope,
                physics.barrierRestitution || 0.5
            );

            if (bowlWall) barriers.push(bowlWall);
        } else if (geometry.type === 'dunes') {
            // Tall containment wall at the dunes arena edge
            const radius = geometry.radius || 70;
            const wallHeight = geometry.wallHeight || 14;
            const dunesWall = this._createBowlWallBarrier(
                radius,
                wallHeight,
                20,
                physics.barrierRestitution || 0.4
            );
            if (dunesWall) barriers.push(dunesWall);
        } else if (geometry.type === 'spline') {
            // Procedural track: barrier walls along both precomputed edges
            const height = geometry.barrierHeight || 1.5;
            const restitution = physics.barrierRestitution || 0.4;

            const innerBarrier = this._createEdgeBarrier(geometry.leftEdge, height, restitution, 'spline_left');
            const outerBarrier = this._createEdgeBarrier(geometry.rightEdge, height, restitution, 'spline_right');

            if (innerBarrier) barriers.push(innerBarrier);
            if (outerBarrier) barriers.push(outerBarrier);
        }

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
            // Yaw so the segment's local X axis aligns with the edge direction
            const yaw = Math.atan2(-dz, dx);

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

            // Use a flatter, wider collider for curb-like behavior
            // Cars can drive over but will get rocked
            // Rotation: segment should be tangent to circle (perpendicular to radius)
            // At angle θ, tangent direction is θ + π/2
            const colliderDesc = this.RAPIER.ColliderDesc
                .cuboid(segmentLength / 2, height / 2, thickness / 2)
                .setTranslation(x, height / 2, z)
                .setRotation(this._eulerToQuat(0, angle, 0));
            this._makeWallSlippery(colliderDesc, 0.15, restitution);

            this.world.createCollider(colliderDesc, body);
        }

        this.staticBodies.set(`barrier_${type}`, body);
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

        const colliderDesc = this.RAPIER.ColliderDesc
            .cuboid(bodyWidth / 2, bodyHeight / 2, bodyLength / 2)
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

        this.world.createCollider(colliderDesc, chassisBody);

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
            entity: vehicle,
            config: physicsConfig,
            // Reverse state tracking
            brakeStartTime: null,
            isReversing: false,
            reverseDelayMs: 1000,           // 1 second hold before reverse
            reverseForceMultiplier: 0.5     // Reverse is 50% of forward power
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
        // Nitro boost multiplies engine force while the buff is active
        const boostMultiplier = entity?.speedBoost || 1;
        const baseEngineForce = (config.engine?.force || 200) * boostMultiplier;

        // Oil slick: drop tyre grip so the car slides
        const baseFrictionSlip = config.frictionSlip || 1000;
        const gripMultiplier = entity?.inOilSlick ? (entity.oilFrictionMultiplier || 0.1) : 1;
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

        // currentSpeed is m/s; ease the lock down to (1 - reduction) by ~15 m/s
        const speedFactor = Math.min(1, currentSpeed / 15);
        const effectiveMax = maxAngle * (1 - highSpeedReduction * speedFactor);
        const targetSteer = -(controls.steering || 0) * effectiveMax;

        const prevSteer = data.currentSteer || 0;
        data.currentSteer = prevSteer + (targetSteer - prevSteer) * smoothing;
        vc.setWheelSteering(0, data.currentSteer);
        vc.setWheelSteering(1, data.currentSteer);

        // Braking on all wheels - don't apply brake when reversing
        const brakeForce = (braking > 0 && !data.isReversing) ? braking * (config.engine?.brakeForce || 50) : 0;
        for (let i = 0; i < 4; i++) {
            vc.setWheelBrake(i, brakeForce);
        }
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
