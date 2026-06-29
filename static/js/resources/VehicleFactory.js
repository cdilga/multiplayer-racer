/**
 * VehicleFactory - Creates vehicle entities from JSON definitions
 *
 * Handles creation of both visual (Three.js) and physics (Rapier) components.
 *
 * Usage:
 *   import { VehicleFactory } from './resources/VehicleFactory.js';
 *
 *   const factory = new VehicleFactory({ resourceLoader, eventBus });
 *   const vehicle = await factory.create('default', { position: { x: 0, y: 1.5, z: 0 } });
 */

import { MaterialFactory } from './MaterialFactory.js';

class VehicleFactory {
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

        // Cache for vehicle configs
        this.configCache = new Map();

        // Material factory for lo-fi retro materials
        this.materialFactory = new MaterialFactory();
    }

    /**
     * Create a vehicle from a definition
     * @param {string} vehicleId - Vehicle ID (e.g., 'default')
     * @param {Object} options - Creation options
     * @param {Object} [options.position] - Initial position { x, y, z }
     * @param {number} [options.rotation] - Initial Y rotation in radians
     * @param {number} [options.color] - Override color (hex number)
     * @param {string} [options.playerId] - Associated player ID
     * @returns {Promise<Object>} Vehicle data with visual and physics components
     */
    async create(vehicleId, options = {}) {
        // Load config if not cached
        let config = this.configCache.get(vehicleId);
        if (!config) {
            config = await this.resourceLoader.loadVehicle(vehicleId);
            this.configCache.set(vehicleId, config);
        }

        const position = options.position || { x: 0, y: 1.5, z: 0 };
        const rotation = options.rotation || 0;

        // Create visual mesh
        const mesh = this._createVisualMesh(config, options);

        // Position and rotate mesh
        mesh.position.set(position.x, position.y, position.z);
        mesh.rotation.y = rotation;

        // Create vehicle data object
        const vehicle = {
            id: options.playerId || `vehicle_${Date.now()}`,
            configId: vehicleId,
            config: config,
            mesh: mesh,
            physicsBody: null,  // Created by PhysicsSystem
            vehicleController: null,  // Created by PhysicsSystem

            // State
            position: { ...position },
            rotation: rotation,
            velocity: { x: 0, y: 0, z: 0 },
            speed: 0,
            health: config.stats?.maxHealth || 100,

            // Controls state
            controls: {
                steering: 0,
                acceleration: 0,
                braking: 0
            },

            // Wheel meshes for visual sync
            wheels: []
        };

        // Store wheel meshes for later sync
        mesh.traverse((child) => {
            if (child.userData?.isWheel) {
                vehicle.wheels.push(child);
            }
        });

        this._emit('vehicle:created', { vehicle, config });

        return vehicle;
    }

    /**
     * Create Three.js mesh from vehicle config
     * @private
     */
    _createVisualMesh(config, options) {
        const visual = config.visual;
        const body = visual.body;
        const roof = visual.roof;
        const wheelConfig = visual.wheels;

        // Lightweight randomization for visual variety (if playerId is present)
        // Uses playerId as seed (stable for reconnects)
        const seed = options.playerId ? this._hashString(options.playerId) : Math.random();
        const rand = (min, max) => min + (max - min) * ((seed * 100) % 1); // pseudo-random

        // Randomize body slightly (±10%)
        const bodyScale = 1.0 + (rand(-0.1, 0.1));
        const bodyWidth = body.width * (1.0 + rand(-0.05, 0.05));
        const bodyHeight = body.height * (1.0 + rand(-0.1, 0.1));
        const bodyLength = body.length * (1.0 + rand(-0.05, 0.05));

        // Create group to hold all parts
        const carGroup = new THREE.Group();
        carGroup.userData = { vehicleId: config.id };

        // Determine color (override or config)
        const bodyColor = options.color !== undefined
            ? options.color
            : this._parseColor(body.color);

        // Create car body
        const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength);
        const bodyMaterial = this.materialFactory.createMaterial({
            color: bodyColor,
            type: 'toon',
            emissive: body.emissive ? this._parseColor(body.emissive) : 0x000000,
            emissiveIntensity: body.emissiveIntensity || 0
        });
        const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        bodyMesh.position.y = bodyHeight / 2;
        bodyMesh.castShadow = true;
        carGroup.add(bodyMesh);

        // Create roof/cabin
        if (roof) {
            // Randomize roof position and size
            const roofWidth = bodyWidth * (roof.widthScale || 0.75) * (0.9 + rand(0, 0.2));
            const roofHeight = bodyHeight * (roof.heightScale || 0.7) * (0.8 + rand(0, 0.4));
            const roofLength = bodyLength * (roof.lengthScale || 0.5) * (0.9 + rand(0, 0.2));

            const roofGeometry = new THREE.BoxGeometry(roofWidth, roofHeight, roofLength);
            const roofMaterial = this.materialFactory.createMaterial({
                color: this._parseColor(roof.color),
                type: 'toon'
            });
            const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
            roofMesh.position.y = bodyHeight + (roofHeight / 2);
            roofMesh.position.z = bodyLength * (roof.zOffset || -0.05) + rand(-0.2, 0.2);
            roofMesh.castShadow = true;
            carGroup.add(roofMesh);
        }

        // Create wheels
        const wheelGeometry = new THREE.CylinderGeometry(
            wheelConfig.radius,
            wheelConfig.radius,
            wheelConfig.thickness,
            wheelConfig.segments || 16
        );
        const wheelMaterial = this.materialFactory.createMaterial({
            color: this._parseColor(wheelConfig.color),
            type: 'toon'
        });

        // Calculate wheel positions (adjust for body size)
        const wheelPositions = this._calculateWheelPositions({
            width: bodyWidth,
            height: bodyHeight,
            length: bodyLength
        }, wheelConfig);

        wheelPositions.forEach((pos, index) => {
            const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
            wheel.position.set(pos.x, pos.y, pos.z);
            wheel.rotation.z = Math.PI / 2;  // Rotate to align with axle
            wheel.castShadow = true;
            wheel.userData = { isWheel: true, wheelIndex: index };
            carGroup.add(wheel);
        });

        // Create headlights
        if (visual.headlights) {
            this._addLights(carGroup, { width: bodyWidth, height: bodyHeight, length: bodyLength }, visual.headlights, true);
        }

        // Create taillights
        if (visual.taillights) {
            this._addLights(carGroup, { width: bodyWidth, height: bodyHeight, length: bodyLength }, visual.taillights, false);
        }

        return carGroup;
    }

    /**
     * Simple string hash for seeding
     * @private
     */
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash) / 2147483647;
    }

    /**
     * Calculate wheel positions from config
     * @private
     */
    _calculateWheelPositions(body, wheelConfig) {
        const protrusion = wheelConfig.protrusion || 0.1;
        const yOffset = wheelConfig.yOffset || -0.1;
        const thickness = wheelConfig.thickness;

        return [
            // Front left
            {
                x: -(body.width / 2) + (thickness / 2 - protrusion),
                y: yOffset,
                z: body.length / 3
            },
            // Front right
            {
                x: (body.width / 2) - (thickness / 2 - protrusion),
                y: yOffset,
                z: body.length / 3
            },
            // Rear left
            {
                x: -(body.width / 2) + (thickness / 2 - protrusion),
                y: yOffset,
                z: -body.length / 3
            },
            // Rear right
            {
                x: (body.width / 2) - (thickness / 2 - protrusion),
                y: yOffset,
                z: -body.length / 3
            }
        ];
    }

    /**
     * Add headlights or taillights
     * @private
     */
    _addLights(group, body, lightConfig, isFront) {
        const lightGeometry = new THREE.SphereGeometry(lightConfig.radius || 0.2, 16, 16);
        const lightMaterial = this.materialFactory.createMaterial({
            color: this._parseColor(lightConfig.color),
            type: 'flat',
            emissive: lightConfig.emissive ? this._parseColor(lightConfig.emissive) : this._parseColor(lightConfig.color),
            emissiveIntensity: lightConfig.emissiveIntensity || 0.5
        });

        const zPos = isFront
            ? (body.length / 2) - 0.1
            : -(body.length / 2) + 0.1;

        // Left light mesh
        const leftLightMesh = new THREE.Mesh(lightGeometry, lightMaterial);
        leftLightMesh.position.set(-(body.width / 3), body.height / 2, zPos);
        group.add(leftLightMesh);

        // Right light mesh
        const rightLightMesh = new THREE.Mesh(lightGeometry, lightMaterial);
        rightLightMesh.position.set(body.width / 3, body.height / 2, zPos);
        group.add(rightLightMesh);

        // Add PointLights for headlights (only if pointLight is enabled)
        if (isFront && lightConfig.pointLight) {
            const lightIntensity = lightConfig.pointLightIntensity || 3.0;
            const lightDistance = lightConfig.pointLightDistance || 20;

            // Left headlight PointLight
            const leftPointLight = new THREE.PointLight(
                this._parseColor(lightConfig.color),
                lightIntensity,
                lightDistance
            );
            leftPointLight.position.set(-(body.width / 3), body.height / 2, zPos);
            group.add(leftPointLight);
            leftLightMesh.userData.pointLight = leftPointLight;

            // Right headlight PointLight
            const rightPointLight = new THREE.PointLight(
                this._parseColor(lightConfig.color),
                lightIntensity,
                lightDistance
            );
            rightPointLight.position.set(body.width / 3, body.height / 2, zPos);
            group.add(rightPointLight);
            rightLightMesh.userData.pointLight = rightPointLight;
        }
    }

    /**
     * Parse color string to Three.js color
     * @private
     */
    _parseColor(colorValue) {
        if (typeof colorValue === 'number') {
            return colorValue;
        }
        if (typeof colorValue === 'string') {
            return new THREE.Color(colorValue).getHex();
        }
        return 0xff0000;  // Default red
    }

    /**
     * Get physics config from vehicle config
     * @param {string} vehicleId - Vehicle ID
     * @returns {Promise<Object>} Physics configuration
     */
    async getPhysicsConfig(vehicleId) {
        let config = this.configCache.get(vehicleId);
        if (!config) {
            config = await this.resourceLoader.loadVehicle(vehicleId);
            this.configCache.set(vehicleId, config);
        }
        return config.physics;
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
export { VehicleFactory };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.VehicleFactory = VehicleFactory;
}
