/**
 * LobbyUI - Manages lobby screen UI
 *
 * Displays:
 * - Room code for players to join
 * - Connected players list
 * - Start game button
 * - Game settings
 *
 * Usage:
 *   const lobby = new LobbyUI({ eventBus, container });
 *   lobby.show();
 */

class LobbyUI {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {HTMLElement} [options.container]
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.container = options.container || document.body;

        // State
        this.visible = false;
        this.roomCode = '';
        this.players = [];
        this.minPlayersToStart = 1;

        // Elements
        this.element = null;
        this.elements = {};

        // Callbacks
        this.onStartGame = null;
    }

    /**
     * Initialize lobby UI
     */
    init() {
        this._createElements();
        this._subscribeToEvents();
    }

    /**
     * Create UI elements
     * @private
     */
    _createElements() {
        // Check if already exists
        let existing = this.container.querySelector('.lobby-ui');
        if (existing) {
            this.element = existing;
            this._bindElements();
            return;
        }

        // Create lobby container
        this.element = document.createElement('div');
        this.element.className = 'lobby-ui';
        this.element.innerHTML = `
            <div class="lobby-content">
                <h1 class="lobby-title">Multiplayer Racer</h1>

                <div class="room-code-section">
                    <p class="room-code-label">Room Code</p>
                    <div class="room-code" id="room-code-display">----</div>
                    <img id="qr-code" class="qr-code hidden" alt="QR Code to join" />
                    <p class="room-code-hint" id="join-url">Share this code with players</p>
                </div>

                <div class="players-section">
                    <h2>Players (<span id="player-count">0</span>)</h2>
                    <ul class="player-list" id="player-list"></ul>
                </div>

                <div class="settings-section">
                    <label>
                        Mode:
                        <select id="mode-select">
                            <option value="race" selected>Race</option>
                            <option value="derby" disabled>Derby (Coming Soon)</option>
                            <option value="fight" disabled>Fight (Coming Soon)</option>
                        </select>
                    </label>
                    <label style="margin-left: 20px;">
                        Laps:
                        <select id="laps-select">
                            <option value="1">1</option>
                            <option value="3" selected>3</option>
                            <option value="5">5</option>
                            <option value="10">10</option>
                        </select>
                    </label>
                </div>

                <button class="start-button" id="start-game-btn" disabled>
                    Waiting for players...
                </button>
            </div>
        `;

        // Add styles
        this._addStyles();

        this.container.appendChild(this.element);
        this._bindElements();
    }

    /**
     * Bind element references
     * @private
     */
    _bindElements() {
        this.elements.roomCode = this.element.querySelector('#room-code-display');
        this.elements.qrCode = this.element.querySelector('#qr-code');
        this.elements.joinUrl = this.element.querySelector('#join-url');
        this.elements.playerCount = this.element.querySelector('#player-count');
        this.elements.playerList = this.element.querySelector('#player-list');
        this.elements.modeSelect = this.element.querySelector('#mode-select');
        this.elements.lapsSelect = this.element.querySelector('#laps-select');
        this.elements.startButton = this.element.querySelector('#start-game-btn');

        // Setup start button handler
        if (this.elements.startButton) {
            this.elements.startButton.addEventListener('click', () => {
                if (this.onStartGame) {
                    const mode = this.elements.modeSelect?.value || 'race';
                    const laps = parseInt(this.elements.lapsSelect?.value || '3', 10);
                    this.onStartGame({ mode, laps });
                }
            });
        }
    }

    /**
     * Add CSS styles
     * @private
     */
    _addStyles() {
        if (document.querySelector('#lobby-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'lobby-ui-styles';
        style.textContent = `
            .lobby-ui {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .lobby-ui.hidden {
                display: none;
            }
            .lobby-content {
                background: rgba(26, 26, 46, 0.85);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 30px 40px;
                text-align: center;
                color: white;
                max-width: 800px;
                width: 95%;
                max-height: 90vh;
                overflow-y: auto;
            }
            .lobby-title {
                font-size: 32px;
                margin: 0 0 30px;
                color: #00d4ff;
            }
            .room-code-section {
                margin-bottom: 30px;
            }
            .room-code-label {
                margin: 0;
                color: #888;
                font-size: 14px;
            }
            .room-code {
                font-size: 48px;
                font-weight: bold;
                letter-spacing: 8px;
                color: #00ff88;
                margin: 10px 0;
                font-family: monospace;
            }
            .room-code-hint {
                margin: 0;
                color: #666;
                font-size: 12px;
            }
            .qr-code {
                width: 150px;
                height: 150px;
                margin: 15px auto;
                border-radius: 10px;
                background: white;
                padding: 5px;
            }
            .qr-code.hidden {
                display: none;
            }
            .players-section {
                margin-bottom: 30px;
            }
            .players-section h2 {
                font-size: 18px;
                margin: 0 0 15px;
                color: #aaa;
            }
            .player-list {
                list-style: none;
                padding: 0;
                margin: 0;
                max-height: 200px;
                overflow-y: auto;
            }
            .player-list li {
                padding: 10px 15px;
                background: #16213e;
                border-radius: 8px;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .player-color {
                width: 20px;
                height: 20px;
                border-radius: 50%;
            }
            .player-name {
                flex: 1;
                text-align: left;
            }
            .settings-section {
                margin-bottom: 30px;
            }
            .settings-section label {
                color: #888;
            }
            .settings-section select {
                background: #16213e;
                color: white;
                border: 1px solid #333;
                padding: 8px 15px;
                border-radius: 5px;
                margin-left: 10px;
            }
            .start-button {
                background: #00ff88;
                color: #1a1a2e;
                border: none;
                padding: 15px 40px;
                font-size: 18px;
                font-weight: bold;
                border-radius: 30px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .start-button:disabled {
                background: #333;
                color: #666;
                cursor: not-allowed;
            }
            .start-button:not(:disabled):hover {
                background: #00cc6a;
                transform: scale(1.05);
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Subscribe to events
     * @private
     */
    _subscribeToEvents() {
        if (!this.eventBus) return;

        this.eventBus.on('network:roomCreated', (data) => {
            this.setRoomCode(data.roomCode);
        });

        this.eventBus.on('network:playerJoined', (player) => {
            this.addPlayer(player);
        });

        this.eventBus.on('network:playerLeft', (data) => {
            this.removePlayer(data.playerId);
        });

        this.eventBus.on('game:lobby', () => {
            this.show();
        });

        this.eventBus.on('game:countdown', () => {
            this.hide();
        });
    }

    /**
     * Set room code
     * @param {string} code
     */
    setRoomCode(code) {
        this.roomCode = code;
        if (this.elements.roomCode) {
            this.elements.roomCode.textContent = code;
        }
        // Update QR code image
        if (this.elements.qrCode && code && code !== '----') {
            this.elements.qrCode.src = `/qrcode/${code}`;
            this.elements.qrCode.classList.remove('hidden');
        }
        // Update join URL
        if (this.elements.joinUrl && code && code !== '----') {
            const joinUrl = `${window.location.origin}/player?room=${code}`;
            this.elements.joinUrl.textContent = joinUrl;
        }
    }

    /**
     * Add player to list
     * @param {Object} player - { id, name, color }
     */
    addPlayer(player) {
        // Avoid duplicates
        if (this.players.find(p => p.id === player.id)) return;

        this.players.push(player);
        this._updatePlayerList();
        this._updateStartButton();
    }

    /**
     * Remove player from list
     * @param {string} playerId
     */
    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
        this._updatePlayerList();
        this._updateStartButton();
    }

    /**
     * Clear all players
     */
    clearPlayers() {
        this.players = [];
        this._updatePlayerList();
        this._updateStartButton();
    }

    /**
     * Update player list display
     * @private
     */
    _updatePlayerList() {
        if (!this.elements.playerList || !this.elements.playerCount) return;

        this.elements.playerCount.textContent = this.players.length.toString();

        this.elements.playerList.innerHTML = this.players.map(player => `
            <li>
                <div class="player-color" style="background: ${player.color || '#888'}"></div>
                <span class="player-name">${player.name || 'Player'}</span>
            </li>
        `).join('');
    }

    /**
     * Update start button state
     * @private
     */
    _updateStartButton() {
        if (!this.elements.startButton) return;

        const canStart = this.players.length >= this.minPlayersToStart;
        this.elements.startButton.disabled = !canStart;
        this.elements.startButton.textContent = canStart
            ? 'Start Race!'
            : `Waiting for players... (${this.players.length}/${this.minPlayersToStart})`;
    }

    /**
     * Show lobby UI
     */
    show() {
        this.visible = true;
        if (this.element) {
            this.element.classList.remove('hidden');
        }
    }

    /**
     * Hide lobby UI
     */
    hide() {
        this.visible = false;
        if (this.element) {
            this.element.classList.add('hidden');
        }
    }

    /**
     * Check if visible
     * @returns {boolean}
     */
    isVisible() {
        return this.visible;
    }

    /**
     * Set start game callback
     * @param {Function} callback
     */
    setOnStartGame(callback) {
        this.onStartGame = callback;
    }

    /**
     * Destroy UI
     */
    destroy() {
        if (this.element) {
            this.element.remove();
        }
        this.players = [];
    }
}

// Export for ES Modules
export { LobbyUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.LobbyUI = LobbyUI;
}
