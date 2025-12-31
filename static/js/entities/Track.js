/**
 * Track - Track entity for racing game
 *
 * Represents the race track with:
 * - Visual mesh (Three.js)
 * - Physics colliders (Rapier)
 * - Spawn positions
 * - Checkpoints
 *
 * Usage:
 *   const track = new Track({
 *     config: trackConfig
 *   });
 */

import { Entity } from './Entity.js';

class Track extends Entity {
    /**
     * @param {Object} options
     * @param {Object} options.config - Track configuration from JSON
     */
    constructor(options = {}) {
        super({
            type: 'track',
            id: options.config?.id || 'track',
            tags: ['track', 'static']
        });

        this.config = options.config;
        this.configId = options.config?.id || 'default';

        // Visual components (Three.js)
        this.mesh = null;         // Main track group
        this.groundMesh = null;   // Ground plane
        this.barrierMeshes = [];  // Barrier meshes

        // Physics components (Rapier)
        this.groundBody = null;
        this.barrierBodies = [];

        // Track data
        this.spawnPositions = options.config?.spawn?.positions || [];
        this.defaultSpawnHeight = options.config?.spawn?.defaultHeight || 1.5;

        // Checkpoint data
        this.checkpoints = this._initCheckpoints(options.config?.checkpoints || []);
        this.finishLineIndex = this._findFinishLine();

        // Race configuration
        this.defaultLaps = options.config?.race?.defaultLaps || 3;
        this.checkpointOrder = options.config?.race?.checkpointOrder || [];
    }

    /**
     * Initialize checkpoints with runtime data
     * @private
     */
    _initCheckpoints(checkpointConfigs) {
        return checkpointConfigs.map((cp, index) => ({
            id: cp.id !== undefined ? cp.id : index,
            position: cp.position,
            width: cp.width || 10,
            isFinishLine: cp.isFinishLine || false,
            // Runtime collision mesh (created by PhysicsSystem)
            triggerBody: null
        }));
    }

    /**
     * Find the finish line checkpoint index
     * @private
     */
    _findFinishLine() {
        for (let i = 0; i < this.checkpoints.length; i++) {
            if (this.checkpoints[i].isFinishLine) {
                return i;
            }
        }
        return 0;  // Default to first checkpoint
    }

    /**
     * Set the visual mesh group
     * @param {THREE.Group} mesh
     */
    setMesh(mesh) {
        this.mesh = mesh;
        this.mesh.userData.entityId = this.id;
        this.mesh.userData.entity = this;

        // Extract sub-meshes
        mesh.traverse((child) => {
            if (child.userData?.isGround) {
                this.groundMesh = child;
            }
            if (child.userData?.isBarrier) {
                this.barrierMeshes.push(child);
            }
        });
    }

    /**
     * Set physics bodies
     * @param {Object} groundBody - Ground rigid body
     * @param {Object[]} barrierBodies - Barrier rigid bodies
     */
    setPhysicsBodies(groundBody, barrierBodies = []) {
        this.groundBody = groundBody;
        this.barrierBodies = barrierBodies;
    }

    /**
     * Get spawn position for a player index
     * @param {number} playerIndex - 0-based player index
     * @returns {Object} { x, y, z, rotation }
     */
    getSpawnPosition(playerIndex) {
        if (this.spawnPositions.length === 0) {
            // Default spawn if none defined
            return {
                x: 0,
                y: this.defaultSpawnHeight,
                z: 0,
                rotation: 0
            };
        }

        const index = playerIndex % this.spawnPositions.length;
        const spawn = this.spawnPositions[index];

        return {
            x: spawn.x,
            y: spawn.y || this.defaultSpawnHeight,
            z: spawn.z,
            rotation: spawn.rotation || 0
        };
    }

    /**
     * Get all spawn positions
     * @returns {Object[]}
     */
    getAllSpawnPositions() {
        return this.spawnPositions.map(spawn => ({
            x: spawn.x,
            y: spawn.y || this.defaultSpawnHeight,
            z: spawn.z,
            rotation: spawn.rotation || 0
        }));
    }

    /**
     * Get checkpoint by index
     * @param {number} index
     * @returns {Object|null}
     */
    getCheckpoint(index) {
        if (index < 0 || index >= this.checkpoints.length) {
            return null;
        }
        return this.checkpoints[index];
    }

    /**
     * Get next checkpoint index (wrapping)
     * @param {number} currentIndex
     * @returns {number}
     */
    getNextCheckpointIndex(currentIndex) {
        return (currentIndex + 1) % this.checkpoints.length;
    }

    /**
     * Check if a position is within a checkpoint zone
     * @param {Object} position - { x, y, z }
     * @param {number} checkpointIndex
     * @returns {boolean}
     */
    isInCheckpoint(position, checkpointIndex) {
        const checkpoint = this.getCheckpoint(checkpointIndex);
        if (!checkpoint) return false;

        const cpPos = checkpoint.position;
        const halfWidth = checkpoint.width / 2;

        // Simple box check (can be improved with oriented boxes)
        const dx = Math.abs(position.x - cpPos.x);
        const dz = Math.abs(position.z - cpPos.z);

        return dx < halfWidth && dz < halfWidth;
    }

    /**
     * Get number of checkpoints
     * @returns {number}
     */
    getCheckpointCount() {
        return this.checkpoints.length;
    }

    /**
     * Check if checkpoint is the finish line
     * @param {number} checkpointIndex
     * @returns {boolean}
     */
    isFinishLine(checkpointIndex) {
        const checkpoint = this.getCheckpoint(checkpointIndex);
        return checkpoint?.isFinishLine || false;
    }

    /**
     * Get track bounds (approximate)
     * @returns {Object} { minX, maxX, minZ, maxZ }
     */
    getBounds() {
        const geometry = this.config?.geometry;

        if (geometry?.type === 'oval') {
            const outer = geometry.outerRadius || 25;
            return {
                minX: -outer,
                maxX: outer,
                minZ: -outer,
                maxZ: outer
            };
        }

        if (geometry?.type === 'rectangle') {
            const hw = (geometry.width || 100) / 2;
            const hl = (geometry.length || 150) / 2;
            return {
                minX: -hw,
                maxX: hw,
                minZ: -hl,
                maxZ: hl
            };
        }

        // Default bounds
        return {
            minX: -50,
            maxX: 50,
            minZ: -50,
            maxZ: 50
        };
    }

    /**
     * Check if position is out of bounds
     * @param {Object} position - { x, z }
     * @param {number} [margin=10] - Extra margin outside track
     * @returns {boolean}
     */
    isOutOfBounds(position, margin = 10) {
        const bounds = this.getBounds();
        return (
            position.x < bounds.minX - margin ||
            position.x > bounds.maxX + margin ||
            position.z < bounds.minZ - margin ||
            position.z > bounds.maxZ + margin
        );
    }

    /**
     * Get lighting configuration
     * @returns {Object}
     */
    getLightingConfig() {
        return this.config?.lighting || {
            ambient: { color: '#ffffff', intensity: 0.6 },
            directional: {
                color: '#ffffff',
                intensity: 0.8,
                position: { x: 50, y: 100, z: 50 },
                castShadow: true
            }
        };
    }

    /**
     * Serialize to JSON
     * @override
     */
    toJSON() {
        return {
            ...super.toJSON(),
            configId: this.configId,
            defaultLaps: this.defaultLaps,
            checkpointCount: this.checkpoints.length,
            spawnCount: this.spawnPositions.length
        };
    }
}

// Export for ES Modules
export { Track };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.Track = Track;
}
