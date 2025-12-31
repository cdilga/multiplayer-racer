/**
 * InputManager - Unified input handling for player controller
 *
 * Manages touch, keyboard, and gamepad inputs for the mobile controller interface.
 *
 * Usage:
 *   const input = new InputManager({ eventBus });
 *   input.init();
 *   const controls = input.getControls();
 */

class InputManager {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {boolean} [options.enableTouch=true]
     * @param {boolean} [options.enableKeyboard=true]
     * @param {boolean} [options.enableGamepad=false]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        this.enableTouch = options.enableTouch !== false;
        this.enableKeyboard = options.enableKeyboard !== false;
        this.enableGamepad = options.enableGamepad || false;

        // Current control state
        this.controls = {
            steering: 0,      // -1 (left) to 1 (right)
            acceleration: 0,  // 0 to 1
            braking: 0        // 0 to 1
        };

        // Input sources (combined for final output)
        this.touchControls = { steering: 0, acceleration: 0, braking: 0 };
        this.keyboardControls = { steering: 0, acceleration: 0, braking: 0 };
        this.gamepadControls = { steering: 0, acceleration: 0, braking: 0 };

        // Registered controllers
        this.controllers = [];

        // Keyboard state
        this.pressedKeys = new Set();

        // Gamepad
        this.gamepadIndex = null;

        // Callbacks
        this.onControlsChange = null;

        // State
        this.initialized = false;
    }

    /**
     * Initialize input manager
     */
    init() {
        if (this.initialized) return;

        console.log('InputManager: Initializing...');

        if (this.enableKeyboard) {
            this._setupKeyboard();
        }

        if (this.enableGamepad) {
            this._setupGamepad();
        }

        this.initialized = true;
        this._emit('input:managerReady');
        console.log('InputManager: Ready');
    }

    /**
     * Setup keyboard handlers
     * @private
     */
    _setupKeyboard() {
        window.addEventListener('keydown', (e) => {
            this.pressedKeys.add(e.code);
            this._updateKeyboardControls();
        });

        window.addEventListener('keyup', (e) => {
            this.pressedKeys.delete(e.code);
            this._updateKeyboardControls();
        });

        window.addEventListener('blur', () => {
            this.pressedKeys.clear();
            this._updateKeyboardControls();
        });
    }

    /**
     * Update keyboard controls
     * @private
     */
    _updateKeyboardControls() {
        // Steering
        let steering = 0;
        if (this.pressedKeys.has('ArrowLeft') || this.pressedKeys.has('KeyA')) {
            steering -= 1;
        }
        if (this.pressedKeys.has('ArrowRight') || this.pressedKeys.has('KeyD')) {
            steering += 1;
        }
        this.keyboardControls.steering = steering;

        // Acceleration
        let accel = 0;
        if (this.pressedKeys.has('ArrowUp') || this.pressedKeys.has('KeyW')) {
            accel = 1;
        }
        this.keyboardControls.acceleration = accel;

        // Braking
        let brake = 0;
        if (this.pressedKeys.has('ArrowDown') || this.pressedKeys.has('KeyS') ||
            this.pressedKeys.has('Space')) {
            brake = 1;
        }
        this.keyboardControls.braking = brake;

        this._updateCombinedControls();
    }

    /**
     * Setup gamepad handlers
     * @private
     */
    _setupGamepad() {
        window.addEventListener('gamepadconnected', (e) => {
            console.log('Gamepad connected:', e.gamepad.id);
            this.gamepadIndex = e.gamepad.index;
            this._emit('input:gamepadConnected', { gamepad: e.gamepad });
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            console.log('Gamepad disconnected:', e.gamepad.id);
            if (e.gamepad.index === this.gamepadIndex) {
                this.gamepadIndex = null;
                this.gamepadControls = { steering: 0, acceleration: 0, braking: 0 };
                this._updateCombinedControls();
            }
            this._emit('input:gamepadDisconnected');
        });
    }

    /**
     * Poll gamepad state
     */
    pollGamepad() {
        if (!this.enableGamepad || this.gamepadIndex === null) return;

        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[this.gamepadIndex];

        if (!gamepad) return;

        // Standard mapping:
        // Left stick X = steering
        // Right trigger = acceleration
        // Left trigger = brake

        // Apply deadzone
        const deadzone = 0.15;
        let stickX = gamepad.axes[0] || 0;
        if (Math.abs(stickX) < deadzone) stickX = 0;

        this.gamepadControls.steering = stickX;
        this.gamepadControls.acceleration = gamepad.buttons[7]?.value || 0;  // RT
        this.gamepadControls.braking = gamepad.buttons[6]?.value || 0;       // LT

        this._updateCombinedControls();
    }

    /**
     * Register a touch controller
     * @param {TouchController} controller
     */
    registerController(controller) {
        this.controllers.push(controller);

        // Subscribe to controller updates
        controller.onUpdate = (controls) => {
            this.touchControls = { ...controls };
            this._updateCombinedControls();
        };
    }

    /**
     * Set touch controls directly
     * @param {Object} controls - { steering, acceleration, braking }
     */
    setTouchControls(controls) {
        if (controls.steering !== undefined) {
            this.touchControls.steering = controls.steering;
        }
        if (controls.acceleration !== undefined) {
            this.touchControls.acceleration = controls.acceleration;
        }
        if (controls.braking !== undefined) {
            this.touchControls.braking = controls.braking;
        }
        this._updateCombinedControls();
    }

    /**
     * Update combined controls from all sources
     * @private
     */
    _updateCombinedControls() {
        // Priority: Touch > Gamepad > Keyboard
        // For each axis, use the source with the largest magnitude

        this.controls.steering = this._selectLargest(
            this.touchControls.steering,
            this.gamepadControls.steering,
            this.keyboardControls.steering
        );

        this.controls.acceleration = this._selectLargest(
            this.touchControls.acceleration,
            this.gamepadControls.acceleration,
            this.keyboardControls.acceleration
        );

        this.controls.braking = this._selectLargest(
            this.touchControls.braking,
            this.gamepadControls.braking,
            this.keyboardControls.braking
        );

        // Emit update event
        this._emit('input:controlsUpdate', { ...this.controls });

        // Call callback if registered
        if (this.onControlsChange) {
            this.onControlsChange(this.controls);
        }
    }

    /**
     * Select value with largest magnitude
     * @private
     */
    _selectLargest(...values) {
        let result = 0;
        let maxMag = 0;

        for (const val of values) {
            const mag = Math.abs(val);
            if (mag > maxMag) {
                maxMag = mag;
                result = val;
            }
        }

        return result;
    }

    /**
     * Update input manager (call each frame)
     * @param {number} dt
     */
    update(dt) {
        if (!this.initialized) return;

        // Poll gamepad
        if (this.enableGamepad) {
            this.pollGamepad();
        }

        // Update registered controllers
        for (const controller of this.controllers) {
            if (typeof controller.update === 'function') {
                controller.update(dt);
            }
        }
    }

    /**
     * Get current controls
     * @returns {Object} { steering, acceleration, braking }
     */
    getControls() {
        return { ...this.controls };
    }

    /**
     * Reset all controls to neutral
     */
    reset() {
        this.controls = { steering: 0, acceleration: 0, braking: 0 };
        this.touchControls = { steering: 0, acceleration: 0, braking: 0 };
        this.keyboardControls = { steering: 0, acceleration: 0, braking: 0 };
        this.gamepadControls = { steering: 0, acceleration: 0, braking: 0 };
        this.pressedKeys.clear();
    }

    /**
     * Set controls change callback
     * @param {Function} callback
     */
    setOnControlsChange(callback) {
        this.onControlsChange = callback;
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
     * Destroy input manager
     */
    destroy() {
        this.controllers = [];
        this.reset();
        this.initialized = false;
    }
}

// Export for ES Modules
export { InputManager };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.InputManager = InputManager;
}
