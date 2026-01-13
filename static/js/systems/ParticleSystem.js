/**
 * ParticleSystem - Manages particle effects for the game
 *
 * Responsibilities:
 * - Create and update particle emitters
 * - Handle explosion effects
 * - Manage smoke trails, sparks, fire, etc.
 * - Auto-cleanup expired particles
 *
 * Usage:
 *   const particles = new ParticleSystem({ eventBus, scene });
 *   particles.init();
 *   particles.createExplosion(position, options);
 */

// Particle effect types
const PARTICLE_TYPES = {
    EXPLOSION: 'explosion',
    SMOKE: 'smoke',
    SPARKS: 'sparks',
    FIRE: 'fire',
    DEBRIS: 'debris',
    SHOCKWAVE: 'shockwave'
};

// Preset configurations for effects
const EFFECT_PRESETS = {
    'explosion-fire': {
        count: 30,
        size: { min: 0.5, max: 2 },
        speed: { min: 3, max: 8 },
        lifetime: { min: 0.5, max: 1.5 },
        colors: ['#FF4400', '#FFAA00', '#FF6600'],
        gravity: -2,
        fadeOut: true,
        spread: Math.PI * 2
    },
    'explosion-large': {
        count: 50,
        size: { min: 0.8, max: 3 },
        speed: { min: 5, max: 12 },
        lifetime: { min: 0.8, max: 2 },
        colors: ['#FF2200', '#FF8800', '#FFCC00'],
        gravity: -3,
        fadeOut: true,
        spread: Math.PI * 2
    },
    'smoke': {
        count: 20,
        size: { min: 0.3, max: 1.5 },
        speed: { min: 1, max: 3 },
        lifetime: { min: 1, max: 3 },
        colors: ['#444444', '#666666', '#888888'],
        gravity: 2, // Rises
        fadeOut: true,
        spread: Math.PI / 4
    },
    'sparks': {
        count: 15,
        size: { min: 0.1, max: 0.3 },
        speed: { min: 8, max: 15 },
        lifetime: { min: 0.3, max: 0.8 },
        colors: ['#FFFF00', '#FFFFFF', '#4444FF'],
        gravity: -5,
        fadeOut: true,
        spread: Math.PI * 2
    },
    'emp-shockwave': {
        count: 1,
        size: { min: 0.5, max: 15 },
        speed: { min: 0, max: 0 },
        lifetime: { min: 0.5, max: 0.5 },
        colors: ['#4444FF'],
        gravity: 0,
        fadeOut: true,
        isShockwave: true,
        expandSpeed: 30
    },
    'vehicle-destroy': {
        count: 40,
        size: { min: 0.3, max: 1.5 },
        speed: { min: 5, max: 15 },
        lifetime: { min: 0.5, max: 2 },
        colors: ['#FF4400', '#222222', '#FFAA00', '#666666'],
        gravity: -8,
        fadeOut: true,
        spread: Math.PI * 2
    }
};

class ParticleSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {THREE.Scene} [options.scene]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.scene = options.scene || null;

        // Active particle groups
        this.particleGroups = new Map(); // groupId -> { particles, mesh, createdAt, ... }

        // Counter for unique IDs
        this.groupCounter = 0;

        // Pool of geometries for performance
        this.geometryPool = [];

        // State
        this.initialized = false;
        this.enabled = true;
    }

    /**
     * Initialize particle system
     */
    init() {
        if (this.initialized) return;

        console.log('ParticleSystem: Initializing...');

        // Subscribe to events
        if (this.eventBus) {
            // Weapon explosions
            this.eventBus.on('weapon:explosion', this._onExplosion.bind(this));
            this.eventBus.on('weapon:hit', this._onWeaponHit.bind(this));

            // Player elimination
            this.eventBus.on('derby:playerEliminated', this._onPlayerEliminated.bind(this));

            // EMP effect
            this.eventBus.on('weapon:fired', this._onWeaponFired.bind(this));
        }

        this.initialized = true;
        console.log('ParticleSystem: Ready');
    }

    /**
     * Set the scene reference
     * @param {THREE.Scene} scene
     */
    setScene(scene) {
        this.scene = scene;
    }

    /**
     * Update all particle groups
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.initialized || !this.enabled) return;

        const now = performance.now();
        const toRemove = [];

        for (const [groupId, group] of this.particleGroups) {
            const age = (now - group.createdAt) / 1000;

            // Check if group has expired
            if (age > group.maxLifetime) {
                toRemove.push(groupId);
                continue;
            }

            // Update particles in the group
            this._updateParticleGroup(group, dt, age);
        }

        // Remove expired groups
        for (const groupId of toRemove) {
            this._removeParticleGroup(groupId);
        }
    }

    /**
     * Create an explosion effect
     * @param {Object} position - { x, y, z }
     * @param {Object} options - Effect options
     * @returns {string} Group ID
     */
    createExplosion(position, options = {}) {
        const preset = EFFECT_PRESETS[options.preset || 'explosion-fire'];
        return this._createParticleGroup(position, { ...preset, ...options });
    }

    /**
     * Create a smoke effect
     * @param {Object} position - { x, y, z }
     * @param {Object} options - Effect options
     * @returns {string} Group ID
     */
    createSmoke(position, options = {}) {
        const preset = EFFECT_PRESETS['smoke'];
        return this._createParticleGroup(position, { ...preset, ...options });
    }

    /**
     * Create sparks effect
     * @param {Object} position - { x, y, z }
     * @param {Object} options - Effect options
     * @returns {string} Group ID
     */
    createSparks(position, options = {}) {
        const preset = EFFECT_PRESETS['sparks'];
        return this._createParticleGroup(position, { ...preset, ...options });
    }

    /**
     * Create EMP shockwave effect
     * @param {Object} position - { x, y, z }
     * @param {Object} options - Effect options
     * @returns {string} Group ID
     */
    createShockwave(position, options = {}) {
        const preset = EFFECT_PRESETS['emp-shockwave'];
        return this._createShockwaveGroup(position, { ...preset, ...options });
    }

    /**
     * Create vehicle destruction effect
     * @param {Object} position - { x, y, z }
     * @returns {string} Group ID
     */
    createVehicleDestruction(position) {
        const preset = EFFECT_PRESETS['vehicle-destroy'];
        return this._createParticleGroup(position, preset);
    }

    /**
     * Create a particle group
     * @private
     */
    _createParticleGroup(position, config) {
        if (!this.scene || typeof THREE === 'undefined') return null;

        const groupId = `particles_${++this.groupCounter}`;
        const particles = [];
        const count = config.count || 20;

        // Create particles
        for (let i = 0; i < count; i++) {
            const size = this._randomRange(config.size.min, config.size.max);
            const speed = this._randomRange(config.speed.min, config.speed.max);
            const lifetime = this._randomRange(config.lifetime.min, config.lifetime.max);
            const color = config.colors[Math.floor(Math.random() * config.colors.length)];

            // Random direction
            const theta = Math.random() * config.spread;
            const phi = Math.random() * Math.PI * 2;
            const velocity = {
                x: Math.sin(theta) * Math.cos(phi) * speed,
                y: Math.cos(theta) * speed * 0.5 + Math.random() * speed * 0.5,
                z: Math.sin(theta) * Math.sin(phi) * speed
            };

            particles.push({
                position: { x: position.x, y: position.y + 0.5, z: position.z },
                velocity: velocity,
                size: size,
                initialSize: size,
                color: color,
                lifetime: lifetime,
                age: 0,
                opacity: 1
            });
        }

        // Create instanced mesh for performance
        const geometry = new THREE.SphereGeometry(0.5, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 1
        });

        // Create individual meshes for each particle (simpler than instanced for small counts)
        const meshGroup = new THREE.Group();
        particles.forEach((p, i) => {
            const particleMaterial = material.clone();
            particleMaterial.color.set(p.color);
            const mesh = new THREE.Mesh(geometry, particleMaterial);
            mesh.position.set(p.position.x, p.position.y, p.position.z);
            mesh.scale.set(p.size, p.size, p.size);
            meshGroup.add(mesh);
            p.mesh = mesh;
        });

        this.scene.add(meshGroup);

        const group = {
            id: groupId,
            particles: particles,
            meshGroup: meshGroup,
            config: config,
            createdAt: performance.now(),
            maxLifetime: Math.max(...particles.map(p => p.lifetime)) + 0.5
        };

        this.particleGroups.set(groupId, group);
        return groupId;
    }

    /**
     * Create a shockwave effect (expanding ring)
     * @private
     */
    _createShockwaveGroup(position, config) {
        if (!this.scene || typeof THREE === 'undefined') return null;

        const groupId = `shockwave_${++this.groupCounter}`;

        // Create ring geometry
        const geometry = new THREE.RingGeometry(0.1, 0.5, 32);
        geometry.rotateX(-Math.PI / 2); // Flat on ground

        const material = new THREE.MeshBasicMaterial({
            color: config.colors[0],
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(position.x, position.y + 0.1, position.z);

        this.scene.add(mesh);

        const group = {
            id: groupId,
            mesh: mesh,
            config: config,
            createdAt: performance.now(),
            maxLifetime: config.lifetime.max,
            expandSpeed: config.expandSpeed || 30,
            currentRadius: 0.5,
            isShockwave: true
        };

        this.particleGroups.set(groupId, group);
        return groupId;
    }

    /**
     * Update a particle group
     * @private
     */
    _updateParticleGroup(group, dt, age) {
        if (group.isShockwave) {
            this._updateShockwave(group, dt, age);
            return;
        }

        const config = group.config;
        const gravity = config.gravity || 0;

        for (const particle of group.particles) {
            if (particle.age >= particle.lifetime) {
                if (particle.mesh) {
                    particle.mesh.visible = false;
                }
                continue;
            }

            // Update age
            particle.age += dt;

            // Apply velocity
            particle.position.x += particle.velocity.x * dt;
            particle.position.y += particle.velocity.y * dt;
            particle.position.z += particle.velocity.z * dt;

            // Apply gravity
            particle.velocity.y += gravity * dt;

            // Update mesh
            if (particle.mesh) {
                particle.mesh.position.set(
                    particle.position.x,
                    particle.position.y,
                    particle.position.z
                );

                // Fade out
                if (config.fadeOut) {
                    const progress = particle.age / particle.lifetime;
                    particle.opacity = 1 - progress;
                    particle.mesh.material.opacity = particle.opacity;

                    // Also shrink
                    const scale = particle.initialSize * (1 - progress * 0.5);
                    particle.mesh.scale.set(scale, scale, scale);
                }
            }
        }
    }

    /**
     * Update shockwave effect
     * @private
     */
    _updateShockwave(group, dt, age) {
        const progress = age / group.maxLifetime;

        // Expand the ring
        group.currentRadius += group.expandSpeed * dt;

        // Update geometry
        if (group.mesh && group.mesh.geometry) {
            group.mesh.geometry.dispose();
            const innerRadius = group.currentRadius - 0.5;
            const outerRadius = group.currentRadius;
            group.mesh.geometry = new THREE.RingGeometry(
                Math.max(0, innerRadius),
                outerRadius,
                32
            );
            group.mesh.geometry.rotateX(-Math.PI / 2);
        }

        // Fade out
        if (group.mesh && group.mesh.material) {
            group.mesh.material.opacity = 0.8 * (1 - progress);
        }
    }

    /**
     * Remove a particle group
     * @private
     */
    _removeParticleGroup(groupId) {
        const group = this.particleGroups.get(groupId);
        if (!group) return;

        if (group.meshGroup) {
            // Dispose each particle mesh
            group.meshGroup.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene.remove(group.meshGroup);
        }

        if (group.mesh) {
            if (group.mesh.geometry) group.mesh.geometry.dispose();
            if (group.mesh.material) group.mesh.material.dispose();
            this.scene.remove(group.mesh);
        }

        this.particleGroups.delete(groupId);
    }

    /**
     * Handle explosion event
     * @private
     */
    _onExplosion(data) {
        if (!this.enabled || !data.position) return;

        this.createExplosion(data.position, {
            preset: data.weaponId === 'mine' ? 'explosion-large' : 'explosion-fire'
        });
    }

    /**
     * Handle weapon hit event
     * @private
     */
    _onWeaponHit(data) {
        if (!this.enabled || !data.position) return;

        // Create sparks at impact point
        this.createSparks(data.position);
    }

    /**
     * Handle player eliminated event
     * @private
     */
    _onPlayerEliminated(data) {
        if (!this.enabled) return;

        // Get vehicle position from the event if available
        // For now, create effect at origin as placeholder
        // In a real implementation, we'd get the vehicle position
    }

    /**
     * Handle weapon fired event
     * @private
     */
    _onWeaponFired(data) {
        if (!this.enabled) return;

        // Create EMP shockwave for EMP weapon
        if (data.weaponId === 'emp') {
            // Would need vehicle position from event
        }
    }

    /**
     * Random number in range
     * @private
     */
    _randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    /**
     * Clear all particles
     */
    clear() {
        for (const [groupId] of this.particleGroups) {
            this._removeParticleGroup(groupId);
        }
        this.particleGroups.clear();
    }

    /**
     * Enable/disable particle system
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
    }

    /**
     * Destroy particle system
     */
    destroy() {
        this.clear();
        this.initialized = false;
    }
}

// Export types
export { PARTICLE_TYPES, EFFECT_PRESETS };

// Export for ES Modules
export { ParticleSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.ParticleSystem = ParticleSystem;
    window.PARTICLE_TYPES = PARTICLE_TYPES;
}
