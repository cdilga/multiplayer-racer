/**
 * TrailSystem - Manages particle exhaust trails for vehicles
 *
 * Creates glowing particle trails behind vehicles when they're moving fast.
 * Uses Points geometry with additive blending for MAXIMAL visual impact.
 *
 * Usage:
 *   const trailSystem = new TrailSystem({ eventBus, renderSystem });
 *   await trailSystem.init();
 */

class TrailSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {RenderSystem} [options.renderSystem]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.renderSystem = options.renderSystem ||
            (typeof window !== 'undefined' ? window.game?.systems?.render : null);

        // Trail data per vehicle
        this.trails = new Map(); // vehicleId -> Trail object

        // Configuration
        this.config = {
            density: 200,        // Max particles per trail
            minSpeed: 30,       // km/h threshold to start trail
            opacity: 0.8,       // Particle opacity
            particleSize: 0.3,  // Size of each particle
            maxAge: 2.0,        // Particle lifetime in seconds
            spawnRate: 10       // Particles per second when moving
        };

        // State
        this.initialized = false;
    }

    /**
     * Initialize trail system
     */
    async init() {
        if (this.initialized) return;

        // Subscribe to vehicle lifecycle events
        if (this.eventBus) {
            this.eventBus.on('vehicle:created', this._onVehicleCreated.bind(this));
            this.eventBus.on('vehicle:removed', this._onVehicleRemoved.bind(this));
        }

        this.initialized = true;
        console.log('TrailSystem: Initialized');
    }

    /**
     * Update trails (called each render frame for smooth visuals)
     * @param {number} dt - Delta time in seconds
     * @param {number} interpolation - Physics interpolation factor
     */
    render(dt, interpolation) {
        if (!this.initialized || !this.renderSystem) return;

        for (const [vehicleId, trail] of this.trails) {
            trail.update(dt);
        }
    }

    /**
     * Handle vehicle created event
     * @private
     */
    _onVehicleCreated({ vehicle }) {
        if (!vehicle || !vehicle.mesh) return;

        const trail = new Trail(vehicle, this.config);
        this.trails.set(vehicle.id, trail);

        // Add trail mesh to scene
        if (this.renderSystem && this.renderSystem.getScene) {
            this.renderSystem.getScene().add(trail.mesh);
        }

        console.log(`TrailSystem: Created trail for vehicle ${vehicle.id}`);
    }

    /**
     * Handle vehicle removed event
     * @private
     */
    _onVehicleRemoved({ vehicleId }) {
        const trail = this.trails.get(vehicleId);
        if (trail) {
            // Remove from scene
            if (this.renderSystem && this.renderSystem.getScene) {
                this.renderSystem.getScene().remove(trail.mesh);
            }

            trail.dispose();
            this.trails.delete(vehicleId);
            console.log(`TrailSystem: Removed trail for vehicle ${vehicleId}`);
        }
    }

    /**
     * Update configuration
     * @param {Object} config - Partial config to update
     */
    updateConfig(config) {
        Object.assign(this.config, config);

        // Update all existing trails
        for (const [vehicleId, trail] of this.trails) {
            trail.updateConfig(this.config);
        }
    }

    /**
     * Destroy trail system
     */
    destroy() {
        // Remove all trails
        for (const [vehicleId, trail] of this.trails) {
            if (this.renderSystem && this.renderSystem.getScene) {
                this.renderSystem.getScene().remove(trail.mesh);
            }
            trail.dispose();
        }
        this.trails.clear();

        // Unsubscribe from events
        if (this.eventBus) {
            this.eventBus.off('vehicle:created', this._onVehicleCreated);
            this.eventBus.off('vehicle:removed', this._onVehicleRemoved);
        }

        this.initialized = false;
    }
}

/**
 * Trail - Individual particle trail for a vehicle
 * @private
 */
class Trail {
    constructor(vehicle, config) {
        this.vehicle = vehicle;
        this.config = { ...config };

        // Particle data
        this.particles = [];
        this.lastSpawnTime = 0;

        // Create geometry and material
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.PointsMaterial({
            color: vehicle.color || 0xff6600,
            size: this.config.particleSize,
            transparent: true,
            opacity: this.config.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // Create Points mesh
        this.mesh = new THREE.Points(this.geometry, this.material);
        this.mesh.userData = { isTrail: true, vehicleId: vehicle.id };
    }

    /**
     * Update trail particles
     * @param {number} dt - Delta time
     */
    update(dt) {
        if (!this.vehicle || !this.vehicle.mesh) return;

        const currentTime = performance.now() / 1000;
        const speed = this.vehicle.speed || 0;

        // Spawn new particles if moving fast enough
        if (speed > this.config.minSpeed) {
            const spawnInterval = 1.0 / this.config.spawnRate;
            if (currentTime - this.lastSpawnTime >= spawnInterval) {
                this._spawnParticle();
                this.lastSpawnTime = currentTime;
            }
        }

        // Update existing particles
        this._updateParticles(dt);

        // Update geometry
        this._updateGeometry();
    }

    /**
     * Spawn a new particle at vehicle position
     * @private
     */
    _spawnParticle() {
        if (!this.vehicle.mesh) return;

        const pos = this.vehicle.mesh.position;
        this.particles.push({
            position: { x: pos.x, y: pos.y, z: pos.z },
            age: 0,
            lifetime: this.config.maxAge
        });

        // Limit particle count
        if (this.particles.length > this.config.density) {
            this.particles.shift(); // Remove oldest
        }
    }

    /**
     * Update particle ages and remove dead ones
     * @private
     */
    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.age += dt;

            // Remove dead particles
            if (particle.age >= particle.lifetime) {
                this.particles.splice(i, 1);
            }
        }
    }

    /**
     * Update geometry with current particle positions
     * @private
     */
    _updateGeometry() {
        const count = this.particles.length;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);

        const vehicleColor = new THREE.Color(this.vehicle.color || 0xff6600);

        for (let i = 0; i < count; i++) {
            const particle = this.particles[i];
            const idx = i * 3;

            // Position
            positions[idx] = particle.position.x;
            positions[idx + 1] = particle.position.y;
            positions[idx + 2] = particle.position.z;

            // Color with age-based fade
            const ageFactor = 1.0 - (particle.age / particle.lifetime);
            const color = vehicleColor.clone().multiplyScalar(ageFactor);
            colors[idx] = color.r;
            colors[idx + 1] = color.g;
            colors[idx + 2] = color.b;
        }

        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        this.geometry.setDrawRange(0, count);

        // Mark as needing update
        this.geometry.attributes.position.needsUpdate = true;
        if (this.geometry.attributes.color) {
            this.geometry.attributes.color.needsUpdate = true;
        }
    }

    /**
     * Update configuration
     * @param {Object} config
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        this.material.size = this.config.particleSize;
        this.material.opacity = this.config.opacity;
    }

    /**
     * Dispose of trail resources
     */
    dispose() {
        if (this.geometry) {
            this.geometry.dispose();
        }
        if (this.material) {
            this.material.dispose();
        }
        this.particles = [];
    }
}

// Export for ES Modules
export { TrailSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.TrailSystem = TrailSystem;
}

