/**
 * RenderSystem - Manages Three.js rendering
 *
 * Responsibilities:
 * - Initialize Three.js scene, camera, renderer
 * - Add/remove meshes
 * - Sync mesh positions from physics
 * - Handle camera following
 * - Manage lighting
 *
 * Usage:
 *   const render = new RenderSystem({ eventBus, container: document.getElementById('game') });
 *   await render.init();
 *   render.addMesh(vehicle.mesh);
 */

class RenderSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container] - Container for renderer
     * @param {Object} [options.cameraConfig] - Camera configuration
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;
        this.cameraConfig = options.cameraConfig || {};

        // Three.js core
        this.scene = null;
        this.camera = null;
        this.renderer = null;

        // Lighting
        this.lights = {};

        // Camera target (for following)
        this.cameraTarget = null;
        this.cameraOffset = { x: 0, y: 15, z: 20 };
        this.cameraLookOffset = { x: 0, y: 0, z: -5 };
        this.cameraSmoothing = 0.1;

        // Tracked meshes
        this.meshes = new Map();  // entityId -> mesh

        // State
        this.initialized = false;
        this.paused = false;
    }

    /**
     * Initialize Three.js
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        console.log('RenderSystem: Initializing...');

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);  // Sky blue

        // Create camera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(
            this.cameraConfig.fov || 60,
            aspect,
            this.cameraConfig.near || 0.1,
            this.cameraConfig.far || 1000
        );
        this.camera.position.set(0, 20, 30);
        this.camera.lookAt(0, 0, 0);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add to container
        this.container.appendChild(this.renderer.domElement);

        // Setup default lighting
        this._setupDefaultLighting();

        // Handle window resize
        window.addEventListener('resize', this._onResize.bind(this));

        this.initialized = true;
        this._emit('render:ready');
        console.log('RenderSystem: Ready');
    }

    /**
     * Setup default lighting
     * @private
     */
    _setupDefaultLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        this.lights.ambient = ambient;

        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xffffff, 0.8);
        directional.position.set(50, 100, 50);
        directional.castShadow = true;

        // Shadow camera setup
        directional.shadow.camera.left = -50;
        directional.shadow.camera.right = 50;
        directional.shadow.camera.top = 50;
        directional.shadow.camera.bottom = -50;
        directional.shadow.camera.near = 0.5;
        directional.shadow.camera.far = 200;
        directional.shadow.mapSize.width = 2048;
        directional.shadow.mapSize.height = 2048;

        this.scene.add(directional);
        this.lights.directional = directional;
    }

    /**
     * Configure lighting from track config
     * @param {Object} lightingConfig
     */
    setLighting(lightingConfig) {
        if (lightingConfig.ambient) {
            this.lights.ambient.color.set(lightingConfig.ambient.color);
            this.lights.ambient.intensity = lightingConfig.ambient.intensity;
        }

        if (lightingConfig.directional) {
            const dir = lightingConfig.directional;
            this.lights.directional.color.set(dir.color);
            this.lights.directional.intensity = dir.intensity;
            if (dir.position) {
                this.lights.directional.position.set(
                    dir.position.x,
                    dir.position.y,
                    dir.position.z
                );
            }
        }
    }

    /**
     * Render frame (called each animation frame)
     * @param {number} dt - Delta time
     * @param {number} interpolation - Physics interpolation factor
     */
    render(dt, interpolation) {
        if (!this.initialized || this.paused) return;

        // Update camera if following target
        this._updateCamera(dt);

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Update camera position (follow target)
     * @private
     */
    _updateCamera(dt) {
        if (!this.cameraTarget) return;

        // Get target position
        let targetPos;
        if (this.cameraTarget.mesh) {
            targetPos = this.cameraTarget.mesh.position;
        } else if (this.cameraTarget.position) {
            targetPos = this.cameraTarget.position;
        } else {
            return;
        }

        // Calculate desired camera position
        const desiredPos = {
            x: targetPos.x + this.cameraOffset.x,
            y: targetPos.y + this.cameraOffset.y,
            z: targetPos.z + this.cameraOffset.z
        };

        // Smooth camera movement
        this.camera.position.x += (desiredPos.x - this.camera.position.x) * this.cameraSmoothing;
        this.camera.position.y += (desiredPos.y - this.camera.position.y) * this.cameraSmoothing;
        this.camera.position.z += (desiredPos.z - this.camera.position.z) * this.cameraSmoothing;

        // Look at target
        const lookAt = {
            x: targetPos.x + this.cameraLookOffset.x,
            y: targetPos.y + this.cameraLookOffset.y,
            z: targetPos.z + this.cameraLookOffset.z
        };
        this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    }

    /**
     * Add a mesh to the scene
     * @param {THREE.Object3D} mesh
     * @param {string} [entityId] - Associated entity ID
     */
    addMesh(mesh, entityId) {
        this.scene.add(mesh);

        if (entityId) {
            this.meshes.set(entityId, mesh);
        }
    }

    /**
     * Remove a mesh from the scene
     * @param {THREE.Object3D|string} meshOrId - Mesh or entity ID
     */
    removeMesh(meshOrId) {
        let mesh;

        if (typeof meshOrId === 'string') {
            mesh = this.meshes.get(meshOrId);
            this.meshes.delete(meshOrId);
        } else {
            mesh = meshOrId;
            // Find and remove from map
            for (const [id, m] of this.meshes) {
                if (m === mesh) {
                    this.meshes.delete(id);
                    break;
                }
            }
        }

        if (mesh) {
            this.scene.remove(mesh);

            // Dispose geometry and materials
            mesh.traverse((child) => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
    }

    /**
     * Get mesh by entity ID
     * @param {string} entityId
     * @returns {THREE.Object3D|undefined}
     */
    getMesh(entityId) {
        return this.meshes.get(entityId);
    }

    /**
     * Set camera follow target
     * @param {Object} target - Entity or object with mesh/position
     */
    setCameraTarget(target) {
        this.cameraTarget = target;
    }

    /**
     * Clear camera target
     */
    clearCameraTarget() {
        this.cameraTarget = null;
    }

    /**
     * Set camera offset for following
     * @param {Object} offset - { x, y, z }
     */
    setCameraOffset(offset) {
        this.cameraOffset = { ...this.cameraOffset, ...offset };
    }

    /**
     * Set camera position directly
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setCameraPosition(x, y, z) {
        this.camera.position.set(x, y, z);
    }

    /**
     * Make camera look at point
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    setCameraLookAt(x, y, z) {
        this.camera.lookAt(x, y, z);
    }

    /**
     * Sync mesh position from entity
     * @param {Entity} entity
     */
    syncMeshFromEntity(entity) {
        if (!entity.mesh) return;

        entity.mesh.position.set(
            entity.position.x,
            entity.position.y,
            entity.position.z
        );
        entity.mesh.rotation.set(
            entity.rotation.x,
            entity.rotation.y,
            entity.rotation.z
        );
    }

    /**
     * Sync mesh position from physics body
     * @param {Entity} entity
     */
    syncMeshFromPhysics(entity) {
        if (!entity.mesh || !entity.physicsBody) return;

        const pos = entity.physicsBody.translation();
        const rot = entity.physicsBody.rotation();

        entity.mesh.position.set(pos.x, pos.y, pos.z);
        entity.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    /**
     * Handle window resize
     * @private
     */
    _onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    /**
     * Get scene
     * @returns {THREE.Scene}
     */
    getScene() {
        return this.scene;
    }

    /**
     * Get camera
     * @returns {THREE.Camera}
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get renderer
     * @returns {THREE.WebGLRenderer}
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * Pause rendering
     */
    pause() {
        this.paused = true;
    }

    /**
     * Resume rendering
     */
    resume() {
        this.paused = false;
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
     * Destroy renderer
     */
    destroy() {
        window.removeEventListener('resize', this._onResize.bind(this));

        // Remove all meshes
        for (const [id, mesh] of this.meshes) {
            this.removeMesh(mesh);
        }
        this.meshes.clear();

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.initialized = false;
    }
}

// Export for ES Modules
export { RenderSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.RenderSystem = RenderSystem;
}
