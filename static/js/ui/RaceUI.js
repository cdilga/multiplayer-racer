/**
 * RaceUI - In-race HUD display
 *
 * Displays:
 * - Countdown
 * - Speedometer
 * - Lap counter
 * - Position
 * - Race timer
 * - Minimap (optional)
 *
 * Usage:
 *   const raceUI = new RaceUI({ eventBus, container });
 *   raceUI.show();
 */

class RaceUI {
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
        this.loserEngagementDurationMs = Math.min(2400, Math.max(600, options.loserEngagementDurationMs ?? 1800));

        // State
        this.visible = false;
        this.currentSpeed = 0;
        this.currentLap = 0;
        this.totalLaps = 3;
        this.raceTime = 0;
        this.loserEngagement = {
            active: false,
            completed: false,
            eliminatedPlayerId: '',
            targetPlayerId: '',
            pressureType: '',
            durationMs: this.loserEngagementDurationMs
        };
        this._loserEngagementTimer = null;

        // Elements
        this.element = null;
        this.elements = {};

        // Countdown
        this.countdownElement = null;
    }

    /**
     * Initialize race UI
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
        let existing = this.container.querySelector('.race-ui');
        if (existing) {
            this.element = existing;
            this._bindElements();
            return;
        }

        // Create race HUD
        this.element = document.createElement('div');
        this.element.className = 'race-ui hidden';
        this.element.innerHTML = `
            <div class="race-hud">
                <div class="hud-top">
                    <div class="hud-timer" id="race-timer">0:00.000</div>
                    <div class="hud-lap">
                        Lap <span id="race-lap">1</span>/<span id="race-total-laps">3</span>
                    </div>
                </div>

                <div class="hud-health-bars" id="health-bars-container">
                    <!-- Health bars populated dynamically -->
                </div>

                <div class="loser-engagement-banner hidden" id="loser-engagement-banner" aria-live="polite">
                    <div class="loser-engagement-kicker">Back next round</div>
                    <div class="loser-engagement-copy">
                        <strong id="loser-engagement-player">Player out</strong>
                        <span id="loser-engagement-target">Leader is target</span>
                    </div>
                    <div class="loser-engagement-pressure" id="loser-engagement-pressure">Arena pressure active</div>
                </div>

                <div class="hud-bottom">
                    <div class="hud-speed">
                        <span class="speed-value" id="race-speed">0</span>
                        <span class="speed-unit">km/h</span>
                    </div>
                </div>
            </div>

            <div class="countdown-overlay hidden" id="race-countdown">
                <span class="countdown-number">3</span>
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
        this.elements.timer = this.element.querySelector('#race-timer');
        this.elements.lap = this.element.querySelector('#race-lap');
        this.elements.totalLaps = this.element.querySelector('#race-total-laps');
        this.elements.lapContainer = this.element.querySelector('.hud-lap');
        this.elements.timerContainer = this.element.querySelector('.hud-timer');
        this.elements.speed = this.element.querySelector('#race-speed');
        this.elements.healthBars = this.element.querySelector('#health-bars-container');
        this.elements.loserEngagement = this.element.querySelector('#loser-engagement-banner');
        this.elements.loserEngagementPlayer = this.element.querySelector('#loser-engagement-player');
        this.elements.loserEngagementTarget = this.element.querySelector('#loser-engagement-target');
        this.elements.loserEngagementPressure = this.element.querySelector('#loser-engagement-pressure');
        this.countdownElement = this.element.querySelector('#race-countdown');
    }

    /**
     * Add CSS styles
     * @private
     */
    _addStyles() {
        if (document.querySelector('#race-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'race-ui-styles';
        style.textContent = `
            .race-ui {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                pointer-events: none;
                z-index: 50;
                font-family: var(--font-body, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            }
            .race-ui.hidden {
                display: none;
            }
            .race-hud {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
            }
            .hud-top {
                position: absolute;
                top: 20px;
                left: 20px;
                right: 20px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }
            .hud-timer {
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 25px;
                border-radius: 10px;
                font-size: 28px;
                font-weight: bold;
                color: white;
                font-family: var(--font-mono, monospace);
            }
            .hud-lap {
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 25px;
                border-radius: 10px;
                font-size: 24px;
                color: white;
            }
            #race-lap {
                color: #00d4ff;
                font-weight: bold;
            }
            .hud-bottom {
                position: absolute;
                bottom: 20px;
                right: 20px;
            }
            .hud-speed {
                background: rgba(0, 0, 0, 0.7);
                padding: 15px 25px;
                border-radius: 10px;
                text-align: right;
            }
            .speed-value {
                font-size: 48px;
                font-weight: bold;
                color: white;
                font-family: var(--font-mono, monospace);
            }
            .speed-unit {
                font-size: 18px;
                color: #888;
                margin-left: 5px;
            }
            .countdown-overlay {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }
            .countdown-overlay.hidden {
                display: none;
            }
            .countdown-number {
                font-size: 200px;
                font-weight: bold;
                color: white;
                text-shadow: 2px 2px 0 rgba(0, 255, 136, 0.5);
                animation: countdown-pulse 1s ease-in-out;
            }
            @keyframes countdown-pulse {
                0% { transform: scale(1.5); opacity: 0; }
                50% { transform: scale(1); opacity: 1; }
                100% { transform: scale(0.8); opacity: 0.5; }
            }

            /* Health bars — chunky segmented, flat, couch-legible, dither-safe.
               Solid loud-palette fills + hard ink borders (no gradients, no
               rounded corners) so they band cleanly under posterize/dither.
               Dimensions are fixed: the segment track never changes width with
               health; only per-segment lit state toggles. */
            .hud-health-bars {
                position: absolute;
                top: 96px;             /* clear of the top HUD row (timer/lap) */
                left: 20px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                width: 300px;          /* fixed footprint: stable + bounded */
                max-width: 32vw;
            }
            .health-bar-item {
                --health-color: #5CFF6A;
                background: rgba(10, 8, 6, 0.82);   /* ink panel, matte */
                border: 2px solid #14110F;          /* hard ink border */
                padding: 8px 10px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .health-bar-color {
                width: 14px;
                height: 14px;
                border: 2px solid #14110F;   /* boxy chip, not a soft dot */
                flex-shrink: 0;
            }
            .health-bar-name {
                color: #fff;
                font-family: var(--font-mono, monospace);
                font-size: 16px;
                font-weight: bold;
                letter-spacing: 0.5px;
                text-transform: uppercase;
                min-width: 64px;
                flex-shrink: 0;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                /* hard outline keeps names crisp over the busy graded world */
                text-shadow: 1px 1px 0 #14110F, -1px 1px 0 #14110F,
                             1px -1px 0 #14110F, -1px -1px 0 #14110F;
            }
            /* Segment track: fixed size, constant 10 slots. No width transition. */
            .health-bar-segments {
                flex: 1;
                display: flex;
                gap: 2px;                 /* ink gap between chunks */
                height: 26px;
                padding: 2px;
                background: #14110F;      /* ink backing shows through gaps */
                border: 2px solid #0a0806;
            }
            .health-seg {
                flex: 1 1 0;
                min-width: 0;
                background: #2A2620;      /* unlit = dark asphalt (world) */
                /* discrete on/off only — no width animation, stable geometry */
                transition: background 0.12s steps(1);
            }
            .health-seg.is-lit {
                background: var(--health-color);   /* flat solid loud color */
            }
            .health-bar-item.tier-high   { --health-color: #5CFF6A; }
            .health-bar-item.tier-medium { --health-color: #FFD23E; }
            .health-bar-item.tier-low    { --health-color: #FF3B3B; }
            /* 5k3.14: low-health DANGER pulse — lit segments throb so a
               near-dead player reads at a glance. Presentation only; no
               physics/geometry change (segment sizes stay fixed). */
            .health-bar-item.tier-low .health-seg.is-lit {
                animation: health-low-pulse 0.6s ease-in-out infinite alternate;
            }
            @keyframes health-low-pulse {
                0%   { filter: brightness(0.72); }
                100% { filter: brightness(1.35); }
            }
            .health-bar-value {
                color: #fff;
                font-family: var(--font-mono, monospace);
                font-size: 15px;
                font-weight: bold;
                min-width: 44px;
                text-align: right;
                text-shadow: 1px 1px 0 #14110F, -1px -1px 0 #14110F;
            }
            .loser-engagement-banner {
                position: absolute;
                left: 50%;
                top: 92px;
                transform: translateX(-50%) rotate(-0.6deg);
                width: min(520px, calc(100vw - 420px));
                min-width: 360px;
                padding: 10px 14px;
                background:
                    repeating-linear-gradient(
                        to bottom,
                        rgba(255, 255, 255, 0.055) 0,
                        rgba(255, 255, 255, 0.055) 1px,
                        transparent 3px,
                        transparent 6px
                    ),
                    rgba(16, 10, 8, 0.92);
                border: 3px solid #14110F;
                box-shadow:
                    5px 5px 0 rgba(0, 0, 0, 0.82),
                    0 0 0 2px #FF3B3B;
                color: #fff;
                text-transform: uppercase;
            }
            .loser-engagement-banner.hidden {
                display: none;
            }
            .loser-engagement-kicker {
                display: inline-block;
                margin-bottom: 5px;
                padding: 3px 7px;
                background: #FFD23E;
                color: #14110F;
                border: 2px solid #14110F;
                font-size: 11px;
                font-weight: 1000;
            }
            .loser-engagement-copy {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 10px;
                min-width: 0;
            }
            #loser-engagement-player {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #FF3B3B;
                font-size: 22px;
                line-height: 1;
                font-weight: 1000;
                text-shadow: 3px 3px 0 #14110F;
            }
            #loser-engagement-target {
                flex: 0 0 auto;
                color: #5CFF6A;
                font-size: 13px;
                font-weight: 900;
            }
            .loser-engagement-pressure {
                margin-top: 4px;
                color: #FFD23E;
                font-family: var(--font-mono, monospace);
                font-size: 12px;
                font-weight: 900;
            }
            @media (max-width: 900px) {
                .loser-engagement-banner {
                    left: 20px;
                    right: 20px;
                    top: 176px;
                    width: auto;
                    min-width: 0;
                    transform: none;
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

        this.eventBus.on('race:countdown', (data) => {
            this.show(); // Ensure UI is visible during countdown
            this.showCountdown(data.count);
        });

        this.eventBus.on('race:start', () => {
            this.hideCountdown();
        });

        // Derby mode countdown events
        this.eventBus.on('derby:countdown', (data) => {
            this.show();
            this.showCountdown(data.count);
        });

        this.eventBus.on('derby:combatStart', () => {
            this.hideCountdown();
            this._hideLoserEngagement({ completed: false });
        });

        this.eventBus.on('derby:loserPressure', (data) => {
            this.showLoserEngagement(data);
        });

        this.eventBus.on('game:countdown', () => {
            this.show(); // Show race UI when countdown state begins
            this._hideLoserEngagement({ completed: false });
        });

        this.eventBus.on('game:racing', () => {
            this.show();
        });

        this.eventBus.on('game:results', () => {
            this.hide();
        });

        this.eventBus.on('race:lapComplete', (data) => {
            this.setLap(data.lap + 1);
        });
    }

    /**
     * Show countdown number
     * @param {number} count
     */
    showCountdown(count) {
        if (!this.countdownElement) return;

        const numberEl = this.countdownElement.querySelector('.countdown-number');
        if (numberEl) {
            numberEl.textContent = count === 0 ? 'GO!' : count.toString();
            // Reset animation
            numberEl.style.animation = 'none';
            numberEl.offsetHeight; // Trigger reflow
            numberEl.style.animation = 'countdown-pulse 1s ease-in-out';
        }

        this.countdownElement.classList.remove('hidden');
    }

    /**
     * Hide countdown
     */
    hideCountdown() {
        if (this.countdownElement) {
            this.countdownElement.classList.add('hidden');
        }
    }

    /**
     * Update speed display
     * @param {number} speed - Speed in km/h
     */
    setSpeed(speed) {
        this.currentSpeed = Math.round(speed);
        if (this.elements.speed) {
            this.elements.speed.textContent = this.currentSpeed.toString();
        }
    }

    /**
     * Update lap display
     * @param {number} lap - Current lap (1-based)
     */
    setLap(lap) {
        this.currentLap = lap;
        if (this.elements.lap) {
            this.elements.lap.textContent = lap.toString();
        }
    }

    /**
     * Set total laps
     * @param {number} laps
     */
    setTotalLaps(laps) {
        this.totalLaps = laps;
        if (this.elements.totalLaps) {
            this.elements.totalLaps.textContent = laps.toString();
        }
    }


    /**
     * Update race timer
     * @param {number} timeMs - Time in milliseconds
     */
    setTime(timeMs) {
        this.raceTime = timeMs;
        if (this.elements.timer) {
            this.elements.timer.textContent = this._formatTime(timeMs);
        }
    }

    /**
     * Format time as M:SS.mmm
     * @private
     */
    _formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const millis = Math.floor(ms % 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }

    /**
     * Update all values at once
     * @param {Object} data - { speed, lap, time }
     */
    update(data) {
        if (data.speed !== undefined) this.setSpeed(data.speed);
        if (data.lap !== undefined) this.setLap(data.lap);
        if (data.time !== undefined) this.setTime(data.time);
    }

    /**
     * Show race UI
     */
    show() {
        this.visible = true;
        if (this.element) {
            this.element.classList.remove('hidden');
        }
    }

    /**
     * Hide race UI
     */
    hide() {
        this.visible = false;
        this._hideLoserEngagement({ completed: false });
        if (this.element) {
            this.element.classList.add('hidden');
        }
        this.hideCountdown();
    }

    /**
     * Show the short host-only loser engagement banner for derby eliminations.
     * @param {Object} data
     */
    showLoserEngagement(data = {}) {
        this._clearLoserEngagementTimer();
        const eliminated = this._normalizeBannerName(data.eliminatedPlayerId || 'Player');
        const target = this._normalizeBannerName(data.targetPlayerId || 'Leader');
        const pressureType = data.pressureType || 'leader-target';

        this.loserEngagement = {
            active: true,
            completed: false,
            eliminatedPlayerId: eliminated,
            targetPlayerId: target,
            pressureType,
            durationMs: this.loserEngagementDurationMs
        };

        if (this.elements.loserEngagementPlayer) {
            this.elements.loserEngagementPlayer.textContent = `${eliminated} is out`;
        }
        if (this.elements.loserEngagementTarget) {
            this.elements.loserEngagementTarget.textContent = `${target} is target`;
        }
        if (this.elements.loserEngagementPressure) {
            this.elements.loserEngagementPressure.textContent = pressureType === 'arena-shrink-started'
                ? 'Arena pressure active'
                : 'Stay in it - back next round';
        }
        if (this.elements.loserEngagement) {
            this.elements.loserEngagement.classList.remove('hidden');
            this.elements.loserEngagement.dataset.pressureType = pressureType;
            this.elements.loserEngagement.dataset.durationMs = String(this.loserEngagementDurationMs);
        }

        this.show();
        this._loserEngagementTimer = this.timerApi.setTimeout(() => {
            this._hideLoserEngagement({ completed: true });
        }, this.loserEngagementDurationMs);
    }

    /**
     * @private
     */
    _normalizeBannerName(value) {
        const text = String(value || '').trim();
        return text ? text.slice(0, 24) : 'Player';
    }

    /**
     * @private
     */
    _hideLoserEngagement({ completed = false } = {}) {
        this._clearLoserEngagementTimer();
        this.loserEngagement.active = false;
        this.loserEngagement.completed = completed || this.loserEngagement.completed;
        if (this.elements.loserEngagement) {
            this.elements.loserEngagement.classList.add('hidden');
        }
    }

    /**
     * @private
     */
    _clearLoserEngagementTimer() {
        if (this._loserEngagementTimer !== null && this.timerApi?.clearTimeout) {
            this.timerApi.clearTimeout(this._loserEngagementTimer);
        }
        this._loserEngagementTimer = null;
    }

    /**
     * Expose deterministic banner state for tests and browser artifacts.
     */
    getLoserEngagementDiagnostics() {
        return {
            visible: this.visible,
            active: this.loserEngagement.active,
            completed: this.loserEngagement.completed,
            eliminatedPlayerId: this.loserEngagement.eliminatedPlayerId,
            targetPlayerId: this.loserEngagement.targetPlayerId,
            pressureType: this.loserEngagement.pressureType,
            durationMs: this.loserEngagement.durationMs,
            hidden: !!this.elements.loserEngagement?.classList.contains('hidden'),
            text: {
                player: this.elements.loserEngagementPlayer?.textContent || '',
                target: this.elements.loserEngagementTarget?.textContent || '',
                pressure: this.elements.loserEngagementPressure?.textContent || ''
            }
        };
    }

    /**
     * Set game mode - hides race-specific elements in derby mode
     * @param {string} mode - 'race' or 'derby'
     */
    setMode(mode) {
        this.mode = mode;

        // Hide race-specific elements in derby mode
        const isRace = mode === 'race';

        if (this.elements.lapContainer) {
            this.elements.lapContainer.style.display = isRace ? '' : 'none';
        }
        if (this.elements.timerContainer) {
            this.elements.timerContainer.style.display = isRace ? '' : 'none';
        }
    }

    /**
     * Clamp a health value to a 0-100 percentage.
     * @param {number} health
     * @param {number} maxHealth
     * @returns {number} percent 0..100
     */
    static healthPercent(health, maxHealth) {
        const max = maxHealth > 0 ? maxHealth : 100;
        return Math.max(0, Math.min(100, (health / max) * 100));
    }

    /**
     * How many discrete segments should be lit for a given percent.
     * Zero only when dead; at least one while alive so a nearly-dead player
     * still reads as present. Pure + deterministic for testing.
     * @param {number} percent 0..100
     * @param {number} [segments=RaceUI.SEGMENT_COUNT]
     * @returns {number} 0..segments
     */
    static segmentsLit(percent, segments = RaceUI.SEGMENT_COUNT) {
        if (percent <= 0) return 0;
        const lit = Math.round((percent / 100) * segments);
        return Math.max(1, Math.min(segments, lit));
    }

    /**
     * Health tier from percent (drives the flat loud-palette color).
     * @param {number} percent 0..100
     * @returns {'high'|'medium'|'low'}
     */
    static healthTier(percent) {
        if (percent > 50) return 'high';
        if (percent > 25) return 'medium';
        return 'low';
    }

    /**
     * Build the fixed segment track markup (constant node count for stability).
     * @private
     */
    _segmentTrackHTML() {
        let segs = '';
        for (let i = 0; i < RaceUI.SEGMENT_COUNT; i++) {
            segs += '<div class="health-seg"></div>';
        }
        return `<div class="health-bar-segments">${segs}</div>`;
    }

    /**
     * Apply a health value to an existing bar item: toggle lit segments, tier
     * class, value text and diagnostic data attributes. Never changes geometry.
     * @private
     */
    _applyHealth(item, percent) {
        const lit = RaceUI.segmentsLit(percent);
        const tier = RaceUI.healthTier(percent);

        item.classList.remove('tier-high', 'tier-medium', 'tier-low');
        item.classList.add(`tier-${tier}`);

        const segs = item.querySelectorAll('.health-seg');
        segs.forEach((seg, i) => {
            seg.classList.toggle('is-lit', i < lit);
        });

        const value = item.querySelector('.health-bar-value');
        if (value) value.textContent = `${Math.round(percent)}%`;

        // Diagnostic hooks for tests/artifacts
        item.dataset.healthPercent = String(Math.round(percent));
        item.dataset.segmentsLit = String(lit);
        item.dataset.tier = tier;
    }

    /**
     * Update health bars for all players
     * @param {Array} players - Array of { id, name, color, health, maxHealth }
     */
    updateHealthBars(players) {
        if (!this.elements.healthBars) return;

        // Clear existing health bars
        this.elements.healthBars.innerHTML = '';

        // Create health bar for each player
        players.forEach(player => {
            const percent = RaceUI.healthPercent(player.health, player.maxHealth);

            const healthBarItem = document.createElement('div');
            healthBarItem.className = 'health-bar-item';
            healthBarItem.dataset.playerId = player.id;
            healthBarItem.innerHTML = `
                <div class="health-bar-color" style="background: ${player.color || '#888'}"></div>
                <span class="health-bar-name">${player.name || 'Player'}</span>
                ${this._segmentTrackHTML()}
                <span class="health-bar-value">0%</span>
            `;
            this.elements.healthBars.appendChild(healthBarItem);
            this._applyHealth(healthBarItem, percent);
        });
    }

    /**
     * Update single player's health bar
     * @param {string} playerId
     * @param {number} health
     * @param {number} maxHealth
     */
    updatePlayerHealth(playerId, health, maxHealth) {
        if (!this.elements.healthBars) return;

        const healthBarItem = this.elements.healthBars.querySelector(`[data-player-id="${playerId}"]`);
        if (!healthBarItem) return;

        this._applyHealth(healthBarItem, RaceUI.healthPercent(health, maxHealth));
    }

    /**
     * Destroy UI
     */
    destroy() {
        this._clearLoserEngagementTimer();
        if (this.element) {
            this.element.remove();
        }
    }
}

// Number of discrete chunks per health bar (couch-legible, dither-safe).
RaceUI.SEGMENT_COUNT = 10;

// Export for ES Modules
export { RaceUI };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.RaceUI = RaceUI;
}
