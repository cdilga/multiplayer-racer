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

import { DEFAULT_TOPOLOGY, normalizeTopology } from '../engine/sessionVocabulary.js';
import { captureSocketConnectError, setTelemetryContextFromPayload } from '../telemetry/index.js';

function resolveSocketTransports(search = '') {
    const params = new URLSearchParams(search || '');
    const socketTransport = (params.get('socketTransport') || '').toLowerCase();

    if (socketTransport === 'polling') {
        return ['polling'];
    }
    if (socketTransport === 'websocket') {
        return ['websocket'];
    }
    if (socketTransport === 'hybrid' || socketTransport === 'upgrade') {
        return ['polling', 'websocket'];
    }

    return params.get('testMode') === '1'
        ? ['polling']
        : ['polling', 'websocket'];
}

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
        // Host capability token + epoch (server-minted). The server rejects
        // host-only events (start_game, vehicle_states, weapon_*, end_game,
        // return_to_lobby, mode_selected, reclaim) unless these accompany them,
        // so we capture them from room_created/room_reclaimed and attach them to
        // every host-only emit. Without this the legitimate host is rejected.
        this.hostToken = null;
        this.hostEpoch = null;
        // Room topology (local/remote/mixed), fixed once the room is created.
        this.topology = DEFAULT_TOPOLOGY;

        // Connected players
        this.players = new Map();  // playerId -> playerData

        // Player controls (received from mobile controllers)
        this.playerControls = new Map();  // playerId -> controls

        // State
        this.initialized = false;
        this.connected = false;
        this._reconnectAttempt = 0;
        this._lastReconnectStartMs = null;
        this._lastConnectivityTelemetryAt = new Map();
    }

    _emitControllerTelemetry(eventName, payload = {}, options = {}) {
        const cooldownMs = Math.max(0, Number(options.cooldownMs || 0));
        const nowMs = Number(options.nowMs || Date.now());
        const key = `network:${eventName}`;
        if (cooldownMs > 0) {
            const lastAt = Number(this._lastConnectivityTelemetryAt.get(key) || 0);
            if (nowMs - lastAt < cooldownMs) {
                return;
            }
        }

        this._lastConnectivityTelemetryAt.set(key, nowMs);
        if (typeof window !== 'undefined' && window.__JJ_TELEMETRY__?.capture) {
            window.__JJ_TELEMETRY__.capture(eventName, {
                topology: this.topology,
                ...payload
            });
        }
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
            this.socket = io({
                transports: resolveSocketTransports(window.location?.search || '')
            });
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
     * Store the server-minted host capability token + epoch from a
     * room_created/room_reclaimed payload (if present).
     * @param {Object} data
     * @private
     */
    _captureHostCredentials(data) {
        if (!data) return;
        if (data.host_token != null) this.hostToken = data.host_token;
        if (data.host_epoch != null) this.hostEpoch = data.host_epoch;
    }

    /**
     * Host-authority fields to attach to every host-only emit. The server's
     * _check_host_authority requires both; sending them lets the legitimate
     * host through and lets the server reject foreign/stale senders.
     * @returns {{host_token: (string|null), host_epoch: (number|null)}}
     * @private
     */
    _hostAuth() {
        return { host_token: this.hostToken, host_epoch: this.hostEpoch };
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
            if (this._reconnectAttempt > 0) {
                const now = Date.now();
                const durationMs = this._lastReconnectStartMs == null
                    ? null
                    : Math.max(0, now - this._lastReconnectStartMs);
                if (typeof window !== 'undefined' && window.__JJ_TELEMETRY__?.capture) {
                    window.__JJ_TELEMETRY__.capture('perf:connectivity:reconnect', {
                        status: 'success',
                        attempt: this._reconnectAttempt,
                        topology: this.topology,
                        topologyClass: this.topology || 'local',
                        durationMs
                    });
                }
                this._reconnectAttempt = 0;
                this._lastReconnectStartMs = null;
                this._emitControllerTelemetry('gameplay:controller:reconnect_succeeded', {
                    attempt: typeof this._reconnectAttempt === 'number' ? this._reconnectAttempt : 0,
                    status: 'success',
                    cause: 'socket_reconnect'
                }, { cooldownMs: 5000 });
            }

            // If we already hosted a room, reclaim it on reconnect. The room
            // may have been dropped server-side (host socket blip or a server
            // recycle on the live deploy), which would make players who scan
            // the still-displayed code hit "room doesn't exist". Reclaiming
            // re-binds (or recreates) the room under the same code.
            if (this.isHost && this.roomCode) {
                // reclaim_room requires the current host token; the server
                // verifies it and rotates it (we adopt the new one via
                // room_reclaimed).
                this.socket.emit('reclaim_room', { room_code: this.roomCode, ...this._hostAuth() });
            }

            this._emitControllerTelemetry('gameplay:controller:connected', {
                mode: 'host_network_connected',
                host: true,
            }, { cooldownMs: 1000 });
        });

        this.socket.on('disconnect', () => {
            this.connected = false;
            this._emit('network:disconnected');
            this._emitControllerTelemetry('gameplay:controller:disconnected', {
                topology: this.topology,
                mode: 'host_network_disconnected',
                cause: 'disconnect'
            }, { cooldownMs: 1000 });
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            this._reconnectAttempt = Number.isFinite(attempt) ? attempt : (this._reconnectAttempt + 1);
            if (this._lastReconnectStartMs == null) {
                this._lastReconnectStartMs = Date.now();
            }
            this._emitControllerTelemetry('gameplay:controller:reconnect_attempted', {
                attempt: this._reconnectAttempt,
                topology: this.topology,
            }, { cooldownMs: 1500 });
            if (typeof window !== 'undefined' && window.__JJ_TELEMETRY__?.capture) {
                window.__JJ_TELEMETRY__.capture('perf:connectivity:reconnect', {
                    status: 'attempt',
                    attempt: this._reconnectAttempt,
                    topology: this.topology
                });
            }
        });

        this.socket.on('reconnect_error', (error) => {
            captureSocketConnectError(error, {
                source: 'NetworkSystem',
                topology: this.topology,
                isHost: this.isHost,
                transport: this.socket?.io?.engine?.transport?.name || 'unknown',
            });
            this._emitControllerTelemetry('gameplay:controller:reconnect_failed', {
                reason: 'reconnect_error',
                attempt: this._reconnectAttempt,
                topology: this.topology
            }, { cooldownMs: 2000 });
            if (typeof window !== 'undefined' && window.__JJ_TELEMETRY__?.capture) {
                window.__JJ_TELEMETRY__.capture('error:network:reconnect', {
                    status: 'failed',
                    topology: this.topology,
                    attempt: this._reconnectAttempt,
                    transport: this.socket?.io?.engine?.transport?.name || 'unknown'
                });
            }
        });

        this.socket.on('connect_error', (error) => {
            captureSocketConnectError(error, {
                source: 'NetworkSystem',
                topology: this.topology,
                isHost: this.isHost,
                transport: this.socket?.io?.engine?.transport?.name || 'unknown',
            });
            this._emit('network:connectError', { connected: false });
        });

        // Room events
        this.socket.on('room_created', (data) => {
            this.roomCode = data.room_code;
            this.isHost = true;
            // Capture the host capability token/epoch so subsequent host-only
            // emits are accepted by the server.
            this._captureHostCredentials(data);
            // Server is authoritative on topology; carry it to lobby consumers.
            this.topology = normalizeTopology(data.topology);
            setTelemetryContextFromPayload(data);
            this._emit('network:roomCreated', {
                roomCode: data.room_code,
                joinUrl: data.join_url,
                topology: this.topology
            });
        });

        // After a reclaim the server ROTATES the token and bumps the epoch;
        // adopt the new credentials or every later host-only emit is rejected.
        this.socket.on('room_reclaimed', (data) => {
            if (data && data.room_code) this.roomCode = data.room_code;
            this.isHost = true;
            this._captureHostCredentials(data);
            this.topology = normalizeTopology(data && data.topology);
            setTelemetryContextFromPayload(data);
            this._emit('network:roomReclaimed', {
                roomCode: this.roomCode,
                topology: this.topology
            });
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

        // Reconnections re-enter the game like a join; GameHost skips
        // vehicle creation if the player's car still exists
        this.socket.on('player_reconnected', (data) => {
            const playerId = data.id || data.player_id;
            const playerData = {
                id: playerId,
                name: data.name || data.player_name || `Player ${playerId}`,
                color: data.car_color || data.color,
                connected: true
            };
            this.players.set(playerId, playerData);
            if (!this.playerControls.has(playerId)) {
                this.playerControls.set(playerId, {
                    steering: 0,
                    acceleration: 0,
                    braking: 0
                });
            }
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

        // Weapon fire event from mobile controller
        this.socket.on('weapon_fire', (data) => {
            const playerId = data.player_id;
            this._emit('weapon:fire', { playerId });
        });

        // Player asked for their stuck car to be reset
        this.socket.on('car_reset_request', (data) => {
            this._emit('network:carResetRequest', { playerId: data.player_id });
        });

        // Game events from server (server sends game_started, not game_start)
        this.socket.on('game_started', (data) => {
            setTelemetryContextFromPayload(data);
            this._emit('network:gameStart', data);
        });

        this.socket.on('game_start', (data) => {
            setTelemetryContextFromPayload(data);
            this._emit('network:gameStart', data);
        });

        this.socket.on('game_end', (data) => {
            setTelemetryContextFromPayload(data);
            this._emit('network:gameEnd', data);
        });

        // Vehicle states from server (forwarded from host)
        this.socket.on('vehicle_states_update', (data) => {
            this._emit('network:vehicleStates', data);
        });
    }

    /**
     * Create a new game room.
     *
     * @param {string} [topology='local'] - Room topology fixed at creation:
     *   'local' (big screen renders, phones are controllers - today's default),
     *   'remote', or 'mixed'. Unknown values coerce to 'local' server-side.
     * @returns {Promise<string>} Room code. The room's server-confirmed
     *   topology is also stored on `this.topology`.
     */
    createRoom(topology = DEFAULT_TOPOLOGY) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected to server'));
                return;
            }

            this.socket.emit('create_room', { topology: normalizeTopology(topology) });

            // Wait for room_created event
            const timeout = setTimeout(() => {
                reject(new Error('Room creation timed out'));
            }, 5000);

            this.socket.once('room_created', (data) => {
                clearTimeout(timeout);
                // Capture host credentials here too: this `once` can fire before
                // the persistent on('room_created') handler, and host-only emits
                // need the token immediately.
                this._captureHostCredentials(data);
                // Server is authoritative on the room's topology.
                this.topology = normalizeTopology(data.topology);
                resolve(data.room_code);
            });
        });
    }

    /**
     * Tell the server the host has returned to the lobby so it resets the
     * room's game state back to 'waiting' - otherwise late joiners are still
     * treated as mid-race joins.
     */
    returnToLobby() {
        if (!this.roomCode) return;
        this.socket.emit('return_to_lobby', { room_code: this.roomCode, ...this._hostAuth() });
    }

    /**
     * Start the game
     * @param {Object} [options] - Game options
     */
    startGame(options = {}) {
        this.socket.emit('start_game', {
            room_code: this.roomCode,
            ...this._hostAuth(),
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
            ...this._hostAuth(),
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
            ...this._hostAuth(),
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
     * Broadcast mode selection to all players in the room
     * @param {string} mode - 'race' or 'derby'
     */
    broadcastModeSelected(mode) {
        this.socket.emit('mode_selected', {
            room_code: this.roomCode,
            ...this._hostAuth(),
            mode
        });
    }

    /**
     * Send weapon pickup notification to a specific player
     * @param {string|number} playerId
     * @param {Object} weaponData - { weaponId, weaponName, icon }
     */
    sendWeaponPickup(playerId, weaponData) {
        this.socket.emit('weapon_pickup', {
            room_code: this.roomCode,
            ...this._hostAuth(),
            player_id: playerId,
            ...weaponData
        });
    }

    /**
     * Send weapon fired notification to a specific player
     * @param {string|number} playerId
     * @param {Object} weaponData - { weaponId }
     */
    sendWeaponFired(playerId, weaponData) {
        this.socket.emit('weapon_fired', {
            room_code: this.roomCode,
            ...this._hostAuth(),
            player_id: playerId,
            ...weaponData
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
