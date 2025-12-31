/**
 * Vehicle - Vehicle entity for racing game
 *
 * Represents a player-controlled vehicle with:
 * - Visual mesh (Three.js)
 * - Physics body (Rapier)
 * - Control state
 * - Health/damage
 *
 * Usage:
 *   const vehicle = new Vehicle({
 *     config: vehicleConfig,
 *     playerId: 'player_123',
 *     position: { x: 0, y: 1.5, z: 0 }
 *   });
 */

import { Entity } from './Entity.js';

class Vehicle extends Entity {
    /**
     * @param {Object} options
     * @param {Object} options.config - Vehicle configuration from JSON
     * @param {string} [options.playerId] - Associated player ID
     * @param {Object} [options.position] - Initial position
     * @param {number} [options.rotation] - Initial Y rotation in radians
     * @param {number} [options.color] - Override body color
     */
    constructor(options = {}) {
        super({
            type: 'vehicle',
            id: options.playerId || options.id,
            position: options.position,
            rotation: { x: 0, y: options.rotation || 0, z: 0 },
            tags: ['vehicle', 'dynamic']
        });

        this.config = options.config;
        this.configId = options.config?.id || 'default';
        this.playerId = options.playerId;
        this.color = options.color;

        // Visual component (Three.js mesh)
        this.mesh = null;
        this.wheelMeshes = [];

        // Physics component (Rapier rigid body)
        this.physicsBody = null;
        this.vehicleController = null;

        // Control state (updated by InputSystem)
        this.controls = {
            steering: 0,      // -1 (left) to 1 (right)
            acceleration: 0,  // 0 to 1
            braking: 0        // 0 to 1
        };

        // Physics state (updated by PhysicsSystem)
        this.velocity = { x: 0, y: 0, z: 0 };
        this.angularVelocity = { x: 0, y: 0, z: 0 };
        this.speed = 0;  // km/h
        this.isGrounded = false;

        // Game state
        this.health = options.config?.stats?.maxHealth || 100;
        this.maxHealth = this.health;
        this.armor = options.config?.stats?.armor || 1.0;
        this.isDead = false;

        // Race state
        this.currentLap = 0;
        this.nextCheckpoint = 0;
        this.lapTimes = [];
        this.bestLapTime = null;
        this.racePosition = 0;
        this.finished = false;

        // Network state
        this.lastUpdateTime = 0;
        this.interpolationBuffer = [];
    }

    /**
     * Set the visual mesh
     * @param {THREE.Group} mesh
     */
    setMesh(mesh) {
        this.mesh = mesh;
        this.mesh.userData.entityId = this.id;
        this.mesh.userData.entity = this;

        // Extract wheel meshes
        this.wheelMeshes = [];
        mesh.traverse((child) => {
            if (child.userData?.isWheel) {
                this.wheelMeshes.push(child);
            }
        });

        // Sync initial position
        this.syncMeshToEntity();
    }

    /**
     * Set the physics body
     * @param {Object} physicsBody - Rapier rigid body
     * @param {Object} [vehicleController] - Rapier vehicle controller
     */
    setPhysicsBody(physicsBody, vehicleController = null) {
        this.physicsBody = physicsBody;
        this.vehicleController = vehicleController;

        // Store reference to entity on physics body
        if (physicsBody) {
            physicsBody.userData = physicsBody.userData || {};
            physicsBody.userData.entityId = this.id;
            physicsBody.userData.entity = this;
        }
    }

    /**
     * Update controls
     * @param {Object} controls - { steering, acceleration, braking }
     */
    setControls(controls) {
        if (controls.steering !== undefined) {
            this.controls.steering = Math.max(-1, Math.min(1, controls.steering));
        }
        if (controls.acceleration !== undefined) {
            this.controls.acceleration = Math.max(0, Math.min(1, controls.acceleration));
        }
        if (controls.braking !== undefined) {
            this.controls.braking = Math.max(0, Math.min(1, controls.braking));
        }
    }

    /**
     * Apply damage to vehicle
     * @param {number} amount - Damage amount
     * @param {Object} [source] - Damage source info
     * @returns {boolean} True if vehicle died
     */
    takeDamage(amount, source = null) {
        if (this.isDead) return false;

        const actualDamage = amount / this.armor;
        this.health = Math.max(0, this.health - actualDamage);

        if (this.health <= 0) {
            this.isDead = true;
            return true;
        }

        return false;
    }

    /**
     * Heal vehicle
     * @param {number} amount
     */
    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
        if (this.health > 0) {
            this.isDead = false;
        }
    }

    /**
     * Reset vehicle to spawn position
     * @param {Object} spawnPos - { x, y, z, rotation }
     */
    reset(spawnPos) {
        this.position.x = spawnPos.x;
        this.position.y = spawnPos.y;
        this.position.z = spawnPos.z;
        this.rotation.y = spawnPos.rotation || 0;

        this.velocity = { x: 0, y: 0, z: 0 };
        this.angularVelocity = { x: 0, y: 0, z: 0 };
        this.speed = 0;

        this.controls = { steering: 0, acceleration: 0, braking: 0 };

        // Reset physics body if exists
        if (this.physicsBody) {
            this.physicsBody.setTranslation(
                { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                true
            );
            this.physicsBody.setRotation(
                this._eulerToQuat(0, spawnPos.rotation || 0, 0),
                true
            );
            this.physicsBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            this.physicsBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }

        // Sync mesh
        this.syncMeshToEntity();
    }

    /**
     * Reset race state for new race
     */
    resetRaceState() {
        this.currentLap = 0;
        this.nextCheckpoint = 0;
        this.lapTimes = [];
        this.racePosition = 0;
        this.finished = false;
    }

    /**
     * Sync entity position from physics body
     */
    syncEntityFromPhysics() {
        if (!this.physicsBody) return;

        const pos = this.physicsBody.translation();
        const rot = this.physicsBody.rotation();
        const vel = this.physicsBody.linvel();
        const angVel = this.physicsBody.angvel();

        this.position.x = pos.x;
        this.position.y = pos.y;
        this.position.z = pos.z;

        // Convert quaternion to euler (approximate Y rotation)
        const euler = this._quatToEuler(rot);
        this.rotation.x = euler.x;
        this.rotation.y = euler.y;
        this.rotation.z = euler.z;

        this.velocity.x = vel.x;
        this.velocity.y = vel.y;
        this.velocity.z = vel.z;

        this.angularVelocity.x = angVel.x;
        this.angularVelocity.y = angVel.y;
        this.angularVelocity.z = angVel.z;

        // Calculate speed in km/h
        this.speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6;
    }

    /**
     * Sync mesh to entity position
     */
    syncMeshToEntity() {
        if (!this.mesh) return;

        this.mesh.position.set(this.position.x, this.position.y, this.position.z);
        this.mesh.rotation.set(this.rotation.x, this.rotation.y, this.rotation.z);
    }

    /**
     * Sync mesh from physics body (for rendering)
     */
    syncMeshFromPhysics() {
        if (!this.mesh || !this.physicsBody) return;

        const pos = this.physicsBody.translation();
        const rot = this.physicsBody.rotation();

        this.mesh.position.set(pos.x, pos.y, pos.z);
        this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    /**
     * Get forward direction vector
     * @returns {Object} { x, y, z }
     */
    getForwardVector() {
        const angle = this.rotation.y;
        return {
            x: Math.sin(angle),
            y: 0,
            z: Math.cos(angle)
        };
    }

    /**
     * Get serializable state for network sync
     * @returns {Object}
     */
    getNetworkState() {
        return {
            id: this.id,
            playerId: this.playerId,
            position: { ...this.position },
            rotation: { ...this.rotation },
            velocity: { ...this.velocity },
            controls: { ...this.controls },
            health: this.health,
            speed: this.speed,
            currentLap: this.currentLap,
            racePosition: this.racePosition
        };
    }

    /**
     * Apply network state update
     * @param {Object} state
     */
    applyNetworkState(state) {
        if (state.position) {
            this.position = { ...state.position };
        }
        if (state.rotation) {
            this.rotation = { ...state.rotation };
        }
        if (state.velocity) {
            this.velocity = { ...state.velocity };
        }
        if (state.health !== undefined) {
            this.health = state.health;
        }
        if (state.currentLap !== undefined) {
            this.currentLap = state.currentLap;
        }
        if (state.racePosition !== undefined) {
            this.racePosition = state.racePosition;
        }
    }

    /**
     * Convert euler angles to quaternion
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
     * Convert quaternion to euler angles
     * @private
     */
    _quatToEuler(q) {
        const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
        const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
        const x = Math.atan2(sinr_cosp, cosr_cosp);

        const sinp = 2 * (q.w * q.y - q.z * q.x);
        const y = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);

        const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
        const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
        const z = Math.atan2(siny_cosp, cosy_cosp);

        return { x, y, z };
    }

    /**
     * Serialize to JSON
     * @override
     */
    toJSON() {
        return {
            ...super.toJSON(),
            configId: this.configId,
            playerId: this.playerId,
            color: this.color,
            controls: { ...this.controls },
            velocity: { ...this.velocity },
            speed: this.speed,
            health: this.health,
            maxHealth: this.maxHealth,
            currentLap: this.currentLap,
            nextCheckpoint: this.nextCheckpoint,
            racePosition: this.racePosition,
            finished: this.finished
        };
    }
}

// Export for ES Modules
export { Vehicle };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.Vehicle = Vehicle;
}
