/**
 * ResultsUI - Race results display
 *
 * Displays:
 * - Final positions
 * - Race times
 * - Best lap times
 * - Play again button
 *
 * Usage:
 *   const results = new ResultsUI({ eventBus, container });
 *   results.show(raceResults);
 */

class ResultsUI {
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
        this.results = [];
        this.mode = 'race'; // 'race' or 'derby'

        // Elements
        this.element = null;
        this.elements = {};

        // Callbacks
        this.onPlayAgain = null;
        this.onBackToLobby = null;
    }

    /**
     * Initialize results UI
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
        let existing = this.container.querySelector('.results-ui');
        if (existing) {
            this.element = existing;
            this._bindElements();
            return;
        }

        // Create results container
        this.element = document.createElement('div');
        this.element.className = 'results-ui hidden';
        this.element.innerHTML = `
            <div class="results-content">
                <h1 class="results-title">Race Complete!</h1>

                <div class="results-podium" id="results-podium"></div>

                <div class="results-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Pos</th>
                                <th>Player</th>
                                <th>Time</th>
                                <th>Best Lap</th>
                            </tr>
                        </thead>
                        <tbody id="results-body"></tbody>
                    </table>
                </div>

                <div class="results-actions">
                    <button class="results-btn btn-primary" id="results-play-again">
                        Play Again
                    </button>
                    <button class="results-btn btn-secondary" id="results-lobby">
                        Back to Lobby
                    </button>
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
        this.elements.podium = this.element.querySelector('#results-podium');
        this.elements.tableBody = this.element.querySelector('#results-body');
        this.elements.playAgainBtn = this.element.querySelector('#results-play-again');
        this.elements.lobbyBtn = this.element.querySelector('#results-lobby');

        // Setup button handlers
        if (this.elements.playAgainBtn) {
            this.elements.playAgainBtn.addEventListener('click', () => {
                if (this.onPlayAgain) this.onPlayAgain();
            });
        }

        if (this.elements.lobbyBtn) {
            this.elements.lobbyBtn.addEventListener('click', () => {
                if (this.onBackToLobby) this.onBackToLobby();
            });
        }
    }

    /**
     * Add CSS styles
     * @private
     */
    _addStyles() {
        if (document.querySelector('#results-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'results-ui-styles';
        // Chrome uses the shared design tokens from host.css/landing.css
        // (--bg-base, --bg-panel, --green, --warn, --danger, --text-muted,
        // --border, --font-sans, --radius-*). The only non-shared colors are
        // semantic accents with no token equivalent - podium medal metallics and
        // the derby "fire" accents - centralized as named local tokens below so
        // there are no scattered hardcoded hex in the rules. Falls back to the
        // legacy hex if the shared tokens aren't loaded.
        style.textContent = `
            .results-ui {
                /* semantic accents (no shared-token equivalent) */
                --podium-gold: #ffd700;
                --podium-gold-deep: #b8860b;
                --podium-silver: #c0c0c0;
                --podium-silver-deep: #808080;
                --podium-bronze: #cd7f32;
                --podium-bronze-deep: #8b4513;
                --derby-red: var(--danger, #f44336);
                --derby-orange: #ff8844;
                --derby-dark: #2a0f0f;
                /* neutral surfaces derived from shared tokens */
                --results-btn-secondary: rgba(255, 255, 255, 0.08);
                --results-btn-secondary-hover: rgba(255, 255, 255, 0.16);

                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100;
                font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            }
            .results-ui.hidden {
                display: none;
            }
            .results-content {
                background: var(--bg-base, #1a1a2e);
                border-radius: var(--radius-lg, 20px);
                padding: 40px;
                text-align: center;
                color: var(--text, #ffffff);
                max-width: 600px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
            }
            .results-title {
                font-size: 36px;
                margin: 0 0 30px;
                color: var(--green, #00ff88);
            }
            .results-podium {
                display: flex;
                justify-content: center;
                align-items: flex-end;
                gap: 20px;
                margin-bottom: 30px;
                min-height: 150px;
            }
            .podium-place {
                text-align: center;
            }
            .podium-player {
                background: var(--bg-panel, #16213e);
                padding: 15px 25px;
                border-radius: var(--radius-md, 10px);
                margin-bottom: 10px;
            }
            .podium-1 { order: 2; }
            .podium-2 { order: 1; }
            .podium-3 { order: 3; }
            .podium-1 .podium-stand {
                height: 100px;
                background: linear-gradient(var(--podium-gold), var(--podium-gold-deep));
            }
            .podium-2 .podium-stand {
                height: 70px;
                background: linear-gradient(var(--podium-silver), var(--podium-silver-deep));
            }
            .podium-3 .podium-stand {
                height: 50px;
                background: linear-gradient(var(--podium-bronze), var(--podium-bronze-deep));
            }
            .podium-stand {
                width: 80px;
                border-radius: 5px 5px 0 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 32px;
                font-weight: bold;
                color: var(--text, #ffffff);
                text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            }
            .podium-name {
                font-weight: bold;
                color: var(--text, #ffffff);
            }
            .podium-time {
                font-size: 12px;
                color: var(--text-muted, #8d99ae);
                font-family: monospace;
            }
            .results-table {
                margin-bottom: 30px;
            }
            .results-table table {
                width: 100%;
                border-collapse: collapse;
            }
            .results-table th,
            .results-table td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid var(--border, rgba(76, 201, 240, 0.18));
            }
            .results-table th {
                color: var(--text-muted, #8d99ae);
                font-weight: normal;
                font-size: 14px;
            }
            .results-table td {
                font-size: 16px;
            }
            .results-table tr:first-child td {
                color: var(--warn, #ffd166);
            }
            .results-table .position-cell {
                font-weight: bold;
                width: 50px;
            }
            .results-table .time-cell {
                font-family: monospace;
            }
            .results-actions {
                display: flex;
                gap: 15px;
                justify-content: center;
            }
            .results-btn {
                padding: 15px 30px;
                font-size: 16px;
                font-weight: bold;
                border: none;
                border-radius: var(--radius-full, 30px);
                cursor: pointer;
                transition: all var(--transition, 0.2s);
            }
            .btn-primary {
                background: var(--green, #00ff88);
                color: var(--bg-base, #1a1a2e);
            }
            .btn-primary:hover {
                background: color-mix(in srgb, var(--green, #00ff88) 82%, #000);
                transform: scale(1.05);
            }
            .btn-secondary {
                background: var(--results-btn-secondary);
                color: var(--text, #ffffff);
            }
            .btn-secondary:hover {
                background: var(--results-btn-secondary-hover);
            }

            /* Derby Mode Styles */
            .results-ui.derby-mode .results-content {
                background: linear-gradient(135deg, var(--derby-dark) 0%, var(--bg-base, #1a1a2e) 100%);
                border: 2px solid var(--derby-red);
                box-shadow: 0 0 30px rgba(244, 67, 54, 0.3);
            }
            .results-ui.derby-mode .results-title,
            .derby-title {
                color: var(--derby-red) !important;
                text-shadow: 0 0 20px rgba(244, 67, 54, 0.5);
            }
            .results-ui.derby-mode .btn-primary {
                background: linear-gradient(135deg, var(--derby-red), var(--derby-orange));
                color: var(--text, #ffffff);
            }
            .results-ui.derby-mode .btn-primary:hover {
                background: linear-gradient(135deg,
                    color-mix(in srgb, var(--derby-red) 80%, #fff),
                    color-mix(in srgb, var(--derby-orange) 80%, #fff));
            }
            .results-ui.derby-mode .podium-1 .podium-stand {
                background: linear-gradient(var(--derby-red), color-mix(in srgb, var(--derby-red) 70%, #000));
            }
            .results-ui.derby-mode .podium-2 .podium-stand {
                background: linear-gradient(var(--derby-orange), color-mix(in srgb, var(--derby-orange) 70%, #000));
            }
            .results-ui.derby-mode .podium-3 .podium-stand {
                background: linear-gradient(
                    color-mix(in srgb, var(--derby-orange) 85%, var(--warn, #ffd166)),
                    color-mix(in srgb, var(--derby-orange) 60%, #000));
            }
            .results-ui.derby-mode tr:first-child td {
                color: var(--derby-red);
            }
            .podium-winner .podium-player {
                border: 2px solid var(--derby-red);
                box-shadow: 0 0 15px rgba(244, 67, 54, 0.5);
                animation: winner-pulse 1.5s ease-in-out infinite;
            }
            @keyframes winner-pulse {
                0%, 100% { box-shadow: 0 0 15px rgba(244, 67, 54, 0.5); }
                50% { box-shadow: 0 0 25px rgba(244, 67, 54, 0.8); }
            }
            /* Respect reduced-motion: drop the looping pulse + button scale */
            @media (prefers-reduced-motion: reduce) {
                .podium-winner .podium-player { animation: none; }
                .btn-primary:hover { transform: none; }
                .results-btn { transition: none; }
            }
            .podium-stats {
                display: flex;
                gap: 10px;
                justify-content: center;
                margin-top: 5px;
            }
            .podium-rounds {
                color: var(--derby-orange);
                font-weight: bold;
            }
            .podium-points {
                color: var(--text-muted, #8d99ae);
                font-size: 12px;
            }
            .rounds-cell {
                font-weight: bold;
                color: var(--derby-orange);
            }
            .points-cell {
                font-family: monospace;
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

        this.eventBus.on('race:finished', (data) => {
            this.mode = 'race';
            this.showResults(data.results);
        });

        // Derby match end
        this.eventBus.on('derby:matchEnd', (data) => {
            this.mode = 'derby';
            this.showDerbyResults(data);
        });

        this.eventBus.on('game:lobby', () => {
            this.hide();
        });

        // Hide results when a new race starts (Play Again)
        this.eventBus.on('game:countdown', () => {
            this.hide();
        });
    }

    /**
     * Set the game mode
     * @param {string} mode - 'race' or 'derby'
     */
    setMode(mode) {
        this.mode = mode;
    }

    /**
     * Show results with data
     * @param {Object[]} results - Array of { position, playerId, finishTime, bestLapTime }
     */
    showResults(results) {
        this.results = results;

        // Reset to race mode styling
        if (this.element) {
            this.element.classList.remove('derby-mode');
        }

        // Update title for race
        const title = this.element.querySelector('.results-title');
        if (title) {
            title.textContent = 'Race Complete!';
            title.classList.remove('derby-title');
        }

        // Update table header for race
        const thead = this.element.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = `
                <th>Pos</th>
                <th>Player</th>
                <th>Time</th>
                <th>Best Lap</th>
            `;
        }

        this._renderPodium(results.slice(0, 3));
        this._renderTable(results);
        this.show();
    }

    /**
     * Render podium display
     * @private
     */
    _renderPodium(topThree) {
        if (!this.elements.podium) return;

        this.elements.podium.innerHTML = topThree.map((result, index) => {
            const position = index + 1;
            return `
                <div class="podium-place podium-${position}">
                    <div class="podium-player">
                        <div class="podium-name">${result.playerId || `Player ${position}`}</div>
                        <div class="podium-time">${this._formatTime(result.finishTime)}</div>
                    </div>
                    <div class="podium-stand">${position}</div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render results table
     * @private
     */
    _renderTable(results) {
        if (!this.elements.tableBody) return;

        this.elements.tableBody.innerHTML = results.map((result) => `
            <tr>
                <td class="position-cell">${result.position}</td>
                <td>${result.playerId || `Player ${result.position}`}</td>
                <td class="time-cell">${this._formatTime(result.finishTime)}</td>
                <td class="time-cell">${this._formatTime(result.bestLapTime)}</td>
            </tr>
        `).join('');
    }

    /**
     * Format time
     * @private
     */
    _formatTime(ms) {
        if (!ms) return '-';

        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const millis = Math.floor(ms % 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }

    /**
     * Show Derby results
     * @param {Object} data - Derby match end data { winnerId, standings, roundWins, matchScores }
     */
    showDerbyResults(data) {
        this.results = data.standings || [];

        // Update title for derby
        const title = this.element.querySelector('.results-title');
        if (title) {
            title.textContent = 'Derby Complete!';
            title.classList.add('derby-title');
        }

        // Update table header for derby
        const thead = this.element.querySelector('thead tr');
        if (thead) {
            thead.innerHTML = `
                <th>Pos</th>
                <th>Player</th>
                <th>Rounds</th>
                <th>Points</th>
            `;
        }

        // Apply derby styling
        if (this.element) {
            this.element.classList.add('derby-mode');
        }

        this._renderDerbyPodium(this.results.slice(0, 3), data.winnerId);
        this._renderDerbyTable(this.results);
        this.show();
    }

    /**
     * Render derby podium
     * @private
     */
    _renderDerbyPodium(topThree, winnerId) {
        if (!this.elements.podium) return;

        this.elements.podium.innerHTML = topThree.map((result, index) => {
            const position = index + 1;
            const isWinner = result.playerId === winnerId;
            return `
                <div class="podium-place podium-${position} ${isWinner ? 'podium-winner' : ''}">
                    <div class="podium-player">
                        <div class="podium-name">${result.playerId || `Player ${position}`}</div>
                        <div class="podium-stats">
                            <span class="podium-rounds">${result.roundWins || 0} win${(result.roundWins || 0) !== 1 ? 's' : ''}</span>
                            <span class="podium-points">${result.totalPoints || 0} pts</span>
                        </div>
                    </div>
                    <div class="podium-stand">${position}</div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render derby results table
     * @private
     */
    _renderDerbyTable(standings) {
        if (!this.elements.tableBody) return;

        this.elements.tableBody.innerHTML = standings.map((result) => `
            <tr>
                <td class="position-cell">${result.position}</td>
                <td>${result.playerId || `Player ${result.position}`}</td>
                <td class="rounds-cell">${result.roundWins || 0}</td>
                <td class="points-cell">${result.totalPoints || 0}</td>
            </tr>
        `).join('');
    }

    /**
     * Show results UI
     */
    show() {
        this.visible = true;
        if (this.element) {
            this.element.classList.remove('hidden');
        }
    }

    /**
     * Hide results UI
     */
    hide() {
        this.visible = false;
        if (this.element) {
            this.element.classList.add('hidden');
        }
    }

    /**
     * Set play again callback
     * @param {Function} callback
     */
    setOnPlayAgain(callback) {
        this.onPlayAgain = callback;
    }

    /**
     * Set back to lobby callback
     * @param {Function} callback
     */
    setOnBackToLobby(callback) {
        this.onBackToLobby = callback;
    }

    /**
     * Destroy UI
     */
    destroy() {
        if (this.element) {
            this.element.remove();
        }
    }
}

// Export for ES Modules
export { ResultsUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.ResultsUI = ResultsUI;
}
