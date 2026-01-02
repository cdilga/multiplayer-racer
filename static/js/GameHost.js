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
import { PhysicsSystem } from './systems/PhysicsSystem.js';
import { RenderSystem } from './systems/RenderSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { InputSystem } from './systems/InputSystem.js';
import { AudioSystem } from './systems/AudioSystem.js';
import { RaceSystem } from './systems/RaceSystem.js';
import { DamageSystem } from './systems/DamageSystem.js';
import { Vehicle } from './entities/Vehicle.js';
import { Track } from './entities/Track.js';
import { LobbyUI } from './ui/LobbyUI.js';
import { RaceUI } from './ui/RaceUI.js';
import { ResultsUI } from './ui/ResultsUI.js';
import { DebugOverlayUI } from './ui/DebugOverlayUI.js';
import { StatsOverlayUI } from './ui/StatsOverlayUI.js';
import { PhysicsTuningUI } from './ui/PhysicsTuningUI.js';

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
            damage: null
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
            physicsTuning: null    // F2 - Physics parameter tuning
        };

        // Entities
        this.track = null;
        this.vehicles = new Map();  // playerId -> Vehicle

        // Game state
        this.roomCode = null;
        this.settings = {
            laps: 3,
            damageEnabled: true,
            track: 'oval',
            vehicle: 'default'
        };

        // Bind methods
        this._onPlayerJoined = this._onPlayerJoined.bind(this);
        this._onPlayerLeft = this._onPlayerLeft.bind(this);
        this._onPlayerInput = this._onPlayerInput.bind(this);
        this._onStartGame = this._onStartGame.bind(this);
        this._onRaceFinished = this._onRaceFinished.bind(this);
        this._onUpdate = this._onUpdate.bind(this);
        this._onRender = this._onRender.bind(this);
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

        // Register systems with engine
        Object.entries(this.systems).forEach(([name, system]) => {
            this.engine.registerSystem(name, system);
        });

        // Initialize engine (initializes all systems)
        await this.engine.init();

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

        // Expose toggle functions globally for keyboard handlers
        window.togglePhysicsDebug = () => this.ui.debugOverlay?.toggle();
        window.toggleStatsOverlay = () => this.ui.statsOverlay?.toggle();
        window.togglePhysicsPanel = () => this.ui.physicsTuning?.toggle();

        // Expose reset functions globally for debug UI
        window.resetCarPosition = (vehicleId) => this.resetVehicleToSpawn(vehicleId);
        window.resetAllCars = () => this.resetAllVehicles();
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

        // Race events
        this.eventBus.on('race:finished', this._onRaceFinished);
        this.eventBus.on('race:start', () => {
            // Transition engine state to RACING when countdown finishes
            this.engine.setState(GAME_STATES.RACING);
        });

        // Game loop events
        this.eventBus.on('loop:update', this._onUpdate);
        this.eventBus.on('loop:render', this._onRender);

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
                tracks: ['oval']
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
            const trackData = await this.trackFactory.create(trackId);

            // Create Track entity
            this.track = new Track({ config: trackData.config });
            this.track.setMesh(trackData.mesh);

            // Add to render system
            this.systems.render.addMesh(trackData.mesh, this.track.id);

            // Create physics bodies for track
            const groundConfig = trackData.config.physics || {};
            const groundBody = this.systems.physics.createGroundBody({
                size: trackData.config.visual?.ground?.size || 200,
                friction: groundConfig.groundFriction || 0.8
            });
            const barrierBodies = this.systems.physics.createBarrierBodies(trackData.config);

            this.track.setPhysicsBodies(groundBody, barrierBodies);

            // Configure race system
            this.systems.race.setTrack(this.track);
            this.systems.race.setLaps(this.settings.laps);

            // Setup lighting
            const lighting = this.track.getLightingConfig();
            this.systems.render.setLighting(lighting);

            console.log('GameHost: Track created:', trackId);
        } catch (error) {
            console.error('GameHost: Error creating track:', error);
        }
    }

    /**
     * Handle player joined
     * @private
     */
    async _onPlayerJoined(playerData) {
        console.log('GameHost: Player joined:', playerData.id);

        try {
            // Get spawn position
            const spawnIndex = this.vehicles.size;
            const spawnPos = this.track.getSpawnPosition(spawnIndex);

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

            // Store vehicle
            this.vehicles.set(playerData.id, vehicle);

            // Update camera to follow first vehicle
            if (this.vehicles.size === 1) {
                this.systems.render.setCameraTarget(vehicle);
            }

            console.log('GameHost: Vehicle created for player:', playerData.id);
        } catch (error) {
            console.error('GameHost: Error creating vehicle:', error);
        }
    }

    /**
     * Handle player left
     * @private
     */
    _onPlayerLeft(data) {
        console.log('GameHost: Player left:', data.playerId);

        const vehicle = this.vehicles.get(data.playerId);
        if (vehicle) {
            // Remove from systems
            this.systems.physics.removeVehicle(vehicle.id);
            this.systems.render.removeMesh(vehicle.id);
            this.systems.input.unregisterVehicle(vehicle.id);
            this.systems.race.unregisterVehicle(vehicle.id);
            this.systems.damage.unregisterVehicle(vehicle.id);

            // Remove from map
            this.vehicles.delete(data.playerId);
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
        }
    }

    /**
     * Handle start game request
     * @private
     */
    _onStartGame(options) {
        console.log('GameHost: Starting game with options:', options);

        if (options.laps) {
            this.settings.laps = options.laps;
            this.systems.race.setLaps(options.laps);
        }

        // Reset all vehicles to spawn positions
        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this.track.getSpawnPosition(index);
            vehicle.reset(spawnPos);
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }

        // Notify network
        this.systems.network.startGame({ laps: this.settings.laps });

        // Update race UI
        this.ui.race.setTotalLaps(this.settings.laps);

        // Start countdown
        this.engine.setState(GAME_STATES.COUNTDOWN);
        this.systems.race.startCountdown();
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
     * Start a new race with same players
     * @private
     */
    _startNewRace() {
        // Reset race
        this.systems.race.reset();

        // Reset all vehicles
        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this.track.getSpawnPosition(index);
            vehicle.reset(spawnPos);
            vehicle.health = vehicle.maxHealth;
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }

        // Start countdown
        this.engine.setState(GAME_STATES.COUNTDOWN);
        this.systems.race.startCountdown();
    }

    /**
     * Reset a specific vehicle to its spawn position
     * @param {string} vehicleId
     */
    resetVehicleToSpawn(vehicleId) {
        console.log('🚗 resetVehicleToSpawn called with vehicleId:', vehicleId);
        if (!this.track) {
            console.log('🚗 No track, returning');
            return;
        }

        // Find the vehicle's index in the vehicles map
        let vehicleIndex = 0;
        let foundVehicle = null;

        console.log('🚗 Searching through vehicles, total count:', this.vehicles.size);
        for (const [playerId, vehicle] of this.vehicles) {
            console.log('🚗 Checking vehicle with playerId:', playerId, 'vehicle.id:', vehicle.id);
            if (vehicle.id === vehicleId || String(vehicle.id) === String(vehicleId)) {
                foundVehicle = vehicle;
                console.log('🚗 FOUND MATCH!');
                break;
            }
            vehicleIndex++;
        }

        if (!foundVehicle) {
            console.log('🚗 Vehicle not found after iterating all');
            return;
        }

        console.log('🚗 Vehicle found at index:', vehicleIndex);
        const spawnPos = this.track.getSpawnPosition(vehicleIndex);
        console.log('🚗 Spawn position:', spawnPos);

        foundVehicle.reset(spawnPos);
        console.log('🚗 foundVehicle.reset() called');

        this.systems.physics.resetVehicle(foundVehicle.id, spawnPos, spawnPos.rotation);
        console.log('🚗 physics.resetVehicle() called');
    }

    /**
     * Reset all vehicles to their spawn positions
     */
    resetAllVehicles() {
        if (!this.track) return;

        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this.track.getSpawnPosition(index);
            vehicle.reset(spawnPos);
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }
    }

    /**
     * Return to lobby
     * @private
     */
    _returnToLobby() {
        this.systems.race.reset();
        this.engine.setState(GAME_STATES.LOBBY);
    }

    /**
     * Update loop
     * @private
     */
    _onUpdate({ dt, time }) {
        const state = this.engine.getState();

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

        // Sync vehicle meshes from physics
        for (const [playerId, vehicle] of this.vehicles) {
            vehicle.syncMeshFromPhysics();
        }

        // Update race UI
        if (state === GAME_STATES.RACING) {
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
    }

    /**
     * Render loop
     * @private
     */
    _onRender({ dt, interpolation, fps }) {
        // Render system handles actual rendering
        // Update debug overlay visualization each frame
        if (this.ui.debugOverlay?.visible) {
            this.ui.debugOverlay.update();
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
