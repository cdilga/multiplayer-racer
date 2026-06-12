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
import { DerbySystem } from './systems/DerbySystem.js';
import { WeaponSystem } from './systems/WeaponSystem.js';
import { TrailSystem } from './systems/TrailSystem.js';
import { ParticleSystem } from './systems/ParticleSystem.js';
import { Vehicle } from './entities/Vehicle.js';
import { Track } from './entities/Track.js';
import { LobbyUI } from './ui/LobbyUI.js';
import { RaceUI } from './ui/RaceUI.js';
import { ResultsUI } from './ui/ResultsUI.js';
import { RoomCodeOverlayUI } from './ui/RoomCodeOverlayUI.js';
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
            damage: null,
            derby: null,
            weapons: null,
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
            physicsTuning: null    // F2 - Physics parameter tuning
        };

        // Entities
        this.track = null;
        this.vehicles = new Map();  // playerId -> Vehicle

        // Game state
        this.roomCode = null;
        this.settings = {
            mode: 'race',
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
        this.systems.derby = new DerbySystem({ eventBus: this.eventBus });
        this.systems.weapons = new WeaponSystem({ eventBus: this.eventBus });

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
        });
        this.eventBus.on('damage:respawn', ({ vehicleId }) => {
            this.systems.physics.setVehicleEnabled(vehicleId, true);
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
            }
        });
        this.eventBus.on('weapon:fired', (data) => {
            if (this.systems.network && data.playerId) {
                this.systems.network.sendWeaponFired(data.playerId, {
                    weaponId: data.weaponId
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
            } else {
                this.systems.physics.resume();
                this.engine.gameLoop.resume();
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
                tracks: ['oval', 'derby-bowl', 'derby-arena', 'derby-coliseum']
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
            // Determine spawn position based on game state
            let spawnPos;
            const currentState = this.engine.getState();
            const isRacing = currentState === GAME_STATES.RACING || currentState === GAME_STATES.COUNTDOWN;

            if (isRacing && this.vehicles.size > 0) {
                // Late join: spawn near last place vehicle
                spawnPos = this._getLateJoinSpawnPosition();
                console.log('GameHost: Late join spawn position:', spawnPos);
            } else {
                // Normal join: use track spawn positions
                const spawnIndex = this.vehicles.size;
                spawnPos = this.track.getSpawnPosition(spawnIndex);
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

            // Emit vehicle created event (for TrailSystem and other systems)
            this.eventBus.emit('vehicle:created', { vehicle });

            // Also set as primary target for single-vehicle fallback
            if (this.vehicles.size === 1) {
                this.systems.render.setCameraTarget(vehicle);
            }

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
            return this.track.getSpawnPosition(0);
        }

        // Get last place vehicle
        const lastPlace = positions[positions.length - 1];
        const lastVehicle = this.vehicles.get(lastPlace.playerId);

        if (!lastVehicle || !lastVehicle.mesh) {
            // Fallback if vehicle not found
            return this.track.getSpawnPosition(this.vehicles.size);
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
            this.systems.input.unregisterVehicle(vehicle.id);
            this.systems.race.unregisterVehicle(vehicle.id);
            this.systems.damage.unregisterVehicle(vehicle.id);
            this.systems.weapons.unregisterVehicle(vehicle.id);

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
    async _onStartGame(options) {
        console.log('GameHost: Starting game with options:', options);

        if (options.mode) {
            this.settings.mode = options.mode;
            this.systems.race.setMode(options.mode);
            this.ui.race.setMode(options.mode);
        }

        if (options.laps) {
            this.settings.laps = options.laps;
            this.systems.race.setLaps(options.laps);
        }

        // Resolve which track/arena to load
        const trackId = this._resolveTrackId(options.track);
        this.settings.track = trackId;

        // Procedural tracks regenerate every start; others only when changed
        if (trackId === 'procedural' || this.track?.configId !== trackId) {
            await this._createTrack(trackId);
        }

        // Reset all vehicles to spawn positions
        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this.track.getSpawnPosition(index);
            vehicle.reset(spawnPos);
            vehicle.health = vehicle.maxHealth;
            this.systems.physics.setVehicleEnabled(vehicle.id, true);
            this.systems.physics.resetVehicle(vehicle.id, spawnPos, spawnPos.rotation);
            index++;
        }

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
        return { x: last.position.x, y: 1.5, z: last.position.z, rotation };
    }

    /**
     * Resolve the requested track id, handling mode defaults and random arenas
     * @private
     * @param {string|null} requested - Track id from the lobby (may be 'random')
     * @returns {string} Concrete track id (or 'procedural')
     */
    _resolveTrackId(requested) {
        const DERBY_ARENAS = ['derby-bowl', 'derby-arena', 'derby-coliseum'];

        if (this.settings.mode === 'derby') {
            if (requested === 'random' || !requested || requested === 'oval' || requested === 'procedural') {
                return DERBY_ARENAS[Math.floor(Math.random() * DERBY_ARENAS.length)];
            }
            return requested;
        }

        // Race mode
        if (!requested || requested === 'random' || DERBY_ARENAS.includes(requested)) {
            return 'procedural';
        }
        return requested;
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
            // Reset vehicles for next round
            let index = 0;
            for (const [playerId, vehicle] of this.vehicles) {
                const spawnPos = this.track.getSpawnPosition(index);
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
        // Reset all vehicles
        let index = 0;
        for (const [playerId, vehicle] of this.vehicles) {
            const spawnPos = this.track.getSpawnPosition(index);
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

        const spawnPos = this.track.getSpawnPosition(vehicleIndex);
        foundVehicle.reset(spawnPos);
        this.systems.physics.resetVehicle(foundVehicle.id, spawnPos, spawnPos.rotation);
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
        this.systems.derby.reset();
        this.systems.weapons.clearAll();
        this.systems.damage.setRespawnEnabled(true);

        // Revive any dead vehicles so the next game starts clean
        for (const [playerId, vehicle] of this.vehicles) {
            if (vehicle.isDead) {
                vehicle.reset(vehicle.spawnPosition || { x: 0, y: 1.5, z: 0, rotation: 0 });
                vehicle.health = vehicle.maxHealth;
            }
            this.systems.physics.setVehicleEnabled(vehicle.id, true);
        }

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

        // Sync vehicle meshes from physics and update effects
        for (const [playerId, vehicle] of this.vehicles) {
            vehicle.syncMeshFromPhysics();
            vehicle.updateEffects(dt);
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
                const isAccelerating = (loudest.controls?.acceleration || 0) > 0;
                this.systems.audio.updateEngineSound(
                    loudest.speed || 0,
                    50, // maxSpeed
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
