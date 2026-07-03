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

import { uiScale } from './UiScaleController.js';
import { ManualVisualSettingsController } from './ManualVisualSettingsController.js';
import { TOPOLOGY, DEFAULT_TOPOLOGY, normalizeTopology } from '../engine/sessionVocabulary.js';
import { normalizeSeed } from '../resources/mapCatalog.js';

// Which lobby track ids are seedable presets (visible seeded generation, j3i.1).
const SEEDABLE_TRACK_IDS = new Set(['procedural', 'random']);

const VISUAL_SETTINGS_STORAGE_KEY = 'visualSettings';
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

// How each room topology is presented in the lobby badge.
const TOPOLOGY_BADGE = {
    [TOPOLOGY.LOCAL]: { icon: '📺', label: 'Local play' },
    [TOPOLOGY.REMOTE]: { icon: '🌍', label: 'Remote play' },
    [TOPOLOGY.MIXED]: { icon: '🔀', label: 'Mixed play' }
};

function safeLobbyColor(value, fallback) {
    const color = typeof value === 'string' ? value.trim() : '';
    return HEX_COLOR_RE.test(color) ? color : fallback;
}

function replaceChildrenSafe(element, children) {
    if (typeof element.replaceChildren === 'function') {
        element.replaceChildren(...children);
        return;
    }
    element.textContent = '';
    children.forEach((child) => element.appendChild(child));
}

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
        this.topology = DEFAULT_TOPOLOGY;
        this.players = [];
        this.minPlayersToStart = 1;

        // Default visual settings
        this.visualSettings = { ...ManualVisualSettingsController.DEFAULT_SETTINGS };
        this.manualVisualSettingsController = null;

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
        uiScale.init();
        this._ensureManualVisualSettingsController();
        this._loadVisualSettingsFromStorage();
        this._createElements();
        this._subscribeToEvents();
    }

    /**
     * Load visual settings from localStorage
     * @private
     */
    _loadVisualSettingsFromStorage() {
        if (this.manualVisualSettingsController) {
            this.visualSettings = this.manualVisualSettingsController.load();
            return;
        }
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
        if (this.manualVisualSettingsController) {
            this.visualSettings = this.manualVisualSettingsController.getSettings();
            return true;
        }
        try {
            localStorage.setItem(VISUAL_SETTINGS_STORAGE_KEY, JSON.stringify(this.visualSettings));
        } catch (e) {
            console.warn('Failed to save visual settings to localStorage:', e);
        }
    }

    /**
     * Create or refresh the manual settings controller against the current host
     * presentation seams. Local phones/controllers never instantiate this UI.
     * @private
     * @returns {ManualVisualSettingsController}
     */
    _ensureManualVisualSettingsController() {
        const game = typeof window !== 'undefined' ? window.game : null;
        const seams = {
            render: game?.systems?.render || null,
            adaptiveQuality: game?.adaptiveQuality || (typeof window !== 'undefined' ? window.__JJ_ADAPTIVE__ : null),
            grainOverlay: typeof window !== 'undefined' ? window.__sbGrainOverlay || null : null
        };

        if (!this.manualVisualSettingsController) {
            this.manualVisualSettingsController = new ManualVisualSettingsController({
                doc: typeof document !== 'undefined' ? document : null,
                render: seams.render,
                adaptiveQuality: seams.adaptiveQuality,
                grainOverlay: seams.grainOverlay
            });
            if (typeof window !== 'undefined') {
                window.__JJ_MANUAL_VISUAL_SETTINGS__ = this.manualVisualSettingsController;
            }
        } else {
            this.manualVisualSettingsController.render = seams.render;
            this.manualVisualSettingsController.adaptiveQuality = seams.adaptiveQuality;
            this.manualVisualSettingsController.grainOverlay = seams.grainOverlay;
        }

        return this.manualVisualSettingsController;
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
                <h1 class="lobby-title">Joystick Jammers</h1>

                <div class="lobby-columns">
                <div class="lobby-col lobby-col-left">
                <div class="room-code-section">
                    <p class="room-code-label">Room Code</p>
                    <div class="topology-badge" id="topology-badge" data-topology="local" title="How players join this room">📺 Local play</div>
                    <div class="room-code" id="room-code-display">----</div>
                    <img id="qr-code" class="qr-code hidden" alt="QR Code to join" />
                    <p class="room-code-hint" id="join-url">Share this code with players</p>
                </div>

                <div class="players-section">
                    <h2>Players (<span id="player-count">0</span>)</h2>
                    <ul class="player-list" id="player-list"></ul>
                    <div class="lobby-banter" id="lobby-banter" aria-live="polite"></div>
                </div>
                </div>

                <div class="lobby-col lobby-col-right">
                <div class="mode-selection-section">
                    <h2 class="mode-selection-title">SELECT MODE</h2>
                    <div class="mode-cards-container">
                        <div class="mode-card selected" data-mode="race">
                            <div class="mode-card-preview">
                                <div class="mode-card-icon">🏁</div>
                            </div>
                            <div class="mode-card-content">
                                <h3 class="mode-card-name">RACE</h3>
                                <p class="mode-card-tagline">"First across the line wins"</p>
                                <div class="mode-card-details">
                                    <span id="race-laps-display">3 laps</span> • Weapons on track
                                </div>
                            </div>
                        </div>
                        <div class="mode-card" data-mode="derby">
                            <div class="mode-card-preview">
                                <div class="mode-card-icon">💥</div>
                            </div>
                            <div class="mode-card-content">
                                <h3 class="mode-card-name">DERBY</h3>
                                <p class="mode-card-tagline">"Last car standing wins"</p>
                                <div class="mode-card-details">
                                    Best of 3 • Full arsenal
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="settings-section race-settings" id="race-settings">
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

                <div class="settings-section" id="track-settings">
                    <label>
                        Track:
                        <select id="track-select"></select>
                    </label>
                    <div class="seed-entry-row" id="seed-entry-row" style="display:none;">
                        <label for="map-seed">
                            Seed:
                            <input type="text" id="map-seed" maxlength="64" placeholder="random"
                                   autocomplete="off" spellcheck="false" />
                        </label>
                        <button type="button" id="seed-randomize" class="seed-randomize-btn" title="New random seed">🎲</button>
                    </div>
                </div>

                <div class="visual-settings-section collapsed">
                    <h3 class="visual-settings-header" id="visual-settings-toggle">
                        Visual Settings <span class="toggle-arrow">▼</span>
                    </h3>
                    <div class="visual-settings-content" id="visual-settings-content">
                        <div class="select-group">
                            <label for="visual-quality-select">Quality</label>
                            <select id="visual-quality-select">
                                <option value="auto">Auto</option>
                                <option value="host-native">Native</option>
                                <option value="host-balanced">Balanced</option>
                                <option value="host-degraded">Degraded</option>
                                <option value="host-fallback">Fallback</option>
                            </select>
                        </div>
                        <div class="slider-group">
                            <label for="resolution-scale-slider">Resolution: <span id="resolution-scale-value">Auto</span></label>
                            <input type="range" id="resolution-scale-slider" min="0.5" max="1" step="0.05" value="1">
                        </div>
                        <div class="toggle-group">
                            <label for="resolution-auto-toggle">
                                <input type="checkbox" id="resolution-auto-toggle" checked>
                                Auto resolution
                            </label>
                        </div>
                        <div class="toggle-group">
                            <label for="reduce-effects-toggle">
                                <input type="checkbox" id="reduce-effects-toggle">
                                Reduce effects
                            </label>
                        </div>
                        <div class="slider-group">
                            <label for="film-grain-slider">Film Grain: <span id="film-grain-value">Auto</span></label>
                            <input type="range" id="film-grain-slider" min="0" max="1" step="0.01" value="0.06">
                        </div>
                        <div class="slider-group">
                            <label for="dither-strength-slider">Dither: <span id="dither-value">Auto</span></label>
                            <input type="range" id="dither-strength-slider" min="0" max="1" step="0.01" value="0.55">
                        </div>
                        <div class="slider-group">
                            <label for="scanline-slider">Scanline: <span id="scanline-value">Auto</span></label>
                            <input type="range" id="scanline-slider" min="0" max="1" step="0.01" value="0.08">
                        </div>
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
                        <div class="presets-group">
                            <label>Presets:</label>
                            <div class="preset-buttons">
                                <button class="preset-button" id="preset-neon-max">Neon Max</button>
                                <button class="preset-button" id="preset-mobile-lite">Mobile Lite</button>
                                <button class="preset-button" id="preset-off">Off</button>
                            </div>
                        </div>
                    </div>
                </div>

                <button class="start-button" id="start-game-btn" disabled>
                    Waiting for players...
                </button>
                </div>
                </div>
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
        this.elements.topologyBadge = this.element.querySelector('#topology-badge');
        this.elements.qrCode = this.element.querySelector('#qr-code');
        this.elements.joinUrl = this.element.querySelector('#join-url');

        // Click-to-copy the join link on the lobby code + QR (br-copy-room-code-flol).
        const copyOnClick = (el) => {
            if (!el) return;
            el.style.cursor = 'pointer';
            el.title = 'Click to copy join link';
            el.addEventListener('click', () => this._copyJoinLink());
        };
        copyOnClick(this.elements.roomCode);
        copyOnClick(this.elements.qrCode);
        // Cmd/Ctrl+C copies the join link in the lobby when nothing else is selected.
        this._boundLobbyCopyKey = (e) => {
            if (!(e.key === 'c' || e.key === 'C') || !(e.metaKey || e.ctrlKey)) return;
            if (!this.roomCode) return;
            const sel = window.getSelection?.();
            if (sel && String(sel).length > 0) return;
            e.preventDefault();
            this._copyJoinLink();
        };
        document.addEventListener('keydown', this._boundLobbyCopyKey);
        this.elements.playerCount = this.element.querySelector('#player-count');
        this.elements.playerList = this.element.querySelector('#player-list');
        this.elements.lobbyBanter = this.element.querySelector('#lobby-banter');
        this.elements.modeCards = this.element.querySelectorAll('.mode-card');
        this.elements.lapsSelect = this.element.querySelector('#laps-select');
        this.elements.trackSelect = this.element.querySelector('#track-select');
        this.elements.seedRow = this.element.querySelector('#seed-entry-row');
        this.elements.seedInput = this.element.querySelector('#map-seed');
        this.elements.seedRandomize = this.element.querySelector('#seed-randomize');
        this.elements.raceSettings = this.element.querySelector('#race-settings');
        this.elements.raceLapsDisplay = this.element.querySelector('#race-laps-display');
        this.elements.startButton = this.element.querySelector('#start-game-btn');

        // Track selected mode
        this.selectedMode = 'race';

        // Visual settings elements
        this.elements.visualSettingsSection = this.element.querySelector('.visual-settings-section');
        this.elements.visualSettingsToggle = this.element.querySelector('#visual-settings-toggle');
        this.elements.visualQualitySelect = this.element.querySelector('#visual-quality-select');
        this.elements.resolutionScaleSlider = this.element.querySelector('#resolution-scale-slider');
        this.elements.resolutionAutoToggle = this.element.querySelector('#resolution-auto-toggle');
        this.elements.resolutionScaleValue = this.element.querySelector('#resolution-scale-value');
        this.elements.reduceEffectsToggle = this.element.querySelector('#reduce-effects-toggle');
        this.elements.filmGrainSlider = this.element.querySelector('#film-grain-slider');
        this.elements.ditherStrengthSlider = this.element.querySelector('#dither-strength-slider');
        this.elements.scanlineSlider = this.element.querySelector('#scanline-slider');
        this.elements.filmGrainValue = this.element.querySelector('#film-grain-value');
        this.elements.ditherValue = this.element.querySelector('#dither-value');
        this.elements.scanlineValue = this.element.querySelector('#scanline-value');
        this.elements.bloomSlider = this.element.querySelector('#bloom-intensity-slider');
        this.elements.fogSlider = this.element.querySelector('#fog-density-slider');
        this.elements.shakeSlider = this.element.querySelector('#camera-shake-slider');
        this.elements.postProcessingToggle = this.element.querySelector('#post-processing-toggle');
        this.elements.bloomValue = this.element.querySelector('#bloom-value');
        this.elements.fogValue = this.element.querySelector('#fog-value');
        this.elements.shakeValue = this.element.querySelector('#shake-value');
        this.elements.presetNeonMax = this.element.querySelector('#preset-neon-max');
        this.elements.presetMobileLite = this.element.querySelector('#preset-mobile-lite');
        this.elements.presetOff = this.element.querySelector('#preset-off');
        // Audio controls
        this.elements.musicVolume = this.element.querySelector('#music-volume');
        this.elements.musicVolumeValue = this.element.querySelector('#music-volume-value');
        this.elements.sfxVolume = this.element.querySelector('#sfx-volume');
        this.elements.sfxVolumeValue = this.element.querySelector('#sfx-volume-value');
        this.elements.muteButton = this.element.querySelector('#mute-button');

        // Setup start button handler
        if (this.elements.startButton) {
            this.elements.startButton.addEventListener('click', () => {
                if (this.onStartGame) {
                    const mode = this.selectedMode || 'race';
                    const laps = parseInt(this.elements.lapsSelect?.value || '3', 10);
                    const track = this.elements.trackSelect?.value || null;
                    this.onStartGame({ mode, laps, track, seed: this._getSelectedSeed() });
                }
            });
        }

        // Seed entry (j3i.1): the seed field appears only for seedable presets,
        // and a randomize button records a fresh visible seed.
        if (this.elements.trackSelect) {
            this.elements.trackSelect.addEventListener('change', () => this._updateSeedVisibility());
        }
        if (this.elements.seedRandomize) {
            this.elements.seedRandomize.addEventListener('click', () => {
                if (this.elements.seedInput) this.elements.seedInput.value = String(this._generateVisibleSeed());
            });
        }

        // Setup mode card selection
        this._setupModeCards();

        // Populate track options for the default mode
        this._updateTrackOptions(this.selectedMode);
        this._updateSeedVisibility();

        // Setup laps select to update display
        if (this.elements.lapsSelect) {
            this.elements.lapsSelect.addEventListener('change', () => {
                this._updateLapsDisplay();
            });
        }

        // Setup audio controls
        this._setupAudioControls();
        this._setupVisualSettingsControls();
    }

    /**
     * Setup audio control handlers
     * @private
     */
    _setupAudioControls() {
        const audioManager = typeof window !== 'undefined' ? window.audioManager : null;
        if (!audioManager) return;

        // Load current values from audioManager
        if (this.elements.musicVolume && audioManager.musicVolume !== undefined) {
            const musicPercent = Math.round(audioManager.musicVolume * 100);
            this.elements.musicVolume.value = musicPercent;
            if (this.elements.musicVolumeValue) {
                this.elements.musicVolumeValue.textContent = `${musicPercent}%`;
            }
        }

        if (this.elements.sfxVolume && audioManager.sfxVolume !== undefined) {
            const sfxPercent = Math.round(audioManager.sfxVolume * 100);
            this.elements.sfxVolume.value = sfxPercent;
            if (this.elements.sfxVolumeValue) {
                this.elements.sfxVolumeValue.textContent = `${sfxPercent}%`;
            }
        }

        // Update mute button state
        if (this.elements.muteButton) {
            this.elements.muteButton.textContent = audioManager.isMuted ? 'Unmute' : 'Mute';
        }

        // Music volume slider
        if (this.elements.musicVolume) {
            this.elements.musicVolume.addEventListener('input', (e) => {
                const value = parseInt(e.target.value, 10);
                if (this.elements.musicVolumeValue) {
                    this.elements.musicVolumeValue.textContent = `${value}%`;
                }
                if (audioManager.setMusicVolume) {
                    audioManager.setMusicVolume(value / 100);
                }
            });
        }

        // SFX volume slider
        if (this.elements.sfxVolume) {
            this.elements.sfxVolume.addEventListener('input', (e) => {
                const value = parseInt(e.target.value, 10);
                if (this.elements.sfxVolumeValue) {
                    this.elements.sfxVolumeValue.textContent = `${value}%`;
                }
                if (audioManager.setSFXVolume) {
                    audioManager.setSFXVolume(value / 100);
                }
            });
        }

        // Mute button
        if (this.elements.muteButton) {
            this.elements.muteButton.addEventListener('click', () => {
                if (audioManager.toggleMute) {
                    const isMuted = audioManager.toggleMute();
                    this.elements.muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
                }
            });
        }
    }

    /**
     * Setup host visual settings controls independently of audio availability.
     * @private
     */
    _setupVisualSettingsControls() {
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
        this._syncVisualControlsFromSettings();
        this._applyVisualSettings();
    }

    _syncVisualControlsFromSettings() {
        const settings = this.visualSettings || {};

        if (this.elements.visualQualitySelect) {
            this.elements.visualQualitySelect.value = settings.visualQualityMode || 'auto';
        }
        if (this.elements.resolutionScaleSlider) {
            this.elements.resolutionScaleSlider.value = String(settings.resolutionScale ?? 1);
        }
        if (this.elements.resolutionAutoToggle) {
            this.elements.resolutionAutoToggle.checked = settings.resolutionScale == null;
        }
        this._updateResolutionScaleLabel(settings.resolutionScale);

        if (this.elements.reduceEffectsToggle) {
            this.elements.reduceEffectsToggle.checked = !!settings.reduceEffects;
        }
        this._setNullableSliderValue('filmGrain', 'filmGrainSlider', 'filmGrainValue', 0.06, 2);
        this._setNullableSliderValue('ditherStrength', 'ditherStrengthSlider', 'ditherValue', 0.55, 2);
        this._setNullableSliderValue('scanline', 'scanlineSlider', 'scanlineValue', 0.08, 2);

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
    }

    _setNullableSliderValue(setting, sliderKey, valueKey, fallback, digits) {
        const value = this.visualSettings[setting];
        if (this.elements[sliderKey]) {
            this.elements[sliderKey].value = String(value ?? fallback);
        }
        if (this.elements[valueKey]) {
            this.elements[valueKey].textContent = value == null ? 'Auto' : Number(value).toFixed(digits);
        }
    }

    _updateResolutionScaleLabel(value) {
        if (this.elements.resolutionScaleValue) {
            this.elements.resolutionScaleValue.textContent =
                value == null ? 'Auto' : `${Math.round(Number(value) * 100)}%`;
        }
    }

    /**
     * Apply all visual settings to the RenderSystem
     * @private
     */
    _applyVisualSettings() {
        const controller = this._ensureManualVisualSettingsController();
        this.visualSettings = controller.update(this.visualSettings);
        return this.visualSettings;
    }

    /**
     * Setup event listeners for visual settings sliders
     * @private
     */
    _setupVisualSettingsListeners() {
        if (this.elements.visualQualitySelect) {
            this.elements.visualQualitySelect.addEventListener('change', (e) => {
                this._updateVisualSetting('visualQualityMode', e.target.value || 'auto');
            });
        }

        if (this.elements.resolutionAutoToggle) {
            this.elements.resolutionAutoToggle.addEventListener('change', (e) => {
                const value = e.target.checked
                    ? null
                    : parseFloat(this.elements.resolutionScaleSlider?.value || '1');
                this._updateResolutionScaleLabel(value);
                this._updateVisualSetting('resolutionScale', value);
            });
        }

        if (this.elements.resolutionScaleSlider) {
            this.elements.resolutionScaleSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.resolutionAutoToggle) {
                    this.elements.resolutionAutoToggle.checked = false;
                }
                this._updateResolutionScaleLabel(value);
                this._updateVisualSetting('resolutionScale', value);
            });
        }

        if (this.elements.reduceEffectsToggle) {
            this.elements.reduceEffectsToggle.addEventListener('change', (e) => {
                this._updateVisualSetting('reduceEffects', !!e.target.checked);
            });
        }

        if (this.elements.filmGrainSlider) {
            this.elements.filmGrainSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.filmGrainValue) {
                    this.elements.filmGrainValue.textContent = value.toFixed(2);
                }
                this._updateVisualSetting('filmGrain', value);
            });
        }

        if (this.elements.ditherStrengthSlider) {
            this.elements.ditherStrengthSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.ditherValue) {
                    this.elements.ditherValue.textContent = value.toFixed(2);
                }
                this._updateVisualSetting('ditherStrength', value);
            });
        }

        if (this.elements.scanlineSlider) {
            this.elements.scanlineSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                if (this.elements.scanlineValue) {
                    this.elements.scanlineValue.textContent = value.toFixed(2);
                }
                this._updateVisualSetting('scanline', value);
            });
        }

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

        // Preset buttons
        if (this.elements.presetNeonMax) {
            this.elements.presetNeonMax.addEventListener('click', () => {
                this._applyPreset('neonMax');
            });
        }
        if (this.elements.presetMobileLite) {
            this.elements.presetMobileLite.addEventListener('click', () => {
                this._applyPreset('mobileLite');
            });
        }
        if (this.elements.presetOff) {
            this.elements.presetOff.addEventListener('click', () => {
                this._applyPreset('off');
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

        const controller = this._ensureManualVisualSettingsController();
        this.visualSettings = controller.update({ [setting]: value });

        // Emit event for other systems
        if (this.eventBus) {
            this.eventBus.emit('visualSettings:changed', { setting, value });
        }
    }

    /**
     * Apply a visual settings preset
     * @private
     * @param {string} presetName - 'neonMax', 'mobileLite', or 'off'
     */
    _applyPreset(presetName) {
        let preset;

        switch (presetName) {
            case 'neonMax':
                // Maximum visual impact - all effects at max
                preset = {
                    visualQualityMode: 'host-native',
                    resolutionScale: 1,
                    reduceEffects: false,
                    filmGrain: 0.2,
                    ditherStrength: 0.7,
                    scanline: 0.16,
                    bloom: 2.0,
                    fog: 0.012,
                    shake: 0.2,
                    postProcessing: true
                };
                break;
            case 'mobileLite':
                // Performance-optimized settings for mobile
                preset = {
                    visualQualityMode: 'host-balanced',
                    resolutionScale: 0.85,
                    reduceEffects: false,
                    filmGrain: 0.05,
                    ditherStrength: 0.42,
                    scanline: 0.04,
                    bloom: 0.8,
                    fog: 0.005,
                    shake: 0.1,
                    postProcessing: true
                };
                break;
            case 'off':
                // Minimal effects for maximum performance
                preset = {
                    visualQualityMode: 'host-fallback',
                    resolutionScale: 0.55,
                    reduceEffects: true,
                    filmGrain: 0,
                    ditherStrength: 0,
                    scanline: 0,
                    bloom: 0,
                    fog: 0,
                    shake: 0,
                    postProcessing: false
                };
                break;
            default:
                console.warn(`Unknown preset: ${presetName}`);
                return;
        }

        // Apply each setting
        this.visualSettings = { ...this.visualSettings, ...preset };

        // Update UI sliders to reflect preset values
        this._syncVisualControlsFromSettings();

        // Apply all settings to render system
        this._applyVisualSettings();

        console.log(`Applied preset: ${presetName}`);
    }

    /**
     * Setup mode card click handlers
     * @private
     */
    _setupModeCards() {
        if (!this.elements.modeCards) return;

        this.elements.modeCards.forEach(card => {
            card.addEventListener('click', () => {
                this._selectMode(card.dataset.mode);
            });
        });
    }

    /**
     * Update the track dropdown to match the selected mode
     * @private
     * @param {string} mode - 'race' or 'derby'
     */
    _updateTrackOptions(mode) {
        if (!this.elements.trackSelect) return;

        const TRACKS = {
            race: [
                { id: 'procedural', name: '✨ Random Circuit' },
                { id: 'oval', name: 'Classic Oval' }
            ],
            derby: [
                { id: 'random', name: '🎲 Random Arena' },
                { id: 'derby-bowl', name: 'The Pit' },
                { id: 'derby-arena', name: 'Iron Cage' },
                { id: 'derby-coliseum', name: 'The Coliseum' }
            ]
        };

        const options = TRACKS[mode] || TRACKS.race;
        // Curated presets first (random/seeded presets lead each list), then the
        // named known maps — the j3i.1 UX rule: presets + seed entry are primary.
        this.elements.trackSelect.innerHTML = options.map(track =>
            `<option value="${track.id}" data-seedable="${SEEDABLE_TRACK_IDS.has(track.id) ? '1' : '0'}">${track.name}</option>`
        ).join('');
        this._updateSeedVisibility();
    }

    /** @returns {string} the full join URL for the current room. */
    joinLink() {
        const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
        return `${origin}/join/${this.roomCode}`;
    }

    /**
     * Copy the join link to the clipboard and flash 'Copied!' feedback in the hint
     * line (br-copy-room-code-flol).
     * @private
     */
    async _copyJoinLink() {
        if (!this.roomCode) return;
        const link = this.joinLink();
        let ok = false;
        try {
            if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(link); ok = true; }
        } catch (_) { ok = false; }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand?.('copy');
                document.body.removeChild(ta); ok = true;
            } catch (_) { ok = false; }
        }
        if (ok && this.elements.joinUrl) {
            this.element?.classList.add('room-copied');
            const hint = this.elements.joinUrl;
            if (this._joinHintOriginal == null) this._joinHintOriginal = hint.textContent;
            hint.textContent = '✓ Copied join link!';
            clearTimeout(this._copyHintTimer);
            this._copyHintTimer = setTimeout(() => {
                hint.textContent = this._joinHintOriginal ?? 'Share this code with players';
                this.element?.classList.remove('room-copied');
            }, 2000);
        }
    }

    /**
     * The seed field is shown only for seedable (random/procedural) presets, so
     * "random" always resolves to a VISIBLE, recorded seed — never an unrecorded
     * Math.random (j3i.1 product rule).
     * @private
     */
    _updateSeedVisibility() {
        if (!this.elements.seedRow) return;
        const seedable = SEEDABLE_TRACK_IDS.has(this.elements.trackSelect?.value);
        this.elements.seedRow.style.display = seedable ? '' : 'none';
    }

    /**
     * The normalized seed the host chose, or null (procedural auto-seeds at start).
     * @private
     * @returns {number|string|null}
     */
    _getSelectedSeed() {
        if (!SEEDABLE_TRACK_IDS.has(this.elements.trackSelect?.value)) return null;
        const raw = (this.elements.seedInput?.value || '').trim();
        if (!raw) return null;
        return normalizeSeed(raw);
    }

    /**
     * A short, human-typeable visible seed (base-36). No gameplay RNG here.
     * @private
     * @returns {string}
     */
    _generateVisibleSeed() {
        const t = (typeof performance !== 'undefined' ? performance.now() : 0);
        return Math.abs(Math.floor(t * 1000) ^ (Date.now() & 0xffff)).toString(36).slice(0, 8);
    }

    /**
     * Select a game mode
     * @private
     * @param {string} mode - 'race' or 'derby'
     */
    _selectMode(mode) {
        this.selectedMode = mode;

        // Refresh track choices for this mode
        this._updateTrackOptions(mode);

        // Update card visual states
        this.elements.modeCards.forEach(card => {
            if (card.dataset.mode === mode) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
        });

        // Show/hide race-specific settings
        if (this.elements.raceSettings) {
            if (mode === 'race') {
                this.elements.raceSettings.style.display = '';
            } else {
                this.elements.raceSettings.style.display = 'none';
            }
        }

        // Update start button text
        this._updateStartButton();

        // Emit event for other components
        if (this.eventBus) {
            this.eventBus.emit('lobby:modeSelected', { mode });
        }
    }

    /**
     * Update the laps display in the race mode card
     * @private
     */
    _updateLapsDisplay() {
        if (this.elements.raceLapsDisplay && this.elements.lapsSelect) {
            const laps = this.elements.lapsSelect.value;
            this.elements.raceLapsDisplay.textContent = `${laps} lap${laps === '1' ? '' : 's'}`;
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
                background:
                    linear-gradient(90deg, rgba(20, 17, 15, 0.9) 0%, rgba(20, 17, 15, 0.68) 34%, rgba(20, 17, 15, 0.12) 66%, rgba(20, 17, 15, 0) 100%);
                display: flex;
                align-items: stretch;
                justify-content: flex-start;
                z-index: 100;
                font-family: var(--font-body, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
                pointer-events: none;
            }
            .lobby-ui.hidden {
                display: none;
            }
            .lobby-content {
                /* --u is the lobby's base unit; every size below is calc(var(--u) * N)
                   so the whole panel scales coherently from one knob. ~16px at 1080p. */
                --u: calc(var(--ui-scale, 1) * clamp(12px, 1.5vmin, 30px));
                background: rgba(42, 38, 32, 0.9);
                backdrop-filter: none;
                -webkit-backdrop-filter: none;
                border-radius: 0 calc(var(--u) * 0.5) calc(var(--u) * 0.5) 0;
                border-right: 3px solid #c9bba0;
                padding: calc(var(--u) * 1.1) calc(var(--u) * 1.9) calc(var(--u) * 1.5);
                text-align: center;
                color: white;
                width: min(48vw, calc(var(--u) * 38));
                min-width: min(92vw, calc(var(--u) * 24));
                height: 100vh;
                max-height: 100vh;
                overflow-y: auto;
                pointer-events: auto;
            }
            .lobby-columns {
                display: flex;
                gap: calc(var(--u) * 1.9);
                justify-content: center;
                align-items: flex-start;
                flex-wrap: wrap;
            }
            .lobby-col {
                min-width: calc(var(--u) * 17);
            }
            .lobby-col-left {
                flex: 0 1 calc(var(--u) * 20);
            }
            .lobby-col-right {
                flex: 1 1 calc(var(--u) * 26);
                max-width: calc(var(--u) * 28);
            }
            .lobby-title {
                font-size: calc(var(--u) * 1.6);
                margin: 0 0 calc(var(--u) * 0.9);
                color: #FFD93D;
            }
            .room-code-section {
                margin-bottom: calc(var(--u) * 1);
            }
            .room-code-label {
                margin: 0;
                color: #c9a887;
                font-size: calc(var(--u) * 0.9);
            }
            .room-code {
                font-size: calc(var(--u) * 2.7);
                font-weight: bold;
                letter-spacing: calc(var(--u) * 0.5);
                color: #FF6B6B;
                margin: calc(var(--u) * 0.4) 0;
                font-family: var(--font-mono, monospace);
            }
            .room-code-hint {
                margin: 0;
                color: #8a6f5a;
                font-size: calc(var(--u) * 0.75);
            }
            .qr-code {
                display: block;
                width: calc(var(--u) * 13);
                height: calc(var(--u) * 13);
                margin: calc(var(--u) * 0.6) auto;
                border-radius: calc(var(--u) * 0.6);
                background: white;
                padding: calc(var(--u) * 0.5);
            }
            .qr-code.hidden {
                display: none;
            }
            .players-section {
                margin-bottom: 10px;
            }
            .players-section h2 {
                font-size: calc(var(--u) * 1);
                margin: 0 0 calc(var(--u) * 0.6);
                color: #c9a887;
            }
            .player-list {
                list-style: none;
                padding: 0;
                margin: 0;
                max-height: calc(var(--u) * 8);
                overflow-y: auto;
            }
            .player-list li {
                padding: calc(var(--u) * 0.45) calc(var(--u) * 0.75);
                background: #3a2015;
                border-radius: calc(var(--u) * 0.5);
                margin-bottom: calc(var(--u) * 0.5);
                display: flex;
                align-items: center;
                gap: calc(var(--u) * 0.6);
                font-size: calc(var(--u) * 0.9);
            }
            .player-color {
                width: calc(var(--u) * 1.25);
                height: calc(var(--u) * 1.25);
                border-radius: 50%;
            }
            .player-name {
                flex: 1;
                text-align: left;
            }
            .lobby-banter {
                display: grid;
                gap: calc(var(--u) * 0.35);
                margin-top: calc(var(--u) * 0.65);
                min-height: calc(var(--u) * 3);
            }
            .banter-line {
                color: #c9bba0;
                background: rgba(20, 17, 15, 0.74);
                border-left: 4px solid var(--banter-color, #ffffff);
                padding: calc(var(--u) * 0.35) calc(var(--u) * 0.5);
                text-align: left;
                font-size: calc(var(--u) * 0.72);
                line-height: 1.2;
                text-transform: uppercase;
            }

            /* Mode Selection Styles */
            .mode-selection-section {
                margin-bottom: 14px;
            }
            .mode-selection-title {
                font-size: calc(var(--u) * 0.9);
                color: #c9a887;
                margin: 0 0 calc(var(--u) * 0.75);
                text-transform: uppercase;
                letter-spacing: calc(var(--u) * 0.12);
            }
            .mode-cards-container {
                display: flex;
                gap: calc(var(--u) * 1);
                justify-content: center;
                flex-wrap: wrap;
            }
            .mode-card {
                --mode-color: #44FF88;
                background: rgba(20, 17, 15, 0.88);
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: calc(var(--u) * 0.45);
                padding: calc(var(--u) * 0.9);
                width: calc(var(--u) * 11.25);
                box-sizing: border-box;
                cursor: pointer;
                opacity: 0.7;
                transform: scale(0.97);
                transition: all 0.3s ease;
            }
            .mode-card[data-mode="race"] {
                --mode-color: #44FF88;
            }
            .mode-card[data-mode="derby"] {
                --mode-color: #FF4444;
            }
            .mode-card:hover {
                opacity: 0.9;
                transform: scale(0.98);
                border-color: var(--mode-color);
                box-shadow: 2px 2px 0 var(--mode-color);
            }
            .mode-card.selected {
                opacity: 1;
                transform: scale(1);
                border: 3px solid var(--mode-color);
                box-shadow: 2px 2px 0 var(--mode-color),
                            inset 2px 2px 0 rgba(255, 255, 255, 0.05);
            }
            .mode-card-preview {
                height: calc(var(--u) * 3.5);
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: calc(var(--u) * 0.6);
                background: rgba(0, 0, 0, 0.3);
                border-radius: calc(var(--u) * 0.6);
            }
            .mode-card-icon {
                font-size: calc(var(--u) * 2.25);
            }
            .mode-card-content {
                text-align: center;
            }
            .mode-card-name {
                font-size: calc(var(--u) * 1.25);
                font-weight: bold;
                margin: 0 0 calc(var(--u) * 0.4);
                color: var(--mode-color);
            }
            .mode-card-tagline {
                font-size: calc(var(--u) * 0.75);
                color: #aaa;
                margin: 0 0 calc(var(--u) * 0.75);
                font-style: italic;
            }
            .mode-card-details {
                font-size: calc(var(--u) * 0.7);
                color: #888;
                padding-top: calc(var(--u) * 0.6);
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }

            /* Race-specific settings */
            .race-settings {
                margin-bottom: 12px;
            }

            .settings-section {
                margin-bottom: 12px;
            }
            .settings-section label {
                color: #c9a887;
                font-size: calc(var(--u) * 0.85);
            }
            .settings-section select {
                background: #3a2015;
                color: white;
                border: 1px solid #4a2510;
                padding: calc(var(--u) * 0.5) calc(var(--u) * 0.9);
                border-radius: calc(var(--u) * 0.3);
                margin-left: calc(var(--u) * 0.6);
                font-size: calc(var(--u) * 0.85);
            }
            .visual-settings-section {
                margin-bottom: 14px;
                background: #3a2015;
                border-radius: 10px;
                overflow: hidden;
            }
            .visual-settings-header {
                margin: 0;
                padding: calc(var(--u) * 0.75) calc(var(--u) * 0.9);
                font-size: calc(var(--u) * 0.85);
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
            .select-group {
                margin-bottom: 15px;
            }
            .select-group label {
                display: flex;
                justify-content: space-between;
                color: #c9a887;
                font-size: 13px;
                margin-bottom: 5px;
            }
            .select-group select {
                width: 100%;
                background: #26150f;
                color: #f5e9d0;
                border: 1px solid #6a3015;
                border-radius: 5px;
                padding: 8px 10px;
                font-size: 13px;
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
            .presets-group {
                margin-top: 20px;
                padding-top: 15px;
                border-top: 1px solid #4a2510;
            }
            .presets-group label {
                display: block;
                color: #c9a887;
                font-size: 13px;
                margin-bottom: 10px;
            }
            .preset-buttons {
                display: flex;
                gap: 10px;
            }
            .preset-button {
                flex: 1;
                background: #4a2510;
                color: #c9a887;
                border: 1px solid #6a3015;
                padding: 8px 12px;
                font-size: 12px;
                border-radius: 5px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .preset-button:hover {
                background: #6a3015;
                color: #fff;
            }
            .preset-button:active {
                transform: scale(0.95);
            }
            .start-button {
                background: #FF6B6B;
                color: #1a0f0a;
                border: none;
                padding: calc(var(--u) * 0.9) calc(var(--u) * 2.5);
                font-size: calc(var(--u) * 1.15);
                font-weight: bold;
                border-radius: calc(var(--u) * 0.45);
                cursor: pointer;
                transition: all 0.2s;
                width: 100%;
                max-width: calc(var(--u) * 25);
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
            .start-button.race-mode:not(:disabled) {
                background: #44FF88;
                color: #0a1a0f;
            }
            .start-button.race-mode:not(:disabled):hover {
                background: #66FFAA;
                box-shadow: 2px 2px 0 #44FF88;
            }
            .start-button.derby-mode:not(:disabled) {
                background: #FF4444;
                color: #1a0f0f;
            }
            .start-button.derby-mode:not(:disabled):hover {
                background: #FF6666;
                box-shadow: 2px 2px 0 #FF4444;
            }
            @media (max-width: 820px) {
                .lobby-ui {
                    background: rgba(20, 17, 15, 0.78);
                    align-items: flex-end;
                }
                .lobby-content {
                    width: 100%;
                    min-width: 0;
                    height: auto;
                    max-height: 58vh;
                    border-right: none;
                    border-top: 3px solid #c9bba0;
                    border-radius: calc(var(--u) * 0.5) calc(var(--u) * 0.5) 0 0;
                }
            }
            .audio-settings-section {
                margin-bottom: 30px;
                padding: 15px;
                background: rgba(22, 33, 62, 0.5);
                border-radius: 10px;
            }
            .audio-settings-section h3 {
                margin: 0 0 15px;
                font-size: 14px;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .audio-controls {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: center;
                gap: 20px;
            }
            .volume-control {
                display: flex;
                align-items: center;
                gap: 10px;
                color: #aaa;
                font-size: 14px;
            }
            .volume-control span:first-child {
                min-width: 40px;
            }
            .volume-control input[type="range"] {
                width: 100px;
                height: 6px;
                -webkit-appearance: none;
                background: #333;
                border-radius: 3px;
                outline: none;
            }
            .volume-control input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px;
                height: 16px;
                background: #00ff88;
                border-radius: 50%;
                cursor: pointer;
            }
            .volume-control input[type="range"]::-moz-range-thumb {
                width: 16px;
                height: 16px;
                background: #00ff88;
                border-radius: 50%;
                cursor: pointer;
                border: none;
            }
            .volume-value {
                min-width: 40px;
                text-align: right;
                color: #00ff88;
                font-family: var(--font-mono, monospace);
            }
            .mute-button {
                background: #333;
                color: #aaa;
                border: 1px solid #444;
                padding: 8px 16px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 12px;
                transition: all 0.2s;
            }
            .mute-button:hover {
                background: #444;
                color: white;
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
            this.setRoomCode(data.roomCode, data.joinUrl);
            // Surface the room's topology (chosen at creation) in the lobby.
            this.setTopology(data.topology);
            // Also set on RoomCodeOverlayUI if available
            if (window.roomCodeOverlay && window.roomCodeOverlay.setRoomCode) {
                window.roomCodeOverlay.setRoomCode(data.roomCode);
            }
        });

        this.eventBus.on('network:playerJoined', (player) => {
            this.addPlayer(player);
        });

        this.eventBus.on('lobby:worldBanter', (snapshot) => {
            this._updateBanter(snapshot?.banter || []);
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
     * Set room code and optional join URL
     * @param {string} code
     * @param {string} [joinUrl] - Server-provided join URL with proper IP
     */
    setRoomCode(code, joinUrl = null) {
        this.roomCode = code;
        if (this.elements.roomCode) {
            this.elements.roomCode.textContent = code;
        }
        // Update QR code image
        if (this.elements.qrCode && code && code !== '----') {
            this.elements.qrCode.src = `/qrcode/${code}`;
            this.elements.qrCode.classList.remove('hidden');
        }
        // Update join URL - use server-provided URL if available
        if (this.elements.joinUrl && code && code !== '----') {
            const displayUrl = joinUrl || `${window.location.origin}/player?room=${code}`;
            this.elements.joinUrl.textContent = displayUrl;
        }
    }

    /**
     * Surface the room topology (local/remote/mixed), fixed at room creation,
     * in the lobby badge. Unknown values coerce to the Local default.
     * @param {string} topology
     */
    setTopology(topology) {
        this.topology = normalizeTopology(topology);
        const badge = this.elements.topologyBadge;
        if (!badge) return;
        const { icon, label } = TOPOLOGY_BADGE[this.topology] || TOPOLOGY_BADGE[DEFAULT_TOPOLOGY];
        badge.dataset.topology = this.topology;
        badge.textContent = `${icon} ${label}`;
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

        const rows = this.players.map((player) => {
            const row = document.createElement('li');
            const color = document.createElement('div');
            color.className = 'player-color';
            color.style.background = safeLobbyColor(player.color, '#888');

            const name = document.createElement('span');
            name.className = 'player-name';
            name.textContent = player.name || 'Player';

            row.appendChild(color);
            row.appendChild(name);
            return row;
        });

        replaceChildrenSafe(this.elements.playerList, rows);
    }

    _updateBanter(banter = []) {
        if (!this.elements.lobbyBanter) return;
        const latest = banter.slice(-3).reverse();
        const rows = latest.map((entry) => {
            const row = document.createElement('div');
            row.className = 'banter-line';
            row.style.setProperty('--banter-color', safeLobbyColor(entry.color, '#ffffff'));
            row.textContent = entry.line || '';
            return row;
        });

        replaceChildrenSafe(this.elements.lobbyBanter, rows);
    }

    /**
     * Update start button state
     * @private
     */
    _updateStartButton() {
        if (!this.elements.startButton) return;

        const canStart = this.players.length >= this.minPlayersToStart;
        this.elements.startButton.disabled = !canStart;

        // Mode-specific button text
        const modeText = this.selectedMode === 'derby' ? 'Start Derby!' : 'Start Race!';
        this.elements.startButton.textContent = canStart
            ? modeText
            : `Waiting for players... (${this.players.length}/${this.minPlayersToStart})`;

        // Mode-specific button color
        if (this.selectedMode === 'derby') {
            this.elements.startButton.classList.add('derby-mode');
            this.elements.startButton.classList.remove('race-mode');
        } else {
            this.elements.startButton.classList.add('race-mode');
            this.elements.startButton.classList.remove('derby-mode');
        }
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
