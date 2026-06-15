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

import { generateTrackConfig } from './ProceduralTrackGenerator.js';
import { buildDunesGrid } from './terrain.js';

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
        let config;
        if (trackId === 'procedural') {
            // Fresh random circuit every time
            config = generateTrackConfig();
            this.configCache.set(config.id, config);
        } else {
            // Load config if not cached
            config = this.configCache.get(trackId);
            if (!config) {
                config = await this.resourceLoader.loadTrack(trackId);
                this.configCache.set(trackId, config);
            }
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
            case 'square':
                return this._createSquareArena(geometry, visual);
            case 'bowl':
                return this._createBowlArena(geometry, visual);
            case 'dunes':
                return this._createDunesArena(geometry, visual);
            case 'spline':
                return this._createSplineTrack(geometry, visual);
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
     * Create square derby arena surface.
     * @private
     */
    _createSquareArena(geometry, visual) {
        const size = geometry.diameter || geometry.size || 70;
        const segments = 8;

        const arenaGeometry = new THREE.PlaneGeometry(size, size, segments, segments);
        const arenaMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.9,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const arenaMesh = new THREE.Mesh(arenaGeometry, arenaMaterial);
        arenaMesh.rotation.x = -Math.PI / 2;
        arenaMesh.position.y = 0.02;
        arenaMesh.receiveShadow = true;
        arenaMesh.userData = { isTrackSurface: true, isSquareArena: true };

        return arenaMesh;
    }

    /**
     * Create bowl arena for derby mode
     * @private
     */
    _createBowlArena(geometry, visual) {
        const diameter = geometry.diameter || 80;
        const radius = diameter / 2;
        const concavity = geometry.floorConcavity || 0.1;
        const segments = 64;

        // Create a slightly concave circular floor
        const arenaGeometry = new THREE.CircleGeometry(radius, segments);

        // Apply concavity to vertices (bowl shape)
        const positions = arenaGeometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const distFromCenter = Math.sqrt(x * x + y * y);
            const normalizedDist = distFromCenter / radius;
            // Bowl curve: lower at center, higher at edges
            const height = (normalizedDist * normalizedDist) * concavity * radius;
            positions.setZ(i, -height);
        }
        arenaGeometry.computeVertexNormals();

        const arenaMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.85,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const arenaMesh = new THREE.Mesh(arenaGeometry, arenaMaterial);
        arenaMesh.rotation.x = -Math.PI / 2;
        arenaMesh.position.y = 0.02;
        arenaMesh.receiveShadow = true;
        arenaMesh.userData = { isTrackSurface: true, isBowl: true };

        return arenaMesh;
    }

    /**
     * Create rolling dunes arena surface (derby). Built from the shared
     * terrain grid so it lines up exactly with the physics trimesh.
     * @private
     */
    _createDunesArena(geometry, visual) {
        const { vertices, indices } = buildDunesGrid(geometry);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geo.setIndex(new THREE.BufferAttribute(indices, 1));
        geo.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.95,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData = { isTrackSurface: true, isDunes: true };

        return mesh;
    }

    /**
     * Create a ramp wedge visual mesh (a tilted ramp surface the car drives up)
     * @private
     */
    _createRampMesh(ramp, visual, base) {
        const length = ramp.length || 10;
        const width = ramp.width || 7;
        const rise = ramp.rise || 3;
        const thickness = 0.6;
        const pitch = Math.atan2(rise, length);
        const slantLen = Math.sqrt(length * length + rise * rise);

        const geo = new THREE.BoxGeometry(width, thickness, slantLen);
        const material = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color || '#888066'),
            roughness: visual.roughness || 0.7,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const mesh = new THREE.Mesh(geo, material);
        // Yaw to the ramp heading, then pitch up so the far end is raised.
        // Matches the physics collider orientation in PhysicsSystem.
        mesh.rotation.order = 'YXZ';
        mesh.rotation.y = ramp.heading || 0;
        mesh.rotation.x = -pitch;
        mesh.position.set(ramp.x, (base || 0) + thickness / 2 + rise / 2, ramp.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { isRamp: true };

        return mesh;
    }

    /**
     * Create procedural spline track as a ribbon between edge loops
     * @private
     */
    _createSplineTrack(geometry, visual) {
        const left = geometry.leftEdge;
        const right = geometry.rightEdge;
        if (!left || !right || left.length !== right.length) {
            console.warn('Spline track missing edge data');
            return null;
        }

        const n = left.length;
        const positions = new Float32Array(n * 2 * 3 + 6);
        const indices = [];

        // Vertex pairs (left, right) along the loop
        for (let i = 0; i < n; i++) {
            positions[i * 6 + 0] = left[i].x;
            positions[i * 6 + 1] = 0.01;
            positions[i * 6 + 2] = left[i].z;
            positions[i * 6 + 3] = right[i].x;
            positions[i * 6 + 4] = 0.01;
            positions[i * 6 + 5] = right[i].z;
        }
        // Closing pair duplicates the first
        positions[n * 6 + 0] = left[0].x;
        positions[n * 6 + 1] = 0.01;
        positions[n * 6 + 2] = left[0].z;
        positions[n * 6 + 3] = right[0].x;
        positions[n * 6 + 4] = 0.01;
        positions[n * 6 + 5] = right[0].z;

        for (let i = 0; i < n; i++) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = i * 2 + 2;
            const d = i * 2 + 3;
            indices.push(a, b, c, b, d, c);
        }

        const trackGeometry = new THREE.BufferGeometry();
        trackGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        trackGeometry.setIndex(indices);
        trackGeometry.computeVertexNormals();

        const trackMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.85,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0
        });

        const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
        trackMesh.receiveShadow = true;
        trackMesh.userData = { isTrackSurface: true };

        return trackMesh;
    }

    /**
     * Create glowing barrier wall mesh along an edge loop
     * @private
     */
    _createEdgeBarrierMesh(points, height, visual) {
        const n = points.length;
        const positions = new Float32Array((n + 1) * 2 * 3);
        const indices = [];

        for (let i = 0; i <= n; i++) {
            const point = points[i % n];
            positions[i * 6 + 0] = point.x;
            positions[i * 6 + 1] = 0;
            positions[i * 6 + 2] = point.z;
            positions[i * 6 + 3] = point.x;
            positions[i * 6 + 4] = height;
            positions[i * 6 + 5] = point.z;
        }

        for (let i = 0; i < n; i++) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = i * 2 + 2;
            const d = i * 2 + 3;
            indices.push(a, b, c, b, d, c);
        }

        const wallGeometry = new THREE.BufferGeometry();
        wallGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        wallGeometry.setIndex(indices);
        wallGeometry.computeVertexNormals();

        const wallMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.6,
            side: THREE.DoubleSide,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0.5
        });

        const wall = new THREE.Mesh(wallGeometry, wallMaterial);
        wall.castShadow = true;
        wall.receiveShadow = true;
        wall.userData = { isBarrier: true, barrierType: 'spline-wall' };

        return wall;
    }

    /**
     * Create start/finish line marking for spline tracks
     * @private
     */
    _createStartLine(geometry, visual) {
        const left = geometry.leftEdge?.[0];
        const right = geometry.rightEdge?.[0];
        if (!left || !right) return null;

        const dx = right.x - left.x;
        const dz = right.z - left.z;
        const length = Math.sqrt(dx * dx + dz * dz);

        const lineGeometry = new THREE.PlaneGeometry(length, 2);
        lineGeometry.rotateX(-Math.PI / 2);
        const lineMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color || '#ffffff'),
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0xffffff,
            emissiveIntensity: visual.emissiveIntensity || 0.8,
            side: THREE.DoubleSide
        });

        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        // Yaw so the plane's long axis spans from left edge to right edge
        line.rotation.y = Math.atan2(-dz, dx);
        line.position.set((left.x + right.x) / 2, 0.03, (left.z + right.z) / 2);
        line.userData = { isStartLine: true };

        return line;
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

        const barrierHeight = geometry.barrierHeight || geometry.wallHeight || 2;
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
        } else if (geometry.type === 'bowl') {
            // Create outer wall for bowl arena
            const diameter = geometry.diameter || 80;
            const radius = diameter / 2;
            const wallHeight = geometry.wallHeight || 15;
            const wallSlope = geometry.wallSlope || 30;

            const outerWall = this._createBowlWall(
                radius,
                wallHeight,
                wallSlope,
                visual
            );
            barriers.push(outerWall);
        } else if (geometry.type === 'square') {
            // Create a single square wall group so derby shrinking can scale it
            const size = geometry.diameter || geometry.size || 70;
            const wallHeight = geometry.wallHeight || barrierHeight;
            const squareWall = this._createSquareWall(
                size,
                wallHeight,
                barrierThickness,
                visual
            );
            barriers.push(squareWall);
        } else if (geometry.type === 'dunes') {
            // Tall containment wall at the arena edge (cars ride up the rolling
            // rim and can catch air, but can't escape the arena)
            const radius = geometry.radius || 70;
            const wallHeight = geometry.wallHeight || 14;
            const wall = this._createBowlWall(radius, wallHeight, 20, visual);
            barriers.push(wall);
        } else if (geometry.type === 'spline') {
            // Glowing walls along both edges of the procedural circuit
            const height = geometry.barrierHeight || 1.4;
            barriers.push(this._createEdgeBarrierMesh(geometry.leftEdge, height, visual));
            barriers.push(this._createEdgeBarrierMesh(geometry.rightEdge, height, visual));

            // Start/finish line marking
            const startLine = this._createStartLine(geometry, config.visual.lineMarkings || {});
            if (startLine) barriers.push(startLine);
        }

        // Optional map-authored stunt ramps. These are returned with the
        // static track objects so they render with the track, but they are not
        // tagged as barriers and do not affect wall shrinking.
        const ramps = geometry.ramps || [];
        const rampVisual = config.visual.ramps || config.visual.track || {};
        const base = geometry.base || 0;
        ramps.forEach(ramp => {
            barriers.push(this._createRampMesh(ramp, rampVisual, base));
        });

        return barriers;
    }

    /**
     * Create square wall group for a derby arena.
     * @private
     */
    _createSquareWall(size, height, thickness, visual) {
        const wallGroup = new THREE.Group();
        wallGroup.userData = { isBarrier: true, barrierType: 'square-wall' };

        const material = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.65,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0,
            side: THREE.DoubleSide
        });
        const rimMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.65,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: (visual.emissiveIntensity || 0) * 1.4
        });

        const half = size / 2;
        const wallThickness = Math.max(1, thickness || 1);
        const wallLength = size + wallThickness * 2;
        const walls = [
            { width: wallLength, depth: wallThickness, x: 0, z: -half },
            { width: wallLength, depth: wallThickness, x: 0, z: half },
            { width: wallThickness, depth: wallLength, x: -half, z: 0 },
            { width: wallThickness, depth: wallLength, x: half, z: 0 }
        ];

        walls.forEach((wallSpec) => {
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(wallSpec.width, height, wallSpec.depth),
                material
            );
            wall.position.set(wallSpec.x, height / 2, wallSpec.z);
            wall.castShadow = true;
            wall.receiveShadow = true;
            wallGroup.add(wall);

            const rim = new THREE.Mesh(
                new THREE.BoxGeometry(wallSpec.width, wallThickness * 0.35, wallSpec.depth),
                rimMaterial
            );
            rim.position.set(wallSpec.x, height + wallThickness * 0.175, wallSpec.z);
            rim.castShadow = true;
            wallGroup.add(rim);
        });

        return wallGroup;
    }

    /**
     * Create sloped wall for bowl arena
     * @private
     */
    _createBowlWall(radius, height, slopeAngle, visual) {
        const wallGroup = new THREE.Group();
        wallGroup.userData = { isBarrier: true, barrierType: 'bowl-wall' };

        const material = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.7,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: visual.emissiveIntensity || 0,
            side: THREE.DoubleSide
        });

        // Create a sloped cylinder wall
        const segments = 64;
        const slopeRad = (slopeAngle * Math.PI) / 180;
        const topRadius = radius + Math.tan(slopeRad) * height;
        const thickness = 1;

        // Create outer cylinder (visible wall)
        const wallGeometry = new THREE.CylinderGeometry(
            topRadius,      // top radius
            radius,         // bottom radius
            height,         // height
            segments,       // radial segments
            1,              // height segments
            true            // open ended
        );

        const wall = new THREE.Mesh(wallGeometry, material);
        wall.position.y = height / 2;
        wall.castShadow = true;
        wall.receiveShadow = true;
        wallGroup.add(wall);

        // Add a rim at the top for visibility
        const rimGeometry = new THREE.TorusGeometry(topRadius, thickness / 2, 8, segments);
        const rimMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(visual.color),
            roughness: visual.roughness || 0.7,
            emissive: visual.emissive ? this._parseColor(visual.emissive) : 0x000000,
            emissiveIntensity: (visual.emissiveIntensity || 0) * 1.5
        });
        const rim = new THREE.Mesh(rimGeometry, rimMaterial);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = height;
        wallGroup.add(rim);

        return wallGroup;
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
