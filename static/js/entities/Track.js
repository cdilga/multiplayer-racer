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
            const tangent = this._resolveCheckpointTangent(checkpointConfigs, index);

            return {
                id: cp.id !== undefined ? cp.id : index,
                position: cp.position,
                width: cp.width || 10,
                tangent,  // Track-flow direction (unit vector for oriented gate)
                heightBand: this._normalizeHeightBand(cp.heightBand),  // Y-coordinate acceptance range
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
     * @private
     * @param {Object[]} checkpointConfigs
     * @param {number} index
     * @returns {{x:number,z:number}}
     */
    _resolveCheckpointTangent(checkpointConfigs, index) {
        const explicit = this._normalizeXZ(checkpointConfigs[index]?.tangent);
        if (explicit) return explicit;

        const count = checkpointConfigs.length;
        if (count >= 2) {
            const current = checkpointConfigs[index]?.position;
            const prev = checkpointConfigs[(index - 1 + count) % count]?.position;
            const next = checkpointConfigs[(index + 1) % count]?.position;
            const derived = this._deriveCheckpointTangent(current, prev, next);
            if (derived) return derived;
        }

        return { x: 1, z: 0 };
    }

    /**
     * @private
     * @param {Object|null|undefined} vector
     * @returns {{x:number,z:number}|null}
     */
    _normalizeXZ(vector) {
        const x = Number(vector?.x);
        const z = Number(vector?.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

        const length = Math.hypot(x, z);
        if (length < 1e-3) return null;
        return { x: x / length, z: z / length };
    }

    /**
     * Derive a track-flow tangent from surrounding checkpoints for legacy/simple
     * configs that never stored tangents explicitly.
     * @private
     * @param {Object|null|undefined} current
     * @param {Object|null|undefined} prev
     * @param {Object|null|undefined} next
     * @returns {{x:number,z:number}|null}
     */
    _deriveCheckpointTangent(current, prev, next) {
        const curr = this._normalizePositionXZ(current);
        const prevPos = this._normalizePositionXZ(prev);
        const nextPos = this._normalizePositionXZ(next);

        if (prevPos && nextPos) {
            return this._normalizeXZ({
                x: nextPos.x - prevPos.x,
                z: nextPos.z - prevPos.z
            });
        }
        if (curr && nextPos) {
            return this._normalizeXZ({
                x: nextPos.x - curr.x,
                z: nextPos.z - curr.z
            });
        }
        if (prevPos && curr) {
            return this._normalizeXZ({
                x: curr.x - prevPos.x,
                z: curr.z - prevPos.z
            });
        }
        return null;
    }

    /**
     * @private
     * @param {Object|null|undefined} position
     * @returns {{x:number,z:number}|null}
     */
    _normalizePositionXZ(position) {
        const x = Number(position?.x);
        const z = Number(position?.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
        return { x, z };
    }

    /**
     * @private
     * @param {Object|null|undefined} heightBand
     * @returns {{min:number,max:number}}
     */
    _normalizeHeightBand(heightBand) {
        let min = Number.isFinite(heightBand?.min) ? heightBand.min : -1;
        let max = Number.isFinite(heightBand?.max) ? heightBand.max : 10;
        if (min > max) [min, max] = [max, min];
        if (min === max) max = min + 1e-3;
        return { min, max };
    }

    /**
     * @private
     * @param {Object|null|undefined} position
     * @param {{min:number,max:number}} heightBand
     * @returns {boolean}
     */
    _isWithinHeightBand(position, heightBand) {
        const y = Number(position?.y);
        if (!Number.isFinite(y)) return false;
        return y >= heightBand.min && y <= heightBand.max;
    }

    /**
     * @private
     * @param {number} relX
     * @param {number} relZ
     * @param {{x:number,z:number}} tangent
     * @returns {number}
     */
    _getGatePlaneDistance(relX, relZ, tangent) {
        return relX * tangent.x + relZ * tangent.z;
    }

    /**
     * @private
     * @param {number} relX
     * @param {number} relZ
     * @param {{x:number,z:number}} tangent
     * @returns {number}
     */
    _getCrossTrackDistance(relX, relZ, tangent) {
        return relX * -tangent.z + relZ * tangent.x;
    }

    /**
     * Current-position helper for diagnostics/tests: is the car on the gate
     * slice right now, rather than merely somewhere far along the tangent line.
     * @private
     * @param {number} width
     * @returns {number}
     */
    _getGatePlaneTolerance(width) {
        return Math.max(0.5, Math.min(2, (width || 10) * 0.1));
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
     * Check if a position lies on the checkpoint gate slice right now.
     * @param {Object} position - { x, y, z }
     * @param {number} checkpointIndex
     * @returns {boolean}
     */
    isInCheckpoint(position, checkpointIndex) {
        const checkpoint = this.getCheckpoint(checkpointIndex);
        if (!checkpoint) return false;

        if (!this._isWithinHeightBand(position, checkpoint.heightBand)) return false;

        const cpPos = checkpoint.position;
        const tangent = checkpoint.tangent;
        const halfWidth = checkpoint.width / 2;
        const planeTolerance = this._getGatePlaneTolerance(checkpoint.width);

        const dx = position.x - cpPos.x;
        const dz = position.z - cpPos.z;
        const planeDistance = this._getGatePlaneDistance(dx, dz, tangent);
        const crossTrackDistance = this._getCrossTrackDistance(dx, dz, tangent);
        return Math.abs(planeDistance) <= planeTolerance &&
            Math.abs(crossTrackDistance) <= halfWidth;
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

        if (!this._isWithinHeightBand(prevPosition, checkpoint.heightBand) ||
            !this._isWithinHeightBand(currPosition, checkpoint.heightBand)) return false;

        const cpPos = checkpoint.position;
        const tangent = checkpoint.tangent;
        const halfWidth = checkpoint.width / 2;
        const EPSILON = 1e-6;

        const prevDx = prevPosition.x - cpPos.x;
        const prevDz = prevPosition.z - cpPos.z;
        const currDx = currPosition.x - cpPos.x;
        const currDz = currPosition.z - cpPos.z;

        const prevPlaneDistance = this._getGatePlaneDistance(prevDx, prevDz, tangent);
        const currPlaneDistance = this._getGatePlaneDistance(currDx, currDz, tangent);

        // If the last frame already sat on the plane, let the previous frame own
        // the trigger so we do not double-count while a car rides along the gate.
        if (Math.abs(prevPlaneDistance) <= EPSILON) return false;

        // Segment never reaches the plane this frame.
        if ((prevPlaneDistance < -EPSILON && currPlaneDistance < -EPSILON) ||
            (prevPlaneDistance > EPSILON && currPlaneDistance > EPSILON)) {
            return false;
        }

        const denominator = currPlaneDistance - prevPlaneDistance;
        if (Math.abs(denominator) <= EPSILON) return false;

        const t = -prevPlaneDistance / denominator;
        if (t < -EPSILON || t > 1 + EPSILON) return false;

        const crossingT = Math.min(1, Math.max(0, t));
        const crossingDx = prevDx + crossingT * (currDx - prevDx);
        const crossingDz = prevDz + crossingT * (currDz - prevDz);
        const crossingY = prevPosition.y + crossingT * (currPosition.y - prevPosition.y);
        const crossingCrossTrack = this._getCrossTrackDistance(crossingDx, crossingDz, tangent);

        return Math.abs(crossingCrossTrack) <= halfWidth + EPSILON &&
            crossingY >= checkpoint.heightBand.min - EPSILON &&
            crossingY <= checkpoint.heightBand.max + EPSILON;
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
