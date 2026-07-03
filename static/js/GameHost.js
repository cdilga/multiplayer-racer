/**
 * GameHost - Main game orchestrator for the host display
 *
 * This is the thin orchestrator that wires all systems together.
 * It replaces the monolithic host.js with a clean, event-driven architecture.
 *
 * Usage:
 *   const game = new GameHost();
 *   await game.init();
 *   game.start();
 */

// Import systems (these also export to window.* for compatibility)
import { eventBus } from './engine/EventBus.js';
import { Engine, GAME_STATES } from './engine/Engine.js';
import { getResourceLoader } from './resources/ResourceLoader.js';
import { VehicleFactory } from './resources/VehicleFactory.js';
import { TrackFactory } from './resources/TrackFactory.js';
import { DEFAULT_VALIDATED_CAPACITY, generateSpawnsForTrack } from './resources/SpawnGenerator.js';
import { validateMapData } from './resources/mapValidator.js';
import { createSpawnAllocator } from './resources/SpawnAllocator.js';
import { ReplayJournal } from './engine/replayJournal.js';
import { GENERATOR_VERSION, computeParamsHash } from './resources/mapCatalog.js';
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { InputSystem } from './systems/InputSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { RaceSystem } from './systems/RaceSystem.js';
import { DamageSystem } from './systems/DamageSystem.js';
import { DerbySystem } from './systems/DerbySystem.js';
import { WeaponSystem } from './systems/WeaponSystem.js';
import { HitStopSystem } from './systems/HitStopSystem.js';
import { TrailSystem } from './systems/TrailSystem.js';
import { ParticleSystem } from './systems/ParticleSystem.js';
import { AdaptiveQualityController } from './engine/AdaptiveQualityController.js';
import { Vehicle } from './entities/Vehicle.js';
import { Track } from './entities/Track.js';
import { LobbyUI } from './ui/LobbyUI.js';
import { RaceUI } from './ui/RaceUI.js';
import { ResultsUI } from './ui/ResultsUI.js';
import { RoomCodeOverlayUI } from './ui/RoomCodeOverlayUI.js';
import { GameMenuUI } from './ui/GameMenuUI.js';
import { BugReportUI } from './ui/BugReportUI.js';
import { DebugOverlayUI } from './ui/DebugOverlayUI.js';
import { StatsOverlayUI } from './ui/StatsOverlayUI.js';
import { PhysicsTuningUI } from './ui/PhysicsTuningUI.js';
import { getRuntimeTelemetryContext, getBrowserTelemetry } from './telemetry/index.js';

// Out-of-bounds recovery (br-oob-death-reset): below this Y a car has clearly
// fallen through the world (immediate recovery); a car past the horizontal
// boundary is recovered after a short grace so a brief clip doesn't kill it.
const OOB_KILL_PLANE_Y = -30;
const OOB_RECOVERY_GRACE_MS = 1500;

class GameHost {
    constructor(options = {}) {
        this.container = options.container || document.getElementById('game-container') || document.body;

        // Core engine
        this.engine = null;
        this.eventBus = eventBus;

        // Systems
        this.systems = {
            physics: null,
            render: null,
            network: null,
            input: null,
            audio: null,
            race: null,
            damage: null,
            derby: null,
            weapons: null,
            hitStop: null,
            trails: null,
            particles: null
        };

        // Factories
        this.resourceLoader = null;
        this.vehicleFactory = null;
        this.trackFactory = null;

        // UI
        this.ui = {
            lobby: null,
            race: null,
            results: null,
            debugOverlay: null,    // F4 - Physics visualization
            statsOverlay: null,    // F3 - Game statistics
            physicsTuning: null,   // F2 - Physics parameter tuning
            cameraControls: null
        };

        // Entities
        this.track = null;
        this.vehicles = new Map();  // playerId -> Vehicle

        // Game state
        this.roomCode = null;
        this._lastStateBroadcast = 0;
        this._stateBroadcastInterval = 100; // 10Hz
        this._matchStartAt = null;
        this._currentMatchId = null;
        this._currentMatchState = null;
        this._oobClusterState = {
            count: 0,
            startedAt: null,
            lastEmitAt: 0,
        };
        this._vehicleThrottleState = new Map();
        this.settings = {
            mode: 'race',
            laps: 3,
            damageEnabled: true,
            track: 'oval',
            vehicle: 'default'
        };
        this.lobbyWorld = {
            enabled: true,
            lastUpdateAt: 0,
            banter: []
        };

        // Bind methods
        this._onPlayerJoined = this._onPlayerJoined.bind(this);
        this._onPlayerLeft = this._onPlayerLeft.bind(this);
        this._onPlayerInput = this._onPlayerInput.bind(this);
        this._onStartGame = this._onStartGame.bind(this);
        this._onRaceFinished = this._onRaceFinished.bind(this);
        this._onUpdate = this._onUpdate.bind(this);
        this._onRender = this._onRender.bind(this);
        this._onCameraKeyDown = this._onCameraKeyDown.bind(this);
        this._lastVisibilitySampleAt = 0;
        this._lastFrameSampleAt = 0;
        this._frameSamplePeriodMs = 1000;
        this._vehicleTelemetryState = new Map();
    }

    _emitGameplayTelemetry(eventName, properties = {}, options = {}) {
        const telemetry = getBrowserTelemetry?.();
        if (!telemetry) {
            return null;
        }

        if (typeof telemetry.captureStateTransition === 'function' && options.transitionState !== undefined) {
            return telemetry.captureStateTransition(eventName, options.transitionState, properties, options);
        }

        if (typeof telemetry.captureWithCooldown === 'function' && options.cooldownMs) {
            return telemetry.captureWithCooldown(eventName, properties, { cooldownMs: options.cooldownMs });
        }

        if (typeof telemetry.capture === 'function') {
            return telemetry.capture(eventName, properties);
        }

        return null;
    }

    _isOutOfBounds(position = {}) {
        const x = Number(position.x);
        const y = Number(position.y);
        const z = Number(position.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            return false;
        }
        return Math.abs(x) > 220 || Math.abs(z) > 220 || y < -20;
    }

    /**
     * Out-of-bounds / kill-plane recovery state machine (br-oob-death-reset).
     * Below the kill-plane -> immediate; past the boundary -> after a short grace
     * (so a brief clip doesn't kill a car). Either way routes lethal damage through
     * the shared path: race -> destroy+respawn, derby -> elimination.
     * @private
     */
    _updateOobRecovery(vehicle, isOob, now, lastState) {
        if (!vehicle || vehicle.isDead || vehicle.invulnerable) {
            if (lastState) lastState.oobSince = null;
            return;
        }
        const pos = vehicle.mesh?.position || vehicle.position || {};
        const y = Number(pos.y);
        if (Number.isFinite(y) && y < OOB_KILL_PLANE_Y) {
            lastState.oobSince = null;
            this._triggerOobRecovery(vehicle, 'kill_plane');
            return;
        }
        if (isOob) {
            if (!lastState.oobSince) {
                lastState.oobSince = now;
            } else if (now - lastState.oobSince >= OOB_RECOVERY_GRACE_MS) {
                lastState.oobSince = null;
                this._triggerOobRecovery(vehicle, 'out_of_bounds');
            }
        } else {
            lastState.oobSince = null;
        }
    }

    /**
     * Destroy an off-map car so the shared damage path recovers it (respawn in
     * race, elimination in derby). Idempotent for an already-dead car.
     * @private
     */
    _triggerOobRecovery(vehicle, reason) {
        if (!vehicle || vehicle.isDead) return;
        this._journalEvent?.('out_of_bounds', { vehicleId: vehicle.id, reason });
        this._emitGameplayTelemetry?.('gameplay:car:out_of_bounds', {
            vehicleId: vehicle.id,
            reason,
            mode: this.settings?.mode ?? null,
            topology: this.systems.network?.topology || 'local'
        }, { cooldownMs: 2000 });
        if (this.systems?.damage?.applyDamage) {
            this.systems.damage.applyDamage(vehicle.id, 1e6, 'out-of-bounds');
        }
    }

    _safeTelemetryContext() {
        return {
            trackId: this.track?.configId || this.track?.config?.id || 'unknown',
            ruleset: this.settings?.mode || 'unknown',
            topology: this.systems.network?.topology || 'local',
        };
    }

    _withMatchContext(props = {}) {
        return {
            ...this._safeTelemetryContext(),
            playerCount: this.vehicles?.size || 0,
            matchId: this._currentMatchId || 'match-unknown',
            ...props
        };
    }

    _trackSeedBucket(seed) {
        const numericSeed = Number(seed);
        if (!Number.isFinite(numericSeed)) {
            return 'n/a';
        }
        if (numericSeed < 1000) {
            return '0_999';
        }
        if (numericSeed < 10000) {
            return '1k_10k';
        }
        if (numericSeed < 100000) {
            return '10k_100k';
        }
        return '100k_plus';
    }

    _generateMatchId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return `match-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
        }
        return `match-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    _setMatchId(matchId) {
        const sanitized = typeof matchId === 'string' && matchId.length > 0
            ? matchId
            : this._generateMatchId();
        this._currentMatchId = sanitized;
        const telemetry = getBrowserTelemetry?.();
        if (telemetry?.setContext) {
            telemetry.setContext({ matchId: sanitized });
        }
        if (telemetry?.setContextFromPayload) {
            telemetry.setContextFromPayload({ matchId: sanitized });
        }
        return sanitized;
    }

    _emitMatchTelemetry(eventName, state, properties = {}, options = {}) {
        if (this._currentMatchState === state && eventName === 'gameplay:match:started') {
            return null;
        }
        this._currentMatchState = state;
        return this._emitGameplayTelemetry(eventName, this._withMatchContext(properties), {
            ...options,
            transitionState: state
        });
    }

    _emitTelemetryWithThrottle(eventName, properties = {}, options = {}) {
        return this._emitGameplayTelemetry(eventName, properties, options);
    }

    _coarseDurationBucket(durationMs) {
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration < 0) {
            return 'n/a';
        }
        return duration >= 120000
            ? '2m+'
            : duration >= 60000
                ? '1m_to_2m'
                : duration >= 30000
                    ? '30s_to_1m'
                    : duration >= 10000
                        ? '10s_to_30s'
                        : 'lt_10s';
    }

    _trackVehicleTelemetry(vehicle = {}) {
        const vehicleId = vehicle.id;
        const lastState = this._vehicleTelemetryState.get(vehicleId) || {};
        const now = Number.isFinite(performance.now()) ? performance.now() : Date.now();

        const handlingState = vehicle.handlingState || 'grounded';
        const isWheelie = handlingState === 'wheelie';
        const wasWheelie = Boolean(lastState.isWheelie);
        const isBoosting = (vehicle.speedBoost || 1) > 1 || (vehicle.stuntBoostMultiplier || 1) > 1;
        const wasBoosting = Boolean(lastState.isBoosting);
        const inWallContact = !!vehicle.inWallContact;
        const isOob = this._isOutOfBounds(vehicle.position || vehicle.mesh?.position || {});
        const wasOob = Boolean(lastState.isOutOfBounds);

        // Out-of-bounds / kill-plane recovery (br-oob-death-reset): a car pushed
        // past the boundary (for a bounded grace) or below the kill-plane is
        // destroyed -> respawned (race) or eliminated (derby) via the shared damage
        // path, so it never sits frozen off-map.
        this._updateOobRecovery(vehicle, isOob, now, lastState);
        const badLandingActive = !!vehicle.stuntBadLandingUntil && now < vehicle.stuntBadLandingUntil;
        const wasBadLanding = Boolean(lastState.badLanding);

        if (lastState.isWheelie !== isWheelie) {
            if (isWheelie) {
                this._emitTelemetryWithThrottle('gameplay:wheelie:entered', {
                    vehicleId,
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown',
                    handlingState,
                    wheeliePhase: 'entered',
                    speed: vehicle.speed,
                });
                lastState.wheelieStartAt = now;
            } else if (wasWheelie) {
                const wheelieDurationMs = Number.isFinite(lastState.wheelieStartAt)
                    ? now - lastState.wheelieStartAt
                    : null;
                this._emitTelemetryWithThrottle('gameplay:wheelie:landed', {
                    vehicleId,
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown',
                    handlingState,
                    durationBucket: this._coarseDurationBucket(wheelieDurationMs),
                    speed: vehicle.speed,
                    durationMs: wheelieDurationMs == null ? null : Math.round(wheelieDurationMs),
                    badLanding: wasBadLanding
                });
            }
            delete lastState.wheelieStartAt;
        }

        if (wasBadLanding && !badLandingActive) {
            this._emitTelemetryWithThrottle('gameplay:wheelie:bad_land', {
                vehicleId,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                handlingState: handlingState
            }, { cooldownMs: 1000 });
        }

        if (!wasWheelie && isWheelie) {
            this._vehicleThrottleState.set(`${vehicleId}:wheelie`, now);
        }

        if (isWheelie) {
            const lastWheelieTick = Number(lastState.wheelieSampleAt || 0);
            if (!lastWheelieTick || now - lastWheelieTick >= 3000) {
                const durationMs = Number.isFinite(lastState.wheelieStartAt)
                    ? Math.max(0, now - lastState.wheelieStartAt)
                    : null;
                this._emitTelemetryWithThrottle('gameplay:wheelie:sustained', {
                    vehicleId,
                    durationBucket: this._coarseDurationBucket(durationMs),
                    durationMs: durationMs == null ? null : Math.round(durationMs),
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown'
                }, { cooldownMs: 3000 });
                lastState.wheelieSampleAt = now;
            }
        }

        if (wasBoosting !== isBoosting) {
            this._emitTelemetryWithThrottle('gameplay:boost:used', {
                vehicleId,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                boostMultiplier: Math.max(
                    Number(vehicle.speedBoost || 1),
                    Number(vehicle.stuntBoostMultiplier || 1)
                )
            }, {
                cooldownMs: 1500,
                transitionState: isBoosting ? 'used' : 'ended'
            });
        }

        if (!wasOob && isOob) {
            this._oobClusterState.startedAt = now;
            this._oobClusterState.count = 1;
            this._oobClusterState.lastEmitAt = now;
            this._emitTelemetryWithThrottle('gameplay:car:out_of_bounds', {
                vehicleId,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                count: this.vehicles.size
            });
        } else if (wasOob && isOob) {
            this._oobClusterState.count += 1;
            if (now - this._oobClusterState.lastEmitAt >= 3000) {
                this._oobClusterState.lastEmitAt = now;
                this._emitTelemetryWithThrottle('gameplay:map:oob_cluster', {
                    clusterSize: this._oobClusterState.count,
                    clusterDurationBucket: this._coarseDurationBucket(now - this._oobClusterState.startedAt),
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown'
                }, { cooldownMs: 5000 });
            }
        } else if (wasOob && !isOob) {
            const clusterDurationMs = Number.isFinite(this._oobClusterState.startedAt)
                ? Math.max(0, now - this._oobClusterState.startedAt)
                : null;
            if (clusterDurationMs > 0 && this._oobClusterState.count > 0) {
                this._emitTelemetryWithThrottle('gameplay:map:reset_cluster', {
                    clusterSize: this._oobClusterState.count,
                    clusterDurationMs: Math.round(clusterDurationMs),
                    clusterDurationBucket: this._coarseDurationBucket(clusterDurationMs),
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown'
                });
            }
            this._oobClusterState = { count: 0, startedAt: null, lastEmitAt: 0 };
        }

        if (!lastState.inWallContact && inWallContact) {
            this._emitTelemetryWithThrottle('gameplay:car:wall_recovery', {
                vehicleId,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                mapReliability: 'wall_touch'
            }, { cooldownMs: 5000 });
        }

        this._vehicleTelemetryState.set(vehicleId, {
            isWheelie,
            isBoosting,
            inWallContact,
            isOutOfBounds: isOob,
            badLanding: badLandingActive,
            badLandingAt: badLandingActive ? now : null,
            wheelieStartAt: lastState.wheelieStartAt,
            wheelieSampleAt: lastState.wheelieSampleAt
        });
    }

    /**
     * Initialize the game host
     */
    async init() {
        console.log('GameHost: Initializing...');

        // Create engine
        this.engine = new Engine({ eventBus: this.eventBus });

        // Create resource loader
        this.resourceLoader = getResourceLoader({ eventBus: this.eventBus });

        // Create factories
        this.vehicleFactory = new VehicleFactory({
            resourceLoader: this.resourceLoader,
            eventBus: this.eventBus
        });
        this.trackFactory = new TrackFactory({
            resourceLoader: this.resourceLoader,
            eventBus: this.eventBus
        });

        // Create systems
        this.systems.physics = new PhysicsSystem({ eventBus: this.eventBus });
        this.systems.render = new RenderSystem({
            eventBus: this.eventBus,
            container: this.container
        });
        this.systems.network = new NetworkSystem({ eventBus: this.eventBus });
        this.systems.input = new InputSystem({
            eventBus: this.eventBus,
            networkSystem: this.systems.network
        });
        this.systems.audio = new AudioSystem({ eventBus: this.eventBus });
        this.systems.race = new RaceSystem({ eventBus: this.eventBus });
        this.systems.damage = new DamageSystem({ eventBus: this.eventBus });
        this.systems.derby = new DerbySystem({ eventBus: this.eventBus });
        this.systems.weapons = new WeaponSystem({ eventBus: this.eventBus });
        this.systems.hitStop = new HitStopSystem({
            eventBus: this.eventBus,
            renderSystem: this.systems.render
        });

        // TrailSystem needs renderSystem, so create after render is initialized
        // But we'll create it after engine.init() so renderSystem is ready

        // Register systems with engine (trails will be registered separately)
        Object.entries(this.systems).forEach(([name, system]) => {
            if (system) {  // Skip trails for now
                this.engine.registerSystem(name, system);
            }
        });

        // Initialize engine (initializes all systems)
        await this.engine.init();

        // Create TrailSystem after render is initialized
        this.systems.trails = new TrailSystem({
            eventBus: this.eventBus,
            renderSystem: this.systems.render
        });
        await this.systems.trails.init();
        this.engine.registerSystem('trails', this.systems.trails);

        // Create ParticleSystem after render is initialized
        this.systems.particles = new ParticleSystem({
            eventBus: this.eventBus,
            scene: this.systems.render.getScene()
        });
        this.systems.particles.init();
        this.engine.registerSystem('particles', this.systems.particles);

        // Configure WeaponSystem with render and damage systems
        this.systems.weapons.renderSystem = this.systems.render;
        this.systems.weapons.damageSystem = this.systems.damage;

        // Adaptive quality controller (5k3.39): drives the render grade tier +
        // resolution scale from a hardware heuristic + runtime fps, using the
        // render system's existing public API. Fed each frame in _onRender.
        this._attachAdaptiveQuality();

        // Create UI
        this._createUI();

        // Subscribe to events
        this._subscribeToEvents();

        // Preload assets
        await this._preloadAssets();

        console.log('GameHost: Ready');
    }

    /**
     * Create UI components
     * @private
     */
    _createUI() {
        this.ui.lobby = new LobbyUI({
            eventBus: this.eventBus,
            container: this.container
        });
        this.ui.lobby.init();
        this.ui.lobby.setOnStartGame(this._onStartGame);

        this.ui.race = new RaceUI({
            eventBus: this.eventBus,
            container: this.container
        });
        this.ui.race.init();

        this.ui.results = new ResultsUI({
            eventBus: this.eventBus,
            container: this.container
        });
        this.ui.results.init();
        this.ui.results.setOnPlayAgain(() => this._startNewRace());
        this.ui.results.setOnBackToLobby(() => this._returnToLobby());

        // Persistent QR code overlay for late joiners
        this.ui.roomCodeOverlay = new RoomCodeOverlayUI({
            eventBus: this.eventBus,
            container: this.container
        });
        this.ui.roomCodeOverlay.init();

        // Always-available menu: restart / back to lobby / reset cars / help
        this.ui.gameMenu = new GameMenuUI({
            eventBus: this.eventBus,
            container: this.container
        });
        this.ui.gameMenu.init();
        this.ui.gameMenu.setOnRestart(() => this._startNewRace());
        this.ui.gameMenu.setOnBackToLobby(() => this._returnToLobby());
        this.ui.gameMenu.setOnResetCars(() => this.resetAllVehicles());

        // Bug reporter: captures a screenshot + game-state snapshot and opens
        // a pre-filled email so reports can be correlated with server logs.
        this.ui.bugReport = new BugReportUI({
            container: this.container,
            getDebugInfo: () => this.collectDebugInfo(),
            captureScreenshot: () => this.captureScreenshot()
        });
        this.ui.bugReport.init();
        this.ui.gameMenu.setOnReportBug(() => this.ui.bugReport.open());

        // Debug UI components
        this.ui.debugOverlay = new DebugOverlayUI({
            eventBus: this.eventBus,
            physicsSystem: this.systems.physics,
            renderSystem: this.systems.render
        });
        this.ui.debugOverlay.init();

        this.ui.statsOverlay = new StatsOverlayUI({
            eventBus: this.eventBus,
            container: this.container,
            gameHost: this
        });
        this.ui.statsOverlay.init();

        this.ui.physicsTuning = new PhysicsTuningUI({
            eventBus: this.eventBus,
            container: this.container,
            gameHost: this
        });
        this.ui.physicsTuning.init();

        this._createCameraControls();

        // Expose toggle functions globally for keyboard handlers
        window.togglePhysicsDebug = () => this.ui.debugOverlay?.toggle();
        window.toggleStatsOverlay = () => this.ui.statsOverlay?.toggle();
        window.togglePhysicsPanel = () => this.ui.physicsTuning?.toggle();
        window.setCameraMode = (mode) => {
            this._setCameraMode(mode);
            return this.systems.render.getCameraModeInfo();
        };
        window.cycleCameraFocus = (direction = 1) => {
            this._cycleCameraFocus(direction);
            return this.systems.render.getCameraModeInfo();
        };

        // Expose reset functions globally for debug UI
        window.resetCarPosition = (vehicleId) => this.resetVehicleToSpawn(vehicleId);
        window.resetAllCars = () => this.resetAllVehicles();
    }

    /**
     * Create host camera mode controls.
     * @private
     */
    _createCameraControls() {
        const root = document.getElementById('camera-controls');
        if (!root) return;

        const controls = {
            root,
            modeButtons: Array.from(root.querySelectorAll('[data-camera-mode]')),
            focusLabel: root.querySelector('#camera-focus-label'),
            prevButton: root.querySelector('#camera-focus-prev'),
            nextButton: root.querySelector('#camera-focus-next')
        };
        this.ui.cameraControls = controls;

        const savedMode = localStorage.getItem('jj_camera_mode');
        if (savedMode) {
            this.systems.render.setCameraMode(savedMode);
        }

        controls.modeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                this._setCameraMode(button.dataset.cameraMode);
            });
        });
        controls.prevButton?.addEventListener('click', () => this._cycleCameraFocus(-1));
        controls.nextButton?.addEventListener('click', () => this._cycleCameraFocus(1));

        document.addEventListener('keydown', this._onCameraKeyDown);
        this._updateCameraControls();
    }

    /**
     * @private
     * @param {KeyboardEvent} event
     */
    _onCameraKeyDown(event) {
        const tagName = event.target?.tagName;
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;

        if (event.key === 'c' || event.key === 'C') {
            event.preventDefault();
            this._cycleCameraMode();
        } else if (event.key === 'v' || event.key === 'V') {
            event.preventDefault();
            this._cycleCameraFocus(1);
        }
    }

    /**
     * @private
     * @param {string} mode
     */
    _setCameraMode(mode) {
        if (!this.systems.render.setCameraMode(mode)) return;
        localStorage.setItem('jj_camera_mode', mode);
        this._updateCameraControls();
    }

    /**
     * @private
     */
    _cycleCameraMode() {
        const mode = this.systems.render.cycleCameraMode();
        localStorage.setItem('jj_camera_mode', mode);
        this._updateCameraControls();
    }

    /**
     * @private
     * @param {number} direction
     */
    _cycleCameraFocus(direction = 1) {
        this.systems.render.cycleCameraFocus(direction);
        this._updateCameraControls();
    }

    /**
     * @private
     */
    _updateCameraControls() {
        const controls = this.ui.cameraControls;
        if (!controls) return;

        const info = this.systems.render.getCameraModeInfo();
        controls.root.classList.toggle('hidden', info.targetCount === 0);
        controls.modeButtons.forEach((button) => {
            const isActive = button.dataset.cameraMode === info.mode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });

        const focusText = info.mode === 'party'
            ? `${info.targetCount || 0} cars`
            : (info.focusName || 'No car');
        if (controls.focusLabel) {
            controls.focusLabel.textContent = focusText;
        }
    }

    /**
     * Subscribe to game events
     * @private
     */
    _subscribeToEvents() {
        // Network events
        this.eventBus.on('network:playerJoined', this._onPlayerJoined);
        this.eventBus.on('network:playerLeft', this._onPlayerLeft);
        this.eventBus.on('network:playerInput', this._onPlayerInput);
        this.eventBus.on('network:gameStart', this._onNetworkGameStart.bind(this));
        this.eventBus.on('network:gameEnd', this._onNetworkGameEnd.bind(this));
        this.eventBus.on('network:roomCreated', (data) => {
            const mapSeed = data?.seed ?? data?.track_seed ?? data?.mapSeed;
            this._setMatchId(this._currentMatchId || this._generateMatchId());
            this._emitTelemetryWithThrottle('gameplay:match:returned_to_lobby', {
                phase: 'room_created',
                trackSeedBucket: this._trackSeedBucket(mapSeed),
                trackId: data?.track_id || data?.trackId || this.track?.configId || 'unknown',
                playerCount: this.vehicles.size
            });
        });

        // Player-requested car reset (stuck car escape hatch)
        this.eventBus.on('network:carResetRequest', ({ playerId }) => {
            const vehicle = this.vehicles.get(playerId);
            if (!vehicle || vehicle.isDead) return;

            // Races go back to the last checkpoint; arenas right the car in place
            const spot = this._getRespawnPosition(vehicle);
            if (spot) {
                this.systems.physics.resetVehicle(vehicle.id, spot, spot.rotation);
            } else {
                this._rightVehicle(vehicle);
            }
            this._emitGameplayTelemetry('gameplay:car:reset_requested', {
                vehicleId: vehicle.id,
                playerId,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                reason: 'player_request'
            }, { cooldownMs: 1200 });
        });

        // Race events
        this.eventBus.on('race:finished', this._onRaceFinished);
        this.eventBus.on('race:start', () => {
            // Transition engine state to RACING when countdown finishes
            this.engine.setState(GAME_STATES.RACING);
        });

        // Derby events
        this.eventBus.on('derby:combatStart', () => {
            // Transition engine state to RACING when derby countdown finishes
            this.engine.setState(GAME_STATES.RACING);
        });
        this.eventBus.on('derby:matchEnd', this._onDerbyMatchEnd.bind(this));
        this.eventBus.on('derby:roundEnd', this._onDerbyRoundEnd.bind(this));
        this.eventBus.on('derby:nextRoundReady', this._onDerbyNextRoundReady.bind(this));

        // Dead cars become non-solid until they respawn
        this.eventBus.on('damage:destroyed', ({ vehicleId }) => {
            this.systems.physics.setVehicleEnabled(vehicleId, false);
            this._journalEvent('destroyed', { vehicleId });
        });
        this.eventBus.on('damage:respawn', ({ vehicleId }) => {
            this.systems.physics.setVehicleEnabled(vehicleId, true);
            this._journalEvent('respawn', { vehicleId });
        });

        // Stunt landings should read on the shared screen even when the camera
        // is not focused tightly on the car.
        this.eventBus.on('vehicle:stuntLanding', ({ charge = 0 }) => {
            this.systems.render?.addImpactShake?.(0.16 + Math.min(0.24, charge * 0.2));
            this._emitGameplayTelemetry('gameplay:wheelie:landed', {
                charge: Number.isFinite(charge) ? Math.round(charge * 100) / 100 : null,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown'
            }, { cooldownMs: 750 });
        });
        this.eventBus.on('vehicle:stuntBadLanding', () => {
            this.systems.render?.addImpactShake?.(0.28);
            this._emitGameplayTelemetry('gameplay:wheelie:bad_land', {
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown'
            }, { cooldownMs: 750 });
        });

        // Race respawns drop you at your last checkpoint, facing the next one
        this.systems.damage.respawnPositionProvider = (vehicle) => this._getRespawnPosition(vehicle);

        // Weapon events - relay to players
        this.eventBus.on('weapon:pickup', (data) => {
            if (this.systems.network && data.playerId) {
                const weapon = this.systems.weapons?.weaponDefs?.get(data.weaponId);
                this.systems.network.sendWeaponPickup(data.playerId, {
                    weaponId: data.weaponId,
                    weaponName: data.weaponName || weapon?.name,
                    icon: weapon?.icon
                });
                this._emitGameplayTelemetry('gameplay:weapon:pickup', {
                    weaponType: data.weaponId || 'unknown',
                    playerId: data.playerId,
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown'
                }, { cooldownMs: 750 });
            }
        });
        this.eventBus.on('weapon:fired', (data) => {
            if (this.systems.network && data.playerId) {
                this.systems.network.sendWeaponFired(data.playerId, {
                    weaponId: data.weaponId
                });
                this._emitGameplayTelemetry('gameplay:weapon:fired', {
                    weaponType: data.weaponId || 'unknown',
                    playerId: data.playerId,
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown',
                }, { cooldownMs: 500 });
            }
        });
        this.eventBus.on('weapon:hit', ({ shooterId, targetId, weaponId, damage }) => {
            const now = Number(performance.now());
            const key = `weapon_hit:${shooterId || 'unknown'}:${targetId || 'unknown'}:${weaponId || 'unknown'}`;
            const lastAt = Number(this._vehicleThrottleState.get(key) || 0);
            if (!lastAt || now - lastAt >= 1000) {
                this._vehicleThrottleState.set(key, now);
                this._emitGameplayTelemetry('gameplay:weapon:hit', {
                    weaponType: weaponId || 'unknown',
                    shooterId: shooterId || null,
                    targetId: targetId || null,
                    topology: this.systems.network?.topology || 'local',
                    ruleset: this.settings?.mode || 'unknown',
                    hitDamageBucket: Number.isFinite(damage)
                        ? (damage <= 20 ? 'lt_20' : damage <= 60 ? '20_60' : '60_plus')
                        : 'n/a'
                });
            }
        });

        // Lobby events
        this.eventBus.on('lobby:modeSelected', ({ mode }) => {
            console.log('GameHost: Mode selected:', mode);
            this.settings.mode = mode;
            // Broadcast to all connected players
            if (this.systems.network) {
                this.systems.network.broadcastModeSelected(mode);
            }
        });

        // Game loop events
        this.eventBus.on('loop:update', this._onUpdate);
        this.eventBus.on('loop:render', this._onRender);

        // Pause cleanly when the tab is hidden - browser timer throttling and
        // energy savers otherwise step physics with stale inputs and the game
        // glitches out. Resume resets loop timing so there's no catch-up jump.
        document.addEventListener('visibilitychange', () => {
            if (!this.engine?.gameLoop?.isRunning()) return;
            if (document.hidden) {
                this.engine.gameLoop.pause();
                this.systems.physics.pause();
                this.systems.audio?.stopEngineSound?.();
                this._emitVisibilitySample('background');
            } else {
                this.systems.physics.resume();
                this.engine.gameLoop.resume();
                this._emitVisibilitySample('foreground');
                if (this.engine.getState() === GAME_STATES.RACING) {
                    this.systems.audio?.startEngineSound?.();
                }
            }
        });

        // State change events
        this.eventBus.on('state:change', ({ from, to }) => {
            console.log(`GameHost: State ${from} -> ${to}`);

            // Emit game-specific events for UI components
            if (to === GAME_STATES.LOBBY) {
                this.eventBus.emit('game:lobby');
            } else if (to === GAME_STATES.COUNTDOWN) {
                this.eventBus.emit('game:countdown');
            } else if (to === GAME_STATES.RACING) {
                this.eventBus.emit('game:racing');
            } else if (to === GAME_STATES.RESULTS) {
                this.eventBus.emit('game:results');
            }

            // Update game-screen visibility for test compatibility
            const gameScreen = document.getElementById('game-screen');
            if (gameScreen) {
                if (to === GAME_STATES.RACING || to === GAME_STATES.COUNTDOWN) {
                    gameScreen.classList.remove('hidden');
                } else if (to === GAME_STATES.LOBBY) {
                    gameScreen.classList.add('hidden');
                }
            }
        });
    }

    /**
     * Preload game assets
     * @private
     */
    async _preloadAssets() {
        try {
            await this.resourceLoader.preload({
                vehicles: ['default'],
                tracks: ['oval', 'derby-bowl', 'derby-arena', 'derby-coliseum', 'derby-dunes']
            });
            console.log('GameHost: Assets preloaded');
        } catch (error) {
            console.error('GameHost: Error preloading assets:', error);
        }
    }

    /**
     * Start the game
     */
    async start() {
        console.log('GameHost: Starting...');

        // Create room
        try {
            this.roomCode = await this.systems.network.createRoom();
            console.log('GameHost: Room created:', this.roomCode);
            // Explicitly update lobby UI with room code
            if (this.ui.lobby && this.roomCode) {
                this.ui.lobby.setRoomCode(this.roomCode);
            }
            // Also set on persistent overlay for late joiners
            if (this.ui.roomCodeOverlay && this.roomCode) {
                this.ui.roomCodeOverlay.setRoomCode(this.roomCode);
            }
        } catch (error) {
            console.error('GameHost: Failed to create room:', error);
        }

        // Load and create track
        await this._createTrack(this.settings.track);

        // Start engine (enters loading state, starts game loop)
        this.engine.start();

        // Transition to lobby
        this.engine.setState(GAME_STATES.LOBBY);
    }

    /**
     * Create track
     * @private
     */
    async _createTrack(trackId) {
        try {
            // Clean up existing track first
            if (this.track) {
                console.log('GameHost: Removing old track:', this.track.configId);

                // Remove mesh from render system
                const oldMesh = this.track.getMesh();
                if (oldMesh) {
                    this.systems.render.removeMesh(oldMesh);
                }

                // Remove physics bodies
                this.systems.physics.removeStaticBodies();

                this.track = null;
            }

            const trackData = await this.trackFactory.create(trackId);

            // Create Track entity
            this.track = new Track({ config: trackData.config });
            this.track.setMesh(trackData.mesh);

            // Add to render system
            this.systems.render.addMesh(trackData.mesh, this.track.id);

            // Create physics bodies for track
            const groundConfig = trackData.config.physics || {};
            let groundBody;
            if (trackData.config.geometry?.type === 'dunes') {
                // Rolling trimesh terrain instead of a flat ground plane
                groundBody = this.systems.physics.createTerrainBody(trackData.config);
            } else if (trackData.config.geometry?.type === 'bowl') {
                // Concave bowl floor as a trimesh built from the same revolved
                // profile as the visual mesh - no flat cuboid, no hard crease.
                groundBody = this.systems.physics.createBowlBody(trackData.config);
            } else {
                groundBody = this.systems.physics.createGroundBody({
                    size: trackData.config.visual?.ground?.size || 200,
                    friction: groundConfig.groundFriction || 0.8
                });
            }
            const barrierBodies = this.systems.physics.createBarrierBodies(trackData.config);

            this.track.setPhysicsBodies(groundBody, barrierBodies);

            // Fail-loud arena validation (n47 / j3i.2): the shared MapInstance
            // validator proves the built map is playable BEFORE any car spawns.
            // Shipped specs always validate; a failure here means a real map/spec
            // bug and is surfaced via telemetry + logging rather than dropping
            // players into a void.
            this._validateArena(trackData.config, trackId);

            // Configure race system
            this.systems.race.setTrack(this.track);
            this.systems.race.setLaps(this.settings.laps);

            // Setup lighting
            const lighting = this.track.getLightingConfig();
            this.systems.render.setLighting(lighting);

            // Camera profile: walled arenas need a high angle so the walls
            // don't occlude the cars; open tracks use the default chase view
            this._applyCameraProfile(trackData.config);

            // Pre-generate a validated spawn set so joins, resets, and soak
            // counts never fall back to stale authored caps or modulo reuse.
            this._ensureTrackSpawnCapacity(Math.max(DEFAULT_VALIDATED_CAPACITY, this.vehicles.size));

            console.log('GameHost: Track created:', trackId);
        } catch (error) {
            console.error('GameHost: Error creating track:', error);
            this._emitGameplayTelemetry('gameplay:map:load_failed', {
                trackId: trackId || 'unknown',
                trackSeedBucket: this._trackSeedBucket(this.settings?.mapSeed ?? this.track?.config?.seed ?? 0),
                status: 'failed',
                reason: 'exception',
                message: String(error?.message || 'track_create_error')
            }, { cooldownMs: 10000 });
            // A build failure (unknown/incompatible id, loader 404, bad JSON) is an
            // invalid map: mark it so _onStartGame fails loud and stays in the lobby
            // instead of spawning onto a null/stale track (n47). No hidden fallback.
            this.track = null;
            this.lastArenaValidation = {
                ok: false,
                requestedTrackId: trackId ?? 'unknown',
                resolvedMapId: null,
                ruleset: this.settings?.mode === 'derby' ? 'derby' : 'race',
                seed: this.settings?.mapSeed ?? null,
                validatorVersion: 'build',
                reasons: [{ code: 'track_build_failed', detail: String(error?.message || 'track_create_error') }]
            };
        }
    }

    /**
     * Validate the built arena against the shared MapInstance validator before
     * spawns. Consumes the single shared validator (br-map-authoring-tool-j3i.2)
     * instead of scattered ad-hoc checks. On failure it fails loud (structured
     * telemetry + console error) and records the report on `this.lastArenaValidation`
     * so the host UI / debug lab / bug reports can surface a blocked-start reason.
     * @private
     * @param {Object} config - loaded track config
     * @param {string} trackId
     * @returns {Object} ValidationReport
     */
    _validateArena(config, trackId) {
        // Validate each arena against its OWN ruleset (derived by the validator
        // from the config): _resolveTrackId already guarantees the mode -> track
        // mapping, so this gate is a structural-validity tripwire (geometry,
        // colliders, closed derby walls / ordered race checkpoints, valid spawns),
        // not a mode-compatibility check.
        const report = validateMapData(config, {
            playerCount: Math.max(1, this.vehicles?.size || 1),
            requestedTrackId: trackId,
            seed: this.settings?.mapSeed ?? config?.seed ?? null
        });
        // Runtime on-ground DIAGNOSTIC (n47): downward-raycast each authored spawn
        // against the just-built colliders and record any that miss ground. This is
        // observability, NOT a blocking gate — spawn ground-support is already
        // authoritatively enforced at generation by SpawnGenerator.validateSpawnSet
        // (requireSupport), and a runtime raycast is too coarse (trimesh terrain,
        // collider-registration timing) to safely block a valid shipped start.
        report.spawnGround = this._checkSpawnsOnGround();

        // Test-only hook: force an invalid verdict so the blocked-start path is
        // exercisable by E2E without shipping a broken track file.
        if (typeof window !== 'undefined' && window.__jjForceMapInvalid && this._isTestMode()) {
            report.ok = false;
            report.reasons = [...(report.reasons || []), { code: 'forced_invalid_test' }];
        }
        this.lastArenaValidation = report;

        if (!report.ok) {
            console.error(
                `GameHost: Arena validation FAILED for ${trackId} (${report.ruleset}):`,
                report.reasons
            );
            this._emitGameplayTelemetry('gameplay:map:invalid', {
                mode: report.ruleset,
                requestedTrackId: report.requestedTrackId,
                resolvedTrackId: report.resolvedMapId,
                seed: report.seed,
                playerCount: report.playerCount,
                reasons: report.reasons.map((r) => r.code),
                validatorVersion: report.validatorVersion,
                status: 'blocked'
            }, { cooldownMs: 10000 });
        }
        return report;
    }

    /**
     * Downward-raycast every authored spawn against the built colliders to prove
     * each has ground beneath it (n47). Returns a structured result; a spawn with
     * no hit within range is "off ground".
     * @private
     * @returns {{ok:boolean, checked:number, offGround:Object[]}}
     */
    _checkSpawnsOnGround() {
        const result = { ok: true, checked: 0, offGround: [] };
        const spawns = (this.track && typeof this.track.getAllSpawnPositions === 'function')
            ? this.track.getAllSpawnPositions()
            : [];
        if (!spawns || spawns.length === 0) return result;
        if (typeof this.systems?.physics?.raycastDown !== 'function') return result;

        for (let i = 0; i < spawns.length; i += 1) {
            const spawn = spawns[i];
            const hit = this.systems.physics.raycastDown(spawn);
            result.checked += 1;
            // A missing raycast capability (null) is not a failure; only an actual
            // "no ground hit" is.
            if (hit && hit.hit === false) {
                result.ok = false;
                result.offGround.push({ index: i, x: spawn.x, z: spawn.z });
            }
        }
        return result;
    }

    /**
     * Fail-loud blocked start for an invalid arena (n47): halt the round before any
     * spawn, stay in the lobby, and emit a structured diagnostic with stayedInLobby.
     * @private
     * @param {string} trackId
     */
    _blockStartInvalidMap(trackId) {
        this.mapStartBlocked = true;
        const report = this.lastArenaValidation || {};
        const reasons = (report.reasons || []).map((r) => r.code || r);
        const exceptionHash = this._hashReasons(reasons);
        console.error(`GameHost: BLOCKED start — invalid arena "${trackId}":`, reasons);
        this._emitGameplayTelemetry('gameplay:map:invalid', {
            mode: this.settings?.mode ?? null,
            requestedTrackId: report.requestedTrackId ?? trackId,
            resolvedTrackId: report.resolvedMapId ?? trackId,
            seed: report.seed ?? null,
            playerCount: this.vehicles?.size ?? 0,
            reasons,
            validatorVersion: report.validatorVersion ?? null,
            exceptionHash,
            stayedInLobby: true,
            debugArtifactPaths: Array.isArray(report.debugArtifactPaths) ? report.debugArtifactPaths : [],
            spawnGround: report.spawnGround ?? null,
            status: 'blocked_start'
        });
        // Best-effort debug screenshot for the bug-report/debug-lab evidence bundle.
        try {
            Promise.resolve(this.captureScreenshot?.()).then((shot) => {
                if (shot) this.lastMapBlockArtifact = { at: Date.now(), reasons, screenshot: shot };
            }).catch(() => {});
        } catch (_) { /* screenshot is best-effort */ }
        // Stay in the lobby; never enter the spawn loop or notify the network start.
        if (this.engine?.getState?.() !== GAME_STATES.LOBBY) {
            this.engine.setState(GAME_STATES.LOBBY);
        }
        this.eventBus?.emit?.('host:map_blocked', { trackId, reasons, stayedInLobby: true });
    }

    /**
     * Stable 8-hex hash of the failure reasons (for exceptionHash grouping).
     * @private
     */
    _hashReasons(reasons = []) {
        const s = reasons.join('|');
        let h = 2166136261;
        for (let i = 0; i < s.length; i += 1) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    /**
     * @private
     * @returns {import('./engine/GameRunContext.js').GameRunContext|null}
     */
    _getRunContext() {
        return this.engine?.getRunContext?.() || this.engine?.runContext || null;
    }

    /**
     * Begin a runtime replay journal for the current match (3xv.10).
     * @private
     */
    _startReplayJournal() {
        this._journalTick = 0;
        this._journalSnapshotEvery = 60; // ~1 snapshot/sec at 60 Hz (not per-frame)
        try {
            this.replayJournal = new ReplayJournal(this._getRunContext(), {
                roomConfig: {
                    mode: this.settings?.mode ?? null,
                    laps: this.settings?.laps ?? null,
                    players: this.vehicles?.size ?? 0,
                    track: this.track?.configId ?? null
                }
            });
        } catch (_) {
            this.replayJournal = null;
        }
    }

    /**
     * Record a game event into the runtime journal (no-op when none is active).
     * @private
     */
    _journalEvent(name, data = {}) {
        this.replayJournal?.recordEvent?.(this._journalTick ?? 0, name, data);
    }

    /**
     * Throttled per-match state snapshot into the journal (1/sec, never per-frame).
     * @private
     */
    _journalSnapshot() {
        if (!this.replayJournal) return;
        this._journalTick = (this._journalTick ?? 0) + 1;
        if (this._journalTick % (this._journalSnapshotEvery || 60) !== 0) return;
        const vehicles = [];
        for (const [, vehicle] of this.vehicles) {
            const p = vehicle?.mesh?.position || vehicle?.position || {};
            vehicles.push({ id: vehicle.id, x: p.x ?? null, z: p.z ?? null, health: vehicle.health ?? null, alive: vehicle.isDead !== true });
        }
        this.replayJournal.snapshot(this._journalTick, { vehicles });
    }

    /**
     * Ensure the active track has a validated spawn set with at least the
     * requested capacity. Authored spawns remain valid for small lobbies, but
     * higher counts always install a generated set first.
     * @private
     * @param {number} playerCount
     * @returns {Object[]|null}
     */
    _ensureTrackSpawnCapacity(playerCount) {
        if (!this.track || !Number.isFinite(playerCount) || playerCount <= 0) return null;

        const authoredCount = Array.isArray(this.track.spawnPositions) ? this.track.spawnPositions.length : 0;
        const generatedCount = Array.isArray(this.track.generatedSpawns) ? this.track.generatedSpawns.length : 0;

        if (generatedCount >= playerCount) {
            return this.track.generatedSpawns;
        }

        if (generatedCount === 0 && playerCount <= authoredCount) {
            return this.track.spawnPositions;
        }

        const result = generateSpawnsForTrack(this.track, playerCount, this._getRunContext(), {
            minPairDistance: 3.5,
            minClearance: 2.0,
            requireSupport: true
        });

        if (!result.valid || result.spawns.length < playerCount) {
            console.error('GameHost: Spawn generation failed validation', result.diagnostics);
            const diagnostics = result?.diagnostics || {};
            this._emitTelemetryWithThrottle('gameplay:map:validation_failed', {
                trackId: this.track?.configId || this.track?.config?.id || 'unknown',
                trackSeedBucket: this._trackSeedBucket(diagnostics?.seed ?? this.track?.config?.seed),
                trackType: this.track?.config?.geometry?.type || 'unknown',
                playerCount: this.vehicles.size,
                requestedSpawns: Number(result?.spawnCount || 0),
                availableSpawns: Number(this.track?.spawnPositions?.length || 0),
                reason: result.valid ? 'insufficient_spawns' : 'validation_failed',
            }, { cooldownMs: 1000 });
            return null;
        }

        this.track.setGeneratedSpawns(result);
        return result.spawns;
    }

    /**
     * @private
     * @returns {{x:number,y:number,z:number,rotation:number}}
     */
    _fallbackSpawnPosition() {
        return {
            x: 0,
            y: this.track?.defaultSpawnHeight || 1.5,
            z: 0,
            rotation: 0
        };
    }

    /**
     * @private
     * @param {number} playerIndex
     * @returns {{x:number,y:number,z:number,rotation:number}}
     */
    _getTrackSpawnPosition(playerIndex) {
        this._ensureTrackSpawnCapacity(playerIndex + 1);
        const spawnPos = this.track?.getSpawnPosition(playerIndex);
        // Full-grid (initial/regrid) placement uses the pre-validated, separated
        // spawn set from SpawnGenerator (validateSpawnSet), so it already upholds
        // the separation invariant. Single-car entry paths (respawn, late-join)
        // route through the runtime allocator via _safePose instead.
        if (spawnPos) return spawnPos;

        console.error(`GameHost: Missing validated spawn for index ${playerIndex}`);
        return this._fallbackSpawnPosition();
    }

    /**
     * Lazily-built shared spawn/respawn allocator (3xv.15). Randomness is drawn
     * from the deterministic run-context RNG so seeded replays place cars
     * identically; falls back to a fixed rotation when no context is attached.
     * @private
     */
    _getSpawnAllocator() {
        if (!this._spawnAllocator) {
            const ctx = this._getRunContext();
            const rng = ctx?.rng?.stream?.('spawn') || ctx?.rng?.('spawn') || null;
            const nextFloat = rng && typeof rng.nextFloat === 'function'
                ? () => rng.nextFloat()
                : (typeof rng === 'function' ? () => rng() : undefined);
            this._spawnAllocator = createSpawnAllocator({
                minSeparation: 3,
                footprintRadius: 1.2,
                nextFloat,
                now: () => (this._getRunContext()?.clock?.nowMs?.() ?? 0)
            });
        }
        return this._spawnAllocator;
    }

    /**
     * Live car positions (excluding the requester), used as allocator blockers so
     * a placement never lands on an occupied footprint.
     * @private
     */
    _liveVehiclePositions(excludeId = null) {
        const positions = [];
        for (const [id, vehicle] of this.vehicles) {
            if (id === excludeId) continue;
            const p = vehicle?.mesh?.position || vehicle?.position;
            if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
                positions.push({ id, x: p.x, z: p.z });
            }
        }
        return positions;
    }

    /**
     * Run a preferred pose through the shared allocator so no two cars ever enter
     * the same point/footprint (3xv.15). Preserves the preferred y/rotation; only
     * x/z may shift on a fallback. Returns the preferred pose unchanged when the
     * allocator has nothing to correct (the common case for a valid grid).
     * @private
     * @param {Object} preferred - {x,y,z,rotation}
     * @param {string|null} requesterId
     * @param {string} phase - 'spawn' | 'respawn'
     * @param {number|null} index
     * @returns {Object}
     */
    _safePose(preferred, requesterId, phase, index = null) {
        if (!preferred) return preferred;
        const allocator = this._getSpawnAllocator();
        const occupied = this._liveVehiclePositions(requesterId);
        const footprint = 1.2;
        const inBounds = (this.track && typeof this.track.isOutOfBounds === 'function')
            ? (p) => !this.track.isOutOfBounds(p, footprint)
            : null;

        const result = allocator.allocate([preferred], {
            occupied,
            inBounds,
            meta: {
                requesterId,
                mapId: this.track?.configId ?? null,
                seed: this.settings?.mapSeed ?? this.track?.config?.seed ?? null,
                ruleset: this.settings?.mode === 'derby' ? 'derby' : 'race',
                phase,
                playerCount: this.vehicles?.size ?? 0
            }
        });

        // Record rejected candidates + fallback outcomes for bug-report / debug
        // observability (3xv.15). Keep a short ring buffer.
        if (result.fallback || (result.diagnostics?.rejectedCount ?? 0) > 0) {
            if (!this._spawnDiagnostics) this._spawnDiagnostics = [];
            this._spawnDiagnostics.push({
                phase,
                requesterId: requesterId ?? null,
                reason: result.reason,
                fallback: !!result.fallback,
                rejected: result.diagnostics?.rejected ?? [],
                mapId: result.diagnostics?.mapId ?? null,
                seed: result.diagnostics?.seed ?? null,
                ruleset: result.diagnostics?.ruleset ?? null,
                playerCount: result.diagnostics?.playerCount ?? null,
                minSeparation: result.diagnostics?.minSeparation ?? null
            });
            if (this._spawnDiagnostics.length > 20) this._spawnDiagnostics.shift();
        }

        if (!result.ok || !result.position) {
            return preferred;
        }
        if (result.fallback) {
            this._emitGameplayTelemetry('gameplay:spawn:reallocated', {
                phase,
                requesterId: requesterId ?? 'unknown',
                index: index ?? null,
                reason: result.reason,
                minSeparation: result.diagnostics?.minSeparation ?? null,
                rejected: result.diagnostics?.rejectedCount ?? 0
            }, { cooldownMs: 2000 });
        }
        // Keep the authored height + heading; only accept the corrected x/z.
        return { ...preferred, x: result.position.x, z: result.position.z };
    }

    /**
     * Pick camera parameters for the loaded track. Derby bowls have tall
     * walls, so the camera goes high and steep to look over them instead of
     * through them.
     * @private
     * @param {Object} trackConfig
     */
    _applyCameraProfile(trackConfig) {
        const geometry = trackConfig.geometry || {};
        const isWalledArena = trackConfig.type === 'derby' || geometry.type === 'bowl' || geometry.type === 'dunes';

        if (isWalledArena) {
            const wallHeight = geometry.wallHeight || 15;
            // dunes specify `radius`; bowls specify `diameter`
            const radius = geometry.radius || (geometry.diameter || 80) / 2;
            const height = wallHeight + 35;

            this.systems.render.setCameraParams({
                offset: { x: 0, y: height, z: radius * 0.75 },
                lookOffset: { x: 0, y: 0, z: 0 },
                baseCameraHeight: height,
                minCameraDepth: 15,
                maxCameraDepth: radius * 1.1
            });
        } else {
            this.systems.render.resetCameraParams();
        }
    }

    /**
     * Handle player joined
     * @private
     */
    async _onPlayerJoined(playerData) {
        console.log('GameHost: Player joined:', playerData.id);

        // Reconnects and duplicate join events must not spawn a second car
        if (this.vehicles.has(playerData.id)) {
            console.log('GameHost: Vehicle already exists for player, skipping creation:', playerData.id);
            return;
        }

        try {
            // Determine spawn position based on game state
            let spawnPos;
            const currentState = this.engine.getState();
            const isRacing = currentState === GAME_STATES.RACING || currentState === GAME_STATES.COUNTDOWN;

            if (isRacing && this.vehicles.size > 0) {
                // Late join: spawn near last place vehicle, run through the shared
                // allocator so the entrant never lands on a live car (3xv.15).
                spawnPos = this._safePose(this._getLateJoinSpawnPosition(), playerData.id, 'late_join');
                console.log('GameHost: Late join spawn position:', spawnPos);
            } else {
                // Normal join: use track spawn positions
                const spawnIndex = this.vehicles.size;
                spawnPos = this._getTrackSpawnPosition(spawnIndex);
            }

            // Create vehicle
            const vehicleData = await this.vehicleFactory.create(this.settings.vehicle, {
                position: spawnPos,
                rotation: spawnPos.rotation,
                playerId: playerData.id,
                color: playerData.color
            });

            // Create Vehicle entity
            const vehicle = new Vehicle({
                config: vehicleData.config,
                playerId: playerData.id,
                playerName: playerData.name,
                position: spawnPos,
                rotation: spawnPos.rotation,
                color: playerData.color
            });
            vehicle.setMesh(vehicleData.mesh);

            // Add to render system
            this.systems.render.addMesh(vehicleData.mesh, vehicle.id);

            // Create physics body
            const physicsConfig = await this.vehicleFactory.getPhysicsConfig(this.settings.vehicle);
            this.systems.physics.createVehicleBody(vehicle, physicsConfig);

            // Register with systems
            this.systems.input.registerVehicle(vehicle);
            this.systems.race.registerVehicle(vehicle);
            this.systems.damage.registerVehicle(vehicle);
            this.systems.weapons.registerVehicle(vehicle);

            // Late joiners during a derby match enter the current round
            if (this.settings.mode === 'derby' && isRacing) {
                this.systems.derby.registerVehicle(vehicle);
            }

            // Store vehicle
            this.vehicles.set(playerData.id, vehicle);

            // Add vehicle to camera tracking (multi-vehicle camera)
            this.systems.render.addCameraTarget(vehicle);
            this._updateCameraControls();
            this._prepareLobbyWorldVehicle(vehicle);
            this._recordLobbyBanter(playerData);

            // Emit vehicle created event (for TrailSystem and other systems)
            this.eventBus.emit('vehicle:created', { vehicle });

            // Also set as primary target for single-vehicle fallback
            if (this.vehicles.size === 1) {
                this.systems.render.setCameraTarget(vehicle);
            }

            this._emitGameplayTelemetry('gameplay:player:joined', {
                playerCount: this.vehicles.size,
                trackSeedBucket: this._trackSeedBucket(this.track?.seed),
                trackId: this.track?.configId || this.track?.config?.id || 'unknown',
                mode: this.settings?.mode || 'unknown'
            });

            console.log('GameHost: Vehicle created for player:', playerData.id);
        } catch (error) {
            console.error('GameHost: Error creating vehicle:', error);
        }
    }

    /**
     * Get spawn position for late-joining players (near last place)
     * @private
     * @returns {Object} Spawn position {x, y, z, rotation}
     */
    _getLateJoinSpawnPosition() {
        // Get race positions to find last place
        const positions = this.systems.race.getPositions();

        if (positions.length === 0) {
            // Fallback to default spawn if no positions yet
            return this._getTrackSpawnPosition(0);
        }

        // Get last place vehicle
        const lastPlace = positions[positions.length - 1];
        const lastVehicle = this.vehicles.get(lastPlace.playerId);

        if (!lastVehicle || !lastVehicle.mesh) {
            // Fallback if vehicle not found
            return this._getTrackSpawnPosition(this.vehicles.size);
        }

        // In races, drop the late joiner at last place's last checkpoint -
        // guaranteed to be on the track, unlike "10 units behind" which can
        // land outside a curving barrier
        const checkpointSpawn = this._getRespawnPosition(lastVehicle);
        if (checkpointSpawn) {
            return checkpointSpawn;
        }

        // Derby/no-checkpoint fallback: slightly behind the last place vehicle
        const lastPos = lastVehicle.mesh.position;
        const lastRot = lastVehicle.mesh.rotation.y;

        const offsetDistance = 10;
        const offsetX = lastPos.x - Math.sin(lastRot) * offsetDistance;
        const offsetZ = lastPos.z - Math.cos(lastRot) * offsetDistance;

        return {
            x: offsetX,
            y: 1.5, // Standard spawn height
            z: offsetZ,
            rotation: lastRot
        };
    }

    /**
     * Handle player left
     * @private
     */
    _onPlayerLeft(data) {
        console.log('GameHost: Player left:', data.playerId);

        const vehicle = this.vehicles.get(data.playerId);
        if (vehicle) {
            // Emit vehicle removed event (for TrailSystem)
            this.eventBus.emit('vehicle:removed', { vehicleId: vehicle.id });

            // Remove from systems
            this.systems.physics.removeVehicle(vehicle.id);
            this.systems.render.removeMesh(vehicle.id);
            this.systems.render.removeCameraTarget(vehicle);
            this._updateCameraControls();
            this.systems.input.unregisterVehicle(vehicle.id);
            this.systems.race.unregisterVehicle(vehicle.id);
            this.systems.damage.unregisterVehicle(vehicle.id);
            this.systems.weapons.unregisterVehicle(vehicle.id);

            // Remove from map
            this.vehicles.delete(data.playerId);
            this._recordLobbyBanter({
                id: data.playerId,
                name: vehicle.playerName || `Player ${data.playerId}`,
                color: vehicle.color,
                action: 'left'
            });

            this._emitGameplayTelemetry('gameplay:player:left', {
                playerCount: this.vehicles.size,
                mode: this.settings?.mode || 'unknown'
            });
        }
    }

    /**
     * Handle player input
     * @private
     */
    _onPlayerInput(data) {
        // Check for test override flag (used in e2e tests to prevent network from overwriting controls)
        if (typeof window !== 'undefined' && window.gameState?._testControlsOverride) {
            return;
        }

        const vehicle = this.vehicles.get(data.playerId);
        if (vehicle) {
            vehicle.setControls(data.controls);
            // Ordered command record for the replay journal (redacted at record time).
            this.replayJournal?.recordCommand?.(this._journalTick ?? 0, data.playerId, data.controls || {});
        }
    }

    _onNetworkGameStart(data = {}) {
        const matchId = this._setMatchId(data.matchId || data.match_id || this._generateMatchId());
        const trackId = data.track_id || data.trackId || this.track?.configId || 'unknown';

        this._matchStartAt = Date.now();
        this._currentMatchState = 'started';
        this._vehicleTelemetryState.clear();
        this._oobClusterState = {
            count: 0,
            startedAt: null,
            lastEmitAt: 0,
        };

        this._emitMatchTelemetry('gameplay:match:started', 'started', {
            trackId,
            trackSeedBucket: this._trackSeedBucket(data.seed || data.track_seed || data.mapSeed),
            mode: data.mode || this.settings?.mode || 'unknown',
            playerCount: this.vehicles.size,
            matchId
        }, { cooldownMs: 0 });
    }

    _onNetworkGameEnd(data = {}) {
        const now = Date.now();
        const durationMs = Number.isFinite(this._matchStartAt) ? Math.max(0, now - this._matchStartAt) : null;
        const endedMode = data.mode || this.settings?.mode || 'unknown';

        this._matchStartAt = null;
        this._currentMatchState = 'ended';

        this._emitMatchTelemetry('gameplay:match:ended', 'ended', {
            durationMs: durationMs == null ? null : Math.round(durationMs),
            winnerCount: data.winnerCount ?? null,
            winnerPlayerAnalyticsIds: data.winnerPlayerAnalyticsIds || null,
            reason: data.reason || 'completed',
            mode: endedMode
        }, { cooldownMs: 5000 });
    }

    /**
     * Handle start game request
     * @private
     */
    async _onStartGame(options) {
        console.log('GameHost: Starting game with options:', options);
        this.mapStartBlocked = false;

        if (options.mode) {
            this.settings.mode = options.mode;
            this.systems.race.setMode(options.mode);
            this.ui.race.setMode(options.mode);
        }

        if (options.laps) {
            this.settings.laps = options.laps;
            this.systems.race.setLaps(options.laps);
        }

        // A host-entered map seed (j3i.1): recorded so "random" is reproducible.
        if (options.seed !== undefined) {
            this.settings.mapSeed = options.seed;
        }

        // Resolve which track/arena to load
        const trackId = this._resolveTrackId(options.track);
        this.settings.track = trackId;

        // Procedural tracks regenerate every start; others only when changed
        if (trackId === 'procedural' || this.track?.configId !== trackId) {
            await this._createTrack(trackId);
        }

        // Fail-loud blocked start (n47): an invalid arena must NEVER enter the
        // spawn loop. Stay in the lobby with structured telemetry instead of
        // dropping players into a void.
        if (this.lastArenaValidation && this.lastArenaValidation.ok === false) {
            this._blockStartInvalidMap(trackId);
            return;
        }

        this._ensureTrackSpawnCapacity(Math.max(this.vehicles.size, DEFAULT_VALIDATED_CAPACITY));

        // Reset all vehicles to spawn positions
        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this._getTrackSpawnPosition(index);
            vehicle.reset(spawnPos);
            vehicle.health = vehicle.maxHealth;
            this.systems.physics.setVehicleEnabled(vehicle.id, true);
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }

        // Start a runtime replay journal for this match (3xv.10): deterministic
        // run identity + ordered commands/events + throttled state snapshots, so a
        // bug report can carry an actionable, privacy-safe replay excerpt.
        this._startReplayJournal();

        // Derby is elimination: no auto-respawns there
        this.systems.damage.setRespawnEnabled(this.settings.mode !== 'derby');

        // Notify network
        this.systems.network.startGame({ mode: this.settings.mode, laps: this.settings.laps });

        // Weapons run in every mode: register vehicles and configure spawn area
        const trackConfig = this.track?.config || {};
        for (const [playerId, vehicle] of this.vehicles) {
            this.systems.weapons.registerVehicle(vehicle);
        }
        this.systems.weapons.setArenaConfig({
            geometry: trackConfig.geometry,
            weapons: trackConfig.weapons
        });

        // Start the appropriate mode
        if (this.settings.mode === 'derby') {
            // Register vehicles with derby system
            for (const [playerId, vehicle] of this.vehicles) {
                this.systems.derby.registerVehicle(vehicle);
            }

            this.systems.derby.setArenaConfig(trackConfig);

            // Set wall mesh for shrinking animation
            if (this.track?.barriers && this.track.barriers.length > 0) {
                this.systems.derby.setWallMesh(this.track.barriers[0]);
            }

            // Drive the physics wall collider in lockstep with the visual shrink
            // so cars never hit an invisible old wall or phase through the
            // shrunk one. No-op for tracks without a resizable arena wall.
            this.systems.derby.setWallCollider({
                setRadius: (radius) => this.systems.physics.setArenaWallRadius(radius)
            });

            // Start derby match
            this.engine.setState(GAME_STATES.COUNTDOWN);
            this.systems.derby.startMatch();
        } else {
            // Update race UI
            this.ui.race.setTotalLaps(this.settings.laps);

            // Start countdown
            this.engine.setState(GAME_STATES.COUNTDOWN);
            this.systems.race.startCountdown();
        }
    }

    /**
     * Where a destroyed vehicle should respawn. In races: the last checkpoint
     * crossed, facing the next one. Elsewhere: null (falls back to grid spawn).
     * @private
     * @param {Vehicle} vehicle
     * @returns {Object|null} { x, y, z, rotation }
     */
    _getRespawnPosition(vehicle) {
        if (this.settings.mode !== 'race' || !this.track) return null;

        const count = this.track.getCheckpointCount();
        if (count < 2) return null;

        const nextIdx = vehicle.nextCheckpoint ?? 0;
        const lastIdx = (nextIdx - 1 + count) % count;
        const last = this.track.getCheckpoint(lastIdx);
        const next = this.track.getCheckpoint(nextIdx);
        if (!last || !next) return null;

        const rotation = Math.atan2(
            next.position.x - last.position.x,
            next.position.z - last.position.z
        );
        // Route through the shared allocator so a respawn never lands on another
        // car sitting on the checkpoint (3xv.15).
        return this._safePose(
            { x: last.position.x, y: 1.5, z: last.position.z, rotation },
            vehicle?.id ?? null,
            'respawn'
        );
    }

    /**
     * Resolve the requested track id, handling mode defaults and random arenas
     * @private
     * @param {string|null} requested - Track id from the lobby (may be 'random')
     * @returns {string} Concrete track id (or 'procedural')
     */
    _resolveTrackId(requested) {
        const DERBY_ARENAS = ['derby-bowl', 'derby-arena', 'derby-coliseum', 'derby-dunes'];

        if (this.settings.mode === 'derby') {
            if (requested === 'random' || !requested || requested === 'oval' || requested === 'procedural') {
                // Seeded random pick (n47/3xv.6): draw from the run-context RNG so
                // replays are deterministic, and RECORD the selector + resolved
                // arena so "random" is never an unrecorded Math.random.
                const pick = this._pickRandomArena(DERBY_ARENAS);
                this.lastTrackResolution = { requested: requested ?? 'random', resolved: pick, random: true, generatorVersion: GENERATOR_VERSION, seed: this.settings?.mapSeed ?? null, paramsHash: computeParamsHash({ seed: this.settings?.mapSeed ?? null }) };
                return pick;
            }
            this.lastTrackResolution = { requested, resolved: requested, random: false };
            return requested;
        }

        // Race mode
        if (!requested || requested === 'random' || DERBY_ARENAS.includes(requested)) {
            this.lastTrackResolution = { requested: requested ?? 'random', resolved: 'procedural', random: requested === 'random' || !requested, generatorVersion: GENERATOR_VERSION, seed: this.settings?.mapSeed ?? null, paramsHash: computeParamsHash({ seed: this.settings?.mapSeed ?? null }) };
            return 'procedural';
        }
        this.lastTrackResolution = { requested, resolved: requested, random: false };
        return requested;
    }

    /**
     * Deterministic arena pick from the run-context RNG (no ungoverned RNG). Falls
     * back to a run-seeded index when no context/RNG is attached.
     * @private
     */
    _pickRandomArena(arenas) {
        const ctx = this._getRunContext();
        const rng = ctx?.rng?.stream?.('map') || ctx?.rng?.('map') || null;
        let unit;
        if (rng && typeof rng.nextFloat === 'function') unit = rng.nextFloat();
        else if (typeof rng === 'function') unit = rng();
        else {
            // No RNG stream: derive a stable index from the run seed rather than
            // Math.random so a given seed always resolves the same arena.
            const seed = Number(ctx?.describe?.().seed ?? this.settings?.mapSeed ?? 0) || 0;
            unit = ((seed % 1000) / 1000);
        }
        const index = Math.min(arenas.length - 1, Math.max(0, Math.floor(unit * arenas.length)));
        return arenas[index];
    }

    /**
     * Check if the host is running in automated test mode.
     * @private
     * @returns {boolean}
     */
    _isTestMode() {
        return typeof window !== 'undefined' && (
            window._testMode === true ||
            new URLSearchParams(window.location?.search).get('testMode') === '1'
        );
    }

    /**
     * Handle race finished
     * @private
     */
    _onRaceFinished(data) {
        console.log('GameHost: Race finished', data);

        // Transition to results state
        this.engine.setState(GAME_STATES.RESULTS);

        // Network broadcast
        this.systems.network.endGame(data.results);
    }

    /**
     * Handle derby round end
     * @private
     */
    _onDerbyRoundEnd(data) {
        console.log('GameHost: Derby round ended', data);
        // The UI will show round results
        // Next round will be triggered by _onDerbyNextRoundReady or match ends
    }

    /**
     * Handle derby next round ready
     * @private
     */
    _onDerbyNextRoundReady(data) {
        console.log('GameHost: Derby next round ready', data);

        // Auto-start next round after a short delay
        setTimeout(() => {
            this._ensureTrackSpawnCapacity(Math.max(this.vehicles.size, DEFAULT_VALIDATED_CAPACITY));

            // Reset vehicles for next round
            let index = 0;
            for (const [playerId, vehicle] of this.vehicles) {
                const spawnPos = this._getTrackSpawnPosition(index);
                vehicle.reset(spawnPos);
                vehicle.health = vehicle.maxHealth;
                vehicle.isDead = false;
                this.systems.physics.setVehicleEnabled(vehicle.id, true);
                this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
                index++;
            }

            // Start next round
            this.systems.derby.nextRound();
        }, 3000);  // 3 second delay between rounds
    }

    /**
     * Handle derby match end
     * @private
     */
    _onDerbyMatchEnd(data) {
        console.log('GameHost: Derby match ended', data);

        // Convert derby results to race results format for ResultsUI
        const results = data.standings.map(entry => ({
            position: entry.position,
            playerId: entry.playerId,
            vehicleId: this._getVehicleIdForPlayer(entry.playerId),
            finishTime: null,
            totalPoints: entry.totalPoints,
            roundWins: entry.roundWins
        }));

        // Transition to results state
        this.engine.setState(GAME_STATES.RESULTS);

        // Network broadcast
        this.systems.network.endGame(results);
    }

    /**
     * Get vehicle ID for a player
     * @private
     */
    _getVehicleIdForPlayer(playerId) {
        const vehicle = this.vehicles.get(playerId);
        return vehicle ? vehicle.id : null;
    }

    /**
     * Start a new race with same players
     * @private
     */
    _startNewRace() {
        this._emitMatchTelemetry('gameplay:match:restarted', 'restarted', {
            reason: 'manual_restart',
            playerCount: this.vehicles.size,
            mode: this.settings?.mode || 'unknown'
        });
        this._ensureTrackSpawnCapacity(Math.max(this.vehicles.size, DEFAULT_VALIDATED_CAPACITY));

        // Reset all vehicles
        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this._getTrackSpawnPosition(index);
            vehicle.reset(spawnPos);
            vehicle.health = vehicle.maxHealth;
            this.systems.physics.setVehicleEnabled(vehicle.id, true);
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }

        // Restart the mode that just finished
        if (this.settings.mode === 'derby') {
            this.engine.setState(GAME_STATES.COUNTDOWN);
            this.systems.derby.startMatch();
        } else {
            this.systems.race.reset();
            this.engine.setState(GAME_STATES.COUNTDOWN);
            this.systems.race.startCountdown();
        }
    }

    /**
     * Reset a specific vehicle to its spawn position
     * @param {string} vehicleId
     */
    resetVehicleToSpawn(vehicleId) {
        if (!this.track) return;

        // Find the vehicle's index in the vehicles map
        let vehicleIndex = 0;
        let foundVehicle = null;

        for (const [playerId, vehicle] of this.vehicles) {
            if (vehicle.id === vehicleId || String(vehicle.id) === String(vehicleId)) {
                foundVehicle = vehicle;
                break;
            }
            vehicleIndex++;
        }

        if (!foundVehicle) return;

        const spawnPos = this._getTrackSpawnPosition(vehicleIndex);
        foundVehicle.reset(spawnPos);
        this.systems.physics.resetVehicle(foundVehicle.id, spawnPos, spawnPos.rotation);
    }

    /**
     * Reset all vehicles to their spawn positions
     */
    resetAllVehicles() {
        if (!this.track) return;

        this._ensureTrackSpawnCapacity(Math.max(this.vehicles.size, DEFAULT_VALIDATED_CAPACITY));

        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this._getTrackSpawnPosition(index);
            vehicle.reset(spawnPos);
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }
    }

    /**
     * Collect a snapshot of the current game state for a bug report.
     *
     * Everything here is defensive (optional chaining + try/catch) so capturing
     * a report can never crash the game, even mid-transition. The returned
     * object carries correlation IDs (roomCode, socketId, timestamp) so a report
     * can be matched against server logs after the fact.
     *
     * @returns {Object}
     */
    collectDebugInfo() {
        const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : null);

        const info = {
            timestamp: new Date().toISOString(),
            url: typeof window !== 'undefined' ? window.location.href : null,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
            roomCode: this.roomCode || null,
            socketId: this.systems.network?.socket?.id || null,
            connected: this.systems.network?.connected ?? null,
            gameState: this.engine?.getState?.() ?? null,
            fps: Math.round(this.engine?.getFps?.() || 0),
            settings: { ...this.settings },
            track: this.track?.configId || null,
            playerCount: this.vehicles?.size || 0,
            players: [],
            // Map validity (n47) + spawn separation observability (3xv.15).
            mapValidation: this.lastArenaValidation
                ? {
                    ok: this.lastArenaValidation.ok,
                    resolvedMapId: this.lastArenaValidation.resolvedMapId,
                    ruleset: this.lastArenaValidation.ruleset,
                    validatorVersion: this.lastArenaValidation.validatorVersion,
                    reasons: (this.lastArenaValidation.reasons || []).map((r) => r.code || r)
                }
                : null,
            spawnDiagnostics: Array.isArray(this._spawnDiagnostics) ? this._spawnDiagnostics.slice(-10) : [],
            trackResolution: this.lastTrackResolution || null
        };

        // Deterministic run identity + replay journal excerpt (3xv.10): buildId,
        // seed, tuningHash, current tick, recent command/event excerpt, and latest
        // snapshot hash — everything a replay needs, privacy-safe (redacted).
        try {
            const ctx = this._getRunContext();
            const described = ctx && typeof ctx.describe === 'function' ? ctx.describe() : null;
            if (described) {
                info.runContext = {
                    buildId: described.buildId ?? null,
                    seed: described.seed ?? null,
                    ruleset: described.ruleset ?? null,
                    topology: described.topology ?? null,
                    tuningHash: described.tuningHash ?? null,
                    tick: described.tick ?? null,
                    simTimeMs: described.simTimeMs ?? null
                };
            }
            info.replayJournal = this.replayJournal ? this.replayJournal.excerpt(20) : null;
        } catch (e) {
            info.runContextError = String(e);
        }

        try {
            for (const [playerId, vehicle] of this.vehicles) {
                const pos = vehicle.position || vehicle.mesh?.position || null;
                info.players.push({
                    playerId,
                    name: this.systems.network?.players?.get?.(playerId)?.name ?? null,
                    speed: round(vehicle.speed),
                    health: vehicle.health ?? null,
                    isDead: vehicle.isDead ?? null,
                    position: pos ? { x: round(pos.x), y: round(pos.y), z: round(pos.z) } : null
                });
            }
        } catch (e) {
            info.playersError = String(e);
        }

        try {
            if (this.settings.mode === 'derby' && this.systems.derby) {
                info.derby = {
                    state: this.systems.derby.getState?.() ?? null,
                    round: this.systems.derby.getCurrentRound?.() ?? null,
                    survivors: this.systems.derby.getSurvivorCount?.() ?? null,
                    combatTime: this.systems.derby.getCombatTime?.() ?? null
                };
            } else if (this.systems.race) {
                info.race = {
                    state: this.systems.race.state ?? null,
                    totalLaps: this.systems.race.totalLaps ?? null,
                    raceTime: this.systems.race.getRaceTime?.() ?? null,
                    positions: this.systems.race.getPositions?.() ?? null
                };
            }
        } catch (e) {
            info.modeError = String(e);
        }

        // Capture render backend diagnostics for evidence and debugging
        try {
            if (this.systems.render) {
                info.renderDiagnostics = this.systems.render.getRenderDiagnostics?.() ?? null;
                // Also include the full grade diagnostics for context
                info.gradeInfo = this.systems.render.getGradeDiagnostics?.() ?? null;
            }
        } catch (e) {
            info.renderError = String(e);
        }

        return info;
    }

    /**
     * Capture a screenshot of the current scene for a bug report.
     * @returns {string|null} image data URL, or null if capture failed
     */
    captureScreenshot() {
        return this.systems.render?.captureScreenshot?.() ?? null;
    }

    /**
     * Return to lobby
     * @private
     */
    _returnToLobby() {
        this.systems.race.reset();
        this.systems.derby.reset();
        this.systems.weapons.clearAll();
        this.systems.damage.setRespawnEnabled(true);

        // Reset the server-side room state so new players join the lobby
        // cleanly instead of being treated as mid-race late joiners
        this.systems.network.returnToLobby();

        // Revive any dead vehicles so the next game starts clean
        for (const [playerId, vehicle] of this.vehicles) {
            if (vehicle.isDead) {
                vehicle.reset(vehicle.spawnPosition || { x: 0, y: 1.5, z: 0, rotation: 0 });
                vehicle.health = vehicle.maxHealth;
            }
            this.systems.physics.setVehicleEnabled(vehicle.id, true);
        }

        this.engine.setState(GAME_STATES.LOBBY);
        this._emitMatchTelemetry('gameplay:match:returned_to_lobby', 'lobby', {
            reason: 'explicit_return',
            playerCount: this.vehicles.size,
            mode: this.settings?.mode || 'unknown'
        }, { cooldownMs: 3000 });
    }

    /**
     * Update loop
     * @private
     */
    _onUpdate({ dt, time }) {
        const state = this.engine.getState();

        // Throttled replay snapshot (3xv.10) — 1/sec, never per-frame.
        if (state === GAME_STATES.RACING) {
            this._journalSnapshot();
        }

        // Apply controls to physics
        if (state === GAME_STATES.RACING) {
            for (const [playerId, vehicle] of this.vehicles) {
                this.systems.physics.applyVehicleControls(
                    vehicle.id,
                    vehicle.controls
                );
            }
        }

        // Step physics world
        this.systems.physics.update(dt);

        if (state === GAME_STATES.RACING) {
            for (const [playerId, vehicle] of this.vehicles) {
                this._trackVehicleTelemetry(vehicle);
            }
        }

        // Sync vehicle meshes from physics and update effects
        for (const [playerId, vehicle] of this.vehicles) {
            if (!this.systems.hitStop?.shouldHoldVehicleMesh?.(vehicle.id)) {
                vehicle.syncMeshFromPhysics();
            }
            vehicle.updateEffects(dt);
        }

        if (state === GAME_STATES.LOBBY) {
            this._updateLobbyWorld(dt, time);
        }

        // Auto-right flipped cars (critical in derby where respawn is off)
        if (state === GAME_STATES.RACING) {
            this._updateFlipRecovery(dt);
        }

        // Update race UI and audio
        if (state === GAME_STATES.RACING) {
            // Only update race-specific UI in race mode
            if (this.settings.mode === 'race') {
                const raceTime = this.systems.race.getRaceTime();
                this.ui.race.setTime(raceTime);

                // Update UI for first vehicle (could be extended for spectator mode)
                const firstVehicle = this.vehicles.values().next().value;
                if (firstVehicle) {
                    this.ui.race.update({
                        speed: firstVehicle.speed,
                        lap: firstVehicle.currentLap + 1,
                        position: firstVehicle.racePosition
                    });
                }
            }

            // Engine sound follows the fastest living car - the one the
            // camera/action is most likely centered on
            let loudest = null;
            for (const [playerId, vehicle] of this.vehicles) {
                if (vehicle.isDead) continue;
                if (!loudest || (vehicle.speed || 0) > (loudest.speed || 0)) {
                    loudest = vehicle;
                }
            }
            if (loudest) {
                const stuntLoaded = loudest.handlingState === 'wheelie' ||
                    loudest.stuntState === 'charging' ||
                    (loudest.speedBoost || 1) > 1 ||
                    (loudest.stuntBoostMultiplier || 1) > 1;
                const isAccelerating = (loudest.controls?.acceleration || 0) > 0 || stuntLoaded;
                // maxSpeed must match the car's real top speed (~124 km/h) so the
                // virtual gearbox spans the full range and audibly shifts through
                // gears. With the old value of 50 the car was past the ceiling
                // almost instantly, pinning the engine at redline (no shifts).
                this.systems.audio.updateEngineSound(
                    loudest.speed || 0,
                    120, // maxSpeed (km/h)
                    isAccelerating
                );
            }

            // Update health bars for all players
            const healthData = [];
            for (const [playerId, vehicle] of this.vehicles) {
                healthData.push({
                    id: playerId,
                    name: vehicle.playerName || `Player ${playerId}`,
                    color: vehicle.color || '#888',
                    health: vehicle.health ?? 100,
                    maxHealth: vehicle.maxHealth ?? 100
                });
            }
            this.ui.race.updateHealthBars(healthData);

            // Broadcast vehicle states back to players (10Hz)
            const now = performance.now();
            if (!this._isTestMode() && now - this._lastStateBroadcast >= this._stateBroadcastInterval) {
                this._lastStateBroadcast = now;
                this.systems.network.broadcastVehicleStates(this._buildVehicleStates());
            }
        }
    }

    _prepareLobbyWorldVehicle(vehicle) {
        if (!vehicle) return;
        vehicle.controls = { steering: 0, acceleration: 0, braking: 0 };
        vehicle.isLobbyWorldVehicle = true;
        vehicle.lobbyIdlePhase = (this.vehicles.size % 6) * 0.9;
        if (vehicle.mesh) {
            vehicle.mesh.visible = true;
            vehicle.mesh.userData.lobbyWorld = true;
            vehicle.mesh.userData.lobbyIdlePhase = vehicle.lobbyIdlePhase;
        }
    }

    _recordLobbyBanter(playerData = {}) {
        const action = playerData.action === 'left' ? 'left' : 'joined';
        const name = playerData.name || `Player ${playerData.id ?? '?'}`;
        const color = playerData.color || '#ffffff';
        const line = action === 'left'
            ? `${name} rolled out`
            : `${name} rolled into the yard`;
        this.lobbyWorld.banter.push({
            playerId: playerData.id ?? playerData.playerId ?? null,
            name,
            color,
            action,
            line,
            at: Date.now()
        });
        if (this.lobbyWorld.banter.length > 5) {
            this.lobbyWorld.banter.shift();
        }
        this.eventBus.emit('lobby:worldBanter', this.getLobbyWorldDiagnostics());
    }

    _updateLobbyWorld(dt = 0, time = 0) {
        if (!this.lobbyWorld.enabled) return;

        let index = 0;
        for (const vehicle of this.vehicles.values()) {
            this._prepareLobbyWorldVehicle(vehicle);
            const phase = (vehicle.lobbyIdlePhase || 0) + (time || 0) * 1.8;
            if (vehicle.mesh) {
                const baseY = vehicle.position?.y ?? vehicle.spawnPosition?.y ?? vehicle.mesh.position.y;
                vehicle.mesh.position.y = baseY + Math.sin(phase) * 0.035;
                vehicle.mesh.rotation.y += Math.sin(phase * 0.7) * 0.002;
            }
            for (const wheel of vehicle.wheelMeshes || []) {
                wheel.rotation.x += dt * (1.4 + index * 0.15);
            }
            index++;
        }

        this.lobbyWorld.lastUpdateAt = Date.now();
    }

    getLobbyWorldDiagnostics() {
        const overlay = typeof window !== 'undefined' ? window.__vehicleIdentityOverlay : null;
        const markerSnapshot = overlay?.getDebugSnapshot?.() || null;
        const vehicles = Array.from(this.vehicles.values()).map((vehicle) => ({
            playerId: vehicle.playerId,
            name: vehicle.playerName,
            visible: vehicle.mesh?.visible !== false,
            lobbyWorld: vehicle.mesh?.userData?.lobbyWorld === true,
            hasMesh: !!vehicle.mesh,
            hasPhysicsBody: !!vehicle.physicsBody,
            position: vehicle.mesh?.position ? {
                x: Math.round(vehicle.mesh.position.x * 100) / 100,
                y: Math.round(vehicle.mesh.position.y * 100) / 100,
                z: Math.round(vehicle.mesh.position.z * 100) / 100
            } : null
        }));

        return {
            enabled: this.lobbyWorld.enabled,
            state: this.engine?.getState?.() || null,
            vehicleCount: vehicles.length,
            visibleVehicleCount: vehicles.filter((vehicle) => vehicle.visible && vehicle.hasMesh).length,
            markerCount: markerSnapshot?.markerCount || 0,
            visibleMarkerCount: markerSnapshot?.visibleCount || 0,
            banter: this.lobbyWorld.banter.slice(-5),
            vehicles
        };
    }

    /**
     * Build the compact vehicle state packet sent back to phone controllers.
     * @private
     * @returns {Object[]}
     */
    _buildVehicleStates() {
        const vehicleStates = [];
        const now = performance.now();
        for (const [playerId, vehicle] of this.vehicles) {
            const landingBoostActive = !!vehicle.stuntBoostUntil &&
                now < vehicle.stuntBoostUntil &&
                (vehicle.stuntBoostMultiplier || 1) > 1;
            const badLandingActive = !!vehicle.stuntBadLandingUntil &&
                now < vehicle.stuntBadLandingUntil;
            const stuntState = badLandingActive
                ? 'bad-landing'
                : (landingBoostActive ? 'reward' : (vehicle.stuntState || 'idle'));
            vehicleStates.push({
                id: playerId,
                speed: vehicle.speed,
                health: vehicle.health,
                boost: (vehicle.speedBoost > 1) || landingBoostActive,
                wheelie: vehicle.handlingState === 'wheelie',
                handlingState: vehicle.handlingState || 'grounded',
                stateDuration: vehicle.stateDuration || 0,
                stuntState,
                stuntCharge: vehicle.stuntCharge || 0,
                landingBoost: landingBoostActive,
                badLanding: badLandingActive
            });
        }
        return vehicleStates;
    }

    /**
     * Detect vehicles stuck on their roof/side and right them after a short
     * delay. Without this, flipped cars in derby are dead weight forever
     * because elimination mode has no respawns.
     * @private
     * @param {number} dt - Delta time in seconds
     */
    _updateFlipRecovery(dt) {
        const FLIP_UP_THRESHOLD = 0.35;   // world-up Y component below this = flipped
        const FLIP_RECOVER_SECONDS = 2.5;

        for (const [playerId, vehicle] of this.vehicles) {
            const body = vehicle.physicsBody;
            if (!body || vehicle.isDead) {
                vehicle._flipTimer = 0;
                continue;
            }

            const rot = body.rotation();
            // Y component of the chassis up-vector for a unit quaternion
            const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);

            if (upY < FLIP_UP_THRESHOLD) {
                vehicle._flipTimer = (vehicle._flipTimer || 0) + dt;
                if (vehicle._flipTimer >= FLIP_RECOVER_SECONDS) {
                    this._rightVehicle(vehicle);
                    vehicle._flipTimer = 0;
                }
            } else {
                vehicle._flipTimer = 0;
            }
        }
    }

    /**
     * Set a flipped vehicle upright in place, preserving its heading
     * @private
     * @param {Vehicle} vehicle
     */
    _rightVehicle(vehicle) {
        const body = vehicle.physicsBody;
        if (!body) return;

        const pos = body.translation();
        const rot = body.rotation();

        // Heading from the chassis forward axis (quaternion applied to +Z),
        // which stays horizontal-ish even when the car is on its roof
        const fwdX = 2 * (rot.x * rot.z + rot.w * rot.y);
        const fwdZ = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
        const yaw = Math.atan2(fwdX, fwdZ) || 0;

        this.systems.physics.resetVehicle(
            vehicle.id,
            { x: pos.x, y: pos.y + 1.5, z: pos.z },
            yaw
        );

        this.eventBus.emit('vehicle:flipRecovered', {
            vehicleId: vehicle.id,
            playerId: vehicle.playerId
        });
    }

    /**
     * Render loop
     * @private
     */
    _onRender({ dt, interpolation, fps }) {
        this.systems.hitStop?.tick?.();
        // Render system handles actual rendering
        // Update debug overlay visualization each frame
        if (this.ui.debugOverlay?.visible) {
            this.ui.debugOverlay.update();
        }
        // Feed the adaptive quality controller real runtime fps (no logging).
        if (this.adaptiveQuality && Number.isFinite(fps) && fps > 0) {
            this.adaptiveQuality.sample(fps);
        }
        this._samplePerfFrame({ fps, dt });
    }

    /**
     * Instantiate + attach the AdaptiveQualityController to the live render
     * system using its public grade-tier/resolution API. No-op if the render
     * system does not expose the ladder API (fallback/no-post safety).
     * @private
     */
    _attachAdaptiveQuality() {
        const render = this.systems.render;
        const hasLadderApi = render && typeof render.setGradeTier === 'function'
            && (typeof render.listGradeTiers === 'function' || typeof render.getHostGradeTiers === 'function');
        if (!hasLadderApi) {
            return;
        }
        this.adaptiveQuality = new AdaptiveQualityController();
        this.adaptiveQuality.attach(render, this._detectRenderCaps());
        // Expose for diagnostics / e2e evidence and future 5k3.37 settings.
        if (typeof window !== 'undefined') {
            window.__JJ_ADAPTIVE__ = this.adaptiveQuality;
        }
    }

    /**
     * Collect device capabilities from safe browser/runtime sources for the
     * initial quality tier. All fields are optional; unknowns stay undefined.
     * @private
     * @returns {Object}
     */
    _detectRenderCaps() {
        const nav = (typeof navigator !== 'undefined') ? navigator : {};
        const caps = {
            cores: Number.isFinite(Number(nav.hardwareConcurrency)) ? Number(nav.hardwareConcurrency) : undefined,
            deviceMemory: Number.isFinite(Number(nav.deviceMemory)) ? Number(nav.deviceMemory) : undefined,
            devicePixelRatio: (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio))
                ? window.devicePixelRatio : undefined,
            remote: !!(this.systems.network?.topology && this.systems.network.topology !== 'local'),
            softwareGpu: false
        };
        try {
            const diag = this.systems.render?.getRenderDiagnostics?.() || {};
            const info = JSON.stringify(diag.adapterInfo || '').toLowerCase();
            caps.softwareGpu = /swiftshader|llvmpipe|software|basic render|microsoft basic/.test(info);
        } catch (e) {
            // best-effort only; leave softwareGpu false
        }
        return caps;
    }

    _samplePerfFrame({ fps, dt }) {
        const now = performance.now();
        if (!Number.isFinite(fps) || now - this._lastFrameSampleAt < this._frameSamplePeriodMs) {
            return;
        }
        this._lastFrameSampleAt = now;
        const diagnostics = this.systems.render?.getRenderDiagnostics?.() || {};
        const cameraMode = this.systems.render?.getCameraModeInfo?.().mode || 'unknown';
        const playerCount = this.systems.network?.getPlayerCount?.() || 0;
        const frameTimeMs = Number.isFinite(dt) ? Number((dt * 1000).toFixed(2)) : null;
        const frameTimeBucket = frameTimeMs == null
            ? 'unknown'
            : frameTimeMs < 10
                ? 'lt_10'
                : frameTimeMs < 16
                    ? '10_16'
                    : frameTimeMs < 20
                        ? '16_20'
                        : frameTimeMs < 30
                            ? '20_30'
                            : frameTimeMs < 50
                                ? '30_50'
                                : '50_plus';
        const fpsRounded = Number.isFinite(fps) ? Math.round(fps) : null;
        const fpsBucket = fpsRounded == null
            ? 'unknown'
            : fpsRounded >= 55
                ? '55_plus'
                : fpsRounded >= 40
                    ? '40_55'
                    : fpsRounded >= 30
                        ? '30_40'
                        : fpsRounded >= 20
                            ? '20_30'
                            : 'lt_20';
        const runtimeContext = getRuntimeTelemetryContext ? getRuntimeTelemetryContext() : {};
        const telemetry = getBrowserTelemetry?.();
        if (telemetry?.capture) {
            telemetry.capture('perf:render:frame_sample', {
                fps: fpsRounded,
                fpsBucket,
                frameTimeMs,
                frameTimeBucket,
                drawCalls: diagnostics.frameTiming?.drawCalls || diagnostics.drawCalls || null,
                triangleCount: diagnostics.renderInfo?.triangles || diagnostics.triangles || null,
                playerCount,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                cameraMode,
                ...runtimeContext
            });
        }
    }

    _emitVisibilitySample(state) {
        const now = performance.now();
        if (now - this._lastVisibilitySampleAt < 1000) {
            return;
        }
        this._lastVisibilitySampleAt = now;
        const telemetry = getBrowserTelemetry?.();
        if (telemetry?.capture) {
            telemetry.capture('perf:visibility:state_sample', {
                visibilityState: state,
                topology: this.systems.network?.topology || 'local',
                ruleset: this.settings?.mode || 'unknown',
                playerCount: this.systems.network?.getPlayerCount?.() || 0,
                ...getRuntimeTelemetryContext?.(),
            });
        }
    }

    /**
     * Stop the game
     */
    stop() {
        this.engine.stop();
        this.systems.network.disconnect();
    }

    /**
     * Destroy game host
     */
    destroy() {
        this.stop();

        // Destroy UI
        Object.values(this.ui).forEach(ui => ui?.destroy());

        // Destroy engine (destroys all systems)
        this.engine.destroy();

        // Clear vehicles
        this.vehicles.clear();
    }
}

// Export for ES Modules
export { GameHost };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.GameHost = GameHost;
}
