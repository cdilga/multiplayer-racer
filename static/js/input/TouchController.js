/**
 * TouchController - Touch-based steering and acceleration for mobile
 *
 * Provides virtual controls:
 * - Tilt steering (accelerometer)
 * - Touch steering (left/right zones)
 * - Accelerate button
 * - Brake button
 *
 * Usage:
 *   const touch = new TouchController({ container: document.getElementById('controls') });
 *   touch.init();
 *   const controls = touch.getControls();
 */

class TouchController {
    /**
     * @param {Object} options
     * @param {HTMLElement} [options.container] - Container for touch zones
     * @param {boolean} [options.useTilt=false] - Use accelerometer for steering
     * @param {boolean} [options.showDebug=false] - Show debug overlay
     */
    constructor(options = {}) {
        this.container = options.container || document.body;
        this.useTilt = options.useTilt || false;
        this.showDebug = options.showDebug || false;

        // Control state
        this.controls = {
            steering: 0,
            acceleration: 0,
            braking: 0
        };

        // Touch tracking
        this.activeTouches = new Map();  // touchId -> touchData

        // Tilt calibration
        this.tiltCalibration = 0;
        this.tiltSensitivity = 1.5;

        // Zone elements
        this.elements = {
            steerLeft: null,
            steerRight: null,
            accelerate: null,
            brake: null,
            debugOverlay: null
        };

        // Callback
        this.onUpdate = null;

        // State
        this.initialized = false;
    }

    /**
     * Initialize touch controller
     */
    init() {
        if (this.initialized) return;

        console.log('TouchController: Initializing...');

        // Create control elements
        this._createControlElements();

        // Setup touch handlers
        this._setupTouchHandlers();

        // Setup tilt if enabled
        if (this.useTilt) {
            this._setupTiltHandlers();
        }

        this.initialized = true;
        console.log('TouchController: Ready');
    }

    /**
     * Create control element zones
     * @private
     */
    _createControlElements() {
        // Check if elements already exist
        if (this.container.querySelector('.touch-controls')) {
            this._bindExistingElements();
            return;
        }

        // Create touch control container
        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'touch-controls';
        controlsDiv.innerHTML = `
            <div class="touch-zone touch-left" data-control="steerLeft">
                <span>◀</span>
            </div>
            <div class="touch-zone touch-right" data-control="steerRight">
                <span>▶</span>
            </div>
            <div class="touch-zone touch-accelerate" data-control="accelerate">
                <span>▲</span>
            </div>
            <div class="touch-zone touch-brake" data-control="brake">
                <span>■</span>
            </div>
        `;

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .touch-controls {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                z-index: 1000;
            }
            .touch-zone {
                position: absolute;
                pointer-events: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 48px;
                color: rgba(255, 255, 255, 0.3);
                user-select: none;
                -webkit-user-select: none;
            }
            .touch-zone.active {
                background: rgba(255, 255, 255, 0.2);
                color: rgba(255, 255, 255, 0.8);
            }
            .touch-left {
                left: 0;
                top: 40%;
                width: 25%;
                height: 30%;
            }
            .touch-right {
                right: 0;
                top: 40%;
                width: 25%;
                height: 30%;
            }
            .touch-accelerate {
                right: 0;
                bottom: 0;
                width: 50%;
                height: 40%;
                background: rgba(0, 255, 0, 0.1);
            }
            .touch-brake {
                left: 0;
                bottom: 0;
                width: 50%;
                height: 40%;
                background: rgba(255, 0, 0, 0.1);
            }
            .touch-debug {
                position: fixed;
                top: 10px;
                left: 10px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px;
                font-family: monospace;
                font-size: 12px;
                z-index: 1001;
            }
        `;

        document.head.appendChild(style);
        this.container.appendChild(controlsDiv);

        this._bindElements(controlsDiv);

        // Create debug overlay if enabled
        if (this.showDebug) {
            this._createDebugOverlay();
        }
    }

    /**
     * Bind existing elements
     * @private
     */
    _bindExistingElements() {
        const controlsDiv = this.container.querySelector('.touch-controls');
        this._bindElements(controlsDiv);
    }

    /**
     * Bind elements from container
     * @private
     */
    _bindElements(container) {
        this.elements.steerLeft = container.querySelector('[data-control="steerLeft"]');
        this.elements.steerRight = container.querySelector('[data-control="steerRight"]');
        this.elements.accelerate = container.querySelector('[data-control="accelerate"]');
        this.elements.brake = container.querySelector('[data-control="brake"]');
    }

    /**
     * Create debug overlay
     * @private
     */
    _createDebugOverlay() {
        const debug = document.createElement('div');
        debug.className = 'touch-debug';
        debug.innerHTML = `
            Steering: <span id="debug-steering">0.00</span><br>
            Accel: <span id="debug-accel">0.00</span><br>
            Brake: <span id="debug-brake">0.00</span><br>
            Tilt: <span id="debug-tilt">0.00</span>
        `;
        this.container.appendChild(debug);
        this.elements.debugOverlay = debug;
    }

    /**
     * Setup touch event handlers
     * @private
     */
    _setupTouchHandlers() {
        const zones = [
            { element: this.elements.steerLeft, control: 'steerLeft' },
            { element: this.elements.steerRight, control: 'steerRight' },
            { element: this.elements.accelerate, control: 'accelerate' },
            { element: this.elements.brake, control: 'brake' }
        ];

        for (const zone of zones) {
            if (!zone.element) continue;

            zone.element.addEventListener('touchstart', (e) => {
                e.preventDefault();
                zone.element.classList.add('active');
                this._onControlStart(zone.control);
            }, { passive: false });

            zone.element.addEventListener('touchend', (e) => {
                e.preventDefault();
                zone.element.classList.remove('active');
                this._onControlEnd(zone.control);
            }, { passive: false });

            zone.element.addEventListener('touchcancel', (e) => {
                zone.element.classList.remove('active');
                this._onControlEnd(zone.control);
            });
        }

        // Prevent scrolling on container
        this.container.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, { passive: false });
    }

    /**
     * Setup tilt (accelerometer) handlers
     * @private
     */
    _setupTiltHandlers() {
        if (!window.DeviceOrientationEvent) {
            console.warn('TouchController: Device orientation not supported');
            return;
        }

        // Request permission on iOS 13+
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // Need to request on user gesture
            document.addEventListener('touchstart', async () => {
                try {
                    const permission = await DeviceOrientationEvent.requestPermission();
                    if (permission === 'granted') {
                        this._listenToTilt();
                    }
                } catch (error) {
                    console.warn('TouchController: Tilt permission denied');
                }
            }, { once: true });
        } else {
            this._listenToTilt();
        }
    }

    /**
     * Listen to device orientation events
     * @private
     */
    _listenToTilt() {
        window.addEventListener('deviceorientation', (e) => {
            if (e.gamma === null) return;

            // gamma is tilt left/right (-90 to 90)
            const tilt = e.gamma - this.tiltCalibration;
            const normalized = Math.max(-1, Math.min(1, tilt / 45 * this.tiltSensitivity));

            if (!this.useTilt) return;

            // Only use tilt if not actively touching steering zones
            if (!this.elements.steerLeft?.classList.contains('active') &&
                !this.elements.steerRight?.classList.contains('active')) {
                this.controls.steering = normalized;
                this._notifyUpdate();
            }
        });
    }

    /**
     * Calibrate tilt (set current position as neutral)
     */
    calibrateTilt() {
        if (!window.DeviceOrientationEvent) return;

        window.addEventListener('deviceorientation', (e) => {
            if (e.gamma !== null) {
                this.tiltCalibration = e.gamma;
            }
        }, { once: true });
    }

    /**
     * Handle control start
     * @private
     */
    _onControlStart(control) {
        switch (control) {
            case 'steerLeft':
                this.controls.steering = -1;
                break;
            case 'steerRight':
                this.controls.steering = 1;
                break;
            case 'accelerate':
                this.controls.acceleration = 1;
                break;
            case 'brake':
                this.controls.braking = 1;
                break;
        }
        this._notifyUpdate();
    }

    /**
     * Handle control end
     * @private
     */
    _onControlEnd(control) {
        switch (control) {
            case 'steerLeft':
            case 'steerRight':
                // Only reset if the opposite isn't pressed
                if (!this.elements.steerLeft?.classList.contains('active') &&
                    !this.elements.steerRight?.classList.contains('active')) {
                    this.controls.steering = 0;
                }
                break;
            case 'accelerate':
                this.controls.acceleration = 0;
                break;
            case 'brake':
                this.controls.braking = 0;
                break;
        }
        this._notifyUpdate();
    }

    /**
     * Notify of control update
     * @private
     */
    _notifyUpdate() {
        // Update debug display
        if (this.showDebug && this.elements.debugOverlay) {
            const steeringEl = this.elements.debugOverlay.querySelector('#debug-steering');
            const accelEl = this.elements.debugOverlay.querySelector('#debug-accel');
            const brakeEl = this.elements.debugOverlay.querySelector('#debug-brake');

            if (steeringEl) steeringEl.textContent = this.controls.steering.toFixed(2);
            if (accelEl) accelEl.textContent = this.controls.acceleration.toFixed(2);
            if (brakeEl) brakeEl.textContent = this.controls.braking.toFixed(2);
        }

        // Call update callback
        if (this.onUpdate) {
            this.onUpdate(this.getControls());
        }
    }

    /**
     * Update controller (call each frame)
     * @param {number} dt
     */
    update(dt) {
        // Currently no per-frame updates needed
    }

    /**
     * Get current controls
     * @returns {Object} { steering, acceleration, braking }
     */
    getControls() {
        return { ...this.controls };
    }

    /**
     * Enable/disable tilt steering
     * @param {boolean} enabled
     */
    setTiltEnabled(enabled) {
        this.useTilt = enabled;
        if (!enabled) {
            // Reset steering when disabling tilt
            if (!this.elements.steerLeft?.classList.contains('active') &&
                !this.elements.steerRight?.classList.contains('active')) {
                this.controls.steering = 0;
                this._notifyUpdate();
            }
        }
    }

    /**
     * Set tilt sensitivity
     * @param {number} sensitivity - 0.5 to 3.0
     */
    setTiltSensitivity(sensitivity) {
        this.tiltSensitivity = Math.max(0.5, Math.min(3.0, sensitivity));
    }

    /**
     * Reset controls
     */
    reset() {
        this.controls = { steering: 0, acceleration: 0, braking: 0 };

        // Remove active states
        Object.values(this.elements).forEach(el => {
            if (el && el.classList) {
                el.classList.remove('active');
            }
        });

        this._notifyUpdate();
    }

    /**
     * Destroy controller
     */
    destroy() {
        // Remove control elements
        const controlsDiv = this.container.querySelector('.touch-controls');
        if (controlsDiv) {
            controlsDiv.remove();
        }

        if (this.elements.debugOverlay) {
            this.elements.debugOverlay.remove();
        }

        this.reset();
        this.initialized = false;
    }
}

// Export for ES Modules
export { TouchController };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.TouchController = TouchController;
}
