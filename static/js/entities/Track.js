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

        // Generated spawns (for arbitrary player counts)
        this.generatedSpawns = null;
        this.spawnGenerationMetadata = null;
    }

    /**
     * Initialize checkpoints with runtime data
     * Normalizes tangent vectors and ensures height bands are valid
     * @private
     */
    _initCheckpoints(checkpointConfigs) {
        return checkpointConfigs.map((cp, index) => {
            // Ensure tangent is normalized and valid
            let tangent = cp.tangent || { x: 1, z: 0 };
            const tanLen = Math.sqrt(tangent.x * tangent.x + tangent.z * tangent.z);
            if (tanLen < 0.001) {
                // Malformed tangent, use default
                tangent = { x: 1, z: 0 };
            } else if (Math.abs(tanLen - 1) > 0.001) {
                // Normalize if not already unit length
                tangent = { x: tangent.x / tanLen, z: tangent.z / tanLen };
            }

            return {
                id: cp.id !== undefined ? cp.id : index,
                position: cp.position,
                width: cp.width || 10,
                tangent,  // Track-flow direction (unit vector for oriented gate)
                heightBand: cp.heightBand || { min: -1, max: 10 },  // Y-coordinate acceptance range
                isFinishLine: cp.isFinishLine || false,
                // Runtime collision mesh (created by PhysicsSystem)
                triggerBody: null
            };
        });
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
     * Get the visual mesh group
     * @returns {THREE.Group|null}
     */
    getMesh() {
        return this.mesh;
    }

    /**
     * Get the ground mesh
     * @returns {THREE.Mesh|null}
     */
    get ground() {
        return this.groundMesh;
    }

    /**
     * Get barrier meshes (alias for barrierMeshes)
     * @returns {THREE.Mesh[]}
     */
    get barriers() {
        return this.barrierMeshes;
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
     * Get spawn position for a player index (no modulo wrapping).
     * Removed the old modulo behavior that caused player 17 to spawn on player 1.
     * Now returns null if index exceeds spawn set, or falls back to a default.
     *
     * For arbitrary player counts, first call setGeneratedSpawns() with results
     * from generateSpawnsForTrack() in SpawnGenerator.
     *
     * @param {number} playerIndex - 0-based player index
     * @returns {Object} { x, y, z, rotation } (fallback if out of bounds)
     */
    getSpawnPosition(playerIndex) {
        // Use generated spawns if available (preferred)
        const spawnSet = this.generatedSpawns || this.spawnPositions;

        if (spawnSet.length === 0) {
            // Default spawn if none defined
            return {
                x: 0,
                y: this.defaultSpawnHeight,
                z: 0,
                rotation: 0
            };
        }

        // FIXED: No modulo wrapping. Use boundary checking instead.
        // If caller doesn't generate spawns for high player counts,
        // fallback to origin (won't overlap) rather than wrapping to player 0.
        if (playerIndex < 0 || playerIndex >= spawnSet.length) {
            // Out of bounds: fallback to safe default
            // Caller SHOULD have called setGeneratedSpawns() first if expecting many players.
            console.warn(`Track.getSpawnPosition: index ${playerIndex} out of bounds for ${spawnSet.length} spawns. Returning default.`);
            return {
                x: 0,
                y: this.defaultSpawnHeight,
                z: 0,
                rotation: 0
            };
        }

        const spawn = spawnSet[playerIndex];

        return {
            x: spawn.x || spawn.position?.x || 0,
            y: spawn.y || spawn.position?.y || this.defaultSpawnHeight,
            z: spawn.z || spawn.position?.z || 0,
            rotation: spawn.rotation || spawn.headingRad || 0
        };
    }

    /**
     * Set generated spawn positions (from SpawnGenerator).
     * Replaces the base spawn set with a generated one for arbitrary player counts.
     *
     * @param {Object} generationResult - Result from generateSpawnsForTrack()
     */
    setGeneratedSpawns(generationResult) {
        if (!generationResult || !generationResult.spawns) return false;
        this.generatedSpawns = generationResult.spawns;
        this.spawnGenerationMetadata = generationResult.diagnostics || {};
        return true;
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
     * Check if a position is within a checkpoint zone (height-aware, oriented gate)
     * Uses the checkpoint tangent for oriented crossing detection on curved tracks.
     * @param {Object} position - { x, y, z }
     * @param {number} checkpointIndex
     * @returns {boolean}
     */
    isInCheckpoint(position, checkpointIndex) {
        const checkpoint = this.getCheckpoint(checkpointIndex);
        if (!checkpoint) return false;

        // Check height band: vehicle must be within acceptable Y range
        if (position.y < checkpoint.heightBand.min || position.y > checkpoint.heightBand.max) {
            return false;
        }

        // Compute perpendicular distance to checkpoint gate using tangent vector
        const cpPos = checkpoint.position;
        const tangent = checkpoint.tangent;
        const halfWidth = checkpoint.width / 2;

        // Vector from checkpoint to vehicle
        const dx = position.x - cpPos.x;
        const dz = position.z - cpPos.z;

        // Project onto tangent to get along-track distance
        const alongTrack = dx * tangent.x + dz * tangent.z;

        // Perpendicular distance is the component perpendicular to tangent
        // perpDist = |(-tangent.z * dx + tangent.x * dz)|
        const perpDist = Math.abs(-tangent.z * dx + tangent.x * dz);

        // Vehicle must be within the gate width in perpendicular direction
        // AND within reasonable along-track distance to avoid false triggers from far away
        return perpDist < halfWidth && Math.abs(alongTrack) < halfWidth * 2;
    }

    /**
     * Helper: Compute perpendicular distance from a point to a gate's perpendicular plane
     * @private
     * @param {Object} position - { x, y, z }
     * @param {Object} checkpoint - checkpoint with position and tangent
     * @returns {number} perpendicular distance (absolute value)
     */
    _getCheckpointPerpDistance(position, checkpoint) {
        const cpPos = checkpoint.position;
        const tangent = checkpoint.tangent;
        const dx = position.x - cpPos.x;
        const dz = position.z - cpPos.z;
        return Math.abs(-tangent.z * dx + tangent.x * dz);
    }

    /**
     * Test if a vehicle crossed the checkpoint gate plane between two frames
     * A crossing is detected when a line segment (prevPos -> currPos) crosses
     * the gate plane perpendicular to the checkpoint's tangent direction.
     *
     * This prevents false positives from:
     * - Vehicles far along the tangent line that never actually cross the gate
     * - Vehicles moving so fast they skip over the gate in one frame
     * - Vehicles staying "in" the checkpoint region multiple frames
     *
     * @param {Object} prevPosition - Previous frame position { x, y, z }
     * @param {Object} currPosition - Current frame position { x, y, z }
     * @param {number} checkpointIndex - Index of checkpoint to test
     * @returns {boolean} True if the vehicle crossed the gate plane this frame
     */
    checkCrossing(prevPosition, currPosition, checkpointIndex) {
        const checkpoint = this.getCheckpoint(checkpointIndex);
        if (!checkpoint) return false;

        // Both positions must be within height band
        if (prevPosition.y < checkpoint.heightBand.min || prevPosition.y > checkpoint.heightBand.max ||
            currPosition.y < checkpoint.heightBand.min || currPosition.y > checkpoint.heightBand.max) {
            return false;
        }

        const cpPos = checkpoint.position;
        const tangent = checkpoint.tangent;
        const halfWidth = checkpoint.width / 2;

        // Vector from checkpoint to positions (in X-Z plane)
        const prevDx = prevPosition.x - cpPos.x;
        const prevDz = prevPosition.z - cpPos.z;
        const currDx = currPosition.x - cpPos.x;
        const currDz = currPosition.z - cpPos.z;

        // Perpendicular distances (signed to detect crossing)
        // perpDist = -tangent.z * dx + tangent.x * dz (no absolute value for crossing detection)
        const prevPerpDist = -tangent.z * prevDx + tangent.x * prevDz;
        const currPerpDist = -tangent.z * currDx + tangent.x * currDz;

        // Check if perpendicular distance changed sign (crossed the gate plane)
        // The gate plane is at perpDist = 0 (the checkpoint's perpendicular line)
        const crossedGate = (prevPerpDist < 0 && currPerpDist > 0) || (prevPerpDist > 0 && currPerpDist < 0);

        // If not crossed, return false
        if (!crossedGate) return false;

        // Crossed the gate plane. Now check:
        // 1. The crossing point is within the gate width
        // 2. The crossing point is within reasonable along-track distance (not far behind/ahead)

        // Interpolate to find the crossing point (where perpDist = 0)
        const t = -prevPerpDist / (currPerpDist - prevPerpDist);
        if (t < 0 || t > 1) return false; // Crossing outside the segment

        // At crossing point, check perpendicular distance is within gate width
        const crossingPerpDist = prevPerpDist + t * (currPerpDist - prevPerpDist);
        if (Math.abs(crossingPerpDist) > halfWidth) return false;

        // Check crossing point's along-track distance is reasonable
        // This prevents false positives from vehicles far ahead or far behind the gate
        const crossingDx = prevDx + t * (currDx - prevDx);
        const crossingDz = prevDz + t * (currDz - prevDz);
        const crossingAlongTrack = crossingDx * tangent.x + crossingDz * tangent.z;
        const alongTrackTolerance = halfWidth * 2;

        return Math.abs(crossingAlongTrack) <= alongTrackTolerance;
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

        if (geometry?.type === 'spline' && geometry.rightEdge?.length) {
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (const point of geometry.rightEdge) {
                if (point.x < minX) minX = point.x;
                if (point.x > maxX) maxX = point.x;
                if (point.z < minZ) minZ = point.z;
                if (point.z > maxZ) maxZ = point.z;
            }
            return { minX, maxX, minZ, maxZ };
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

        if (geometry?.type === 'square') {
            const half = (geometry.diameter || geometry.size || 70) / 2;
            return {
                minX: -half,
                maxX: half,
                minZ: -half,
                maxZ: half
            };
        }

        if (geometry?.type === 'bowl') {
            const radius = (geometry.diameter || 80) / 2;
            return {
                minX: -radius,
                maxX: radius,
                minZ: -radius,
                maxZ: radius
            };
        }

        if (geometry?.type === 'dunes') {
            const radius = geometry.radius || (geometry.diameter || 140) / 2;
            return {
                minX: -radius,
                maxX: radius,
                minZ: -radius,
                maxZ: radius
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
