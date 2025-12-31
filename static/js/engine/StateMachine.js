/**
 * StateMachine - Manages game state transitions
 *
 * Game states: Loading -> Lobby -> Countdown -> Racing -> Results -> Lobby
 *
 * Usage:
 *   import { StateMachine } from './engine/StateMachine.js';
 *   import { eventBus } from './engine/EventBus.js';
 *
 *   const states = {
 *     loading: {
 *       enter: () => showLoadingScreen(),
 *       update: (dt) => checkLoadingProgress(),
 *       exit: () => hideLoadingScreen()
 *     },
 *     lobby: { ... },
 *     racing: { ... }
 *   };
 *
 *   const fsm = new StateMachine({ states, initial: 'loading', eventBus });
 *   fsm.transition('lobby');
 *
 * Events emitted:
 *   - 'state:exit' { from, to } - Before exiting current state
 *   - 'state:enter' { from, to } - After entering new state
 *   - 'state:change' { from, to } - State has changed
 */

class StateMachine {
    /**
     * @param {Object} options
     * @param {Object} options.states - State definitions { stateName: { enter, update, exit } }
     * @param {string} [options.initial] - Initial state name
     * @param {EventBus} [options.eventBus] - EventBus for emitting events
     */
    constructor(options = {}) {
        this.states = options.states || {};
        this.eventBus = options.eventBus || (typeof window !== 'undefined' ? window.eventBus : null);
        this.currentState = null;
        this.previousState = null;
        this.stateData = {};  // Data passed during transitions

        // Enter initial state if provided
        if (options.initial && this.states[options.initial]) {
            this._enterState(options.initial, null);
        }
    }

    /**
     * Get current state name
     * @returns {string|null}
     */
    getState() {
        return this.currentState;
    }

    /**
     * Get previous state name
     * @returns {string|null}
     */
    getPreviousState() {
        return this.previousState;
    }

    /**
     * Get data associated with current state
     * @returns {Object}
     */
    getStateData() {
        return this.stateData;
    }

    /**
     * Check if currently in a specific state
     * @param {string} stateName
     * @returns {boolean}
     */
    is(stateName) {
        return this.currentState === stateName;
    }

    /**
     * Check if transition to state is valid
     * @param {string} to - Target state name
     * @returns {boolean}
     */
    canTransition(to) {
        if (!this.states[to]) {
            return false;
        }

        const currentStateDef = this.states[this.currentState];
        if (currentStateDef && currentStateDef.canExit) {
            return currentStateDef.canExit(to);
        }

        const targetStateDef = this.states[to];
        if (targetStateDef && targetStateDef.canEnter) {
            return targetStateDef.canEnter(this.currentState);
        }

        return true;
    }

    /**
     * Transition to a new state
     * @param {string} to - Target state name
     * @param {Object} [data] - Data to pass to the new state
     * @returns {boolean} True if transition succeeded
     */
    transition(to, data = {}) {
        if (!this.states[to]) {
            console.warn(`StateMachine: Unknown state '${to}'`);
            return false;
        }

        if (this.currentState === to) {
            console.warn(`StateMachine: Already in state '${to}'`);
            return false;
        }

        if (!this.canTransition(to)) {
            console.warn(`StateMachine: Cannot transition from '${this.currentState}' to '${to}'`);
            return false;
        }

        const from = this.currentState;

        // Exit current state
        if (from) {
            this._exitState(from, to);
        }

        // Enter new state
        this._enterState(to, from, data);

        return true;
    }

    /**
     * Update current state
     * @param {number} dt - Delta time
     */
    update(dt) {
        if (!this.currentState) return;

        const stateDef = this.states[this.currentState];
        if (stateDef && typeof stateDef.update === 'function') {
            stateDef.update(dt, this.stateData);
        }
    }

    /**
     * Add or replace a state definition
     * @param {string} name - State name
     * @param {Object} definition - State definition { enter, update, exit, canEnter, canExit }
     */
    addState(name, definition) {
        this.states[name] = definition;
    }

    /**
     * Remove a state definition
     * @param {string} name - State name
     */
    removeState(name) {
        if (this.currentState === name) {
            console.warn(`StateMachine: Cannot remove current state '${name}'`);
            return;
        }
        delete this.states[name];
    }

    /**
     * Exit current state
     * @private
     */
    _exitState(from, to) {
        this._emit('state:exit', { from, to });

        const stateDef = this.states[from];
        if (stateDef && typeof stateDef.exit === 'function') {
            stateDef.exit(to, this.stateData);
        }

        this.previousState = from;
    }

    /**
     * Enter new state
     * @private
     */
    _enterState(to, from, data = {}) {
        this.currentState = to;
        this.stateData = data;

        const stateDef = this.states[to];
        if (stateDef && typeof stateDef.enter === 'function') {
            stateDef.enter(from, data);
        }

        this._emit('state:enter', { from, to, data });
        this._emit('state:change', { from, to, data });
    }

    /**
     * Emit event via EventBus
     * @private
     */
    _emit(event, data) {
        if (this.eventBus) {
            this.eventBus.emit(event, data);
        }
    }

    /**
     * Get all registered state names
     * @returns {string[]}
     */
    getStateNames() {
        return Object.keys(this.states);
    }
}

// Pre-defined game states for racing game
const GAME_STATES = {
    LOADING: 'loading',
    LOBBY: 'lobby',
    COUNTDOWN: 'countdown',
    RACING: 'racing',
    RESULTS: 'results',
    PAUSED: 'paused'
};

// Export for ES Modules
export { StateMachine, GAME_STATES };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.StateMachine = StateMachine;
    window.GAME_STATES = GAME_STATES;
}
