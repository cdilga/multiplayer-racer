/**
 * NetworkSystem - Manages Socket.IO communication
 *
 * Responsibilities:
 * - Connect to game server
 * - Handle room creation/joining
 * - Sync player inputs from mobile controllers
 * - Broadcast game state to players
 *
 * Usage:
 *   const network = new NetworkSystem({ eventBus });
 *   await network.init();
 *   network.createRoom();
 */

class NetworkSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {Object} [options.socket] - Existing Socket.IO instance
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        // Socket.IO instance
        this.socket = options.socket || null;

        // Room state
        this.roomCode = null;
        this.isHost = false;

        // Connected players
        this.players = new Map();  // playerId -> playerData

        // Player controls (received from mobile controllers)
        this.playerControls = new Map();  // playerId -> controls

        // State
        this.initialized = false;
        this.connected = false;
    }

    /**
     * Initialize Socket.IO connection
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        console.log('NetworkSystem: Initializing...');

        // Create socket if not provided
        if (!this.socket) {
            if (typeof io === 'undefined') {
                console.error('NetworkSystem: Socket.IO not loaded');
                return;
            }
            this.socket = io();
        }

        // Setup event handlers
        this._setupSocketHandlers();

        // Wait for connection
        await this._waitForConnection();

        this.initialized = true;
        this._emit('network:ready');
        console.log('NetworkSystem: Ready');
    }

    /**
     * Wait for socket connection
     * @private
     */
    _waitForConnection() {
        return new Promise((resolve) => {
            if (this.socket.connected) {
                this.connected = true;
                resolve();
                return;
            }

            this.socket.once('connect', () => {
                this.connected = true;
                resolve();
            });
        });
    }

    /**
     * Setup Socket.IO event handlers
     * @private
     */
    _setupSocketHandlers() {
        // Connection events
        this.socket.on('connect', () => {
            this.connected = true;
            this._emit('network:connected');
        });

        this.socket.on('disconnect', () => {
            this.connected = false;
            this._emit('network:disconnected');
        });

        // Room events
        this.socket.on('room_created', (data) => {
            this.roomCode = data.room_code;
            this.isHost = true;
            this._emit('network:roomCreated', { roomCode: data.room_code });
        });

        // Player events
        this.socket.on('player_joined', (data) => {
            // Server sends: id, name, car_color
            const playerId = data.id || data.player_id;
            const playerData = {
                id: playerId,
                name: data.name || data.player_name || `Player ${this.players.size + 1}`,
                color: data.car_color || data.color,
                connected: true
            };
            this.players.set(playerId, playerData);
            this.playerControls.set(playerId, {
                steering: 0,
                acceleration: 0,
                braking: 0
            });
            this._emit('network:playerJoined', playerData);
        });

        this.socket.on('player_left', (data) => {
            // Server sends: player_id, player_name
            const playerId = data.player_id || data.id;
            const player = this.players.get(playerId);
            if (player) {
                this.players.delete(playerId);
                this.playerControls.delete(playerId);
                this._emit('network:playerLeft', { playerId: playerId, player });
            }
        });

        // Control input from mobile (server sends player_controls_update)
        this.socket.on('player_controls_update', (data) => {
            const playerId = data.player_id;
            const controls = this.playerControls.get(playerId);
            if (controls) {
                if (data.steering !== undefined) controls.steering = data.steering;
                if (data.acceleration !== undefined) controls.acceleration = data.acceleration;
                if (data.braking !== undefined) controls.braking = data.braking;

                this._emit('network:playerInput', {
                    playerId: playerId,
                    controls: { ...controls }
                });
            }
        });

        // Also listen for player_input for compatibility
        this.socket.on('player_input', (data) => {
            const playerId = data.player_id;
            const controls = this.playerControls.get(playerId);
            if (controls) {
                if (data.steering !== undefined) controls.steering = data.steering;
                if (data.acceleration !== undefined) controls.acceleration = data.acceleration;
                if (data.braking !== undefined) controls.braking = data.braking;

                this._emit('network:playerInput', {
                    playerId: playerId,
                    controls: { ...controls }
                });
            }
        });

        // Game events from server (server sends game_started, not game_start)
        this.socket.on('game_started', (data) => {
            this._emit('network:gameStart', data);
        });

        this.socket.on('game_start', (data) => {
            this._emit('network:gameStart', data);
        });

        this.socket.on('game_end', (data) => {
            this._emit('network:gameEnd', data);
        });
    }

    /**
     * Create a new game room
     * @returns {Promise<string>} Room code
     */
    createRoom() {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            this.socket.emit('create_room');

            // Wait for room_created event
            const timeout = setTimeout(() => {
                reject(new Error('Room creation timed out'));
            }, 5000);

            this.socket.once('room_created', (data) => {
                clearTimeout(timeout);
                resolve(data.room_code);
            });
        });
    }

    /**
     * Start the game
     * @param {Object} [options] - Game options
     */
    startGame(options = {}) {
        this.socket.emit('start_game', {
            room_code: this.roomCode,
            ...options
        });
        this._emit('network:gameStarting');
    }

    /**
     * End the game
     * @param {Object} results - Game results
     */
    endGame(results = {}) {
        this.socket.emit('end_game', {
            room_code: this.roomCode,
            results
        });
    }

    /**
     * Send game state to all players
     * @param {Object} state - Game state to broadcast
     */
    broadcastGameState(state) {
        this.socket.emit('game_state', {
            room_code: this.roomCode,
            state
        });
    }

    /**
     * Send vehicle state updates
     * @param {Object[]} vehicleStates - Array of vehicle states
     */
    broadcastVehicleStates(vehicleStates) {
        this.socket.emit('vehicle_states', {
            room_code: this.roomCode,
            vehicles: vehicleStates
        });
    }

    /**
     * Send countdown update
     * @param {number} count - Countdown number
     */
    sendCountdown(count) {
        this.socket.emit('countdown', {
            room_code: this.roomCode,
            count
        });
    }

    /**
     * Send race position update to a player
     * @param {string} playerId
     * @param {Object} raceData - { position, lap, time }
     */
    sendRaceUpdate(playerId, raceData) {
        this.socket.emit('race_update', {
            player_id: playerId,
            ...raceData
        });
    }

    /**
     * Get controls for a player
     * @param {string} playerId
     * @returns {Object} { steering, acceleration, braking }
     */
    getPlayerControls(playerId) {
        return this.playerControls.get(playerId) || {
            steering: 0,
            acceleration: 0,
            braking: 0
        };
    }

    /**
     * Get all player controls
     * @returns {Map<string, Object>}
     */
    getAllPlayerControls() {
        return new Map(this.playerControls);
    }

    /**
     * Get connected players
     * @returns {Map<string, Object>}
     */
    getPlayers() {
        return new Map(this.players);
    }

    /**
     * Get player count
     * @returns {number}
     */
    getPlayerCount() {
        return this.players.size;
    }

    /**
     * Check if player exists
     * @param {string} playerId
     * @returns {boolean}
     */
    hasPlayer(playerId) {
        return this.players.has(playerId);
    }

    /**
     * Get room code
     * @returns {string|null}
     */
    getRoomCode() {
        return this.roomCode;
    }

    /**
     * Check if connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
        }
        this.connected = false;
        this.roomCode = null;
        this.players.clear();
        this.playerControls.clear();
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
     * Destroy network system
     */
    destroy() {
        this.disconnect();
        this.initialized = false;
    }
}

// Export for ES Modules
export { NetworkSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.NetworkSystem = NetworkSystem;
}
