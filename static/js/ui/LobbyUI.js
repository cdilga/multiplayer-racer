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

const VISUAL_SETTINGS_STORAGE_KEY = 'visualSettings';

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

        // Default visual settings
        this.visualSettings = {
            bloom: 1.0,
            fog: 0.008,
            shake: 0.15,
            postProcessing: true
        };

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
        this._loadVisualSettingsFromStorage();
        this._createElements();
        this._subscribeToEvents();
    }

    /**
     * Load visual settings from localStorage
     * @private
     */
    _loadVisualSettingsFromStorage() {
        try {
            const stored = localStorage.getItem(VISUAL_SETTINGS_STORAGE_KEY);
            if (stored) {
                const settings = JSON.parse(stored);
                this.visualSettings = { ...this.visualSettings, ...settings };
            }
        } catch (e) {
            console.warn('Failed to load visual settings from localStorage:', e);
        }
    }

    /**
     * Save visual settings to localStorage
     * @private
     */
    _saveVisualSettingsToStorage() {
        try {
            localStorage.setItem(VISUAL_SETTINGS_STORAGE_KEY, JSON.stringify(this.visualSettings));
        } catch (e) {
            console.warn('Failed to save visual settings to localStorage:', e);
        }
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
                        Laps:
                        <select id="laps-select">
                            <option value="1">1</option>
                            <option value="3" selected>3</option>
                            <option value="5">5</option>
                            <option value="10">10</option>
                        </select>
                    </label>
                </div>

                <div class="visual-settings-section">
                    <h3 class="visual-settings-header" id="visual-settings-toggle">
                        Visual Settings <span class="toggle-arrow">▼</span>
                    </h3>
                    <div class="visual-settings-content" id="visual-settings-content">
                        <div class="slider-group">
                            <label for="bloom-intensity-slider">Bloom: <span id="bloom-value">1.0</span></label>
                            <input type="range" id="bloom-intensity-slider" min="0" max="2" step="0.1" value="1">
                        </div>
                        <div class="slider-group">
                            <label for="fog-density-slider">Fog: <span id="fog-value">0.008</span></label>
                            <input type="range" id="fog-density-slider" min="0" max="0.02" step="0.001" value="0.008">
                        </div>
                        <div class="slider-group">
                            <label for="camera-shake-slider">Camera Shake: <span id="shake-value">0.15</span></label>
                            <input type="range" id="camera-shake-slider" min="0" max="0.5" step="0.05" value="0.15">
                        </div>
                        <div class="toggle-group">
                            <label for="post-processing-toggle">
                                <input type="checkbox" id="post-processing-toggle" checked>
                                Post-Processing Effects
                            </label>
                        </div>
                    </div>
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
        this.elements.lapsSelect = this.element.querySelector('#laps-select');
        this.elements.startButton = this.element.querySelector('#start-game-btn');

        // Visual settings elements
        this.elements.visualSettingsSection = this.element.querySelector('.visual-settings-section');
        this.elements.visualSettingsToggle = this.element.querySelector('#visual-settings-toggle');
        this.elements.bloomSlider = this.element.querySelector('#bloom-intensity-slider');
        this.elements.fogSlider = this.element.querySelector('#fog-density-slider');
        this.elements.shakeSlider = this.element.querySelector('#camera-shake-slider');
        this.elements.postProcessingToggle = this.element.querySelector('#post-processing-toggle');
        this.elements.bloomValue = this.element.querySelector('#bloom-value');
        this.elements.fogValue = this.element.querySelector('#fog-value');
        this.elements.shakeValue = this.element.querySelector('#shake-value');

        // Setup start button handler
        if (this.elements.startButton) {
            this.elements.startButton.addEventListener('click', () => {
                if (this.onStartGame) {
                    const laps = parseInt(this.elements.lapsSelect?.value || '3', 10);
                    this.onStartGame({ laps });
                }
            });
        }

        // Setup visual settings toggle (collapse/expand)
        if (this.elements.visualSettingsToggle) {
            this.elements.visualSettingsToggle.addEventListener('click', () => {
                this.elements.visualSettingsSection?.classList.toggle('collapsed');
            });
        }

        // Setup visual settings sliders
        this._setupVisualSettingsListeners();

        // Initialize slider values from loaded settings
        this._initializeSliderValues();
    }

    /**
     * Initialize slider values from loaded settings
     * @private
     */
    _initializeSliderValues() {
        if (this.elements.bloomSlider) {
            this.elements.bloomSlider.value = this.visualSettings.bloom.toString();
            if (this.elements.bloomValue) {
                this.elements.bloomValue.textContent = this.visualSettings.bloom.toFixed(1);
            }
        }
        if (this.elements.fogSlider) {
            this.elements.fogSlider.value = this.visualSettings.fog.toString();
            if (this.elements.fogValue) {
                this.elements.fogValue.textContent = this.visualSettings.fog.toFixed(3);
            }
        }
        if (this.elements.shakeSlider) {
            this.elements.shakeSlider.value = this.visualSettings.shake.toString();
            if (this.elements.shakeValue) {
                this.elements.shakeValue.textContent = this.visualSettings.shake.toFixed(2);
            }
        }
        if (this.elements.postProcessingToggle) {
            this.elements.postProcessingToggle.checked = this.visualSettings.postProcessing;
        }

        // Apply loaded settings to the RenderSystem
        this._applyVisualSettings();
    }

    /**
     * Apply all visual settings to the RenderSystem
     * @private
     */
    _applyVisualSettings() {
        this._updateVisualSetting('bloom', this.visualSettings.bloom);
        this._updateVisualSetting('fog', this.visualSettings.fog);
        this._updateVisualSetting('shake', this.visualSettings.shake);
        this._updateVisualSetting('postProcessing', this.visualSettings.postProcessing);
    }

    /**
     * Setup event listeners for visual settings sliders
     * @private
     */
    _setupVisualSettingsListeners() {
        // Bloom intensity slider
        if (this.elements.bloomSlider) {
            this.elements.bloomSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.bloomValue) {
                    this.elements.bloomValue.textContent = value.toFixed(1);
                }
                this._updateVisualSetting('bloom', value);
            });
        }

        // Fog density slider
        if (this.elements.fogSlider) {
            this.elements.fogSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.fogValue) {
                    this.elements.fogValue.textContent = value.toFixed(3);
                }
                this._updateVisualSetting('fog', value);
            });
        }

        // Camera shake slider
        if (this.elements.shakeSlider) {
            this.elements.shakeSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.shakeValue) {
                    this.elements.shakeValue.textContent = value.toFixed(2);
                }
                this._updateVisualSetting('shake', value);
            });
        }

        // Post-processing toggle
        if (this.elements.postProcessingToggle) {
            this.elements.postProcessingToggle.addEventListener('change', (e) => {
                this._updateVisualSetting('postProcessing', e.target.checked);
            });
        }
    }

    /**
     * Update a visual setting in the RenderSystem
     * @private
     * @param {string} setting - Setting name
     * @param {number|boolean} value - Setting value
     */
    _updateVisualSetting(setting, value) {
        // Update internal state
        this.visualSettings[setting] = value;

        // Save to localStorage
        this._saveVisualSettingsToStorage();

        // Access game through window.game
        const render = window.game?.systems?.render;
        if (!render) return;

        switch (setting) {
            case 'bloom':
                if (render.postProcessing?.passes?.bloom) {
                    render.postProcessing.passes.bloom.strength = value;
                }
                break;
            case 'fog':
                if (render.scene?.fog) {
                    render.scene.fog.density = value;
                }
                break;
            case 'shake':
                if (render.cameraShake) {
                    render.cameraShake.intensity = value;
                }
                break;
            case 'postProcessing':
                if (render.postProcessing) {
                    render.postProcessing.enabled = value;
                }
                break;
        }

        // Emit event for other systems
        if (this.eventBus) {
            this.eventBus.emit('visualSettings:changed', { setting, value });
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
                background: rgba(0, 0, 0, 0.85);
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
                background: #2a1510;
                border-radius: 20px;
                padding: 40px;
                text-align: center;
                color: white;
                max-width: 500px;
                width: 90%;
            }
            .lobby-title {
                font-size: 32px;
                margin: 0 0 30px;
                color: #FFD93D;
            }
            .room-code-section {
                margin-bottom: 30px;
            }
            .room-code-label {
                margin: 0;
                color: #c9a887;
                font-size: 14px;
            }
            .room-code {
                font-size: 48px;
                font-weight: bold;
                letter-spacing: 8px;
                color: #FF6B6B;
                margin: 10px 0;
                font-family: monospace;
            }
            .room-code-hint {
                margin: 0;
                color: #8a6f5a;
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
                color: #c9a887;
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
                background: #3a2015;
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
                color: #c9a887;
            }
            .settings-section select {
                background: #3a2015;
                color: white;
                border: 1px solid #4a2510;
                padding: 8px 15px;
                border-radius: 5px;
                margin-left: 10px;
            }
            .visual-settings-section {
                margin-bottom: 20px;
                background: #3a2015;
                border-radius: 10px;
                overflow: hidden;
            }
            .visual-settings-header {
                margin: 0;
                padding: 12px 15px;
                font-size: 14px;
                color: #c9a887;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background 0.2s;
            }
            .visual-settings-header:hover {
                background: #4a2510;
            }
            .toggle-arrow {
                font-size: 12px;
                transition: transform 0.2s;
            }
            .visual-settings-section.collapsed .toggle-arrow {
                transform: rotate(-90deg);
            }
            .visual-settings-content {
                padding: 15px;
                border-top: 1px solid #4a2510;
            }
            .visual-settings-section.collapsed .visual-settings-content {
                display: none;
            }
            .slider-group {
                margin-bottom: 15px;
            }
            .slider-group label {
                display: flex;
                justify-content: space-between;
                color: #c9a887;
                font-size: 13px;
                margin-bottom: 5px;
            }
            .slider-group input[type="range"] {
                width: 100%;
                height: 6px;
                -webkit-appearance: none;
                background: #4a2510;
                border-radius: 3px;
                outline: none;
            }
            .slider-group input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                background: #FF6B6B;
                border-radius: 50%;
                cursor: pointer;
            }
            .toggle-group {
                margin-top: 15px;
            }
            .toggle-group label {
                display: flex;
                align-items: center;
                gap: 10px;
                color: #c9a887;
                font-size: 13px;
                cursor: pointer;
            }
            .toggle-group input[type="checkbox"] {
                width: 18px;
                height: 18px;
                accent-color: #FF6B6B;
            }
            .start-button {
                background: #FF6B6B;
                color: #1a0f0a;
                border: none;
                padding: 15px 40px;
                font-size: 18px;
                font-weight: bold;
                border-radius: 30px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .start-button:disabled {
                background: #4a2510;
                color: #8a6f5a;
                cursor: not-allowed;
            }
            .start-button:not(:disabled):hover {
                background: #FF8800;
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
