/**
 * TrackFactory - Creates track entities from JSON definitions
 *
 * Handles creation of track geometry, barriers, checkpoints, and spawn points.
 *
 * Usage:
 *   import { TrackFactory } from './resources/TrackFactory.js';
 *
 *   const factory = new TrackFactory({ resourceLoader, eventBus });
 *   const track = await factory.create('oval');
 */

class TrackFactory {
    /**
     * @param {Object} options
     * @param {ResourceLoader} options.resourceLoader - Resource loader instance
     * @param {EventBus} [options.eventBus] - EventBus for events
     */
    constructor(options = {}) {
        this.resourceLoader = options.resourceLoader ||
            (typeof window !== 'undefined' ? window.getResourceLoader?.() : null);
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        // Cache for track configs
        this.configCache = new Map();
    }

    /**
     * Create a track from a definition
     * @param {string} trackId - Track ID (e.g., 'oval')
     * @returns {Promise<Object>} Track data with visual and physics components
     */
    async create(trackId) {
        // Load config if not cached
        let config = this.configCache.get(trackId);
        if (!config) {
            config = await this.resourceLoader.loadTrack(trackId);
            this.configCache.set(trackId, config);
        }

        // Create container group
        const trackGroup = new THREE.Group();
        trackGroup.userData = { trackId: config.id };

        // Create ground plane
        const ground = this._createGround(config);
        trackGroup.add(ground);

        // Create track surface based on type
        const trackSurface = this._createTrackSurface(config);
        if (trackSurface) {
            trackGroup.add(trackSurface);
        }

        // Create barriers
        const barriers = this._createBarriers(config);
        barriers.forEach(barrier => trackGroup.add(barrier));

        // Create track data object
        const track = {
            id: config.id,
            config: config,
            mesh: trackGroup,
            ground: ground,
            barriers: barriers,

            // Spawn points
            spawnPositions: config.spawn.positions,
            defaultSpawnHeight: config.spawn.defaultHeight || 1.5,

            // Race config
            checkpoints: config.checkpoints,
            defaultLaps: config.race?.defaultLaps || 3,

            // Physics bodies (created by PhysicsSystem)
            groundBody: null,
            barrierBodies: []
        };

        this._emit('track:created', { track, config });

        return track;
    }

    /**
     * Create ground plane
     * @private
     */
    _createGround(config) {
        const visual = config.visual.ground;
        const size = visual.size || 200;

        const geometry = new THREE.PlaneGeometry(size, size);
        const material = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: 0.9,
            side: THREE.DoubleSide
        });

        const ground = new THREE.Mesh(geometry, material);
        ground.rotation.x = -Math.PI / 2;  // Lay flat
        ground.position.y = 0;
        ground.receiveShadow = true;
        ground.userData = { isGround: true };

        return ground;
    }

    /**
     * Create track surface based on geometry type
     * @private
     */
    _createTrackSurface(config) {
        const geometry = config.geometry;
        const visual = config.visual.track;

        switch (geometry.type) {
            case 'oval':
                return this._createOvalTrack(geometry, visual);
            case 'rectangle':
                return this._createRectangleTrack(geometry, visual);
            case 'custom':
                return this._createCustomTrack(geometry, visual);
            default:
                console.warn(`Unknown track type: ${geometry.type}`);
                return null;
        }
    }

    /**
     * Create oval track surface
     * @private
     */
    _createOvalTrack(geometry, visual) {
        const innerRadius = geometry.innerRadius;
        const outerRadius = geometry.outerRadius;
        const segments = 64;

        // Create ring geometry for oval track
        const trackShape = new THREE.Shape();

        // Outer circle
        trackShape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);

        // Inner circle (hole)
        const holePath = new THREE.Path();
        holePath.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
        trackShape.holes.push(holePath);

        const trackGeometry = new THREE.ShapeGeometry(trackShape, segments);
        const trackMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.9,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
        trackMesh.rotation.x = -Math.PI / 2;
        trackMesh.position.y = 0.01;  // Slightly above ground
        trackMesh.receiveShadow = true;
        trackMesh.userData = { isTrackSurface: true };

        return trackMesh;
    }

    /**
     * Create rectangle track surface
     * @private
     */
    _createRectangleTrack(geometry, visual) {
        const width = geometry.width || 100;
        const length = geometry.length || 150;
        const trackWidth = geometry.trackWidth || 10;

        // Create rectangular track shape with hole
        const trackShape = new THREE.Shape();

        const outerW = width / 2;
        const outerL = length / 2;
        const innerW = outerW - trackWidth;
        const innerL = outerL - trackWidth;

        // Outer rectangle
        trackShape.moveTo(-outerW, -outerL);
        trackShape.lineTo(outerW, -outerL);
        trackShape.lineTo(outerW, outerL);
        trackShape.lineTo(-outerW, outerL);
        trackShape.lineTo(-outerW, -outerL);

        // Inner rectangle (hole)
        const holePath = new THREE.Path();
        holePath.moveTo(-innerW, -innerL);
        holePath.lineTo(-innerW, innerL);
        holePath.lineTo(innerW, innerL);
        holePath.lineTo(innerW, -innerL);
        holePath.lineTo(-innerW, -innerL);
        trackShape.holes.push(holePath);

        const trackGeometry = new THREE.ShapeGeometry(trackShape);
        const trackMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.9,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
        trackMesh.rotation.x = -Math.PI / 2;
        trackMesh.position.y = 0.01;
        trackMesh.receiveShadow = true;
        trackMesh.userData = { isTrackSurface: true };

        return trackMesh;
    }

    /**
     * Create custom track from path data
     * @private
     */
    _createCustomTrack(geometry, visual) {
        // Placeholder for custom track paths
        console.log('Custom track type - implement path-based creation');
        return null;
    }

    /**
     * Create barriers around track
     * @private
     */
    _createBarriers(config) {
        const barriers = [];
        const geometry = config.geometry;
        const visual = config.visual.barriers;

        const barrierHeight = geometry.barrierHeight || 2;
        const barrierThickness = geometry.barrierThickness || 0.5;

        if (geometry.type === 'oval') {
            // Create circular barriers
            const innerBarrier = this._createCircularBarrier(
                geometry.innerRadius - barrierThickness / 2,
                barrierHeight,
                barrierThickness,
                visual,
                'inner'
            );
            const outerBarrier = this._createCircularBarrier(
                geometry.outerRadius + barrierThickness / 2,
                barrierHeight,
                barrierThickness,
                visual,
                'outer'
            );

            barriers.push(innerBarrier, outerBarrier);
        }

        return barriers;
    }

    /**
     * Create circular barrier (smooth curb)
     * @private
     */
    _createCircularBarrier(radius, height, thickness, visual, type) {
        const barrierGroup = new THREE.Group();
        barrierGroup.userData = { isBarrier: true, barrierType: type };

        const material = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.7,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        // Create a smooth ring using TorusGeometry for a curb-like appearance
        // For low curbs, we use a half-circle cross-section (tube)
        const tubeRadius = Math.min(height, thickness) / 2;
        const torusGeometry = new THREE.TorusGeometry(radius, tubeRadius, 8, 64);
        const torus = new THREE.Mesh(torusGeometry, material);

        // Rotate to lie flat and position at ground level
        torus.rotation.x = Math.PI / 2;
        torus.position.y = tubeRadius;

        torus.castShadow = true;
        torus.receiveShadow = true;
        barrierGroup.add(torus);

        // Add a flat top strip for the curb surface
        const ringGeometry = new THREE.RingGeometry(
            radius - thickness / 2,
            radius + thickness / 2,
            64
        );
        const topMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.7,
            side: THREE.DoubleSide
        });
        const topRing = new THREE.Mesh(ringGeometry, topMaterial);
        topRing.rotation.x = -Math.PI / 2;
        topRing.position.y = height;
        topRing.receiveShadow = true;
        barrierGroup.add(topRing);

        return barrierGroup;
    }

    /**
     * Get spawn position for a player index
     * @param {Object} track - Track object
     * @param {number} playerIndex - Player index (0-based)
     * @returns {Object} Position { x, y, z, rotation }
     */
    getSpawnPosition(track, playerIndex) {
        const spawns = track.spawnPositions;
        const index = playerIndex % spawns.length;
        const spawn = spawns[index];

        return {
            x: spawn.x,
            y: spawn.y || track.defaultSpawnHeight,
            z: spawn.z,
            rotation: spawn.rotation || 0
        };
    }

    /**
     * Get physics config for track
     * @param {string} trackId - Track ID
     * @returns {Promise<Object>}
     */
    async getPhysicsConfig(trackId) {
        let config = this.configCache.get(trackId);
        if (!config) {
            config = await this.resourceLoader.loadTrack(trackId);
            this.configCache.set(trackId, config);
        }
        return config.physics;
    }

    /**
     * Parse color
     * @private
     */
    _parseColor(colorValue) {
        if (typeof colorValue === 'number') {
            return colorValue;
        }
        if (typeof colorValue === 'string') {
            return new THREE.Color(colorValue).getHex();
        }
        return 0x888888;
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
}

// Export for ES Modules
export { TrackFactory };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.TrackFactory = TrackFactory;
}
