/**
 * StatsOverlayUI - Game statistics and performance monitoring
 *
 * Displays:
 * - FPS counter
 * - Game state
 * - Player count
 * - Per-player stats (position, velocity, lap, rotation)
 * - Individual car reset buttons
 * - Reset all cars button
 *
 * Toggle with F3 key.
 *
 * Usage:
 *   const statsUI = new StatsOverlayUI({
 *       container: document.body,
 *       gameHost: gameHost
 *   });
 *   statsUI.init();
 */

class StatsOverlayUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container]
     * @param {GameHost} options.gameHost - Reference to GameHost for vehicle/engine access
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;
        this.gameHost = options.gameHost;

        // State
        this.visible = false;
        this.element = null;
        this.updateInterval = null;
        this.frameCounter = {
            frames: 0,
            lastTime: Date.now(),
            fps: 0
        };
    }

    /**
     * Initialize stats UI
     */
    init() {
        this._createElements();
        this._subscribeToEvents();
    }

    /**
     * Create DOM elements
     * @private
     */
    _createElements() {
        // Try to reuse existing stats overlay from HTML
        let element = this.container.querySelector('#stats-overlay');

        if (!element) {
            // Create if it doesn't exist
            element = document.createElement('div');
            element.id = 'stats-overlay';
            this.container.appendChild(element);
        }

        this.element = element;

        // Add default styles if not already present
        if (!document.querySelector('#stats-overlay-styles')) {
            const style = document.createElement('style');
            style.id = 'stats-overlay-styles';
            style.textContent = `
                #stats-overlay {
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    background: rgba(0, 0, 0, 0.8);
                    color: #00ff88;
                    font-family: monospace;
                    font-size: 12px;
                    padding: 15px;
                    border-radius: 5px;
                    max-height: 80vh;
                    max-width: 400px;
                    overflow-y: auto;
                    z-index: 100;
                    border: 2px solid #00ff88;
                }

                #stats-overlay.hidden {
                    display: none;
                }

                .stats-header {
                    font-weight: bold;
                    font-size: 14px;
                    margin-bottom: 10px;
                    border-bottom: 1px solid #00ff88;
                    padding-bottom: 5px;
                }

                .stats-section {
                    margin-top: 10px;
                    margin-bottom: 5px;
                    font-weight: bold;
                    color: #00d4ff;
                }

                .stats-item {
                    margin: 2px 0;
                }

                .player-card {
                    background: rgba(0, 50, 80, 0.6);
                    padding: 8px;
                    margin-top: 8px;
                    border-left: 3px solid #00ff88;
                    border-radius: 3px;
                }

                .player-name {
                    font-weight: bold;
                    color: #00ff88;
                    margin-bottom: 5px;
                }

                .reset-btn {
                    background: #0066cc;
                    color: white;
                    border: none;
                    padding: 4px 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-family: monospace;
                    font-size: 11px;
                    margin-top: 5px;
                    margin-right: 5px;
                }

                .reset-btn:hover {
                    background: #0088ff;
                }

                .reset-all-btn {
                    background: #cc6600;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-family: monospace;
                    font-size: 12px;
                    margin-top: 10px;
                    width: 100%;
                }

                .reset-all-btn:hover {
                    background: #ff8800;
                }
            `;
            document.head.appendChild(style);
        }

        // Initialize with hidden class
        this.element.classList.add('hidden');
    }

    /**
     * Subscribe to events
     * @private
     */
    _subscribeToEvents() {
        // No event subscriptions needed - updates on demand
    }

    /**
     * Toggle stats overlay
     */
    toggle() {
        this.visible = !this.visible;
        this.element.classList.toggle('hidden', !this.visible);

        if (this.visible) {
            this._startUpdates();
        } else {
            this._stopUpdates();
        }
    }

    /**
     * Start periodic updates
     * @private
     */
    _startUpdates() {
        this._update();  // Immediate first update
        this.updateInterval = setInterval(() => this._update(), 500);
    }

    /**
     * Stop periodic updates
     * @private
     */
    _stopUpdates() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Update stats display
     * @private
     */
    _update() {
        if (!this.element || !this.visible) return;

        try {
            // Calculate FPS
            const now = Date.now();
            const delta = now - this.frameCounter.lastTime;
            if (delta >= 1000) {
                this.frameCounter.fps = Math.round((this.frameCounter.frames * 1000) / delta);
                this.frameCounter.frames = 0;
                this.frameCounter.lastTime = now;
            }
            this.frameCounter.frames++;

            // Get game state
            const state = this.gameHost?.engine?.state?.name || 'UNKNOWN';
            const vehicles = this.gameHost?.vehicles || new Map();
            const playerCount = vehicles.size;

            // Build HTML
            let html = `
                <div class="stats-header">Game Stats (Press F3 to toggle)</div>
                <div class="stats-item">FPS: <span style="color: #ffff00;">${this.frameCounter.fps}</span></div>
                <div class="stats-item">State: ${state}</div>
                <div class="stats-item">Players: ${playerCount}</div>
                <div class="stats-item">Physics: Active</div>
            `;

            // Per-player stats
            if (playerCount > 0) {
                html += '<div class="stats-section">Players:</div>';

                for (const [playerId, vehicle] of vehicles) {
                    const debugData = this.gameHost?.systems?.physics?.getVehicleDebugData(vehicle.id);

                    if (!debugData) {
                        continue;
                    }

                    const pos = debugData.position;
                    const speed = debugData.speed.toFixed(1);
                    const lap = (vehicle.currentLap || 0) + 1;

                    html += `
                        <div class="player-card">
                            <div class="player-name">Player ${playerId}</div>
                            <div class="stats-item">Speed: ${speed} km/h</div>
                            <div class="stats-item">Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})</div>
                            <div class="stats-item">Lap: ${lap}</div>
                            <button class="reset-btn" onclick="window.resetCarPosition('${vehicle.id}')">
                                Reset Car
                            </button>
                        </div>
                    `;
                }

                html += `<button class="reset-all-btn" onclick="window.resetAllCars()">Reset All Cars</button>`;
            }

            this.element.innerHTML = html;
        } catch (error) {
            console.error('StatsOverlayUI update error:', error);
        }
    }

    /**
     * Destroy UI
     */
    destroy() {
        this._stopUpdates();
        if (this.element) {
            this.element.remove();
        }
    }
}

// Export for ES Modules
export { StatsOverlayUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.StatsOverlayUI = StatsOverlayUI;
}
