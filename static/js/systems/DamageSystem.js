/**
 * DamageSystem - Manages vehicle damage and destruction
 *
 * Responsibilities:
 * - Calculate collision damage
 * - Apply damage to vehicles
 * - Handle vehicle destruction
 * - Manage respawn
 *
 * Usage:
 *   const damage = new DamageSystem({ eventBus });
 *   damage.init();
 */

class DamageSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {boolean} [options.enabled=true] - Enable damage
     * @param {number} [options.collisionDamageMultiplier=1]
     * @param {number} [options.respawnDelay=3000] - Respawn delay in ms
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        this.enabled = options.enabled !== false;
        this.collisionDamageMultiplier = options.collisionDamageMultiplier || 1;
        this.respawnDelay = options.respawnDelay || 3000;
        this.respawnEnabled = true;  // Off in derby (elimination mode)

        // Registered vehicles
        this.vehicles = new Map();

        // Optional callback: (vehicle) => {x, y, z, rotation} for respawn spot
        this.respawnPositionProvider = null;

        // Pending respawns
        this.respawnQueue = [];

        // Collision cooldown to prevent double damage
        this.collisionCooldowns = new Map();
        this.cooldownDuration = 500;  // ms

        // State
        this.initialized = false;
    }

    /**
     * Initialize damage system
     */
    async init() {
        if (this.initialized) return;

        console.log('DamageSystem: Initializing...');

        // Subscribe to collision events
        if (this.eventBus) {
            this.eventBus.on('physics:collision', this._onCollision.bind(this));
        }

        this.initialized = true;
        this._emit('damage:ready');
        console.log('DamageSystem: Ready');
    }

    /**
     * Register a vehicle for damage tracking
     * @param {Vehicle} vehicle
     */
    registerVehicle(vehicle) {
        this.vehicles.set(vehicle.id, vehicle);
    }

    /**
     * Unregister a vehicle
     * @param {string} vehicleId
     */
    unregisterVehicle(vehicleId) {
        this.vehicles.delete(vehicleId);
        this.collisionCooldowns.delete(vehicleId);
    }

    /**
     * Update damage system
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.initialized || !this.enabled) return;

        const now = performance.now();

        // Process respawn queue
        this._processRespawns(now);

        // Clear expired cooldowns
        for (const [key, expiry] of this.collisionCooldowns) {
            if (now > expiry) {
                this.collisionCooldowns.delete(key);
            }
        }
    }

    /**
     * Handle collision event
     * @private
     */
    _onCollision(data) {
        if (!this.enabled) return;

        const { entityA, entityB, typeA, typeB } = data;

        // Vehicle-vehicle collision
        if (typeA === 'vehicle' && typeB === 'vehicle') {
            this._handleVehicleCollision(entityA, entityB);
        }
        // Vehicle-barrier collision
        else if (typeA === 'vehicle' || typeB === 'vehicle') {
            const vehicle = typeA === 'vehicle' ? entityA : entityB;
            this._handleBarrierCollision(vehicle);
        }
    }

    /**
     * Handle vehicle-to-vehicle collision
     * @private
     */
    _handleVehicleCollision(vehicleA, vehicleB) {
        const now = performance.now();

        // Create collision key for cooldown
        const key = [vehicleA.id, vehicleB.id].sort().join('-');

        // Check cooldown
        if (this.collisionCooldowns.has(key)) return;
        this.collisionCooldowns.set(key, now + this.cooldownDuration);

        // Calculate relative velocity for damage
        const damage = this._calculateCollisionDamage(vehicleA, vehicleB);

        if (damage > 0) {
            // Apply damage to both vehicles
            this.applyDamage(vehicleA.id, damage / 2);
            this.applyDamage(vehicleB.id, damage / 2);

            this._emit('damage:vehicleCollision', {
                vehicleA: vehicleA.id,
                vehicleB: vehicleB.id,
                damage
            });
        }
    }

    /**
     * Handle vehicle-to-barrier collision
     * @private
     */
    _handleBarrierCollision(vehicle) {
        if (!vehicle) return;

        const now = performance.now();
        const key = `barrier-${vehicle.id}`;

        // Check cooldown
        if (this.collisionCooldowns.has(key)) return;
        this.collisionCooldowns.set(key, now + this.cooldownDuration);

        // Calculate damage from speed - walls give chip damage, not death
        const speed = vehicle.speed || 0;
        const damage = Math.max(0, (speed - 18) * 0.35) * this.collisionDamageMultiplier;

        if (damage > 0) {
            this.applyDamage(vehicle.id, damage);

            this._emit('damage:barrierCollision', {
                vehicleId: vehicle.id,
                damage,
                speed
            });
        }
    }

    /**
     * Calculate collision damage between two vehicles
     * @private
     */
    _calculateCollisionDamage(vehicleA, vehicleB) {
        const velA = vehicleA.velocity || { x: 0, y: 0, z: 0 };
        const velB = vehicleB.velocity || { x: 0, y: 0, z: 0 };

        // Relative velocity
        const relVel = {
            x: velA.x - velB.x,
            y: velA.y - velB.y,
            z: velA.z - velB.z
        };

        const relSpeed = Math.sqrt(
            relVel.x * relVel.x +
            relVel.y * relVel.y +
            relVel.z * relVel.z
        );

        // Damage based on relative speed - ramming stays a viable derby tactic.
        // Nitro and clean stunt landings can add a flat ram bonus; use the
        // strongest current bonus from either car because this legacy damage
        // path applies one shared collision impulse to both vehicles.
        const baseDamage = Math.max(0, relSpeed - 5) * 2.5;
        const ramBonus = Math.max(
            vehicleA.ramDamageBonus || 0,
            vehicleB.ramDamageBonus || 0,
            vehicleA.stuntRamDamageBonus || 0,
            vehicleB.stuntRamDamageBonus || 0
        );
        return (baseDamage + ramBonus) * this.collisionDamageMultiplier;
    }

    /**
     * Apply damage to a vehicle
     * @param {string} vehicleId
     * @param {number} amount
     * @param {Object} [source] - Damage source info
     */
    applyDamage(vehicleId, amount, source = null) {
        if (!this.enabled) return;

        const vehicle = this.vehicles.get(vehicleId);
        if (!vehicle) return;

        const died = vehicle.takeDamage(amount, source);

        this._emit('damage:applied', {
            vehicleId,
            amount,
            currentHealth: vehicle.health,
            maxHealth: vehicle.maxHealth,
            source
        });

        if (died) {
            this._onVehicleDestroyed(vehicle);
        }
    }

    /**
     * Heal a vehicle
     * @param {string} vehicleId
     * @param {number} amount
     */
    heal(vehicleId, amount) {
        const vehicle = this.vehicles.get(vehicleId);
        if (!vehicle) return;

        vehicle.heal(amount);

        this._emit('damage:healed', {
            vehicleId,
            amount,
            currentHealth: vehicle.health,
            maxHealth: vehicle.maxHealth
        });
    }

    /**
     * Handle vehicle destruction
     * @private
     */
    _onVehicleDestroyed(vehicle) {
        this._emit('damage:destroyed', {
            vehicleId: vehicle.id,
            playerId: vehicle.playerId
        });

        // Queue respawn (derby is elimination - no respawns there)
        if (this.respawnEnabled) {
            this.respawnQueue.push({
                vehicleId: vehicle.id,
                respawnTime: performance.now() + this.respawnDelay
            });
        }
    }

    /**
     * Process respawn queue
     * @private
     */
    _processRespawns(now) {
        const toRespawn = [];

        this.respawnQueue = this.respawnQueue.filter(entry => {
            if (now >= entry.respawnTime) {
                toRespawn.push(entry.vehicleId);
                return false;
            }
            return true;
        });

        for (const vehicleId of toRespawn) {
            this._respawnVehicle(vehicleId);
        }
    }

    /**
     * Respawn a vehicle
     * @private
     */
    _respawnVehicle(vehicleId) {
        const vehicle = this.vehicles.get(vehicleId);
        if (!vehicle) return;

        // Full reset: restores position, velocity, mesh visibility, isDead.
        // Host can supply a smarter spot (e.g. last checkpoint in races).
        const respawnPos = this.respawnPositionProvider?.(vehicle) || vehicle.spawnPosition;
        if (respawnPos) {
            vehicle.reset(respawnPos);
        } else {
            vehicle.isDead = false;
            if (vehicle.mesh) vehicle.mesh.visible = true;
        }

        // Reset health and any lingering weapon effects
        vehicle.health = vehicle.maxHealth;
        vehicle.speedBoost = 1;
        vehicle.stuntState = 'idle';
        vehicle.stuntCharge = 0;
        vehicle.stuntAirTime = 0;
        vehicle.stuntBoostMultiplier = 1;
        vehicle.stuntBoostUntil = 0;
        vehicle.stuntRamDamageBonus = 0;
        vehicle.stuntBadLandingUntil = 0;
        vehicle.lastStuntLanding = null;
        vehicle.stunned = false;
        vehicle.inOilSlick = false;

        this._emit('damage:respawn', {
            vehicleId,
            playerId: vehicle.playerId
        });
    }

    /**
     * Enable/disable automatic respawns (derby disables them)
     * @param {boolean} enabled
     */
    setRespawnEnabled(enabled) {
        this.respawnEnabled = enabled;
        if (!enabled) {
            this.respawnQueue = [];
        }
    }

    /**
     * Get vehicle health
     * @param {string} vehicleId
     * @returns {Object} { current, max, percent }
     */
    getHealth(vehicleId) {
        const vehicle = this.vehicles.get(vehicleId);
        if (!vehicle) return { current: 0, max: 0, percent: 0 };

        return {
            current: vehicle.health,
            max: vehicle.maxHealth,
            percent: (vehicle.health / vehicle.maxHealth) * 100
        };
    }

    /**
     * Enable damage
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable damage
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Set damage multiplier
     * @param {number} multiplier
     */
    setDamageMultiplier(multiplier) {
        this.collisionDamageMultiplier = multiplier;
    }

    /**
     * Set respawn delay
     * @param {number} delay - Delay in milliseconds
     */
    setRespawnDelay(delay) {
        this.respawnDelay = delay;
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
     * Destroy damage system
     */
    destroy() {
        this.vehicles.clear();
        this.respawnQueue = [];
        this.collisionCooldowns.clear();
        this.initialized = false;
    }
}

// Export for ES Modules
export { DamageSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.DamageSystem = DamageSystem;
}
