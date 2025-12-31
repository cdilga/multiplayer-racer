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
        style.textContent = `
            .results-ui {
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
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            .results-ui.hidden {
                display: none;
            }
            .results-content {
                background: #1a1a2e;
                border-radius: 20px;
                padding: 40px;
                text-align: center;
                color: white;
                max-width: 600px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
            }
            .results-title {
                font-size: 36px;
                margin: 0 0 30px;
                color: #00ff88;
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
                background: #16213e;
                padding: 15px 25px;
                border-radius: 10px;
                margin-bottom: 10px;
            }
            .podium-1 { order: 2; }
            .podium-2 { order: 1; }
            .podium-3 { order: 3; }
            .podium-1 .podium-stand {
                height: 100px;
                background: linear-gradient(#ffd700, #b8860b);
            }
            .podium-2 .podium-stand {
                height: 70px;
                background: linear-gradient(#c0c0c0, #808080);
            }
            .podium-3 .podium-stand {
                height: 50px;
                background: linear-gradient(#cd7f32, #8b4513);
            }
            .podium-stand {
                width: 80px;
                border-radius: 5px 5px 0 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 32px;
                font-weight: bold;
                color: white;
                text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            }
            .podium-name {
                font-weight: bold;
                color: white;
            }
            .podium-time {
                font-size: 12px;
                color: #888;
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
                border-bottom: 1px solid #333;
            }
            .results-table th {
                color: #888;
                font-weight: normal;
                font-size: 14px;
            }
            .results-table td {
                font-size: 16px;
            }
            .results-table tr:first-child td {
                color: #ffd700;
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
                border-radius: 30px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-primary {
                background: #00ff88;
                color: #1a1a2e;
            }
            .btn-primary:hover {
                background: #00cc6a;
                transform: scale(1.05);
            }
            .btn-secondary {
                background: #333;
                color: white;
            }
            .btn-secondary:hover {
                background: #444;
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
            this.showResults(data.results);
        });

        this.eventBus.on('game:lobby', () => {
            this.hide();
        });
    }

    /**
     * Show results with data
     * @param {Object[]} results - Array of { position, playerId, finishTime, bestLapTime }
     */
    showResults(results) {
        this.results = results;
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
