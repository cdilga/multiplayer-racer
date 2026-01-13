/**
 * DerbySystem - Manages derby mode game logic
 *
 * Responsibilities:
 * - Round state machine (countdown, combat, roundEnd, matchEnd)
 * - Elimination tracking
 * - Last-vehicle-standing detection
 * - Multi-round scoring (best of 3)
 * - Victory conditions
 *
 * Usage:
 *   const derby = new DerbySystem({ eventBus });
 *   derby.init();
 *   derby.startMatch();
 */

// Derby states
const DERBY_STATES = {
    IDLE: 'idle',
    COUNTDOWN: 'countdown',
    COMBAT: 'combat',
    ROUND_END: 'round_end',
    MATCH_END: 'match_end'
};

// Scoring by placement
const PLACEMENT_POINTS = {
    1: 10,
    2: 6,
    3: 4,
    4: 3,
    5: 2,
    default: 1
};

class DerbySystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {number} [options.roundsToWin=2] - Rounds needed to win the match
     * @param {number} [options.maxRounds=3] - Maximum rounds in a match
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        // Match configuration
        this.roundsToWin = options.roundsToWin || 2;
        this.maxRounds = options.maxRounds || 3;

        // State
        this.state = DERBY_STATES.IDLE;
        this.currentRound = 0;
        this.countdownValue = 3;
        this.countdownTimer = 0;
        this.roundStartTime = 0;

        // Registered vehicles
        this.vehicles = new Map();  // vehicleId -> derbyData

        // Round tracking
        this.eliminationOrder = [];  // Order of eliminations this round
        this.roundWinners = [];      // Winner of each round
        this.roundScores = [];       // Scores per round [{playerId: points, ...}, ...]

        // Match tracking
        this.matchScores = new Map();  // playerId -> total points
        this.roundWins = new Map();    // playerId -> round win count

        // State
        this.initialized = false;
    }

    /**
     * Initialize derby system
     */
    async init() {
        if (this.initialized) return;

        console.log('DerbySystem: Initializing...');

        // Subscribe to damage events for elimination
        if (this.eventBus) {
            this.eventBus.on('damage:destroyed', this._onVehicleDestroyed.bind(this));
        }

        this.initialized = true;
        this._emit('derby:ready');
        console.log('DerbySystem: Ready');
    }

    /**
     * Register a vehicle for derby
     * @param {Vehicle} vehicle
     */
    registerVehicle(vehicle) {
        this.vehicles.set(vehicle.id, {
            vehicle: vehicle,
            playerId: vehicle.playerId,
            eliminated: false,
            eliminationOrder: null,
            health: vehicle.health || 100
        });

        // Initialize match scores if not present
        if (!this.matchScores.has(vehicle.playerId)) {
            this.matchScores.set(vehicle.playerId, 0);
            this.roundWins.set(vehicle.playerId, 0);
        }
    }

    /**
     * Unregister a vehicle
     * @param {string} vehicleId
     */
    unregisterVehicle(vehicleId) {
        const data = this.vehicles.get(vehicleId);
        if (data) {
            this.matchScores.delete(data.playerId);
            this.roundWins.delete(data.playerId);
        }
        this.vehicles.delete(vehicleId);
    }

    /**
     * Clear all vehicles
     */
    clearVehicles() {
        this.vehicles.clear();
        this.matchScores.clear();
        this.roundWins.clear();
    }

    /**
     * Check if running in test mode
     * @returns {boolean}
     * @private
     */
    _isTestMode() {
        return typeof window !== 'undefined' && (
            window._testMode === true ||
            new URLSearchParams(window.location?.search).get('testMode') === '1'
        );
    }

    /**
     * Start a new derby match
     */
    startMatch() {
        console.log('DerbySystem: Starting match');

        // Reset match state
        this.currentRound = 0;
        this.roundWinners = [];
        this.roundScores = [];

        // Reset player match scores
        for (const [playerId] of this.matchScores) {
            this.matchScores.set(playerId, 0);
            this.roundWins.set(playerId, 0);
        }

        this._emit('derby:matchStart', {
            roundsToWin: this.roundsToWin,
            maxRounds: this.maxRounds,
            playerCount: this.vehicles.size
        });

        // Start first round
        this.startRound();
    }

    /**
     * Start a new round
     */
    startRound() {
        this.currentRound++;
        console.log(`DerbySystem: Starting round ${this.currentRound}`);

        // Reset round state
        this.eliminationOrder = [];
        for (const [vehicleId, data] of this.vehicles) {
            data.eliminated = false;
            data.eliminationOrder = null;
            // Reset vehicle health
            if (data.vehicle) {
                data.vehicle.health = data.vehicle.maxHealth || 100;
                data.vehicle.isDead = false;
            }
        }

        // Skip countdown in test mode
        if (this._isTestMode()) {
            console.log('DerbySystem: Test mode - skipping countdown');
            this._emit('derby:countdown', { count: 0, testMode: true });
            this._startCombat();
            return;
        }

        // Start countdown
        this.state = DERBY_STATES.COUNTDOWN;
        this.countdownValue = 3;
        this.countdownTimer = 0;

        this._emit('derby:roundStart', {
            round: this.currentRound,
            maxRounds: this.maxRounds
        });
        this._emit('derby:countdown', { count: this.countdownValue });
    }

    /**
     * Start combat phase
     * @private
     */
    _startCombat() {
        this.state = DERBY_STATES.COMBAT;
        this.roundStartTime = performance.now();

        this._emit('derby:combatStart', {
            round: this.currentRound,
            playerCount: this.vehicles.size
        });
    }

    /**
     * Update derby system
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.initialized) return;

        if (this.state === DERBY_STATES.COUNTDOWN) {
            this._updateCountdown(dt);
        } else if (this.state === DERBY_STATES.COMBAT) {
            this._updateCombat(dt);
        }
    }

    /**
     * Update countdown
     * @private
     */
    _updateCountdown(dt) {
        this.countdownTimer += dt;

        if (this.countdownTimer >= 1) {
            this.countdownTimer = 0;
            this.countdownValue--;

            if (this.countdownValue > 0) {
                this._emit('derby:countdown', { count: this.countdownValue });
            } else {
                this._startCombat();
            }
        }
    }

    /**
     * Update combat phase
     * @private
     */
    _updateCombat(dt) {
        // Check for round end (one survivor or all eliminated)
        const survivors = this._getSurvivors();

        if (survivors.length <= 1) {
            this._endRound(survivors[0] || null);
        }
    }

    /**
     * Handle vehicle destruction (elimination)
     * @private
     */
    _onVehicleDestroyed(data) {
        if (this.state !== DERBY_STATES.COMBAT) return;

        const vehicleData = this.vehicles.get(data.vehicleId);
        if (!vehicleData || vehicleData.eliminated) return;

        // Mark as eliminated
        vehicleData.eliminated = true;
        vehicleData.eliminationOrder = this.eliminationOrder.length + 1;
        this.eliminationOrder.push({
            vehicleId: data.vehicleId,
            playerId: data.playerId,
            order: vehicleData.eliminationOrder
        });

        const survivors = this._getSurvivors();

        this._emit('derby:playerEliminated', {
            vehicleId: data.vehicleId,
            playerId: data.playerId,
            order: vehicleData.eliminationOrder,
            survivorsLeft: survivors.length
        });

        console.log(`DerbySystem: Player ${data.playerId} eliminated. ${survivors.length} survivors remaining.`);
    }

    /**
     * Get surviving vehicles
     * @private
     * @returns {Array}
     */
    _getSurvivors() {
        const survivors = [];
        for (const [vehicleId, data] of this.vehicles) {
            if (!data.eliminated) {
                survivors.push(data);
            }
        }
        return survivors;
    }

    /**
     * End the current round
     * @private
     * @param {Object|null} winner - Winner vehicle data or null if draw
     */
    _endRound(winner) {
        this.state = DERBY_STATES.ROUND_END;

        // Calculate placements and scores
        const roundScore = this._calculateRoundScores(winner);
        this.roundScores.push(roundScore);

        // Track round winner
        const winnerId = winner ? winner.playerId : null;
        this.roundWinners.push(winnerId);

        if (winnerId) {
            const currentWins = this.roundWins.get(winnerId) || 0;
            this.roundWins.set(winnerId, currentWins + 1);
        }

        const roundTime = performance.now() - this.roundStartTime;

        this._emit('derby:roundEnd', {
            round: this.currentRound,
            winnerId: winnerId,
            winnerVehicleId: winner ? winner.vehicle.id : null,
            roundTime: roundTime,
            scores: roundScore,
            eliminationOrder: this.eliminationOrder
        });

        console.log(`DerbySystem: Round ${this.currentRound} ended. Winner: ${winnerId || 'None'}`);

        // Check for match end
        if (this._isMatchOver()) {
            this._endMatch();
        } else {
            // Emit event to allow UI to show round results before next round
            this._emit('derby:nextRoundReady', {
                nextRound: this.currentRound + 1,
                maxRounds: this.maxRounds
            });
        }
    }

    /**
     * Calculate scores for the round
     * @private
     * @param {Object|null} winner
     * @returns {Object} playerId -> points
     */
    _calculateRoundScores(winner) {
        const scores = {};
        const playerCount = this.vehicles.size;

        // Winner gets 1st place points
        if (winner) {
            const placement = 1;
            const points = PLACEMENT_POINTS[placement] || PLACEMENT_POINTS.default;
            scores[winner.playerId] = points;

            // Update match score
            const currentScore = this.matchScores.get(winner.playerId) || 0;
            this.matchScores.set(winner.playerId, currentScore + points);
        }

        // Eliminated players get points based on elimination order (last eliminated = better placement)
        const eliminations = [...this.eliminationOrder].reverse();
        eliminations.forEach((elim, index) => {
            // Winner is 1st, last eliminated is 2nd, etc.
            const placement = index + 2;
            const points = PLACEMENT_POINTS[placement] || PLACEMENT_POINTS.default;
            scores[elim.playerId] = points;

            // Update match score
            const currentScore = this.matchScores.get(elim.playerId) || 0;
            this.matchScores.set(elim.playerId, currentScore + points);
        });

        return scores;
    }

    /**
     * Check if match is over
     * @private
     * @returns {boolean}
     */
    _isMatchOver() {
        // Check if anyone has won enough rounds
        for (const [playerId, wins] of this.roundWins) {
            if (wins >= this.roundsToWin) {
                return true;
            }
        }

        // Check if max rounds reached
        if (this.currentRound >= this.maxRounds) {
            return true;
        }

        return false;
    }

    /**
     * End the match
     * @private
     */
    _endMatch() {
        this.state = DERBY_STATES.MATCH_END;

        // Determine match winner
        let matchWinner = null;
        let maxWins = 0;

        for (const [playerId, wins] of this.roundWins) {
            if (wins > maxWins) {
                maxWins = wins;
                matchWinner = playerId;
            }
        }

        // If tied on round wins, use total points
        if (!matchWinner) {
            let maxPoints = 0;
            for (const [playerId, points] of this.matchScores) {
                if (points > maxPoints) {
                    maxPoints = points;
                    matchWinner = playerId;
                }
            }
        }

        // Build final standings
        const standings = this._buildFinalStandings();

        this._emit('derby:matchEnd', {
            winnerId: matchWinner,
            standings: standings,
            roundWins: Object.fromEntries(this.roundWins),
            matchScores: Object.fromEntries(this.matchScores),
            roundScores: this.roundScores
        });

        console.log(`DerbySystem: Match ended. Winner: ${matchWinner}`);
    }

    /**
     * Build final standings sorted by total points
     * @private
     * @returns {Array}
     */
    _buildFinalStandings() {
        const standings = [];

        for (const [playerId, points] of this.matchScores) {
            standings.push({
                playerId: playerId,
                totalPoints: points,
                roundWins: this.roundWins.get(playerId) || 0
            });
        }

        // Sort by round wins first, then total points
        standings.sort((a, b) => {
            if (b.roundWins !== a.roundWins) {
                return b.roundWins - a.roundWins;
            }
            return b.totalPoints - a.totalPoints;
        });

        // Add position
        standings.forEach((entry, index) => {
            entry.position = index + 1;
        });

        return standings;
    }

    /**
     * Trigger next round (called by UI after showing results)
     */
    nextRound() {
        if (this.state !== DERBY_STATES.ROUND_END) {
            console.warn('DerbySystem: Cannot start next round - not in ROUND_END state');
            return;
        }

        this.startRound();
    }

    /**
     * Get current state
     * @returns {string}
     */
    getState() {
        return this.state;
    }

    /**
     * Get current round
     * @returns {number}
     */
    getCurrentRound() {
        return this.currentRound;
    }

    /**
     * Get survivor count
     * @returns {number}
     */
    getSurvivorCount() {
        return this._getSurvivors().length;
    }

    /**
     * Get match scores
     * @returns {Map}
     */
    getMatchScores() {
        return new Map(this.matchScores);
    }

    /**
     * Get round wins
     * @returns {Map}
     */
    getRoundWins() {
        return new Map(this.roundWins);
    }

    /**
     * Get combat time elapsed
     * @returns {number} Time in milliseconds
     */
    getCombatTime() {
        if (this.state !== DERBY_STATES.COMBAT) return 0;
        return performance.now() - this.roundStartTime;
    }

    /**
     * Reset derby system
     */
    reset() {
        this.state = DERBY_STATES.IDLE;
        this.currentRound = 0;
        this.countdownValue = 3;
        this.countdownTimer = 0;
        this.eliminationOrder = [];
        this.roundWinners = [];
        this.roundScores = [];

        // Reset vehicle data but keep registrations
        for (const [vehicleId, data] of this.vehicles) {
            data.eliminated = false;
            data.eliminationOrder = null;
        }

        // Reset scores
        for (const [playerId] of this.matchScores) {
            this.matchScores.set(playerId, 0);
            this.roundWins.set(playerId, 0);
        }
    }

    /**
     * Emit event
     * @private
     */
    _emit(event, data) {
        if (this.eventBus) {
            this.eventBus.emit(event, data);
        }
    }

    /**
     * Destroy derby system
     */
    destroy() {
        this.vehicles.clear();
        this.matchScores.clear();
        this.roundWins.clear();
        this.eliminationOrder = [];
        this.roundWinners = [];
        this.roundScores = [];
        this.initialized = false;
    }
}

// Export states
export { DERBY_STATES };

// Export for ES Modules
export { DerbySystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.DerbySystem = DerbySystem;
    window.DERBY_STATES = DERBY_STATES;
}
