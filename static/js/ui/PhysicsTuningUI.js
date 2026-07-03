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

import {
    listCameraClusterTunables,
    resolveCameraClusterOptions
} from '../geometry/index.js';
import { DEFAULT_STEERING_AUTHORITY_CONFIG } from '../systems/steeringAuthority.js';

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
        this.cameraClusterTunables = listCameraClusterTunables();

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
        this._applyCameraClusterDebugSettings();
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
                <h4>Engine & Physics</h4>
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
                <label>
                    <span>Linear Damping</span>
                    <input type="range" class="physics-slider" data-param="car.linearDamping" min="0" max="1" value="${this.params.car.linearDamping}" step="0.05">
                    <span class="physics-value" data-param="car.linearDamping">${this.params.car.linearDamping}</span>
                </label>
                <label>
                    <span>Angular Damping</span>
                    <input type="range" class="physics-slider" data-param="car.angularDamping" min="0" max="1" value="${this.params.car.angularDamping}" step="0.05">
                    <span class="physics-value" data-param="car.angularDamping">${this.params.car.angularDamping}</span>
                </label>
            </div>

            <div class="physics-section">
                <h4>Steering</h4>
                <label>
                    <span>Max Angle</span>
                    <input type="range" class="physics-slider" data-param="steering.maxAngle" min="0.1" max="1.0" value="${this.params.steering.maxAngle}" step="0.02">
                    <span class="physics-value" data-param="steering.maxAngle">${this.params.steering.maxAngle}</span>
                </label>
                <label>
                    <span>High Speed Red.</span>
                    <input type="range" class="physics-slider" data-param="steering.highSpeedReduction" min="0" max="1" value="${this.params.steering.highSpeedReduction}" step="0.05">
                    <span class="physics-value" data-param="steering.highSpeedReduction">${this.params.steering.highSpeedReduction}</span>
                </label>
                <label>
                    <span>Smoothing</span>
                    <input type="range" class="physics-slider" data-param="steering.smoothing" min="0.05" max="1" value="${this.params.steering.smoothing}" step="0.05">
                    <span class="physics-value" data-param="steering.smoothing">${this.params.steering.smoothing}</span>
                </label>
                <label>
                    <span>Front-Light Auth</span>
                    <input type="range" class="physics-slider" data-param="steeringAuthority.frontLightAuthority" min="0" max="1" value="${this.params.steeringAuthority.frontLightAuthority}" step="0.02">
                    <span class="physics-value" data-param="steeringAuthority.frontLightAuthority">${this.params.steeringAuthority.frontLightAuthority}</span>
                </label>
                <label>
                    <span>Wheelie Auth</span>
                    <input type="range" class="physics-slider" data-param="steeringAuthority.wheelieAuthority" min="0" max="0.6" value="${this.params.steeringAuthority.wheelieAuthority}" step="0.02">
                    <span class="physics-value" data-param="steeringAuthority.wheelieAuthority">${this.params.steeringAuthority.wheelieAuthority}</span>
                </label>
                <label>
                    <span>Air Auth</span>
                    <input type="range" class="physics-slider" data-param="steeringAuthority.airborneAuthority" min="0" max="0.4" value="${this.params.steeringAuthority.airborneAuthority}" step="0.02">
                    <span class="physics-value" data-param="steeringAuthority.airborneAuthority">${this.params.steeringAuthority.airborneAuthority}</span>
                </label>
                <label>
                    <span>Side-Tilt Floor</span>
                    <input type="range" class="physics-slider" data-param="steeringAuthority.sideTiltSteerFloor" min="0" max="0.5" value="${this.params.steeringAuthority.sideTiltSteerFloor}" step="0.02">
                    <span class="physics-value" data-param="steeringAuthority.sideTiltSteerFloor">${this.params.steeringAuthority.sideTiltSteerFloor}</span>
                </label>
                <label>
                    <span>Recovery Assist</span>
                    <input type="range" class="physics-slider" data-param="steeringAuthority.recoveryMaxInfluence" min="0" max="0.8" value="${this.params.steeringAuthority.recoveryMaxInfluence}" step="0.05">
                    <span class="physics-value" data-param="steeringAuthority.recoveryMaxInfluence">${this.params.steeringAuthority.recoveryMaxInfluence}</span>
                </label>
            </div>

            <div class="physics-section">
                <h4>Wheelie Intent</h4>
                <label>
                    <span>Lift Threshold</span>
                    <input type="range" class="physics-slider" data-param="wheelie.activationThrottle" min="0.7" max="1.0" value="${this.params.wheelie.activationThrottle}" step="0.01">
                    <span class="physics-value" data-param="wheelie.activationThrottle">${this.params.wheelie.activationThrottle}</span>
                </label>
                <label>
                    <span>Lift Dwell (ms)</span>
                    <input type="range" class="physics-slider" data-param="wheelie.activationDwellMs" min="0" max="500" value="${this.params.wheelie.activationDwellMs}" step="10">
                    <span class="physics-value" data-param="wheelie.activationDwellMs">${this.params.wheelie.activationDwellMs}</span>
                </label>
            </div>

            <div class="physics-section">
                <h4>Wheels & Grip</h4>
                <label>
                    <span>Friction Slip</span>
                    <input type="range" class="physics-slider" data-param="wheels.frictionSlip" min="100" max="2000" value="${this.params.wheels.frictionSlip}" step="50">
                    <span class="physics-value" data-param="wheels.frictionSlip">${this.params.wheels.frictionSlip}</span>
                </label>
                <label>
                    <span>Suspension Stiff.</span>
                    <input type="range" class="physics-slider" data-param="wheels.suspensionStiffness" min="5" max="100" value="${this.params.wheels.suspensionStiffness}" step="5">
                    <span class="physics-value" data-param="wheels.suspensionStiffness">${this.params.wheels.suspensionStiffness}</span>
                </label>
                <label>
                    <span>Wall Slide Grip</span>
                    <input type="range" class="physics-slider" data-param="wheels.wallSlideGrip" min="0" max="1" value="${this.params.wheels.wallSlideGrip}" step="0.05">
                    <span class="physics-value" data-param="wheels.wallSlideGrip">${this.params.wheels.wallSlideGrip}</span>
                </label>
            </div>

            <div class="physics-section telemetry-section">
                <h4>Telemetry (Live)</h4>
                <div id="telemetry-readout">No active vehicle</div>
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

            <div class="physics-section">
                <h4>Audio</h4>
                <label>
                    <span>Engine Min Pitch</span>
                    <input type="range" class="physics-slider" data-param="audio.engineMinPitch" min="0.5" max="1.5" value="${this.params.audio.engineMinPitch}" step="0.1">
                    <span class="physics-value" data-param="audio.engineMinPitch">${this.params.audio.engineMinPitch}</span>
                </label>
                <label>
                    <span>Engine Max Pitch</span>
                    <input type="range" class="physics-slider" data-param="audio.engineMaxPitch" min="1.0" max="3.0" value="${this.params.audio.engineMaxPitch}" step="0.1">
                    <span class="physics-value" data-param="audio.engineMaxPitch">${this.params.audio.engineMaxPitch}</span>
                </label>
                <label>
                    <span>Engine Volume</span>
                    <input type="range" class="physics-slider" data-param="audio.engineVolume" min="0" max="1" value="${this.params.audio.engineVolume}" step="0.05">
                    <span class="physics-value" data-param="audio.engineVolume">${this.params.audio.engineVolume}</span>
                </label>
            </div>

            <div class="physics-section">
                <h4>Host Camera Clustering</h4>
                <div class="physics-note">
                    Host renderer only. Local phones and keyboards stay controller/HUD clients.
                </div>
                ${this._renderCameraClusterControls()}
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

                .physics-note {
                    margin: 0 0 8px 0;
                    color: #88d9ff;
                    font-size: 10px;
                    line-height: 1.35;
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

                .telemetry-section {
                    background: rgba(0, 40, 0, 0.4);
                    padding: 8px;
                    border-radius: 4px;
                    border: 1px solid #004400;
                    margin-top: 15px;
                }

                #telemetry-readout {
                    font-size: 10px;
                    line-height: 1.4;
                    white-space: pre-wrap;
                    color: #00ff00;
                }

                .telemetry-value {
                    color: #ffff00;
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Render host camera cluster controls from shared kernel descriptors
     * @private
     */
    _renderCameraClusterControls() {
        return this.cameraClusterTunables.map((descriptor) => {
            const paramPath = `cameraCluster.${descriptor.key}`;
            const value = this._getParam(paramPath);
            return `
                <label title="${descriptor.description}">
                    <span>${descriptor.label}</span>
                    <input
                        type="range"
                        class="physics-slider"
                        data-param="${paramPath}"
                        min="${descriptor.minValue}"
                        max="${descriptor.maxValue}"
                        value="${value}"
                        step="${descriptor.step}"
                    >
                    <span class="physics-value" data-param="${paramPath}">${value}</span>
                </label>
            `;
        }).join('');
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
                this._applyRuntimeParams();
            });
        });

        // Bind buttons
        this.element.querySelector('#physics-save-btn').addEventListener('click', () => {
            this._saveToLocalStorage();
        });

        this.element.querySelector('#physics-reset-btn').addEventListener('click', () => {
            this.params = this._getDefaultParams();
            this._updateAllControls();
            this._applyRuntimeParams();
            this._saveToLocalStorage();
        });

        this.element.querySelector('#physics-export-btn').addEventListener('click', () => {
            this._exportJSON();
        });
    }

    /**
     * Apply runtime-facing tuning surfaces
     * @private
     */
    _applyRuntimeParams() {
        this._applyToAllVehicles();
        this._applyCameraClusterDebugSettings();
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

        if (this.visible) {
            this._startTelemetryLoop();
        } else {
            this._stopTelemetryLoop();
        }
    }

    /**
     * Start the telemetry update loop
     * @private
     */
    _startTelemetryLoop() {
        this._stopTelemetryLoop(); // Clean up existing loop if any

        this.telemetryInterval = setInterval(() => {
            this._updateTelemetry();
        }, 100); // 10Hz update
    }

    /**
     * Stop the telemetry update loop
     * @private
     */
    _stopTelemetryLoop() {
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
            this.telemetryInterval = null;
        }
    }

    /**
     * Update the telemetry display
     * @private
     */
    _updateTelemetry() {
        if (!this.gameHost || !this.gameHost.systems) return;

        const physics = this.gameHost.systems.physics;
        const telemetryReadout = this.element.querySelector('#telemetry-readout');
        if (!telemetryReadout) return;

        // Get the first vehicle (or a selected one)
        const vehicleIds = Array.from(physics.vehicleBodies.keys());
        if (vehicleIds.length === 0) {
            telemetryReadout.innerHTML = 'No active vehicles';
            return;
        }

        const vehicleId = vehicleIds[0];
        const tel = physics.getVehicleTelemetry(vehicleId);

        if (!tel) {
            telemetryReadout.innerHTML = 'Error fetching telemetry';
            return;
        }

        const wheelIcons = tel.wheels.map((w, i) => {
            const color = w.isGrounded ? '#00ff00' : '#ff0000';
            const pos = ['FL', 'FR', 'RL', 'RR'][i];
            return `<span style="color: ${color}">${pos}</span>`;
        }).join(' ');

        const steeringAuth = tel.steeringAuthority || {};
        const factors = steeringAuth.factors || {};
        const tuning = steeringAuth.tuning || {};
        const recovery = tel.steeringRecovery || {};

        telemetryReadout.innerHTML = `
ID: <span class="telemetry-value">${vehicleId.substring(0, 8)}</span>
Speed: <span class="telemetry-value">${tel.speed.toFixed(1)} km/h</span>
Steer: <span class="telemetry-value">${tel.steerAngle.toFixed(2)}</span>
Throttle: <span class="telemetry-value">${tel.throttle.toFixed(2)}</span>
Wheels: ${wheelIcons}
State: <span class="telemetry-value">${tel.isAirborne ? 'AIRBORNE' : (tel.isWheelie ? 'WHEELIE' : 'GROUNDED')}</span>
Env: <span class="telemetry-value">${tel.inWallContact ? 'WALL' : ''} ${tel.inOilSlick ? 'OIL' : ''}</span>
Authority: <span class="telemetry-value">${Number(steeringAuth.authority ?? 1).toFixed(2)} (${steeringAuth.dominantLimiter || 'none'})</span>
Auth factors: <span class="telemetry-value">state ${(factors.state ?? 1).toFixed(2)} / speed ${(factors.speed ?? 1).toFixed(2)} / roll ${(factors.roll ?? 1).toFixed(2)} / land ${(factors.badLanding ?? 1).toFixed(2)}</span>
Recovery: <span class="telemetry-value">${Number(steeringAuth.recoveryInfluence || 0).toFixed(2)} wall ${Number(steeringAuth.wallPeel || 0).toFixed(2)} last ${Number(recovery.rollImpulse || 0).toFixed(3)}/${Number(recovery.yawImpulse || 0).toFixed(3)}</span>
Auth tuning: <span class="telemetry-value">FL ${Number(tuning.frontLightAuthority ?? this.params.steeringAuthority.frontLightAuthority).toFixed(2)} / WH ${Number(tuning.wheelieAuthority ?? this.params.steeringAuthority.wheelieAuthority).toFixed(2)} / AIR ${Number(tuning.airborneAuthority ?? this.params.steeringAuthority.airborneAuthority).toFixed(2)}</span>
Wheelie: <span class="telemetry-value">${(tel.wheelieIntent?.holdMs || 0).toFixed(0)}/${(tel.wheelieIntent?.dwellMs || 0).toFixed(0)}ms @ ${(tel.wheelieIntent?.threshold || 0).toFixed(2)} ${tel.wheelieIntent?.ready ? 'READY' : ''}</span>
Boost: <span class="telemetry-value">${tel.speedBoost.toFixed(1)}x</span>
Stunt: <span class="telemetry-value">${tel.stuntState} ${(tel.stuntCharge * 100).toFixed(0)}% ${tel.stuntBoost.toFixed(2)}x</span>
        `.trim();
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
            // Update config on vehicle data
            vehicleData.config.physics = {
                ...vehicleData.config.physics,
                linearDamping: this.params.car.linearDamping,
                angularDamping: this.params.car.angularDamping,
                wallSlideGrip: this.params.wheels.wallSlideGrip,
                frictionSlip: this.params.wheels.frictionSlip
            };

            vehicleData.config.engine = {
                ...vehicleData.config.engine,
                force: this.params.car.engineForce,
                brakeForce: this.params.car.brakeForce
            };

            vehicleData.config.steering = {
                ...vehicleData.config.steering,
                maxAngle: this.params.steering.maxAngle,
                highSpeedReduction: this.params.steering.highSpeedReduction,
                smoothing: this.params.steering.smoothing
            };

            vehicleData.config.steeringAuthority = {
                ...vehicleData.config.steeringAuthority,
                ...this.params.steeringAuthority
            };

            vehicleData.config.wheelie = {
                ...vehicleData.config.wheelie,
                activationThrottle: this.params.wheelie.activationThrottle,
                activationDwellMs: this.params.wheelie.activationDwellMs
            };

            // Apply linear/angular damping directly to rigid body
            if (vehicleData.body) {
                if (typeof vehicleData.body.setLinearDamping === 'function') {
                    vehicleData.body.setLinearDamping(this.params.car.linearDamping);
                }
                if (typeof vehicleData.body.setAngularDamping === 'function') {
                    vehicleData.body.setAngularDamping(this.params.car.angularDamping);
                }
            }

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

        // Apply audio parameters to audioManager
        const audioManager = typeof window !== 'undefined' ? window.audioManager : null;
        if (audioManager) {
            // Store audio params for engine sound updates
            audioManager.engineMinPitch = this.params.audio.engineMinPitch;
            audioManager.engineMaxPitch = this.params.audio.engineMaxPitch;
            audioManager.engineBaseVolume = this.params.audio.engineVolume;
        }
    }

    /**
     * Publish resolved camera-cluster tuning for host-side debug consumers
     * @private
     */
    _applyCameraClusterDebugSettings() {
        const resolved = resolveCameraClusterOptions(this.params.cameraCluster || {});
        this.params.cameraCluster = resolved;

        if (typeof window !== 'undefined') {
            window.__jjCameraClusterTuning = {
                ...resolved,
                source: 'PhysicsTuningUI'
            };
            window.getCameraClusterTuning = () => ({
                ...window.__jjCameraClusterTuning
            });
            if (typeof CustomEvent === 'function') {
                window.dispatchEvent(new CustomEvent('jj:cameraClusterTuningChanged', {
                    detail: window.__jjCameraClusterTuning
                }));
            }
        }

        if (this.eventBus && typeof this.eventBus.emit === 'function') {
            this.eventBus.emit('debug:cameraClusterTuningChanged', {
                ...resolved,
                source: 'PhysicsTuningUI'
            });
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
                brakeForce: 50,
                linearDamping: 0.2,
                angularDamping: 0.4
            },
            steering: {
                maxAngle: 0.38,
                highSpeedReduction: 0.45,
                smoothing: 0.3
            },
            steeringAuthority: {
                frontLightAuthority: DEFAULT_STEERING_AUTHORITY_CONFIG.frontLightAuthority,
                wheelieAuthority: DEFAULT_STEERING_AUTHORITY_CONFIG.wheelieAuthority,
                airborneAuthority: DEFAULT_STEERING_AUTHORITY_CONFIG.airborneAuthority,
                sideTiltSteerFloor: DEFAULT_STEERING_AUTHORITY_CONFIG.sideTiltSteerFloor,
                recoveryMaxInfluence: DEFAULT_STEERING_AUTHORITY_CONFIG.recoveryMaxInfluence
            },
            wheelie: {
                activationThrottle: 0.92,
                activationDwellMs: 280
            },
            wheels: {
                frictionSlip: 1000,
                suspensionStiffness: 30,
                wallSlideGrip: 0.2
            },
            damage: {
                multiplier: 1,
                respawnDelay: 3
            },
            audio: {
                engineMinPitch: 0.8,
                engineMaxPitch: 1.6,
                engineVolume: 0.4
            },
            cameraCluster: resolveCameraClusterOptions({})
        };
    }

    /**
     * Merge saved camera-cluster values with defaults
     * @private
     */
    _mergeCameraClusterParams(defaults, saved = {}) {
        return {
            ...defaults,
            ...saved,
            importance: {
                ...defaults.importance,
                ...(saved.importance || {})
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
                steering: { ...defaults.steering, ...parsed.steering },
                steeringAuthority: { ...defaults.steeringAuthority, ...parsed.steeringAuthority },
                wheelie: { ...defaults.wheelie, ...parsed.wheelie },
                wheels: { ...defaults.wheels, ...parsed.wheels },
                damage: { ...defaults.damage, ...parsed.damage },
                audio: { ...defaults.audio, ...parsed.audio },
                cameraCluster: this._mergeCameraClusterParams(
                    defaults.cameraCluster,
                    parsed.cameraCluster
                )
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
