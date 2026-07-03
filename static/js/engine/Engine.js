/**
 * Engine - Main game engine orchestrator
 *
 * Coordinates all systems, manages lifecycle, and provides central access point.
 *
 * Usage:
 *   import { Engine } from './engine/Engine.js';
 *
 *   const engine = new Engine();
 *   await engine.init();
 *   engine.start();
 *
 * The Engine:
 *   - Initializes all systems in correct order
 *   - Manages the game loop
 *   - Coordinates state transitions
 *   - Provides access to all systems
 */

import { EventBus, eventBus } from './EventBus.js';
import { GameLoop } from './GameLoop.js';
import { StateMachine, GAME_STATES } from './StateMachine.js';
import { GameRunContext } from './GameRunContext.js';

class Engine {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus] - Custom EventBus instance
     * @param {number} [options.fixedTimestep] - Physics timestep
     * @param {GameRunContext} [options.runContext] - Pre-built run context (else one is created at init)
     * @param {string} [options.buildId] - Build identifier recorded on the run context
     * @param {number} [options.seed] - Deterministic run seed (generated if omitted)
     * @param {boolean} [options.deterministic] - Require an explicit seed (test/replay harness)
     * @param {string} [options.topology] - Room topology (local/remote/mixed)
     * @param {string|null} [options.ruleset] - Game ruleset (race/derby), if known at startup
     * @param {string|null} [options.roomCode]
     * @param {string} [options.tuningProfileId]
     * @param {Object} [options.tuning]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus || eventBus;
        this.fixedTimestep = options.fixedTimestep || 1 / 60;

        // Deterministic run context (seed, clocks, RNG streams). Created during
        // init() so every startup - production or test - records one. May be
        // supplied pre-built via options.runContext.
        this.runContext = options.runContext || null;
        this._runContextOptions = {
            buildId: options.buildId,
            seed: options.seed,
            deterministic: options.deterministic,
            topology: options.topology,
            ruleset: options.ruleset,
            roomCode: options.roomCode,
            tuningProfileId: options.tuningProfileId,
            tuning: options.tuning,
            entropy: options.entropy
        };

        // Core components
        this.gameLoop = null;
        this.stateMachine = null;

        // Registered systems
        this.systems = new Map();

        // Initialization state
        this.initialized = false;

        // Bind methods
        this._onUpdate = this._onUpdate.bind(this);
        this._onRender = this._onRender.bind(this);
    }

    /**
     * Initialize the engine and all systems
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) {
            console.warn('Engine already initialized');
            return;
        }

        console.log('Engine: Initializing...');

        // Establish the deterministic run context first, so systems can read it
        // (clocks, seed, RNG streams) during their own init().
        if (!this.runContext) {
            this.runContext = GameRunContext.create({
                ...this._runContextOptions,
                fixedDt: this.fixedTimestep
            });
        }
        // One-time init log (not per-frame) + event for telemetry/correlation.
        const ctx = this.runContext.describe();
        console.log(
            `Engine: run context build=${ctx.buildId} seed=${ctx.seed} (${ctx.seedSource}) ` +
            `topology=${ctx.topology} ruleset=${ctx.ruleset} tuningHash=${ctx.tuningHash}`
        );
        this.eventBus.emit('engine:runcontext', ctx);

        // Create game loop
        this.gameLoop = new GameLoop({
            fixedTimestep: this.fixedTimestep,
            eventBus: this.eventBus
        });

        // Create state machine with game states
        this.stateMachine = new StateMachine({
            eventBus: this.eventBus,
            states: this._createGameStates()
        });

        // Subscribe to loop events
        this.eventBus.on('loop:update', this._onUpdate);
        this.eventBus.on('loop:render', this._onRender);

        // Initialize all registered systems
        for (const [name, system] of this.systems) {
            // Give every system the deterministic run context before it inits,
            // so gameplay timers/RNG read from SimClock + named streams.
            this._attachRunContext(system);
            if (typeof system.init === 'function') {
                console.log(`Engine: Initializing system '${name}'...`);
                await system.init();
            }
        }

        this.initialized = true;
        this.eventBus.emit('engine:ready');
        console.log('Engine: Ready');
    }

    /**
     * Start the game (enters loading state and starts loop)
     */
    start() {
        if (!this.initialized) {
            console.error('Engine: Not initialized. Call init() first.');
            return;
        }

        this.stateMachine.transition(GAME_STATES.LOADING);
        this.gameLoop.start();
        this.eventBus.emit('engine:start');
    }

    /**
     * Stop the engine
     */
    stop() {
        this.gameLoop.stop();
        this.eventBus.emit('engine:stop');
    }

    /**
     * Pause the game
     */
    pause() {
        this.gameLoop.pause();
        this.stateMachine.transition(GAME_STATES.PAUSED);
    }

    /**
     * Resume the game
     */
    resume() {
        const previousState = this.stateMachine.getPreviousState();
        this.gameLoop.resume();
        if (previousState) {
            this.stateMachine.transition(previousState);
        }
    }

    /**
     * Register a system with the engine
     * @param {string} name - System name
     * @param {Object} system - System instance
     */
    registerSystem(name, system) {
        if (this.systems.has(name)) {
            console.warn(`Engine: System '${name}' already registered`);
            return;
        }

        this.systems.set(name, system);

        // Provide eventBus to system if it has a setEventBus method
        if (typeof system.setEventBus === 'function') {
            system.setEventBus(this.eventBus);
        }

        // Provide the run context (if it already exists) so late-registered
        // systems are also deterministic.
        if (this.runContext) {
            this._attachRunContext(system);
        }

        // If already initialized, init the new system immediately
        if (this.initialized && typeof system.init === 'function') {
            system.init();
        }
    }

    /**
     * Attach the run context to a system, via setRunContext() if present,
     * otherwise by setting a `runContext` field.
     * @param {Object} system
     * @private
     */
    _attachRunContext(system) {
        if (!system || !this.runContext) return;
        if (typeof system.setRunContext === 'function') {
            system.setRunContext(this.runContext);
        } else {
            system.runContext = this.runContext;
        }
    }

    /**
     * Get a registered system by name
     * @param {string} name - System name
     * @returns {Object|undefined}
     */
    getSystem(name) {
        return this.systems.get(name);
    }

    /**
     * Unregister a system
     * @param {string} name - System name
     */
    unregisterSystem(name) {
        const system = this.systems.get(name);
        if (system && typeof system.destroy === 'function') {
            system.destroy();
        }
        this.systems.delete(name);
    }

    /**
     * Get the deterministic run context (seed, clocks, RNG streams).
     * Available after init().
     * @returns {GameRunContext|null}
     */
    getRunContext() {
        return this.runContext;
    }

    /**
     * Get the state machine
     * @returns {StateMachine}
     */
    getStateMachine() {
        return this.stateMachine;
    }

    /**
     * Get current game state
     * @returns {string}
     */
    getState() {
        return this.stateMachine?.getState();
    }

    /**
     * Transition to a new state
     * @param {string} state - Target state
     * @param {Object} [data] - Data to pass
     */
    setState(state, data) {
        this.stateMachine.transition(state, data);
    }

    /**
     * Get FPS
     * @returns {number}
     */
    getFps() {
        return this.gameLoop?.getFps() || 0;
    }

    /**
     * Handle fixed timestep update
     * @private
     */
    _onUpdate({ dt, time }) {
        // Advance the deterministic sim clock exactly one fixed step per fixed
        // update. loop:update fires once per fixed timestep, so sim time tracks
        // ticks regardless of render fps - this is what makes gameplay timers
        // deterministic across 30/60/120 fps.
        if (this.runContext) {
            this.runContext.clock.step(1);
        }

        // Update state machine
        this.stateMachine.update(dt);

        // Update all systems that have an update method
        for (const [name, system] of this.systems) {
            if (typeof system.update === 'function') {
                system.update(dt, time);
            }
        }
    }

    /**
     * Handle render update
     * @private
     */
    _onRender({ dt, interpolation, fps }) {
        // Render all systems that have a render method
        for (const [name, system] of this.systems) {
            if (typeof system.render === 'function') {
                system.render(dt, interpolation);
            }
        }
    }

    /**
     * Create default game state definitions
     * @private
     */
    _createGameStates() {
        const self = this;

        return {
            [GAME_STATES.LOADING]: {
                enter: () => {
                    self.eventBus.emit('game:loading');
                },
                update: (dt) => {
                    // Check if all assets loaded, then transition to lobby
                },
                exit: () => {}
            },

            [GAME_STATES.LOBBY]: {
                enter: () => {
                    self.eventBus.emit('game:lobby');
                },
                update: (dt) => {},
                exit: () => {}
            },

            [GAME_STATES.COUNTDOWN]: {
                enter: (from, data) => {
                    self.eventBus.emit('game:countdown', data);
                },
                update: (dt) => {},
                exit: () => {}
            },

            [GAME_STATES.RACING]: {
                enter: () => {
                    self.eventBus.emit('game:racing');
                },
                update: (dt) => {},
                exit: () => {}
            },

            [GAME_STATES.RESULTS]: {
                enter: (from, data) => {
                    self.eventBus.emit('game:results', data);
                },
                update: (dt) => {},
                exit: () => {}
            },

            [GAME_STATES.PAUSED]: {
                enter: () => {
                    self.eventBus.emit('game:paused');
                },
                update: (dt) => {},
                exit: () => {}
            }
        };
    }

    /**
     * Destroy the engine and cleanup
     */
    destroy() {
        this.stop();

        // Destroy all systems
        for (const [name, system] of this.systems) {
            if (typeof system.destroy === 'function') {
                system.destroy();
            }
        }
        this.systems.clear();

        // Clear event subscriptions
        this.eventBus.off('loop:update', this._onUpdate);
        this.eventBus.off('loop:render', this._onRender);

        this.initialized = false;
        this.eventBus.emit('engine:destroyed');
    }
}

// Export for ES Modules
export { Engine, GAME_STATES };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.Engine = Engine;
}
