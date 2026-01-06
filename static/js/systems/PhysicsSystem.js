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

        // Update vehicle controllers
        for (const [vehicleId, data] of this.vehicleBodies) {
            if (data.controller) {
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
        }

        return barriers;
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
                .setRotation(this._eulerToQuat(0, angle, 0))
                .setFriction(0.3)  // Lower friction for sliding over
                .setRestitution(restitution);

            this.world.createCollider(colliderDesc, body);
        }

        this.staticBodies.set(`barrier_${type}`, body);
        return body;
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

        const acceleration = controls.acceleration || 0;
        const braking = controls.braking || 0;
        const baseEngineForce = config.engine?.force || 200;

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

        // Steering on front wheels (negate for correct direction)
        const steerAngle = -(controls.steering || 0) * (config.steering?.maxAngle || 0.5);
        vc.setWheelSteering(0, steerAngle);
        vc.setWheelSteering(1, steerAngle);

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
