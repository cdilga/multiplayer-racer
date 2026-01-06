/**
 * PhysicsTuningUI - Physics parameter tuning panel
 *
 * Features:
 * - Live adjustment of physics parameters via sliders
 * - Real-time application to running vehicles
 * - Save/load profiles to localStorage
 * - Export physics config as JSON
 *
 * Toggle with F2 key.
 *
 * Usage:
 *   const tuningUI = new PhysicsTuningUI({
 *       container: document.body,
 *       gameHost: gameHost
 *   });
 *   tuningUI.init();
 */

class PhysicsTuningUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container]
     * @param {GameHost} options.gameHost - Reference to GameHost
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;
        this.gameHost = options.gameHost;

        // State
        this.visible = false;
        this.element = null;
        this.params = this._loadParams();
    }

    /**
     * Initialize physics tuning UI
     */
    init() {
        this._createElements();
        this._bindControls();
        this._subscribeToEvents();
    }

    /**
     * Create DOM elements
     * @private
     */
    _createElements() {
        // Try to reuse existing physics panel
        let element = this.container.querySelector('#physics-params-panel');

        if (!element) {
            element = document.createElement('div');
            element.id = 'physics-params-panel';
            this.container.appendChild(element);
        }

        this.element = element;

        // Build HTML
        this.element.innerHTML = `
            <div class="physics-panel-header">Physics Tuning (F2)</div>

            <div class="physics-section">
                <h4>Engine</h4>
                <label>
                    <span>Engine Force</span>
                    <input type="range" class="physics-slider" data-param="car.engineForce" min="50" max="500" value="${this.params.car.engineForce}" step="10">
                    <span class="physics-value" data-param="car.engineForce">${this.params.car.engineForce}</span>
                </label>
                <label>
                    <span>Brake Force</span>
                    <input type="range" class="physics-slider" data-param="car.brakeForce" min="10" max="200" value="${this.params.car.brakeForce}" step="5">
                    <span class="physics-value" data-param="car.brakeForce">${this.params.car.brakeForce}</span>
                </label>
            </div>

            <div class="physics-section">
                <h4>Wheels</h4>
                <label>
                    <span>Friction Slip</span>
                    <input type="range" class="physics-slider" data-param="wheels.frictionSlip" min="100" max="2000" value="${this.params.wheels.frictionSlip}" step="50">
                    <span class="physics-value" data-param="wheels.frictionSlip">${this.params.wheels.frictionSlip}</span>
                </label>
                <label>
                    <span>Suspension Stiffness</span>
                    <input type="range" class="physics-slider" data-param="wheels.suspensionStiffness" min="5" max="100" value="${this.params.wheels.suspensionStiffness}" step="5">
                    <span class="physics-value" data-param="wheels.suspensionStiffness">${this.params.wheels.suspensionStiffness}</span>
                </label>
            </div>

            <div class="physics-section">
                <h4>Damage</h4>
                <label>
                    <span>Damage Multiplier</span>
                    <input type="range" class="physics-slider" data-param="damage.multiplier" min="0" max="5" value="${this.params.damage.multiplier}" step="0.1">
                    <span class="physics-value" data-param="damage.multiplier">${this.params.damage.multiplier}</span>
                </label>
                <label>
                    <span>Respawn Delay (s)</span>
                    <input type="range" class="physics-slider" data-param="damage.respawnDelay" min="0.5" max="10" value="${this.params.damage.respawnDelay}" step="0.5">
                    <span class="physics-value" data-param="damage.respawnDelay">${this.params.damage.respawnDelay}</span>
                </label>
            </div>

            <div class="physics-actions">
                <button id="physics-save-btn" class="physics-btn">Save</button>
                <button id="physics-reset-btn" class="physics-btn">Reset Defaults</button>
                <button id="physics-export-btn" class="physics-btn">Export JSON</button>
            </div>
        `;

        // Add styles
        if (!document.querySelector('#physics-panel-styles')) {
            const style = document.createElement('style');
            style.id = 'physics-panel-styles';
            style.textContent = `
                #physics-params-panel {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: rgba(0, 0, 0, 0.9);
                    color: #00ff88;
                    font-family: monospace;
                    font-size: 11px;
                    padding: 15px;
                    border-radius: 5px;
                    min-width: 300px;
                    z-index: 99;
                    border: 2px solid #00aa00;
                    display: none;
                }

                #physics-params-panel.visible {
                    display: block;
                }

                .physics-panel-header {
                    font-weight: bold;
                    font-size: 13px;
                    margin-bottom: 10px;
                    border-bottom: 1px solid #00aa00;
                    padding-bottom: 5px;
                }

                .physics-section {
                    margin: 10px 0;
                }

                .physics-section h4 {
                    margin: 0 0 5px 0;
                    color: #00d4ff;
                    font-size: 11px;
                }

                .physics-section label {
                    display: block;
                    margin: 5px 0;
                }

                .physics-section span:first-child {
                    display: inline-block;
                    width: 130px;
                }

                .physics-section input[type="range"] {
                    width: 100px;
                    vertical-align: middle;
                }

                .physics-value {
                    display: inline-block;
                    width: 50px;
                    text-align: right;
                    margin-left: 5px;
                    color: #ffff00;
                }

                .physics-actions {
                    display: flex;
                    gap: 5px;
                    margin-top: 10px;
                }

                .physics-btn {
                    flex: 1;
                    background: #004400;
                    color: #00ff88;
                    border: 1px solid #00aa00;
                    padding: 4px 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-family: monospace;
                    font-size: 10px;
                    transition: 0.2s;
                }

                .physics-btn:hover {
                    background: #006600;
                    color: #00ffaa;
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Bind control event listeners
     * @private
     */
    _bindControls() {
        // Bind sliders
        const sliders = this.element.querySelectorAll('.physics-slider');
        sliders.forEach(slider => {
            slider.addEventListener('input', (e) => {
                const param = e.target.dataset.param;
                const value = parseFloat(e.target.value);

                // Update display value
                const valueSpan = this.element.querySelector(`.physics-value[data-param="${param}"]`);
                if (valueSpan) {
                    valueSpan.textContent = value;
                }

                // Update params and apply
                this._setParam(param, value);
                this._applyToAllVehicles();
            });
        });

        // Bind buttons
        this.element.querySelector('#physics-save-btn').addEventListener('click', () => {
            this._saveToLocalStorage();
        });

        this.element.querySelector('#physics-reset-btn').addEventListener('click', () => {
            this.params = this._getDefaultParams();
            this._updateAllControls();
            this._applyToAllVehicles();
            this._saveToLocalStorage();
        });

        this.element.querySelector('#physics-export-btn').addEventListener('click', () => {
            this._exportJSON();
        });
    }

    /**
     * Subscribe to events
     * @private
     */
    _subscribeToEvents() {
        // No event subscriptions needed
    }

    /**
     * Toggle physics tuning panel
     */
    toggle() {
        this.visible = !this.visible;
        this.element.classList.toggle('visible', this.visible);
    }

    /**
     * Set a physics parameter
     * @private
     */
    _setParam(path, value) {
        const parts = path.split('.');
        let obj = this.params;

        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
        }

        obj[parts[parts.length - 1]] = value;
    }

    /**
     * Get a physics parameter
     * @private
     */
    _getParam(path) {
        const parts = path.split('.');
        let obj = this.params;

        for (const part of parts) {
            obj = obj[part];
        }

        return obj;
    }

    /**
     * Update all slider controls to match current params
     * @private
     */
    _updateAllControls() {
        const sliders = this.element.querySelectorAll('.physics-slider');
        sliders.forEach(slider => {
            const param = slider.dataset.param;
            const value = this._getParam(param);
            slider.value = value;

            const valueSpan = this.element.querySelector(`.physics-value[data-param="${param}"]`);
            if (valueSpan) {
                valueSpan.textContent = value;
            }
        });
    }

    /**
     * Apply physics parameters to all vehicles
     * @private
     */
    _applyToAllVehicles() {
        if (!this.gameHost || !this.gameHost.systems) return;

        const physics = this.gameHost.systems.physics;
        for (const [vehicleId, vehicleData] of physics.vehicleBodies) {
            // Update engine force and brake force in vehicle data
            vehicleData.config.engine = {
                ...vehicleData.config.engine,
                force: this.params.car.engineForce,
                brakeForce: this.params.car.brakeForce
            };

            // Update suspension parameters if vehicle has controller
            if (vehicleData.controller) {
                const vc = vehicleData.controller;
                const numWheels = vc.numWheels ? vc.numWheels() : 4;

                for (let i = 0; i < numWheels; i++) {
                    if (typeof vc.setWheelFrictionSlip === 'function') {
                        vc.setWheelFrictionSlip(i, this.params.wheels.frictionSlip);
                    }
                    if (typeof vc.setWheelSuspensionStiffness === 'function') {
                        vc.setWheelSuspensionStiffness(i, this.params.wheels.suspensionStiffness);
                    }
                }
            }
        }

        // Apply damage system parameters
        const damage = this.gameHost.systems.damage;
        if (damage) {
            damage.setDamageMultiplier(this.params.damage.multiplier);
            damage.setRespawnDelay(this.params.damage.respawnDelay * 1000); // Convert seconds to ms
        }
    }

    /**
     * Get default physics parameters
     * @private
     */
    _getDefaultParams() {
        return {
            car: {
                engineForce: 200,
                brakeForce: 50
            },
            wheels: {
                frictionSlip: 1000,
                suspensionStiffness: 30
            },
            damage: {
                multiplier: 1,
                respawnDelay: 3
            }
        };
    }

    /**
     * Load parameters from localStorage
     * @private
     */
    _loadParams() {
        try {
            const defaults = this._getDefaultParams();
            const saved = localStorage.getItem('racerPhysicsParams');
            if (!saved) return defaults;

            // Merge saved params with defaults to ensure new params are included
            const parsed = JSON.parse(saved);
            return {
                car: { ...defaults.car, ...parsed.car },
                wheels: { ...defaults.wheels, ...parsed.wheels },
                damage: { ...defaults.damage, ...parsed.damage }
            };
        } catch (error) {
            console.warn('Error loading physics params:', error);
            return this._getDefaultParams();
        }
    }

    /**
     * Save parameters to localStorage
     * @private
     */
    _saveToLocalStorage() {
        try {
            localStorage.setItem('racerPhysicsParams', JSON.stringify(this.params));
            console.log('Physics parameters saved to localStorage');
        } catch (error) {
            console.warn('Error saving physics params:', error);
        }
    }

    /**
     * Export parameters as JSON file
     * @private
     */
    _exportJSON() {
        try {
            const json = JSON.stringify(this.params, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `physics-profile-${Date.now()}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            console.log('Physics profile exported as JSON');
        } catch (error) {
            console.warn('Error exporting physics params:', error);
        }
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
export { PhysicsTuningUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.PhysicsTuningUI = PhysicsTuningUI;
}
