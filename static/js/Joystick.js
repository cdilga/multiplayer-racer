/**
 * Reusable Joystick Controller Component
 *
 * A well-encapsulated joystick that can be configured for different use cases.
 * Supports horizontal-only, vertical-only, or full 2D movement.
 * Properly tracks touch identifiers to support multi-touch scenarios.
 *
 * @example
 * const joystick = new Joystick({
 *     container: document.getElementById('steering-area'),
 *     mode: 'horizontal',
 *     onMove: ({ x, y }) => console.log('Position:', x, y),
 *     onEnd: () => console.log('Released')
 * });
 */
class Joystick {
    /**
     * @param {Object} options Configuration options
     * @param {HTMLElement} options.container Container element for the joystick
     * @param {string} options.mode Movement constraint: 'horizontal' | 'vertical' | 'full' (default: 'full')
     * @param {number} options.size Base size in pixels (default: 120)
     * @param {number} options.knobRatio Knob size as ratio of base (default: 0.5)
     * @param {number} options.maxDistance Max travel distance from center (default: size/3)
     * @param {Function} options.onMove Callback with { x: -1 to 1, y: -1 to 1 }
     * @param {Function} options.onEnd Callback when touch ends
     * @param {boolean} options.fixed If true, joystick stays at fixed position (default: false, floating)
     * @param {Object} options.colors Custom colors { base, knob, active }
     */
    constructor(options) {
        this.container = options.container;
        this.mode = options.mode || 'full';
        this.size = options.size || 120;
        this.knobRatio = options.knobRatio || 0.5;
        this.maxDistance = options.maxDistance || (this.size / 3);
        this.onMove = options.onMove || (() => {});
        this.onEnd = options.onEnd || (() => {});
        this.fixed = options.fixed || false;
        this.colors = options.colors || {
            base: 'rgba(76, 201, 240, 0.2)',
            knob: 'rgba(76, 201, 240, 0.8)',
            active: 'rgba(76, 201, 240, 1)'
        };

        // State
        this.touchId = null;
        this.active = false;
        this.centerX = 0;
        this.centerY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.value = { x: 0, y: 0 };
        this.enabled = true;

        // DOM elements
        this.elements = {
            base: null,
            knob: null
        };

        // Bound event handlers (for proper removal)
        this._onTouchStart = this._handleTouchStart.bind(this);
        this._onTouchMove = this._handleTouchMove.bind(this);
        this._onTouchEnd = this._handleTouchEnd.bind(this);
        this._onContextMenu = (e) => e.preventDefault();

        this._init();
    }

    _init() {
        // Create base circle
        this.elements.base = document.createElement('div');
        this.elements.base.className = 'joystick-base';
        Object.assign(this.elements.base.style, {
            position: 'absolute',
            width: `${this.size}px`,
            height: `${this.size}px`,
            borderRadius: '50%',
            backgroundColor: this.colors.base,
            border: `3px solid ${this.colors.knob}`,
            display: 'none',
            pointerEvents: 'none',
            transform: 'translate(-50%, -50%)',
            zIndex: '10'
        });

        // Create knob
        const knobSize = this.size * this.knobRatio;
        this.elements.knob = document.createElement('div');
        this.elements.knob.className = 'joystick-knob';
        Object.assign(this.elements.knob.style, {
            position: 'absolute',
            width: `${knobSize}px`,
            height: `${knobSize}px`,
            borderRadius: '50%',
            backgroundColor: this.colors.knob,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            transition: 'background-color 0.1s',
            pointerEvents: 'none'
        });

        this.elements.base.appendChild(this.elements.knob);
        this.container.appendChild(this.elements.base);

        // Attach event listeners to container
        this.container.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.container.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this.container.addEventListener('touchend', this._onTouchEnd, { passive: false });
        this.container.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
        this.container.addEventListener('contextmenu', this._onContextMenu);

        // Prevent text selection and other default behaviors
        this.container.style.touchAction = 'none';
        this.container.style.webkitUserSelect = 'none';
        this.container.style.userSelect = 'none';
        this.container.style.webkitTouchCallout = 'none';
    }

    _handleTouchStart(e) {
        if (!this.enabled) return;

        // Find touch that started in this container
        const rect = this.container.getBoundingClientRect();

        for (const touch of e.changedTouches) {
            // Check if this touch started within our container
            if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
                touch.clientY >= rect.top && touch.clientY <= rect.bottom) {

                // Only track one touch at a time for this joystick
                if (this.touchId === null) {
                    e.preventDefault();

                    this.touchId = touch.identifier;
                    this.active = true;

                    // Set center position where touch started
                    this.centerX = touch.clientX - rect.left;
                    this.centerY = touch.clientY - rect.top;
                    this.currentX = this.centerX;
                    this.currentY = this.centerY;

                    // Show and position base
                    this.elements.base.style.display = 'block';
                    this.elements.base.style.left = `${this.centerX}px`;
                    this.elements.base.style.top = `${this.centerY}px`;

                    // Reset knob to center
                    this.elements.knob.style.left = '50%';
                    this.elements.knob.style.top = '50%';
                    this.elements.knob.style.backgroundColor = this.colors.active;

                    // Initial value is 0
                    this._updateValue(0, 0);

                    break;
                }
            }
        }
    }

    _handleTouchMove(e) {
        if (!this.enabled || this.touchId === null) return;

        // Find our tracked touch
        let ourTouch = null;
        for (const touch of e.touches) {
            if (touch.identifier === this.touchId) {
                ourTouch = touch;
                break;
            }
        }

        if (ourTouch) {
            e.preventDefault();

            const rect = this.container.getBoundingClientRect();
            this.currentX = ourTouch.clientX - rect.left;
            this.currentY = ourTouch.clientY - rect.top;

            // Calculate delta from center
            let deltaX = this.currentX - this.centerX;
            let deltaY = this.currentY - this.centerY;

            // Apply mode constraints
            if (this.mode === 'horizontal') {
                deltaY = 0;
            } else if (this.mode === 'vertical') {
                deltaX = 0;
            }

            // Calculate distance and clamp to maxDistance
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > this.maxDistance) {
                const angle = Math.atan2(deltaY, deltaX);
                deltaX = Math.cos(angle) * this.maxDistance;
                deltaY = Math.sin(angle) * this.maxDistance;
            }

            // Update knob position (as percentage offset from center)
            const knobOffsetX = (deltaX / this.maxDistance) * 50;
            const knobOffsetY = (deltaY / this.maxDistance) * 50;
            this.elements.knob.style.left = `${50 + knobOffsetX}%`;
            this.elements.knob.style.top = `${50 + knobOffsetY}%`;

            // Calculate normalized value (-1 to 1)
            const normalizedX = deltaX / this.maxDistance;
            const normalizedY = deltaY / this.maxDistance;

            this._updateValue(normalizedX, normalizedY);
        }
    }

    _handleTouchEnd(e) {
        if (!this.enabled || this.touchId === null) return;

        // Check if our tracked touch ended
        for (const touch of e.changedTouches) {
            if (touch.identifier === this.touchId) {
                e.preventDefault();
                this._release();
                break;
            }
        }
    }

    _updateValue(x, y) {
        // Clamp values
        this.value.x = Math.max(-1, Math.min(1, x));
        this.value.y = Math.max(-1, Math.min(1, y));

        this.onMove(this.value);
    }

    _release() {
        this.touchId = null;
        this.active = false;
        this.value = { x: 0, y: 0 };

        // Hide joystick
        this.elements.base.style.display = 'none';
        this.elements.knob.style.backgroundColor = this.colors.knob;

        // Reset knob position
        this.elements.knob.style.left = '50%';
        this.elements.knob.style.top = '50%';

        this.onEnd();
    }

    /**
     * Get current joystick value
     * @returns {{ x: number, y: number }} Values from -1 to 1
     */
    getValue() {
        return { ...this.value };
    }

    /**
     * Check if joystick is currently active
     * @returns {boolean}
     */
    isActive() {
        return this.active;
    }

    /**
     * Enable or disable the joystick
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled && this.active) {
            this._release();
        }
    }

    /**
     * Programmatically set joystick value (for AI/automated control)
     * @param {number} x Value from -1 to 1
     * @param {number} y Value from -1 to 1
     */
    setValue(x, y) {
        if (this.mode === 'horizontal') y = 0;
        if (this.mode === 'vertical') x = 0;

        this._updateValue(x, y);
    }

    /**
     * Clean up the joystick (remove DOM elements and event listeners)
     */
    destroy() {
        this.container.removeEventListener('touchstart', this._onTouchStart);
        this.container.removeEventListener('touchmove', this._onTouchMove);
        this.container.removeEventListener('touchend', this._onTouchEnd);
        this.container.removeEventListener('touchcancel', this._onTouchEnd);
        this.container.removeEventListener('contextmenu', this._onContextMenu);

        if (this.elements.base && this.elements.base.parentNode) {
            this.elements.base.parentNode.removeChild(this.elements.base);
        }

        this.elements = { base: null, knob: null };
    }
}

// Export for both ES6 modules and global use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Joystick;
} else {
    window.Joystick = Joystick;
}
