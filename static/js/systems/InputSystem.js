/**
 * InputSystem - Manages player input
 *
 * Responsibilities:
 * - Collect inputs from NetworkSystem (mobile controllers)
 * - Collect inputs from local keyboard (for testing)
 * - Apply inputs to vehicle entities
 *
 * Usage:
 *   const input = new InputSystem({ eventBus, networkSystem });
 *   input.update(dt);
 */

class InputSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {NetworkSystem} [options.networkSystem]
     * @param {boolean} [options.enableKeyboard=true] - Enable keyboard controls for testing
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.networkSystem = options.networkSystem || null;
        this.enableKeyboard = options.enableKeyboard !== false;

        // Local keyboard state
        this.keyboardState = {
            steering: 0,
            acceleration: 0,
            braking: 0
        };

        // Key mappings
        this.keys = {
            forward: new Set(['KeyW', 'ArrowUp']),
            backward: new Set(['KeyS', 'ArrowDown']),
            left: new Set(['KeyA', 'ArrowLeft']),
            right: new Set(['KeyD', 'ArrowRight']),
            brake: new Set(['Space'])
        };

        // Currently pressed keys
        this.pressedKeys = new Set();

        // Registered vehicles
        this.vehicles = new Map();  // vehicleId -> vehicle

        // State
        this.initialized = false;
    }

    /**
     * Initialize input system
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        console.log('InputSystem: Initializing...');

        // Setup keyboard handlers
        if (this.enableKeyboard) {
            this._setupKeyboardHandlers();
        }

        // Subscribe to network input events
        if (this.eventBus) {
            this.eventBus.on('network:playerInput', this._onNetworkInput.bind(this));
        }

        this.initialized = true;
        this._emit('input:ready');
        console.log('InputSystem: Ready');
    }

    /**
     * Setup keyboard event handlers
     * @private
     */
    _setupKeyboardHandlers() {
        window.addEventListener('keydown', (e) => {
            this.pressedKeys.add(e.code);
            this._updateKeyboardState();
        });

        window.addEventListener('keyup', (e) => {
            this.pressedKeys.delete(e.code);
            this._updateKeyboardState();
        });

        // Clear keys on window blur
        window.addEventListener('blur', () => {
            this.pressedKeys.clear();
            this._updateKeyboardState();
        });
    }

    /**
     * Update keyboard state from pressed keys
     * @private
     */
    _updateKeyboardState() {
        // Steering
        let steering = 0;
        for (const key of this.keys.left) {
            if (this.pressedKeys.has(key)) steering -= 1;
        }
        for (const key of this.keys.right) {
            if (this.pressedKeys.has(key)) steering += 1;
        }
        this.keyboardState.steering = Math.max(-1, Math.min(1, steering));

        // Acceleration
        let accel = 0;
        for (const key of this.keys.forward) {
            if (this.pressedKeys.has(key)) accel = 1;
        }
        for (const key of this.keys.backward) {
            if (this.pressedKeys.has(key)) accel = -1;  // Reverse
        }
        this.keyboardState.acceleration = accel;

        // Braking
        let brake = 0;
        for (const key of this.keys.brake) {
            if (this.pressedKeys.has(key)) brake = 1;
        }
        this.keyboardState.braking = brake;
    }

    /**
     * Handle network input event
     * @private
     */
    _onNetworkInput(data) {
        const vehicle = this.vehicles.get(data.playerId);
        if (vehicle) {
            vehicle.setControls(data.controls);
        }
    }

    /**
     * Update input system (called each frame)
     * @param {number} dt - Delta time
     */
    update(dt) {
        if (!this.initialized) return;

        // Apply network inputs to vehicles
        if (this.networkSystem) {
            const allControls = this.networkSystem.getAllPlayerControls();
            for (const [playerId, controls] of allControls) {
                const vehicle = this.vehicles.get(playerId);
                if (vehicle) {
                    vehicle.setControls(controls);
                }
            }
        }

        // Apply keyboard input to first vehicle (for testing)
        if (this.enableKeyboard && this.vehicles.size > 0) {
            const firstVehicle = this.vehicles.values().next().value;
            if (firstVehicle && !this._hasNetworkControl(firstVehicle)) {
                firstVehicle.setControls(this.keyboardState);
            }
        }
    }

    /**
     * Check if vehicle has network control
     * @private
     */
    _hasNetworkControl(vehicle) {
        if (!this.networkSystem) return false;
        return this.networkSystem.hasPlayer(vehicle.playerId);
    }

    /**
     * Register a vehicle for input handling
     * @param {Vehicle} vehicle
     */
    registerVehicle(vehicle) {
        this.vehicles.set(vehicle.id, vehicle);

        // Also register by playerId if different
        if (vehicle.playerId && vehicle.playerId !== vehicle.id) {
            this.vehicles.set(vehicle.playerId, vehicle);
        }
    }

    /**
     * Unregister a vehicle
     * @param {string} vehicleId
     */
    unregisterVehicle(vehicleId) {
        const vehicle = this.vehicles.get(vehicleId);
        if (vehicle) {
            this.vehicles.delete(vehicleId);
            if (vehicle.playerId) {
                this.vehicles.delete(vehicle.playerId);
            }
        }
    }

    /**
     * Clear all registered vehicles
     */
    clearVehicles() {
        this.vehicles.clear();
    }

    /**
     * Get keyboard state (for testing)
     * @returns {Object}
     */
    getKeyboardState() {
        return { ...this.keyboardState };
    }

    /**
     * Set network system
     * @param {NetworkSystem} networkSystem
     */
    setNetworkSystem(networkSystem) {
        this.networkSystem = networkSystem;
    }

    /**
     * Check if key is pressed
     * @param {string} keyCode
     * @returns {boolean}
     */
    isKeyPressed(keyCode) {
        return this.pressedKeys.has(keyCode);
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
     * Destroy input system
     */
    destroy() {
        this.vehicles.clear();
        this.pressedKeys.clear();
        this.initialized = false;
    }
}

// Export for ES Modules
export { InputSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.InputSystem = InputSystem;
}
