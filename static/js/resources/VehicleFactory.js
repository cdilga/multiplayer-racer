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

        // Create group to hold all parts
        const carGroup = new THREE.Group();
        carGroup.userData = { vehicleId: config.id };

        // Determine color (override or config)
        const bodyColor = options.color !== undefined
            ? options.color
            : this._parseColor(body.color);

        // Create car body
        const bodyGeometry = new THREE.BoxGeometry(body.width, body.height, body.length);
        const bodyMaterial = new THREE.MeshStandardMaterial({
            color: bodyColor,
            roughness: body.roughness || 0.5
        });
        const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
        bodyMesh.position.y = body.height / 2;
        bodyMesh.castShadow = true;
        carGroup.add(bodyMesh);

        // Create roof/cabin
        if (roof) {
            const roofWidth = body.width * (roof.widthScale || 0.75);
            const roofHeight = body.height * (roof.heightScale || 0.7);
            const roofLength = body.length * (roof.lengthScale || 0.5);

            const roofGeometry = new THREE.BoxGeometry(roofWidth, roofHeight, roofLength);
            const roofMaterial = new THREE.MeshStandardMaterial({
                color: this._parseColor(roof.color),
                roughness: roof.roughness || 0.7
            });
            const roofMesh = new THREE.Mesh(roofGeometry, roofMaterial);
            roofMesh.position.y = body.height + (roofHeight / 2);
            roofMesh.position.z = body.length * (roof.zOffset || -0.05);
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
        const wheelMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(wheelConfig.color),
            roughness: wheelConfig.roughness || 0.8
        });

        // Calculate wheel positions
        const wheelPositions = this._calculateWheelPositions(body, wheelConfig);

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
            this._addLights(carGroup, body, visual.headlights, true);
        }

        // Create taillights
        if (visual.taillights) {
            this._addLights(carGroup, body, visual.taillights, false);
        }

        return carGroup;
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
        const lightMaterial = new THREE.MeshStandardMaterial({
            color: this._parseColor(lightConfig.color),
            emissive: this._parseColor(lightConfig.color),
            emissiveIntensity: lightConfig.emissiveIntensity || 0.5
        });

        const zPos = isFront
            ? (body.length / 2) - 0.1
            : -(body.length / 2) + 0.1;

        // Left light
        const leftLight = new THREE.Mesh(lightGeometry, lightMaterial);
        leftLight.position.set(-(body.width / 3), body.height / 2, zPos);
        group.add(leftLight);

        // Right light
        const rightLight = new THREE.Mesh(lightGeometry, lightMaterial);
        rightLight.position.set(body.width / 3, body.height / 2, zPos);
        group.add(rightLight);
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
