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

class Engine {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus] - Custom EventBus instance
     * @param {number} [options.fixedTimestep] - Physics timestep
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus || eventBus;
        this.fixedTimestep = options.fixedTimestep || 1 / 60;

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

        // If already initialized, init the new system immediately
        if (this.initialized && typeof system.init === 'function') {
            system.init();
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
