/**
 * RaceUI - In-race HUD display
 *
 * Displays:
 * - Countdown
 * - Speedometer
 * - Lap counter
 * - Position
 * - Race timer
 * - Minimap (optional)
 *
 * Usage:
 *   const raceUI = new RaceUI({ eventBus, container });
 *   raceUI.show();
 */

class RaceUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;

        // State
        this.visible = false;
        this.currentSpeed = 0;
        this.currentLap = 0;
        this.totalLaps = 3;
        this.position = 0;
        this.totalPlayers = 0;
        this.raceTime = 0;

        // Elements
        this.element = null;
        this.elements = {};

        // Countdown
        this.countdownElement = null;
    }

    /**
     * Initialize race UI
     */
    init() {
        this._createElements();
        this._subscribeToEvents();
    }

    /**
     * Create UI elements
     * @private
     */
    _createElements() {
        // Check if already exists
        let existing = this.container.querySelector('.race-ui');
        if (existing) {
            this.element = existing;
            this._bindElements();
            return;
        }

        // Create race HUD
        this.element = document.createElement('div');
        this.element.className = 'race-ui hidden';
        this.element.innerHTML = `
            <div class="race-hud">
                <div class="hud-top">
                    <div class="hud-position">
                        <span class="position-value" id="race-position">1</span>
                        <span class="position-suffix">st</span>
                    </div>
                    <div class="hud-timer" id="race-timer">0:00.000</div>
                    <div class="hud-lap">
                        Lap <span id="race-lap">1</span>/<span id="race-total-laps">3</span>
                    </div>
                </div>

                <div class="hud-bottom">
                    <div class="hud-speed">
                        <span class="speed-value" id="race-speed">0</span>
                        <span class="speed-unit">km/h</span>
                    </div>
                </div>
            </div>

            <div class="countdown-overlay hidden" id="race-countdown">
                <span class="countdown-number">3</span>
            </div>
        `;

        // Add styles
        this._addStyles();

        this.container.appendChild(this.element);
        this._bindElements();
    }

    /**
     * Bind element references
     * @private
     */
    _bindElements() {
        this.elements.position = this.element.querySelector('#race-position');
        this.elements.positionSuffix = this.element.querySelector('.position-suffix');
        this.elements.timer = this.element.querySelector('#race-timer');
        this.elements.lap = this.element.querySelector('#race-lap');
        this.elements.totalLaps = this.element.querySelector('#race-total-laps');
        this.elements.speed = this.element.querySelector('#race-speed');
        this.countdownElement = this.element.querySelector('#race-countdown');
    }

    /**
     * Add CSS styles
     * @private
     */
    _addStyles() {
        if (document.querySelector('#race-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'race-ui-styles';
        style.textContent = `
            .race-ui {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                z-index: 50;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .race-ui.hidden {
                display: none;
            }
            .race-hud {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
            }
            .hud-top {
                position: absolute;
                top: 20px;
                left: 20px;
                right: 20px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }
            .hud-position {
                background: rgba(0, 0, 0, 0.7);
                padding: 10px 20px;
                border-radius: 10px;
                color: white;
            }
            .position-value {
                font-size: 48px;
                font-weight: bold;
                color: #00ff88;
            }
            .position-suffix {
                font-size: 24px;
                color: #888;
            }
            .hud-timer {
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 25px;
                border-radius: 10px;
                font-size: 28px;
                font-weight: bold;
                color: white;
                font-family: monospace;
            }
            .hud-lap {
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 25px;
                border-radius: 10px;
                font-size: 24px;
                color: white;
            }
            #race-lap {
                color: #00d4ff;
                font-weight: bold;
            }
            .hud-bottom {
                position: absolute;
                bottom: 20px;
                right: 20px;
            }
            .hud-speed {
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 25px;
                border-radius: 10px;
                text-align: right;
            }
            .speed-value {
                font-size: 48px;
                font-weight: bold;
                color: white;
                font-family: monospace;
            }
            .speed-unit {
                font-size: 18px;
                color: #888;
                margin-left: 5px;
            }
            .countdown-overlay {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }
            .countdown-overlay.hidden {
                display: none;
            }
            .countdown-number {
                font-size: 200px;
                font-weight: bold;
                color: white;
                text-shadow: 0 0 50px rgba(0, 255, 136, 0.5);
                animation: countdown-pulse 1s ease-in-out;
            }
            @keyframes countdown-pulse {
                0% { transform: scale(1.5); opacity: 0; }
                50% { transform: scale(1); opacity: 1; }
                100% { transform: scale(0.8); opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Subscribe to events
     * @private
     */
    _subscribeToEvents() {
        if (!this.eventBus) return;

        this.eventBus.on('race:countdown', (data) => {
            this.showCountdown(data.count);
        });

        this.eventBus.on('race:start', () => {
            this.hideCountdown();
        });

        this.eventBus.on('game:racing', () => {
            this.show();
        });

        this.eventBus.on('game:results', () => {
            this.hide();
        });

        this.eventBus.on('race:lapComplete', (data) => {
            this.setLap(data.lap + 1);
        });
    }

    /**
     * Show countdown number
     * @param {number} count
     */
    showCountdown(count) {
        if (!this.countdownElement) return;

        const numberEl = this.countdownElement.querySelector('.countdown-number');
        if (numberEl) {
            numberEl.textContent = count === 0 ? 'GO!' : count.toString();
            // Reset animation
            numberEl.style.animation = 'none';
            numberEl.offsetHeight; // Trigger reflow
            numberEl.style.animation = 'countdown-pulse 1s ease-in-out';
        }

        this.countdownElement.classList.remove('hidden');
    }

    /**
     * Hide countdown
     */
    hideCountdown() {
        if (this.countdownElement) {
            this.countdownElement.classList.add('hidden');
        }
    }

    /**
     * Update speed display
     * @param {number} speed - Speed in km/h
     */
    setSpeed(speed) {
        this.currentSpeed = Math.round(speed);
        if (this.elements.speed) {
            this.elements.speed.textContent = this.currentSpeed.toString();
        }
    }

    /**
     * Update lap display
     * @param {number} lap - Current lap (1-based)
     */
    setLap(lap) {
        this.currentLap = lap;
        if (this.elements.lap) {
            this.elements.lap.textContent = lap.toString();
        }
    }

    /**
     * Set total laps
     * @param {number} laps
     */
    setTotalLaps(laps) {
        this.totalLaps = laps;
        if (this.elements.totalLaps) {
            this.elements.totalLaps.textContent = laps.toString();
        }
    }

    /**
     * Update position display
     * @param {number} position - 1-based position
     */
    setPosition(position) {
        this.position = position;
        if (this.elements.position) {
            this.elements.position.textContent = position.toString();
        }
        if (this.elements.positionSuffix) {
            this.elements.positionSuffix.textContent = this._getPositionSuffix(position);
        }
    }

    /**
     * Get position suffix (st, nd, rd, th)
     * @private
     */
    _getPositionSuffix(pos) {
        if (pos >= 11 && pos <= 13) return 'th';
        switch (pos % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

    /**
     * Update race timer
     * @param {number} timeMs - Time in milliseconds
     */
    setTime(timeMs) {
        this.raceTime = timeMs;
        if (this.elements.timer) {
            this.elements.timer.textContent = this._formatTime(timeMs);
        }
    }

    /**
     * Format time as M:SS.mmm
     * @private
     */
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const millis = Math.floor(ms % 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }

    /**
     * Update all values at once
     * @param {Object} data - { speed, lap, position, time }
     */
    update(data) {
        if (data.speed !== undefined) this.setSpeed(data.speed);
        if (data.lap !== undefined) this.setLap(data.lap);
        if (data.position !== undefined) this.setPosition(data.position);
        if (data.time !== undefined) this.setTime(data.time);
    }

    /**
     * Show race UI
     */
    show() {
        this.visible = true;
        if (this.element) {
            this.element.classList.remove('hidden');
        }
    }

    /**
     * Hide race UI
     */
    hide() {
        this.visible = false;
        if (this.element) {
            this.element.classList.add('hidden');
        }
        this.hideCountdown();
    }

    /**
     * Destroy UI
     */
    destroy() {
        if (this.element) {
            this.element.remove();
        }
    }
}

// Export for ES Modules
export { RaceUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.RaceUI = RaceUI;
}
