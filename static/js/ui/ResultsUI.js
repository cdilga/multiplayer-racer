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
        this.timerApi = options.timerApi || (typeof window !== 'undefined' ? window : globalThis);
        this.winMomentDurationMs = Math.min(950, Math.max(0, options.winMomentDurationMs ?? 850));
        this.rematchCountdownEnabled = options.rematchCountdownEnabled !== false;
        this.rematchCountdownDurationMs = Math.max(0, options.rematchCountdownDurationMs ?? 5000);
        this.rematchCountdownTickMs = Math.max(50, options.rematchCountdownTickMs ?? 1000);
        this.derbyStingDurationMs = Math.min(1800, Math.max(300, options.derbyStingDurationMs ?? 1200));

        // State
        this.visible = false;
        this.results = [];
        this.mode = 'race'; // 'race' or 'derby'
        this.winMoment = {
            active: false,
            winnerName: '',
            mode: 'race',
            startedAt: 0,
            durationMs: this.winMomentDurationMs,
            completed: false
        };
        this._winMomentTimer = null;
        this.rematchCountdown = {
            active: false,
            canceled: false,
            completed: false,
            autoStarted: false,
            secondsRemaining: Math.ceil(this.rematchCountdownDurationMs / 1000),
            durationMs: this.rematchCountdownDurationMs
        };
        this._rematchCountdownTimer = null;
        this._rematchCountdownEndsAt = 0;
        this.derbyStandingsSting = {
            active: false,
            completed: false,
            round: null,
            winnerName: '',
            standings: [],
            durationMs: this.derbyStingDurationMs
        };
        this._derbyStandingsStingTimer = null;

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
            this._createDerbyStandingsStingElement();
            this._bindElements();
            return;
        }

        // Create results container
        this.element = document.createElement('div');
        this.element.className = 'results-ui hidden';
        this.element.innerHTML = `
            <div class="results-content">
                <div class="results-chrome-label">Skip Bin Arcade Results</div>
                <h1 class="results-title">Race Complete!</h1>

                <div class="results-win-moment hidden" id="results-win-moment" aria-live="polite">
                    <div class="results-win-kicker">Winner</div>
                    <div class="results-win-name" id="results-win-name">WINNER</div>
                    <div class="results-win-beat">Spotlight locked</div>
                </div>

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

                <div class="results-rematch" id="results-rematch" aria-live="polite">
                    <div class="results-rematch-copy">
                        <span class="results-rematch-kicker">Rematch armed</span>
                        <strong id="results-rematch-count">5</strong>
                        <span id="results-rematch-label">starting again</span>
                    </div>
                    <button class="results-btn btn-secondary" id="results-rematch-cancel" type="button">
                        Cancel
                    </button>
                </div>
            </div>
        `;

        // Add styles
        this._addStyles();

        this.container.appendChild(this.element);
        this._createDerbyStandingsStingElement();
        this._bindElements();
    }

    /**
     * Create the between-round derby sting outside the modal.
     * @private
     */
    _createDerbyStandingsStingElement() {
        let existing = this.container.querySelector('.results-derby-sting');
        if (!existing) {
            existing = document.createElement('div');
            existing.className = 'results-derby-sting hidden';
            existing.setAttribute('aria-live', 'polite');
            existing.innerHTML = `
                <div class="results-derby-sting-card">
                    <div class="results-derby-sting-kicker" id="results-derby-sting-round">Round</div>
                    <div class="results-derby-sting-main">
                        <span class="results-derby-sting-winner" id="results-derby-sting-winner">Winner</span>
                        <span class="results-derby-sting-badge">standings sting</span>
                    </div>
                    <ol class="results-derby-sting-list" id="results-derby-sting-list"></ol>
                </div>
            `;
            this.container.appendChild(existing);
        }
        this.elements.derbySting = existing;
        this.elements.derbyStingRound = existing.querySelector('#results-derby-sting-round');
        this.elements.derbyStingWinner = existing.querySelector('#results-derby-sting-winner');
        this.elements.derbyStingList = existing.querySelector('#results-derby-sting-list');
    }

    /**
     * Bind element references
     * @private
     */
    _bindElements() {
        this.elements.content = this.element.querySelector('.results-content');
        this.elements.winMoment = this.element.querySelector('#results-win-moment');
        this.elements.winName = this.element.querySelector('#results-win-name');
        this.elements.podium = this.element.querySelector('#results-podium');
        this.elements.table = this.element.querySelector('.results-table');
        this.elements.actions = this.element.querySelector('.results-actions');
        this.elements.rematch = this.element.querySelector('#results-rematch');
        this.elements.rematchCount = this.element.querySelector('#results-rematch-count');
        this.elements.rematchLabel = this.element.querySelector('#results-rematch-label');
        this.elements.rematchCancelBtn = this.element.querySelector('#results-rematch-cancel');
        this.elements.tableBody = this.element.querySelector('#results-body');
        this.elements.playAgainBtn = this.element.querySelector('#results-play-again');
        this.elements.lobbyBtn = this.element.querySelector('#results-lobby');
        if (!this.elements.derbySting) {
            this._createDerbyStandingsStingElement();
        }

        // Setup button handlers
        if (this.elements.playAgainBtn) {
            this.elements.playAgainBtn.addEventListener('click', () => {
                this._cancelRematchCountdown('manual-play-again');
                if (this.onPlayAgain) this.onPlayAgain();
            });
        }

        if (this.elements.lobbyBtn) {
            this.elements.lobbyBtn.addEventListener('click', () => {
                this._cancelRematchCountdown('back-to-lobby');
                if (this.onBackToLobby) this.onBackToLobby();
            });
        }

        if (this.elements.rematchCancelBtn) {
            this.elements.rematchCancelBtn.addEventListener('click', () => {
                this.cancelRematchCountdown();
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
                --results-sticker-ink: rgba(5, 8, 12, 0.92);
                --results-crt-line: rgba(255, 255, 255, 0.055);

                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background:
                    radial-gradient(circle at 50% 18%, rgba(0, 255, 136, 0.08), transparent 34%),
                    rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 100;
                font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            }
            .results-ui::after {
                content: "";
                position: absolute;
                inset: 0;
                pointer-events: none;
                background: repeating-linear-gradient(
                    to bottom,
                    transparent 0,
                    transparent 3px,
                    var(--results-crt-line) 4px
                );
                opacity: 0.42;
                mix-blend-mode: screen;
            }
            .results-ui.hidden {
                display: none;
            }
            .results-content {
                position: relative;
                background:
                    linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent 34%),
                    var(--bg-base, #1a1a2e);
                border: 4px solid var(--results-sticker-ink);
                border-radius: var(--radius-md, 8px);
                padding: 26px 32px 22px;
                text-align: center;
                color: var(--text, #ffffff);
                max-width: 640px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow:
                    7px 7px 0 var(--results-sticker-ink),
                    0 0 0 2px var(--warn, #ffd166),
                    0 0 45px rgba(0, 255, 136, 0.12);
                z-index: 1;
            }
            .results-content::before {
                content: "";
                position: absolute;
                inset: 10px;
                border: 1px dashed rgba(255, 210, 102, 0.28);
                pointer-events: none;
            }
            .results-chrome-label {
                display: inline-block;
                margin: 0 0 8px;
                padding: 4px 9px;
                background: var(--warn, #ffd166);
                color: var(--results-sticker-ink);
                border: 3px solid var(--results-sticker-ink);
                box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.8);
                text-transform: uppercase;
                font-size: 12px;
                font-weight: 1000;
            }
            .results-title {
                font-size: 36px;
                margin: 0 0 18px;
                color: var(--green, #00ff88);
                text-transform: uppercase;
                text-shadow:
                    3px 3px 0 var(--results-sticker-ink),
                    -2px 2px 0 var(--danger, #f44336);
            }
            .results-win-moment {
                min-height: 300px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 12px;
                padding: 18px 10px 28px;
                color: var(--text, #ffffff);
                text-transform: uppercase;
                position: relative;
                isolation: isolate;
            }
            .results-win-moment.hidden {
                display: none;
            }
            .results-win-moment::before {
                content: "";
                position: absolute;
                inset: 8% 12%;
                background:
                    radial-gradient(circle at 50% 50%, rgba(255, 210, 62, 0.45), rgba(255, 46, 46, 0.12) 48%, transparent 70%);
                border: 4px solid var(--warn, #ffd166);
                box-shadow:
                    0 0 0 6px rgba(0, 0, 0, 0.75),
                    0 0 42px rgba(255, 210, 62, 0.44);
                transform: skew(-4deg) rotate(-1deg);
                z-index: -1;
            }
            .results-win-kicker {
                color: var(--warn, #ffd166);
                font-size: 18px;
                font-weight: 900;
                letter-spacing: 0;
                text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.88);
            }
            .results-win-name {
                max-width: min(92vw, 560px);
                overflow-wrap: anywhere;
                font-size: clamp(52px, 8vw, 92px);
                line-height: 0.94;
                font-weight: 1000;
                color: var(--green, #00ff88);
                text-shadow:
                    5px 5px 0 rgba(0, 0, 0, 0.92),
                    -2px 2px 0 var(--danger, #f44336);
            }
            .results-win-beat {
                display: inline-block;
                padding: 7px 12px;
                background: var(--danger, #f44336);
                color: var(--text, #ffffff);
                border: 3px solid rgba(0, 0, 0, 0.85);
                box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.82);
                font-size: 15px;
                font-weight: 900;
            }
            .results-ui.win-moment-active .results-title,
            .results-ui.win-moment-active .results-podium,
            .results-ui.win-moment-active .results-table,
            .results-ui.win-moment-active .results-actions {
                display: none;
            }
            .results-ui.win-moment-active .results-content {
                animation: results-shared-slowmo 850ms cubic-bezier(0.18, 0.82, 0.28, 1);
            }
            @keyframes results-shared-slowmo {
                0% { transform: scale(0.96); filter: saturate(1.25) contrast(1.06); }
                58% { transform: scale(1.035); filter: saturate(1.55) contrast(1.16); }
                100% { transform: scale(1); filter: saturate(1) contrast(1); }
            }
            .results-podium {
                display: flex;
                justify-content: center;
                align-items: flex-end;
                gap: 14px;
                margin-bottom: 16px;
                min-height: 126px;
            }
            .podium-place {
                text-align: center;
            }
            .podium-player {
                background: var(--bg-panel, #16213e);
                padding: 9px 20px;
                border: 3px solid var(--results-sticker-ink);
                border-radius: var(--radius-sm, 4px);
                box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.82);
                margin-bottom: 10px;
            }
            .podium-1 { order: 2; }
            .podium-2 { order: 1; }
            .podium-3 { order: 3; }
            .podium-1 .podium-stand {
                height: 84px;
                background: linear-gradient(var(--podium-gold), var(--podium-gold-deep));
            }
            .podium-2 .podium-stand {
                height: 58px;
                background: linear-gradient(var(--podium-silver), var(--podium-silver-deep));
            }
            .podium-3 .podium-stand {
                height: 42px;
                background: linear-gradient(var(--podium-bronze), var(--podium-bronze-deep));
            }
            .podium-stand {
                width: 80px;
                border: 3px solid var(--results-sticker-ink);
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
                font-family: var(--font-mono, monospace);
            }
            .results-table {
                margin-bottom: 16px;
                background: rgba(0, 0, 0, 0.16);
                border: 3px solid var(--results-sticker-ink);
                box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.72);
            }
            .results-table table {
                width: 100%;
                border-collapse: collapse;
            }
            .results-table th,
            .results-table td {
                padding: 9px 12px;
                text-align: left;
                border-bottom: 1px solid var(--border, rgba(76, 201, 240, 0.18));
            }
            .results-table th {
                color: var(--text-muted, #8d99ae);
                font-weight: 900;
                font-size: 13px;
                text-transform: uppercase;
            }
            .results-table td {
                font-size: 16px;
            }
            .results-table tr:first-child td {
                color: var(--warn, #ffd166);
                font-weight: 900;
            }
            .results-table .position-cell {
                font-weight: bold;
                width: 50px;
            }
            .results-table .time-cell {
                font-family: var(--font-mono, monospace);
            }
            .results-actions {
                display: flex;
                gap: 14px;
                justify-content: center;
            }
            .results-rematch {
                margin: 14px auto 0;
                max-width: 520px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 14px;
                padding: 10px 12px;
                background: rgba(255, 210, 62, 0.12);
                border: 3px solid var(--warn, #ffd166);
                box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.78);
                color: var(--text, #ffffff);
            }
            .results-rematch.hidden {
                display: none;
            }
            .results-rematch-copy {
                display: flex;
                align-items: baseline;
                gap: 9px;
                text-align: left;
                text-transform: uppercase;
                font-weight: 900;
                min-width: 0;
            }
            .results-rematch-kicker {
                color: var(--warn, #ffd166);
                font-size: 13px;
                white-space: nowrap;
            }
            #results-rematch-count {
                min-width: 1.5ch;
                color: var(--green, #00ff88);
                font-size: 38px;
                line-height: 1;
                text-shadow: 3px 3px 0 rgba(0, 0, 0, 0.9);
            }
            #results-rematch-label {
                color: var(--text-muted, #8d99ae);
                font-size: 13px;
            }
            .results-rematch.canceled {
                border-color: var(--text-muted, #8d99ae);
                background: rgba(255, 255, 255, 0.07);
            }
            .results-rematch.canceled .results-rematch-copy {
                display: grid;
                grid-template-columns: auto auto auto;
                align-items: baseline;
                column-gap: 8px;
                flex: 1 1 auto;
                overflow: visible;
            }
            .results-rematch.canceled .results-rematch-kicker {
                color: var(--text-muted, #8d99ae);
            }
            .results-rematch.canceled #results-rematch-count {
                color: var(--text-muted, #8d99ae);
                min-width: auto;
                font-size: 24px;
                line-height: 1;
                white-space: nowrap;
            }
            .results-rematch.canceled #results-rematch-label {
                display: none;
                color: var(--text-muted, #8d99ae);
                line-height: 1;
                text-transform: none;
                white-space: nowrap;
                overflow: visible;
                font-size: 12px;
            }
            .results-rematch.canceled #results-rematch-cancel {
                padding: 10px 16px;
                font-size: 14px;
            }
            .results-btn {
                padding: 15px 30px;
                font-size: 16px;
                font-weight: bold;
                border: none;
                border-radius: var(--radius-sm, 6px);
                cursor: pointer;
                transition: all var(--transition, 0.2s);
                box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.72);
                text-transform: uppercase;
            }
            .btn-primary {
                background: var(--green, #00ff88);
                color: var(--bg-base, #1a1a2e);
                border: 3px solid var(--results-sticker-ink);
            }
            .btn-primary:hover {
                background: color-mix(in srgb, var(--green, #00ff88) 82%, #000);
                transform: scale(1.05);
            }
            .btn-secondary {
                background: var(--results-btn-secondary);
                color: var(--text, #ffffff);
                border: 3px solid rgba(255, 255, 255, 0.1);
            }
            .btn-secondary:hover {
                background: var(--results-btn-secondary-hover);
            }

            /* Derby Mode Styles */
            .results-ui.derby-mode .results-content {
                background: linear-gradient(135deg, var(--derby-dark) 0%, var(--bg-base, #1a1a2e) 100%);
                border-color: var(--results-sticker-ink);
                box-shadow:
                    7px 7px 0 var(--results-sticker-ink),
                    0 0 0 2px var(--derby-red),
                    0 0 45px rgba(244, 67, 54, 0.18);
            }
            .results-ui.derby-mode .results-title,
            .derby-title {
                color: var(--derby-red) !important;
                text-shadow: 2px 2px 0 rgba(244, 67, 54, 0.5);
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
                box-shadow: 2px 2px 0 rgba(244, 67, 54, 0.5);
                animation: winner-pulse 1.5s ease-in-out infinite;
            }
            @keyframes winner-pulse {
                0%, 100% { box-shadow: 2px 2px 0 rgba(244, 67, 54, 0.5); }
                50% { box-shadow: 2px 2px 0 rgba(244, 67, 54, 0.8); }
            }
            /* Respect reduced-motion: drop the looping pulse + button scale */
            @media (prefers-reduced-motion: reduce) {
                .podium-winner .podium-player { animation: none; }
                .results-ui.win-moment-active .results-content { animation: none; }
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
                font-family: var(--font-mono, monospace);
            }
            .results-derby-sting {
                --derby-red: var(--danger, #f44336);
                --derby-orange: #ff8844;
                --results-sticker-ink: rgba(5, 8, 12, 0.92);
                position: fixed;
                top: 28px;
                left: 50%;
                transform: translateX(-50%) rotate(-0.8deg);
                width: min(640px, calc(100vw - 44px));
                z-index: 96;
                pointer-events: none;
                font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
                color: var(--text, #ffffff);
            }
            .results-derby-sting.hidden {
                display: none;
            }
            .results-derby-sting-card {
                position: relative;
                overflow: hidden;
                padding: 14px 18px 12px;
                background:
                    repeating-linear-gradient(
                        to bottom,
                        rgba(255, 255, 255, 0.05) 0,
                        rgba(255, 255, 255, 0.05) 1px,
                        transparent 3px,
                        transparent 6px
                    ),
                    linear-gradient(135deg, rgba(244, 67, 54, 0.95), rgba(26, 26, 46, 0.97) 58%, rgba(0, 255, 136, 0.18));
                border: 4px solid var(--results-sticker-ink);
                border-radius: var(--radius-md, 8px);
                box-shadow:
                    6px 6px 0 var(--results-sticker-ink),
                    0 0 0 2px var(--derby-orange),
                    0 0 34px rgba(244, 67, 54, 0.28);
            }
            .results-derby-sting-kicker {
                display: inline-block;
                padding: 4px 8px;
                background: var(--warn, #ffd166);
                color: var(--results-sticker-ink);
                border: 3px solid var(--results-sticker-ink);
                box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.8);
                text-transform: uppercase;
                font-size: 12px;
                font-weight: 1000;
            }
            .results-derby-sting-main {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin: 9px 0 10px;
                text-transform: uppercase;
            }
            .results-derby-sting-winner {
                min-width: 0;
                overflow-wrap: anywhere;
                font-size: 34px;
                line-height: 0.95;
                font-weight: 1000;
                color: var(--green, #00ff88);
                text-shadow:
                    4px 4px 0 rgba(0, 0, 0, 0.9),
                    -2px 2px 0 var(--derby-red);
            }
            .results-derby-sting-badge {
                flex: 0 0 auto;
                padding: 5px 8px;
                background: var(--derby-orange);
                color: var(--results-sticker-ink);
                border: 3px solid var(--results-sticker-ink);
                box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.78);
                font-size: 12px;
                font-weight: 1000;
            }
            .results-derby-sting-list {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 8px;
                margin: 0;
                padding: 0;
                list-style: none;
            }
            .results-derby-sting-row {
                display: grid;
                grid-template-columns: auto minmax(0, 1fr) auto;
                align-items: center;
                gap: 7px;
                min-height: 38px;
                padding: 7px 8px;
                background: rgba(0, 0, 0, 0.34);
                border: 2px solid rgba(255, 255, 255, 0.2);
                box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.62);
            }
            .results-derby-sting-rank {
                color: var(--warn, #ffd166);
                font-weight: 1000;
            }
            .results-derby-sting-name {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-weight: 900;
            }
            .results-derby-sting-points {
                color: var(--text-muted, #8d99ae);
                font-family: var(--font-mono, monospace);
                font-size: 13px;
                font-weight: 900;
                white-space: nowrap;
            }
            @media (max-width: 700px) {
                .results-derby-sting {
                    top: 18px;
                    width: calc(100vw - 24px);
                }
                .results-derby-sting-main {
                    align-items: flex-start;
                    flex-direction: column;
                    gap: 7px;
                }
                .results-derby-sting-list {
                    grid-template-columns: 1fr;
                }
                .results-derby-sting-winner {
                    font-size: 28px;
                }
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
            this._hideDerbyStandingsSting({ completed: true });
            this.showDerbyResults(data);
        });

        this.eventBus.on('derby:roundEnd', (data) => {
            this.showDerbyStandingsSting(data);
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
        this._resetRematchCountdown();
        this._startWinMoment({
            mode: 'race',
            winnerName: this._extractRaceWinnerName(results)
        });
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
        this._resetRematchCountdown();
        this._startWinMoment({
            mode: 'derby',
            winnerName: this._extractDerbyWinnerName(data)
        });
        this.show();
    }

    /**
     * Start the pre-table host-screen win beat.
     * @private
     */
    _startWinMoment({ mode, winnerName }) {
        this._clearWinMomentTimer();
        const safeWinner = this._normalizeWinnerName(winnerName);
        this.winMoment = {
            active: true,
            winnerName: safeWinner,
            mode,
            startedAt: this._nowMs(),
            durationMs: this.winMomentDurationMs,
            completed: false
        };

        if (this.elements.winName) {
            this.elements.winName.textContent = safeWinner;
        }
        if (this.elements.winMoment) {
            this.elements.winMoment.classList.remove('hidden');
        }
        if (this.element) {
            this.element.classList.add('win-moment-active');
            this.element.dataset.winMomentMode = mode;
            this.element.dataset.winMomentDurationMs = String(this.winMomentDurationMs);
        }

        this._winMomentTimer = this.timerApi.setTimeout(() => {
            this._completeWinMoment();
        }, this.winMomentDurationMs);
    }

    /**
     * Finish the win beat and reveal the normal results table.
     * @private
     */
    _completeWinMoment() {
        this._clearWinMomentTimer();
        this.winMoment.active = false;
        this.winMoment.completed = true;
        if (this.elements.winMoment) {
            this.elements.winMoment.classList.add('hidden');
        }
        if (this.element) {
            this.element.classList.remove('win-moment-active');
        }
        this._startRematchCountdown();
    }

    /**
     * @private
     */
    _clearWinMomentTimer() {
        if (this._winMomentTimer !== null && this.timerApi?.clearTimeout) {
            this.timerApi.clearTimeout(this._winMomentTimer);
        }
        this._winMomentTimer = null;
    }

    /**
     * @private
     */
    _extractRaceWinnerName(results) {
        if (!Array.isArray(results) || results.length === 0) return 'WINNER';
        const winner = results.find(result => Number(result.position) === 1) || results[0];
        return winner?.playerName || winner?.displayName || winner?.playerId || 'WINNER';
    }

    /**
     * @private
     */
    _extractDerbyWinnerName(data) {
        const standings = Array.isArray(data?.standings) ? data.standings : [];
        const winner = standings.find(entry => entry.playerId === data?.winnerId) || standings[0];
        return winner?.playerName || winner?.displayName || winner?.playerId || data?.winnerId || 'WINNER';
    }

    /**
     * @private
     */
    _normalizeWinnerName(value) {
        const text = String(value || 'WINNER').trim();
        return text ? text.slice(0, 40) : 'WINNER';
    }

    /**
     * @private
     */
    _nowMs() {
        if (typeof performance !== 'undefined' && performance.now) {
            return performance.now();
        }
        return Date.now();
    }

    /**
     * Expose deterministic state for runtime proof.
     */
    getWinMomentDiagnostics() {
        return {
            visible: this.visible,
            active: this.winMoment.active,
            completed: this.winMoment.completed,
            mode: this.winMoment.mode,
            winnerName: this.winMoment.winnerName,
            durationMs: this.winMoment.durationMs,
            tableHidden: !!this.element?.classList.contains('win-moment-active'),
            winMomentHidden: !!this.elements.winMoment?.classList.contains('hidden')
        };
    }

    /**
     * Start the cancelable auto-rematch countdown after results are visible.
     * @private
     */
    _startRematchCountdown() {
        this._clearRematchCountdownTimer();
        if (!this.rematchCountdownEnabled || this.rematchCountdownDurationMs <= 0) {
            this._hideRematchCountdown();
            return;
        }

        this._rematchCountdownEndsAt = this._nowMs() + this.rematchCountdownDurationMs;
        this.rematchCountdown = {
            active: true,
            canceled: false,
            completed: false,
            autoStarted: false,
            secondsRemaining: Math.ceil(this.rematchCountdownDurationMs / 1000),
            durationMs: this.rematchCountdownDurationMs
        };
        this._renderRematchCountdown();
        this._scheduleRematchCountdownTick();
    }

    /**
     * User-visible cancel affordance for the auto-rematch countdown.
     */
    cancelRematchCountdown() {
        this._cancelRematchCountdown('cancel-button');
    }

    /**
     * @private
     */
    _cancelRematchCountdown(reason = 'cancel') {
        this._clearRematchCountdownTimer();
        if (!this.rematchCountdown.active && this.rematchCountdown.canceled) return;
        this.rematchCountdown.active = false;
        this.rematchCountdown.canceled = true;
        this.rematchCountdown.completed = false;
        this.rematchCountdown.cancelReason = reason;
        this._renderRematchCountdown();
    }

    /**
     * @private
     */
    _scheduleRematchCountdownTick() {
        this._rematchCountdownTimer = this.timerApi.setTimeout(() => {
            this._tickRematchCountdown();
        }, this.rematchCountdownTickMs);
    }

    /**
     * @private
     */
    _tickRematchCountdown() {
        this._clearRematchCountdownTimer();
        if (!this.rematchCountdown.active || this.rematchCountdown.canceled) return;

        const remainingMs = Math.max(0, this._rematchCountdownEndsAt - this._nowMs());
        this.rematchCountdown.secondsRemaining = Math.ceil(remainingMs / 1000);
        this._renderRematchCountdown();

        if (remainingMs <= 0) {
            this._completeRematchCountdown();
            return;
        }

        this._scheduleRematchCountdownTick();
    }

    /**
     * @private
     */
    _completeRematchCountdown() {
        this._clearRematchCountdownTimer();
        if (!this.rematchCountdown.active || this.rematchCountdown.canceled) return;

        this.rematchCountdown.active = false;
        this.rematchCountdown.completed = true;
        this.rematchCountdown.autoStarted = true;
        this._hideRematchCountdown();

        if (this.onPlayAgain) {
            this.onPlayAgain();
        }
    }

    /**
     * @private
     */
    _resetRematchCountdown() {
        this._clearRematchCountdownTimer();
        this.rematchCountdown = {
            active: false,
            canceled: false,
            completed: false,
            autoStarted: false,
            secondsRemaining: Math.ceil(this.rematchCountdownDurationMs / 1000),
            durationMs: this.rematchCountdownDurationMs
        };
        this._hideRematchCountdown();
    }

    /**
     * @private
     */
    _clearRematchCountdownTimer() {
        if (this._rematchCountdownTimer !== null && this.timerApi?.clearTimeout) {
            this.timerApi.clearTimeout(this._rematchCountdownTimer);
        }
        this._rematchCountdownTimer = null;
    }

    /**
     * @private
     */
    _renderRematchCountdown() {
        if (!this.elements.rematch) return;

        this.elements.rematch.classList.remove('hidden');
        this.elements.rematch.classList.toggle('canceled', !!this.rematchCountdown.canceled);

        if (this.elements.rematchCount) {
            this.elements.rematchCount.textContent = this.rematchCountdown.canceled
                ? 'Canceled'
                : String(Math.max(0, this.rematchCountdown.secondsRemaining));
        }
        if (this.elements.rematchLabel) {
            this.elements.rematchLabel.textContent = this.rematchCountdown.canceled
                ? ''
                : 'starting again';
        }
        const kicker = this.elements.rematch?.querySelector?.('.results-rematch-kicker');
        if (kicker) {
            kicker.textContent = this.rematchCountdown.canceled ? 'Rematch canceled' : 'Rematch armed';
        }
        if (this.elements.rematchCancelBtn) {
            this.elements.rematchCancelBtn.disabled = !!this.rematchCountdown.canceled;
            this.elements.rematchCancelBtn.textContent = this.rematchCountdown.canceled ? 'Canceled' : 'Cancel';
        }
    }

    /**
     * @private
     */
    _hideRematchCountdown() {
        if (this.elements.rematch) {
            this.elements.rematch.classList.add('hidden');
            this.elements.rematch.classList.remove('canceled');
        }
        if (this.elements.rematchCancelBtn) {
            this.elements.rematchCancelBtn.disabled = false;
            this.elements.rematchCancelBtn.textContent = 'Cancel';
        }
    }

    /**
     * Expose deterministic state for runtime proof.
     */
    getRematchCountdownDiagnostics() {
        return {
            active: this.rematchCountdown.active,
            canceled: this.rematchCountdown.canceled,
            completed: this.rematchCountdown.completed,
            autoStarted: this.rematchCountdown.autoStarted,
            secondsRemaining: this.rematchCountdown.secondsRemaining,
            durationMs: this.rematchCountdown.durationMs,
            cancelReason: this.rematchCountdown.cancelReason || null,
            hidden: !!this.elements.rematch?.classList.contains('hidden'),
            label: this.elements.rematchLabel?.textContent || '',
            countText: this.elements.rematchCount?.textContent || ''
        };
    }

    /**
     * Show a quick between-round derby standings sting without opening the results modal.
     * @param {Object} data - Round-end payload with round, winnerId, scores, or standings
     */
    showDerbyStandingsSting(data = {}) {
        this._clearDerbyStandingsStingTimer();
        const standings = this._extractDerbyStingStandings(data);
        const winnerName = this._normalizeWinnerName(
            data.winnerName ||
            data.displayName ||
            data.winnerId ||
            standings[0]?.playerId ||
            'Round Complete'
        );

        this.derbyStandingsSting = {
            active: true,
            completed: false,
            round: Number.isFinite(Number(data.round)) ? Number(data.round) : null,
            winnerName,
            standings,
            durationMs: this.derbyStingDurationMs
        };

        this._renderDerbyStandingsSting();
        if (this.elements.derbySting) {
            this.elements.derbySting.classList.remove('hidden');
            this.elements.derbySting.dataset.durationMs = String(this.derbyStingDurationMs);
            this.elements.derbySting.dataset.round = this.derbyStandingsSting.round ?? '';
        }

        this._derbyStandingsStingTimer = this.timerApi.setTimeout(() => {
            this._hideDerbyStandingsSting({ completed: true });
        }, this.derbyStingDurationMs);
    }

    /**
     * @private
     */
    _renderDerbyStandingsSting() {
        if (this.elements.derbyStingRound) {
            this.elements.derbyStingRound.textContent = this.derbyStandingsSting.round
                ? `Round ${this.derbyStandingsSting.round}`
                : 'Round complete';
        }
        if (this.elements.derbyStingWinner) {
            this.elements.derbyStingWinner.textContent = `${this.derbyStandingsSting.winnerName} wins`;
        }
        if (!this.elements.derbyStingList) return;

        this.elements.derbyStingList.innerHTML = '';
        this.derbyStandingsSting.standings.slice(0, 3).forEach((entry, index) => {
            const row = document.createElement('li');
            row.className = 'results-derby-sting-row';
            row.innerHTML = `
                <span class="results-derby-sting-rank">#${index + 1}</span>
                <span class="results-derby-sting-name"></span>
                <span class="results-derby-sting-points"></span>
            `;
            row.querySelector('.results-derby-sting-name').textContent = entry.playerId || `Player ${index + 1}`;
            row.querySelector('.results-derby-sting-points').textContent = `${entry.totalPoints || 0} pts`;
            this.elements.derbyStingList.appendChild(row);
        });
    }

    /**
     * @private
     */
    _extractDerbyStingStandings(data = {}) {
        if (Array.isArray(data.standings) && data.standings.length > 0) {
            return data.standings.map((entry, index) => ({
                playerId: entry.playerName || entry.displayName || entry.playerId || `Player ${index + 1}`,
                totalPoints: Number(entry.totalPoints ?? entry.points ?? entry.score ?? 0),
                roundWins: Number(entry.roundWins ?? 0),
                position: Number(entry.position ?? index + 1)
            })).sort(this._sortDerbyStandings).slice(0, 3);
        }

        const scores = data.scores || data.roundScores || data.matchScores || {};
        const roundWins = data.roundWins || {};
        const rows = Object.entries(scores).map(([playerId, score]) => ({
            playerId,
            totalPoints: Number(score || 0),
            roundWins: Number(roundWins[playerId] || 0)
        }));

        if (rows.length === 0 && data.winnerId) {
            rows.push({
                playerId: data.winnerName || data.winnerId,
                totalPoints: 0,
                roundWins: 1
            });
        }

        return rows.sort(this._sortDerbyStandings).slice(0, 3).map((entry, index) => ({
            ...entry,
            position: index + 1
        }));
    }

    /**
     * @private
     */
    _sortDerbyStandings(a, b) {
        if ((b.roundWins || 0) !== (a.roundWins || 0)) {
            return (b.roundWins || 0) - (a.roundWins || 0);
        }
        if ((b.totalPoints || 0) !== (a.totalPoints || 0)) {
            return (b.totalPoints || 0) - (a.totalPoints || 0);
        }
        return String(a.playerId || '').localeCompare(String(b.playerId || ''));
    }

    /**
     * @private
     */
    _hideDerbyStandingsSting({ completed = false } = {}) {
        this._clearDerbyStandingsStingTimer();
        this.derbyStandingsSting.active = false;
        this.derbyStandingsSting.completed = completed || this.derbyStandingsSting.completed;
        if (this.elements.derbySting) {
            this.elements.derbySting.classList.add('hidden');
        }
    }

    /**
     * @private
     */
    _clearDerbyStandingsStingTimer() {
        if (this._derbyStandingsStingTimer !== null && this.timerApi?.clearTimeout) {
            this.timerApi.clearTimeout(this._derbyStandingsStingTimer);
        }
        this._derbyStandingsStingTimer = null;
    }

    /**
     * Expose deterministic state for runtime proof.
     */
    getDerbyStandingsStingDiagnostics() {
        return {
            active: this.derbyStandingsSting.active,
            completed: this.derbyStandingsSting.completed,
            round: this.derbyStandingsSting.round,
            winnerName: this.derbyStandingsSting.winnerName,
            standings: this.derbyStandingsSting.standings,
            rowCount: this.derbyStandingsSting.standings.length,
            durationMs: this.derbyStandingsSting.durationMs,
            hidden: !!this.elements.derbySting?.classList.contains('hidden'),
            modalVisible: this.visible
        };
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
        this._clearWinMomentTimer();
        this._clearRematchCountdownTimer();
        this._hideDerbyStandingsSting();
        this.winMoment.active = false;
        this.rematchCountdown.active = false;
        if (this.element) {
            this.element.classList.add('hidden');
            this.element.classList.remove('win-moment-active');
        }
        if (this.elements.winMoment) {
            this.elements.winMoment.classList.add('hidden');
        }
        this._hideRematchCountdown();
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
        this._clearWinMomentTimer();
        this._clearRematchCountdownTimer();
        this._clearDerbyStandingsStingTimer();
        if (this.elements.derbySting) {
            this.elements.derbySting.remove();
        }
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
