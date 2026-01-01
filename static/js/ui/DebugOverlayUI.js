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
        // Debug UI doesn't need event subscriptions
        // It updates on-demand when visible
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

        // Recreate meshes each frame to show current physics state
        this._removeDebugMeshes();
        this._createDebugMeshes();
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
     * Destroy debug UI
     */
    destroy() {
        this._removeDebugMeshes();
    }
}

// Export for ES Modules
export { DebugOverlayUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.DebugOverlayUI = DebugOverlayUI;
}
