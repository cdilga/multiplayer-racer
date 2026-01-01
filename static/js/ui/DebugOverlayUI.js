/**
 * DebugOverlayUI - Physics bounding box visualization
 *
 * Renders wireframe debug visualization of all physics bodies in the scene.
 * Toggle with F4 key.
 *
 * Usage:
 *   const debugUI = new DebugOverlayUI({
 *       physicsSystem: physicsSystem,
 *       renderSystem: renderSystem
 *   });
 *   debugUI.init();
 */

class DebugOverlayUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {PhysicsSystem} options.physicsSystem - Reference to physics system
     * @param {RenderSystem} options.renderSystem - Reference to render system
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.physicsSystem = options.physicsSystem;
        this.renderSystem = options.renderSystem;

        // State
        this.visible = false;
        this.debugMeshes = [];  // Array of THREE.LineSegments objects
        this.collisionSpheres = [];  // Temporary collision indicators
        this.forceArrows = [];  // Force vector visualization
        this.collisionEvents = [];  // Queue of recent collisions
        this.COLLISION_DISPLAY_DURATION = 500;  // ms to show collision sphere
    }

    /**
     * Initialize debug UI
     */
    init() {
        this._subscribeToEvents();
    }

    /**
     * Subscribe to events
     * @private
     */
    _subscribeToEvents() {
        // Listen to collision events for visualization
        if (this.eventBus && typeof this.eventBus.on === 'function') {
            try {
                this.eventBus.on('physics:collision', (event) => {
                    this._onCollision(event);
                });
            } catch (error) {
                console.warn('DebugOverlayUI: Failed to subscribe to collision events', error);
            }
        }
    }

    /**
     * Handle collision event - record collision point for visualization
     * @private
     */
    _onCollision(event) {
        // Get collision point as average of two body positions
        const posA = event.bodyA.translation();
        const posB = event.bodyB.translation();

        const collisionPoint = {
            x: (posA.x + posB.x) / 2,
            y: (posA.y + posB.y) / 2,
            z: (posA.z + posB.z) / 2,
            timestamp: Date.now()
        };

        this.collisionEvents.push(collisionPoint);
    }

    /**
     * Toggle debug visualization
     */
    toggle() {
        this.visible = !this.visible;
        console.log(`Physics debug visualization: ${this.visible ? 'ON' : 'OFF'}`);

        if (this.visible) {
            this._createDebugMeshes();
        } else {
            this._removeDebugMeshes();
        }
    }

    /**
     * Update debug meshes (call every frame if visible)
     */
    update() {
        if (!this.visible) return;

        // Recreate physics wireframes
        this._removeDebugMeshes();
        this._createDebugMeshes();

        // Update collision visualization
        this._updateCollisionSpheres();

        // Update force vector visualization
        this._updateForceVectors();
    }

    /**
     * Create debug wireframe meshes
     * @private
     */
    _createDebugMeshes() {
        if (!this.physicsSystem || !this.renderSystem) return;

        // Get debug data from Rapier world
        const debugData = this.physicsSystem.getDebugVertices();
        if (!debugData) {
            console.warn('DebugOverlayUI: Could not get debug vertices from physics system');
            return;
        }

        // Create positions array from Rapier's vertex data
        const positions = [];
        const { vertices } = debugData;

        // Rapier returns vertices as [x1, y1, z1, x2, y2, z2, ...] for line segments
        for (let i = 0; i < vertices.length; i += 6) {
            if (i + 5 < vertices.length) {
                // Start point
                positions.push(vertices[i], vertices[i + 1], vertices[i + 2]);
                // End point
                positions.push(vertices[i + 3], vertices[i + 4], vertices[i + 5]);
            }
        }

        if (positions.length === 0) {
            console.warn('DebugOverlayUI: No positions generated from debug vertices');
            return;
        }

        // Create geometry with positions
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        // Create line material (bright green)
        const material = new THREE.LineBasicMaterial({
            color: 0x00ff00,
            linewidth: 1,
            opacity: 1.0,
            transparent: false,
            fog: false
        });

        // Create line segments
        const lineSegments = new THREE.LineSegments(geometry, material);
        lineSegments.frustumCulled = false;  // Don't cull debug geometry

        // Add to scene and track
        this.renderSystem.scene.add(lineSegments);
        this.debugMeshes.push(lineSegments);

        console.log(`DebugOverlayUI: Created ${this.debugMeshes.length} debug mesh with ${positions.length / 6} lines`);
    }

    /**
     * Remove debug meshes from scene
     * @private
     */
    _removeDebugMeshes() {
        this.debugMeshes.forEach(mesh => {
            // Remove from scene
            this.renderSystem.scene.remove(mesh);

            // Dispose geometry and materials
            if (mesh.geometry) {
                mesh.geometry.dispose();
            }
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        });

        this.debugMeshes = [];
    }

    /**
     * Update collision sphere visualizations
     * @private
     */
    _updateCollisionSpheres() {
        const now = Date.now();

        // Remove expired collision spheres
        for (let i = this.collisionSpheres.length - 1; i >= 0; i--) {
            const sphere = this.collisionSpheres[i];
            const age = now - sphere.userData.timestamp;

            if (age > this.COLLISION_DISPLAY_DURATION) {
                // Remove from scene
                this.renderSystem.scene.remove(sphere);
                sphere.geometry.dispose();
                sphere.material.dispose();
                this.collisionSpheres.splice(i, 1);
            } else {
                // Fade out over time
                const fadeProgress = age / this.COLLISION_DISPLAY_DURATION;
                sphere.material.opacity = 1.0 - (fadeProgress * 0.8);
            }
        }

        // Add new collision spheres
        while (this.collisionEvents.length > 0) {
            const collision = this.collisionEvents.shift();
            this._createCollisionSphere(collision);
        }
    }

    /**
     * Create a collision indicator sphere
     * @private
     */
    _createCollisionSphere(collision) {
        const geometry = new THREE.SphereGeometry(0.3, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            transparent: true,
            opacity: 1.0,
            fog: false
        });

        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(collision.x, collision.y, collision.z);
        sphere.userData = { timestamp: collision.timestamp };
        sphere.frustumCulled = false;

        this.renderSystem.scene.add(sphere);
        this.collisionSpheres.push(sphere);
    }

    /**
     * Update force vector visualization
     * @private
     */
    _updateForceVectors() {
        // Remove old force arrows
        this.forceArrows.forEach(arrow => {
            this.renderSystem.scene.remove(arrow);
        });
        this.forceArrows = [];

        if (!this.physicsSystem) return;

        // Get all vehicles
        const vehiclesData = this.physicsSystem.getAllVehiclesDebugData();
        if (!vehiclesData) return;

        // For each vehicle, create force arrows
        for (const [vehicleId, debugData] of Object.entries(vehiclesData)) {
            if (!debugData || !debugData.position) continue;

            // Get the vehicle body to determine current forces
            const vehicleData = this.physicsSystem.vehicleBodies.get(vehicleId);
            if (!vehicleData) continue;

            const pos = debugData.position;
            const origin = new THREE.Vector3(pos.x, pos.y, pos.z);

            // Get the forward direction from the rotation
            const rot = debugData.rotation;
            const forward = this._getForwardVector(rot);

            // Approximate forces from velocity (actual force magnitude)
            const velocity = debugData.velocity;
            const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);

            // Create velocity arrow (blue)
            if (speed > 0.1) {
                const velDirection = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize();
                const velMagnitude = Math.min(speed * 0.3, 3.0);  // Scale for visibility
                this._createForceArrow(origin, velDirection, velMagnitude, 0x0088ff, 'velocity');
            }

            // Create reverse indicator if reversing
            if (vehicleData && vehicleData.isReversing) {
                const reverseDir = new THREE.Vector3(forward.x, 0, forward.z).normalize().multiplyScalar(-1);
                this._createForceArrow(
                    origin.clone().add(new THREE.Vector3(0, -0.5, 0)),
                    reverseDir,
                    1.0,
                    0xff8800,  // Orange for reverse
                    'reverse'
                );
            }
        }
    }

    /**
     * Create a force vector arrow
     * @private
     */
    _createForceArrow(origin, direction, magnitude, color, type) {
        const arrowHelper = new THREE.ArrowHelper(
            direction,
            origin,
            magnitude,
            color,
            magnitude * 0.3,  // Head length
            magnitude * 0.2   // Head width
        );

        arrowHelper.line.fog = false;
        arrowHelper.cone.fog = false;
        arrowHelper.frustumCulled = false;

        this.renderSystem.scene.add(arrowHelper);
        this.forceArrows.push(arrowHelper);
    }

    /**
     * Get forward vector from quaternion rotation
     * @private
     */
    _getForwardVector(quaternion) {
        // Convert quaternion to forward vector (0, 0, -1) rotated by quat
        // Forward in three.js is (0, 0, -1)
        const x = quaternion.x || 0;
        const y = quaternion.y || 0;
        const z = quaternion.z || 0;
        const w = quaternion.w || 1;

        // Apply rotation to forward vector
        const fx = 2 * (x * z + w * y);
        const fy = 2 * (y * z - w * x);
        const fz = 1 - 2 * (x * x + y * y);

        return new THREE.Vector3(fx, fy, fz).normalize();
    }

    /**
     * Destroy debug UI
     */
    destroy() {
        this._removeDebugMeshes();
        this.collisionSpheres.forEach(sphere => {
            this.renderSystem.scene.remove(sphere);
            sphere.geometry.dispose();
            sphere.material.dispose();
        });
        this.collisionSpheres = [];
        this.forceArrows.forEach(arrow => {
            this.renderSystem.scene.remove(arrow);
        });
        this.forceArrows = [];
    }
}

// Export for ES Modules
export { DebugOverlayUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.DebugOverlayUI = DebugOverlayUI;
}
