/**
 * WeaponSystem - Manages weapon spawning, pickups, inventory, and firing
 *
 * Responsibilities:
 * - Spawn weapon pickups in the arena
 * - Handle pickup collection
 * - Manage player weapon inventory (1 weapon at a time)
 * - Process weapon firing
 * - Track projectiles and effects
 *
 * Usage:
 *   const weapons = new WeaponSystem({ eventBus, renderSystem, physicsSystem });
 *   weapons.init();
 *   weapons.setArenaConfig(arenaConfig);
 *   weapons.start();
 */

// Weapon types
const WEAPON_TYPES = {
    MISSILE: 'missile',
    MINE: 'mine',
    BOOST: 'boost',
    OIL_SLICK: 'oil-slick',
    SNIPER: 'sniper',
    SHIELD: 'shield',
    EMP: 'emp',
    FLAMETHROWER: 'flamethrower'
};

// Rarity tiers
const RARITY_TIERS = {
    COMMON: { weight: 70, weapons: ['missile', 'mine', 'boost'] },
    UNCOMMON: { weight: 25, weapons: ['shield', 'emp'] },
    RARE: { weight: 5, weapons: ['sniper'] }
};

class WeaponSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {RenderSystem} [options.renderSystem]
     * @param {PhysicsSystem} [options.physicsSystem]
     * @param {DamageSystem} [options.damageSystem]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.renderSystem = options.renderSystem || null;
        this.physicsSystem = options.physicsSystem || null;
        this.damageSystem = options.damageSystem || null;

        // Configuration
        this.arenaConfig = null;
        this.enabled = false;
        this.spawnInterval = [8, 12]; // seconds
        this.maxActivePickups = 3;
        this.arenaRadius = 35; // Default, updated from arena config

        // State
        this.initialized = false;
        this.running = false;
        this.nextSpawnTime = 0;

        // Active pickups in the arena
        this.pickups = new Map(); // pickupId -> { weapon, position, mesh, createdAt }

        // Player inventories (1 weapon per player)
        this.inventory = new Map(); // playerId -> { weaponId, weaponData }

        // Active projectiles/effects
        this.projectiles = new Map(); // projectileId -> projectile data
        this.effects = new Map(); // effectId -> effect data

        // Weapon definitions
        this.weaponDefs = new Map();

        // Pickup counter for unique IDs
        this.pickupCounter = 0;
        this.projectileCounter = 0;

        // Registered vehicles for pickup detection
        this.vehicles = new Map();
    }

    /**
     * Initialize weapon system
     */
    async init() {
        if (this.initialized) return;

        console.log('WeaponSystem: Initializing...');

        // Load weapon definitions
        await this._loadWeaponDefinitions();

        // Subscribe to events
        if (this.eventBus) {
            this.eventBus.on('weapon:fire', this._onWeaponFire.bind(this));
            this.eventBus.on('derby:combatStart', this._onCombatStart.bind(this));
            this.eventBus.on('derby:roundEnd', this._onRoundEnd.bind(this));
            this.eventBus.on('derby:matchEnd', this._onMatchEnd.bind(this));
        }

        this.initialized = true;
        this._emit('weapon:ready');
        console.log('WeaponSystem: Ready');
    }

    /**
     * Load weapon definitions
     * @private
     */
    async _loadWeaponDefinitions() {
        // Define starter weapons (Phase 2: Missile, Mine, Boost)
        this.weaponDefs.set('missile', {
            id: 'missile',
            name: 'Homing Missile',
            icon: '\uD83D\uDE80', // rocket emoji
            rarity: 'common',
            behavior: {
                type: 'projectile',
                speed: 50,
                lifetime: 5,
                tracking: {
                    enabled: true,
                    turnRate: 3,
                    lockRange: 30,
                    lockAngle: 45
                }
            },
            damage: {
                amount: 35,
                radius: 0,
                knockback: 15
            },
            effects: {
                trail: { type: 'smoke', color: '#FFAA44', size: 0.3 },
                explosion: { particles: 'explosion-fire', scale: 2 }
            },
            ui: { color: '#FF6B6B', description: 'Tracks nearest enemy' }
        });

        this.weaponDefs.set('mine', {
            id: 'mine',
            name: 'Proximity Mine',
            icon: '\uD83D\uDCA3', // bomb emoji
            rarity: 'common',
            behavior: {
                type: 'deployable',
                deployBehind: true,
                deployOffset: -2,
                lifetime: 60,
                triggerRadius: 3,
                armDelay: 1
            },
            damage: {
                amount: 40,
                radius: 5,
                knockback: 25
            },
            effects: {
                idle: { type: 'pulse', color: '#FF0000', rate: 1 },
                explosion: { particles: 'explosion-large', scale: 3 }
            },
            ui: { color: '#FF4444', description: 'Drops behind car' }
        });

        this.weaponDefs.set('boost', {
            id: 'boost',
            name: 'Nitro Boost',
            icon: '\uD83D\uDD25', // fire emoji
            rarity: 'common',
            behavior: {
                type: 'buff',
                duration: 3,
                speedMultiplier: 2,
                ramDamageBonus: 25
            },
            damage: {
                amount: 0
            },
            effects: {
                active: { type: 'flames', color: '#FF4400', emitFrom: 'exhaust' }
            },
            ui: { color: '#FF8800', description: 'Speed burst + ram damage' }
        });

        console.log(`WeaponSystem: Loaded ${this.weaponDefs.size} weapon definitions`);
    }

    /**
     * Set arena configuration
     * @param {Object} config - Arena config with weapons section
     */
    setArenaConfig(config) {
        this.arenaConfig = config;

        if (config.weapons) {
            this.enabled = config.weapons.enabled !== false;
            this.spawnInterval = config.weapons.spawnInterval || [8, 12];
            this.maxActivePickups = config.weapons.maxActive || 3;
        }

        if (config.geometry) {
            this.arenaRadius = (config.geometry.diameter || 80) / 2 - 5; // Stay away from walls
        }

        console.log(`WeaponSystem: Arena config set, weapons ${this.enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Register a vehicle for pickup detection
     * @param {Vehicle} vehicle
     */
    registerVehicle(vehicle) {
        this.vehicles.set(vehicle.id, vehicle);
        // Initialize empty inventory for this player
        if (!this.inventory.has(vehicle.playerId)) {
            this.inventory.set(vehicle.playerId, null);
        }
    }

    /**
     * Unregister a vehicle
     * @param {string} vehicleId
     */
    unregisterVehicle(vehicleId) {
        const vehicle = this.vehicles.get(vehicleId);
        if (vehicle) {
            this.inventory.delete(vehicle.playerId);
        }
        this.vehicles.delete(vehicleId);
    }

    /**
     * Start weapon spawning
     */
    start() {
        if (!this.enabled) {
            console.log('WeaponSystem: Weapons disabled for this arena');
            return;
        }

        this.running = true;
        this._scheduleNextSpawn();
        console.log('WeaponSystem: Started');
    }

    /**
     * Stop weapon spawning
     */
    stop() {
        this.running = false;
        console.log('WeaponSystem: Stopped');
    }

    /**
     * Update weapon system
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.initialized) return;

        const now = performance.now() / 1000;

        // Spawn new pickups if running
        if (this.running && this.enabled && now >= this.nextSpawnTime) {
            if (this.pickups.size < this.maxActivePickups) {
                this._spawnWeaponPickup();
            }
            this._scheduleNextSpawn();
        }

        // Check for pickup collisions
        this._checkPickupCollisions();

        // Update projectiles
        this._updateProjectiles(dt);

        // Update effects (buffs, mines, etc.)
        this._updateEffects(dt);
    }

    /**
     * Schedule next weapon spawn
     * @private
     */
    _scheduleNextSpawn() {
        const [minInterval, maxInterval] = this.spawnInterval;
        const interval = minInterval + Math.random() * (maxInterval - minInterval);
        this.nextSpawnTime = performance.now() / 1000 + interval;
    }

    /**
     * Spawn a weapon pickup in the arena
     * @private
     */
    _spawnWeaponPickup() {
        // Select weapon based on rarity
        const weapon = this._selectRandomWeapon();
        if (!weapon) return;

        // Generate random position within arena
        const position = this._getRandomSpawnPosition();

        // Create pickup ID
        const pickupId = `pickup_${++this.pickupCounter}`;

        // Create visual representation
        const mesh = this._createPickupMesh(weapon);
        if (mesh) {
            mesh.position.set(position.x, position.y, position.z);
            if (this.renderSystem) {
                this.renderSystem.addMesh(mesh, pickupId);
            }
        }

        // Store pickup
        this.pickups.set(pickupId, {
            id: pickupId,
            weapon: weapon,
            position: position,
            mesh: mesh,
            createdAt: performance.now(),
            rotation: 0
        });

        this._emit('weapon:spawned', {
            pickupId,
            weaponId: weapon.id,
            position
        });

        console.log(`WeaponSystem: Spawned ${weapon.name} at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`);
    }

    /**
     * Select a random weapon based on rarity
     * @private
     * @returns {Object} Weapon definition
     */
    _selectRandomWeapon() {
        // Calculate total weight
        let totalWeight = 0;
        for (const tier of Object.values(RARITY_TIERS)) {
            // Only include weapons that are defined
            const availableWeapons = tier.weapons.filter(w => this.weaponDefs.has(w));
            if (availableWeapons.length > 0) {
                totalWeight += tier.weight;
            }
        }

        // Random selection
        let random = Math.random() * totalWeight;

        for (const tier of Object.values(RARITY_TIERS)) {
            const availableWeapons = tier.weapons.filter(w => this.weaponDefs.has(w));
            if (availableWeapons.length === 0) continue;

            if (random < tier.weight) {
                // Select random weapon from this tier
                const weaponId = availableWeapons[Math.floor(Math.random() * availableWeapons.length)];
                return this.weaponDefs.get(weaponId);
            }
            random -= tier.weight;
        }

        // Fallback to first available weapon
        return this.weaponDefs.values().next().value;
    }

    /**
     * Get a random spawn position within the arena
     * @private
     * @returns {Object} { x, y, z }
     */
    _getRandomSpawnPosition() {
        // Random position within arena circle
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * this.arenaRadius * 0.8; // Keep away from edges

        return {
            x: Math.cos(angle) * distance,
            y: 1.5, // Floating above ground
            z: Math.sin(angle) * distance
        };
    }

    /**
     * Create visual mesh for pickup
     * @private
     * @param {Object} weapon - Weapon definition
     * @returns {THREE.Mesh}
     */
    _createPickupMesh(weapon) {
        if (typeof THREE === 'undefined') return null;

        // Create a glowing box for the pickup
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const color = weapon.ui?.color || '#FFFF00';

        const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.5,
            metalness: 0.5,
            roughness: 0.3
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.weaponId = weapon.id;
        mesh.userData.isPickup = true;

        return mesh;
    }

    /**
     * Check for pickup collisions with vehicles
     * @private
     */
    _checkPickupCollisions() {
        const pickupRadius = 3; // Pickup collection radius

        for (const [pickupId, pickup] of this.pickups) {
            // Rotate pickup for visual effect
            if (pickup.mesh) {
                pickup.rotation += 0.02;
                pickup.mesh.rotation.y = pickup.rotation;
                // Bob up and down
                pickup.mesh.position.y = 1.5 + Math.sin(pickup.rotation * 2) * 0.3;
            }

            // Check collision with each vehicle
            for (const [vehicleId, vehicle] of this.vehicles) {
                if (vehicle.isDead) continue;

                const pos = vehicle.mesh?.position;
                if (!pos) continue;

                const dx = pos.x - pickup.position.x;
                const dz = pos.z - pickup.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < pickupRadius) {
                    this._collectPickup(pickupId, vehicle);
                    break;
                }
            }
        }
    }

    /**
     * Collect a pickup
     * @private
     * @param {string} pickupId
     * @param {Vehicle} vehicle
     */
    _collectPickup(pickupId, vehicle) {
        const pickup = this.pickups.get(pickupId);
        if (!pickup) return;

        // Remove pickup mesh
        if (pickup.mesh && this.renderSystem) {
            this.renderSystem.removeMesh(pickupId);
        }

        // Remove from pickups
        this.pickups.delete(pickupId);

        // Give weapon to player (replaces existing)
        const playerId = vehicle.playerId;
        this.inventory.set(playerId, {
            weaponId: pickup.weapon.id,
            weaponData: pickup.weapon
        });

        this._emit('weapon:pickup', {
            playerId,
            vehicleId: vehicle.id,
            weaponId: pickup.weapon.id,
            weaponName: pickup.weapon.name
        });

        console.log(`WeaponSystem: ${playerId} picked up ${pickup.weapon.name}`);
    }

    /**
     * Fire weapon for a player
     * @param {string} playerId
     */
    fireWeapon(playerId) {
        const inventoryItem = this.inventory.get(playerId);
        if (!inventoryItem) {
            console.log(`WeaponSystem: ${playerId} has no weapon`);
            return;
        }

        const vehicle = this._getVehicleByPlayerId(playerId);
        if (!vehicle || vehicle.isDead) return;

        const weapon = inventoryItem.weaponData;

        // Process weapon based on type
        switch (weapon.behavior.type) {
            case 'projectile':
                this._fireProjectile(vehicle, weapon);
                break;
            case 'deployable':
                this._deployWeapon(vehicle, weapon);
                break;
            case 'buff':
                this._applyBuff(vehicle, weapon);
                break;
            case 'hitscan':
                this._fireHitscan(vehicle, weapon);
                break;
            case 'aoe':
                this._fireAOE(vehicle, weapon);
                break;
        }

        // Clear inventory after use
        this.inventory.set(playerId, null);

        this._emit('weapon:fired', {
            playerId,
            vehicleId: vehicle.id,
            weaponId: weapon.id,
            weaponName: weapon.name
        });
    }

    /**
     * Fire a projectile weapon (missile)
     * @private
     */
    _fireProjectile(vehicle, weapon) {
        const pos = vehicle.mesh?.position;
        const rot = vehicle.mesh?.rotation.y || 0;
        if (!pos) return;

        // Spawn projectile in front of vehicle
        const spawnOffset = 3;
        const projectilePos = {
            x: pos.x + Math.sin(rot) * spawnOffset,
            y: pos.y + 0.5,
            z: pos.z + Math.cos(rot) * spawnOffset
        };

        const projectileId = `proj_${++this.projectileCounter}`;

        // Find target (nearest enemy)
        let target = null;
        if (weapon.behavior.tracking?.enabled) {
            target = this._findNearestEnemy(vehicle);
        }

        // Create projectile mesh
        const mesh = this._createProjectileMesh(weapon);
        if (mesh) {
            mesh.position.set(projectilePos.x, projectilePos.y, projectilePos.z);
            mesh.rotation.y = rot;
            if (this.renderSystem) {
                this.renderSystem.addMesh(mesh, projectileId);
            }
        }

        this.projectiles.set(projectileId, {
            id: projectileId,
            weapon: weapon,
            ownerId: vehicle.playerId,
            position: { ...projectilePos },
            rotation: rot,
            velocity: weapon.behavior.speed,
            target: target,
            mesh: mesh,
            createdAt: performance.now(),
            lifetime: weapon.behavior.lifetime * 1000
        });

        console.log(`WeaponSystem: ${vehicle.playerId} fired ${weapon.name}`);
    }

    /**
     * Deploy a weapon (mine)
     * @private
     */
    _deployWeapon(vehicle, weapon) {
        const pos = vehicle.mesh?.position;
        const rot = vehicle.mesh?.rotation.y || 0;
        if (!pos) return;

        // Deploy behind vehicle
        const offset = weapon.behavior.deployOffset || -2;
        const deployPos = {
            x: pos.x - Math.sin(rot) * Math.abs(offset),
            y: 0.5,
            z: pos.z - Math.cos(rot) * Math.abs(offset)
        };

        const effectId = `effect_${++this.projectileCounter}`;

        // Create mine mesh
        const mesh = this._createMineMesh(weapon);
        if (mesh) {
            mesh.position.set(deployPos.x, deployPos.y, deployPos.z);
            if (this.renderSystem) {
                this.renderSystem.addMesh(mesh, effectId);
            }
        }

        this.effects.set(effectId, {
            id: effectId,
            type: 'mine',
            weapon: weapon,
            ownerId: vehicle.playerId,
            position: { ...deployPos },
            mesh: mesh,
            createdAt: performance.now(),
            armTime: performance.now() + (weapon.behavior.armDelay || 1) * 1000,
            lifetime: weapon.behavior.lifetime * 1000,
            armed: false,
            triggerRadius: weapon.behavior.triggerRadius || 3
        });

        console.log(`WeaponSystem: ${vehicle.playerId} deployed ${weapon.name}`);
    }

    /**
     * Apply a buff weapon (boost)
     * @private
     */
    _applyBuff(vehicle, weapon) {
        const effectId = `buff_${++this.projectileCounter}`;

        this.effects.set(effectId, {
            id: effectId,
            type: 'buff',
            weapon: weapon,
            targetVehicleId: vehicle.id,
            ownerId: vehicle.playerId,
            createdAt: performance.now(),
            duration: weapon.behavior.duration * 1000,
            speedMultiplier: weapon.behavior.speedMultiplier || 1,
            ramDamageBonus: weapon.behavior.ramDamageBonus || 0
        });

        // Apply speed boost effect
        vehicle.speedBoost = weapon.behavior.speedMultiplier || 2;
        vehicle.ramDamageBonus = weapon.behavior.ramDamageBonus || 25;

        this._emit('weapon:buffApplied', {
            playerId: vehicle.playerId,
            vehicleId: vehicle.id,
            weaponId: weapon.id,
            duration: weapon.behavior.duration
        });

        console.log(`WeaponSystem: ${vehicle.playerId} activated ${weapon.name}`);
    }

    /**
     * Fire hitscan weapon (sniper)
     * @private
     */
    _fireHitscan(vehicle, weapon) {
        // Find target in line of fire
        const target = this._raycastForTarget(vehicle, weapon.behavior.range || 100);

        if (target) {
            this._applyDamage(target.id, weapon.damage.amount, vehicle.playerId, weapon.id);

            this._emit('weapon:hit', {
                weaponId: weapon.id,
                shooterId: vehicle.playerId,
                targetId: target.playerId,
                damage: weapon.damage.amount
            });
        }

        console.log(`WeaponSystem: ${vehicle.playerId} fired ${weapon.name}, hit: ${target?.playerId || 'none'}`);
    }

    /**
     * Fire AOE weapon (EMP)
     * @private
     */
    _fireAOE(vehicle, weapon) {
        const pos = vehicle.mesh?.position;
        if (!pos) return;

        const radius = weapon.behavior.radius || 15;

        // Find all vehicles in range
        for (const [vehicleId, targetVehicle] of this.vehicles) {
            if (vehicleId === vehicle.id) continue;
            if (targetVehicle.isDead) continue;

            const targetPos = targetVehicle.mesh?.position;
            if (!targetPos) continue;

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= radius) {
                // Apply stun
                targetVehicle.stunned = true;
                targetVehicle.stunEndTime = performance.now() + (weapon.behavior.stunDuration || 3) * 1000;

                this._emit('weapon:stun', {
                    targetId: targetVehicle.playerId,
                    duration: weapon.behavior.stunDuration
                });
            }
        }

        console.log(`WeaponSystem: ${vehicle.playerId} fired ${weapon.name}`);
    }

    /**
     * Update active projectiles
     * @private
     */
    _updateProjectiles(dt) {
        const now = performance.now();

        for (const [projectileId, projectile] of this.projectiles) {
            // Check lifetime
            if (now - projectile.createdAt > projectile.lifetime) {
                this._removeProjectile(projectileId);
                continue;
            }

            // Update position
            const weapon = projectile.weapon;
            let direction = projectile.rotation;

            // Homing behavior
            if (weapon.behavior.tracking?.enabled && projectile.target) {
                const target = this.vehicles.get(projectile.target);
                if (target && !target.isDead) {
                    const targetPos = target.mesh?.position;
                    if (targetPos) {
                        const dx = targetPos.x - projectile.position.x;
                        const dz = targetPos.z - projectile.position.z;
                        const targetAngle = Math.atan2(dx, dz);

                        // Turn towards target
                        const turnRate = weapon.behavior.tracking.turnRate * dt;
                        let angleDiff = targetAngle - direction;

                        // Normalize angle difference
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                        if (Math.abs(angleDiff) < turnRate) {
                            direction = targetAngle;
                        } else {
                            direction += Math.sign(angleDiff) * turnRate;
                        }

                        projectile.rotation = direction;
                    }
                }
            }

            // Move projectile
            const speed = projectile.velocity * dt;
            projectile.position.x += Math.sin(direction) * speed;
            projectile.position.z += Math.cos(direction) * speed;

            // Update mesh
            if (projectile.mesh) {
                projectile.mesh.position.set(
                    projectile.position.x,
                    projectile.position.y,
                    projectile.position.z
                );
                projectile.mesh.rotation.y = direction;
            }

            // Check collision with vehicles
            for (const [vehicleId, vehicle] of this.vehicles) {
                if (vehicle.playerId === projectile.ownerId) continue;
                if (vehicle.isDead) continue;

                const pos = vehicle.mesh?.position;
                if (!pos) continue;

                const dx = pos.x - projectile.position.x;
                const dz = pos.z - projectile.position.z;
                const distance = Math.sqrt(dx * dx + dz * dz);

                if (distance < 2) {
                    // Hit!
                    this._applyDamage(vehicleId, weapon.damage.amount, projectile.ownerId, weapon.id);

                    this._emit('weapon:hit', {
                        projectileId,
                        weaponId: weapon.id,
                        shooterId: projectile.ownerId,
                        targetId: vehicle.playerId,
                        damage: weapon.damage.amount
                    });

                    this._removeProjectile(projectileId);
                    break;
                }
            }
        }
    }

    /**
     * Update active effects (mines, buffs)
     * @private
     */
    _updateEffects(dt) {
        const now = performance.now();

        for (const [effectId, effect] of this.effects) {
            if (effect.type === 'mine') {
                // Check if armed
                if (!effect.armed && now >= effect.armTime) {
                    effect.armed = true;
                }

                // Check lifetime
                if (now - effect.createdAt > effect.lifetime) {
                    this._removeEffect(effectId);
                    continue;
                }

                // Check trigger collision
                if (effect.armed) {
                    for (const [vehicleId, vehicle] of this.vehicles) {
                        if (vehicle.playerId === effect.ownerId) continue;
                        if (vehicle.isDead) continue;

                        const pos = vehicle.mesh?.position;
                        if (!pos) continue;

                        const dx = pos.x - effect.position.x;
                        const dz = pos.z - effect.position.z;
                        const distance = Math.sqrt(dx * dx + dz * dz);

                        if (distance < effect.triggerRadius) {
                            // Explode!
                            this._explodeMine(effect);
                            this._removeEffect(effectId);
                            break;
                        }
                    }
                }

                // Pulse animation
                if (effect.mesh) {
                    const pulse = Math.sin(now / 200) * 0.2 + 1;
                    effect.mesh.scale.set(pulse, pulse, pulse);
                }
            } else if (effect.type === 'buff') {
                // Check duration
                if (now - effect.createdAt > effect.duration) {
                    // Remove buff
                    const vehicle = this.vehicles.get(effect.targetVehicleId);
                    if (vehicle) {
                        vehicle.speedBoost = 1;
                        vehicle.ramDamageBonus = 0;
                    }

                    this._emit('weapon:buffExpired', {
                        playerId: effect.ownerId,
                        vehicleId: effect.targetVehicleId,
                        weaponId: effect.weapon.id
                    });

                    this._removeEffect(effectId);
                }
            }
        }
    }

    /**
     * Explode a mine
     * @private
     */
    _explodeMine(mine) {
        const weapon = mine.weapon;
        const radius = weapon.damage.radius || 5;

        // Damage all vehicles in radius
        for (const [vehicleId, vehicle] of this.vehicles) {
            if (vehicle.isDead) continue;

            const pos = vehicle.mesh?.position;
            if (!pos) continue;

            const dx = pos.x - mine.position.x;
            const dz = pos.z - mine.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance <= radius) {
                // Calculate damage falloff
                const falloff = 1 - (distance / radius);
                const damage = weapon.damage.amount * falloff;

                this._applyDamage(vehicleId, damage, mine.ownerId, weapon.id);

                this._emit('weapon:hit', {
                    effectId: mine.id,
                    weaponId: weapon.id,
                    shooterId: mine.ownerId,
                    targetId: vehicle.playerId,
                    damage: damage
                });
            }
        }

        this._emit('weapon:explosion', {
            position: mine.position,
            weaponId: weapon.id
        });

        console.log(`WeaponSystem: Mine exploded at (${mine.position.x.toFixed(1)}, ${mine.position.z.toFixed(1)})`);
    }

    /**
     * Apply damage to a vehicle
     * @private
     */
    _applyDamage(vehicleId, amount, sourcePlayerId, weaponId) {
        if (this.damageSystem) {
            this.damageSystem.applyDamage(vehicleId, amount, {
                type: 'weapon',
                weaponId: weaponId,
                sourcePlayerId: sourcePlayerId
            });
        } else {
            // Fallback: apply damage directly
            const vehicle = this.vehicles.get(vehicleId);
            if (vehicle) {
                vehicle.takeDamage(amount, {
                    type: 'weapon',
                    weaponId: weaponId,
                    sourcePlayerId: sourcePlayerId
                });
            }
        }
    }

    /**
     * Create projectile mesh
     * @private
     */
    _createProjectileMesh(weapon) {
        if (typeof THREE === 'undefined') return null;

        const geometry = new THREE.ConeGeometry(0.3, 1.5, 8);
        geometry.rotateX(Math.PI / 2);

        const color = weapon.effects?.trail?.color || '#FF4400';
        const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.8
        });

        return new THREE.Mesh(geometry, material);
    }

    /**
     * Create mine mesh
     * @private
     */
    _createMineMesh(weapon) {
        if (typeof THREE === 'undefined') return null;

        const geometry = new THREE.SphereGeometry(0.8, 16, 16);
        const color = weapon.effects?.idle?.color || '#FF0000';

        const material = new THREE.MeshStandardMaterial({
            color: '#333333',
            emissive: color,
            emissiveIntensity: 0.5
        });

        return new THREE.Mesh(geometry, material);
    }

    /**
     * Remove a projectile
     * @private
     */
    _removeProjectile(projectileId) {
        const projectile = this.projectiles.get(projectileId);
        if (projectile?.mesh && this.renderSystem) {
            this.renderSystem.removeMesh(projectileId);
        }
        this.projectiles.delete(projectileId);
    }

    /**
     * Remove an effect
     * @private
     */
    _removeEffect(effectId) {
        const effect = this.effects.get(effectId);
        if (effect?.mesh && this.renderSystem) {
            this.renderSystem.removeMesh(effectId);
        }
        this.effects.delete(effectId);
    }

    /**
     * Find nearest enemy vehicle
     * @private
     */
    _findNearestEnemy(vehicle) {
        const pos = vehicle.mesh?.position;
        if (!pos) return null;

        let nearest = null;
        let nearestDistance = Infinity;

        for (const [vehicleId, target] of this.vehicles) {
            if (vehicleId === vehicle.id) continue;
            if (target.isDead) continue;

            const targetPos = target.mesh?.position;
            if (!targetPos) continue;

            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = vehicleId;
            }
        }

        return nearest;
    }

    /**
     * Raycast for hitscan target
     * @private
     */
    _raycastForTarget(vehicle, range) {
        const pos = vehicle.mesh?.position;
        const rot = vehicle.mesh?.rotation.y || 0;
        if (!pos) return null;

        // Simple raycast along vehicle forward direction
        for (const [vehicleId, target] of this.vehicles) {
            if (vehicleId === vehicle.id) continue;
            if (target.isDead) continue;

            const targetPos = target.mesh?.position;
            if (!targetPos) continue;

            // Check if target is roughly in front
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance > range) continue;

            const angleToTarget = Math.atan2(dx, dz);
            let angleDiff = Math.abs(angleToTarget - rot);
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

            if (Math.abs(angleDiff) < 0.3) { // ~17 degrees
                return target;
            }
        }

        return null;
    }

    /**
     * Get vehicle by player ID
     * @private
     */
    _getVehicleByPlayerId(playerId) {
        for (const [vehicleId, vehicle] of this.vehicles) {
            if (vehicle.playerId === playerId) {
                return vehicle;
            }
        }
        return null;
    }

    /**
     * Get player's current weapon
     * @param {string} playerId
     * @returns {Object|null} Weapon data or null
     */
    getPlayerWeapon(playerId) {
        const item = this.inventory.get(playerId);
        return item?.weaponData || null;
    }

    /**
     * Handle combat start event
     * @private
     */
    _onCombatStart() {
        this.start();
    }

    /**
     * Handle round end event
     * @private
     */
    _onRoundEnd() {
        this._cleanup();
    }

    /**
     * Handle match end event
     * @private
     */
    _onMatchEnd() {
        this._cleanup();
        this.stop();
    }

    /**
     * Handle weapon fire event from controller
     * @private
     */
    _onWeaponFire(data) {
        this.fireWeapon(data.playerId);
    }

    /**
     * Clean up all pickups, projectiles, and effects
     * @private
     */
    _cleanup() {
        // Remove all pickup meshes
        for (const [pickupId, pickup] of this.pickups) {
            if (pickup.mesh && this.renderSystem) {
                this.renderSystem.removeMesh(pickupId);
            }
        }
        this.pickups.clear();

        // Remove all projectile meshes
        for (const [projectileId, projectile] of this.projectiles) {
            if (projectile.mesh && this.renderSystem) {
                this.renderSystem.removeMesh(projectileId);
            }
        }
        this.projectiles.clear();

        // Remove all effect meshes and clear buffs
        for (const [effectId, effect] of this.effects) {
            if (effect.mesh && this.renderSystem) {
                this.renderSystem.removeMesh(effectId);
            }
            // Clear buff effects from vehicles
            if (effect.type === 'buff') {
                const vehicle = this.vehicles.get(effect.targetVehicleId);
                if (vehicle) {
                    vehicle.speedBoost = 1;
                    vehicle.ramDamageBonus = 0;
                }
            }
        }
        this.effects.clear();

        // Clear inventories
        for (const [playerId] of this.inventory) {
            this.inventory.set(playerId, null);
        }

        this.running = false;
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
     * Destroy weapon system
     */
    destroy() {
        this._cleanup();
        this.vehicles.clear();
        this.inventory.clear();
        this.weaponDefs.clear();
        this.initialized = false;
    }
}

// Export constants
export { WEAPON_TYPES, RARITY_TIERS };

// Export for ES Modules
export { WeaponSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.WeaponSystem = WeaponSystem;
    window.WEAPON_TYPES = WEAPON_TYPES;
}
