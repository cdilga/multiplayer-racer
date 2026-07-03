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

import { RealClock } from '../engine/Clock.js';

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

// Inward push tuning. PUSH_ACCEL is the per-second impulse magnitude applied to
// a vehicle outside the shrinking boundary; the per-frame impulse is
// PUSH_ACCEL * dt so the shove is frame-rate independent (CLAUDE.md rule). The
// value is chosen so a 60fps frame delivers the same impulse (~10) the old
// dt-less code applied every frame, preserving the original feel.
const PUSH_ACCEL = 600;

// Minimum radius change (world units) before the physics wall collider is
// rebuilt. Rebuilding 64 colliders every frame is wasteful; throttling to a
// small step keeps the visual/collider gap well under the wall thickness while
// avoiding per-frame churn.
const COLLIDER_SYNC_STEP = 0.25;

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

        // Deterministic run context (set by Engine). Round timers read sim time
        // from it; falls back to wall time only when no context is attached.
        this.runContext = options.runContext || null;
        this._realClock = new RealClock();

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

        // Arena shrinking
        this.arenaConfig = null;
        this.shrinkingEnabled = false;
        this.shrinkingActive = false;
        this.originalDiameter = 80;
        this.currentDiameter = 80;
        this.minDiameter = 40;
        this.shrinkRate = 0.5; // units per second
        this.shrinkStartTime = 30; // seconds into combat
        this.warningColor = '#FF2E2E'; // 5k3.14: DANGER red
        this.loserPressureActive = false;
        this.loserPressureEvents = [];

        // Wall mesh reference (set by GameHost)
        this.wallMesh = null;
        // Arena wall collider controller (set by GameHost). Exposes
        // setRadius(radius) so the physics wall is rebuilt in lockstep with the
        // visual shrink. Null when no physics is wired (e.g. headless tests).
        this.wallCollider = null;
        // Last radius pushed to the collider controller, for sync throttling.
        this._lastColliderRadius = null;

        // State
        this.initialized = false;
    }

    /**
     * Attach the deterministic run context.
     * @param {import('../engine/GameRunContext.js').GameRunContext} ctx
     */
    setRunContext(ctx) {
        this.runContext = ctx;
    }

    /**
     * Current gameplay time in ms: sim time when a run context is attached
     * (deterministic), else wall time via the allowlisted RealClock adapter.
     * @returns {number}
     * @private
     */
    _nowMs() {
        return this.runContext ? this.runContext.clock.nowMs() : this._realClock.nowMs();
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
     * Set arena configuration including shrinking settings
     * @param {Object} config - Arena config from track JSON
     */
    setArenaConfig(config) {
        this.arenaConfig = config;

        if (config.geometry) {
            // Bowls specify `diameter`; dunes specify `radius`
            const geo = config.geometry;
            this.originalDiameter = geo.diameter || (geo.radius ? geo.radius * 2 : 80);
            this.currentDiameter = this.originalDiameter;
        }

        if (config.derby?.shrinking) {
            const shrink = config.derby.shrinking;
            this.shrinkingEnabled = shrink.enabled !== false;
            this.shrinkStartTime = shrink.startTime || 30;
            this.shrinkRate = shrink.rate || 0.5;
            this.minDiameter = shrink.minDiameter || 40;
            this.warningColor = shrink.warningColor || '#FF2E2E'; // 5k3.14: DANGER red default
        }

        console.log(`DerbySystem: Arena config set. Shrinking: ${this.shrinkingEnabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Set the wall mesh for shrinking visual updates
     * @param {THREE.Mesh} wallMesh - The arena wall mesh
     */
    setWallMesh(wallMesh) {
        this.wallMesh = wallMesh;
    }

    /**
     * Wire the arena wall collider controller used to keep the physics wall in
     * lockstep with the visual shrink.
     *
     * @param {{ setRadius: (radius: number) => void } | null} controller -
     *   Object whose `setRadius(radius)` rebuilds/resizes the Rapier arena wall
     *   to the given radius (world units). GameHost backs this with
     *   `PhysicsSystem.setArenaWallRadius`. Pass null to detach.
     */
    setWallCollider(controller) {
        this.wallCollider = controller;
        this._lastColliderRadius = null;
        // Snap the freshly wired collider to the current arena radius so there
        // is no startup gap before the first shrink step.
        this._syncWallCollider(true);
    }

    /**
     * Parse the configured warning colour (e.g. '#FF4444') into a 0xRRGGBB int.
     * Falls back to a red glow if the value is missing or malformed.
     * @returns {number}
     * @private
     */
    _warningColorHex() {
        const raw = typeof this.warningColor === 'string' ? this.warningColor : '';
        const hex = parseInt(raw.replace('#', ''), 16);
        return Number.isFinite(hex) ? hex : 0xFF2E2E; // 5k3.14: DANGER red
    }

    /**
     * Resize the physics wall collider to match the current visual radius.
     *
     * The visual mesh scales every frame; rebuilding 64 colliders that often is
     * wasteful, so collider rebuilds are throttled to COLLIDER_SYNC_STEP. The
     * residual gap stays well under the wall thickness, so a car at the visible
     * wall is always within collider contact.
     * @param {boolean} [force=false] - Sync even if below the step threshold.
     * @private
     */
    _syncWallCollider(force = false) {
        const controller = this.wallCollider;
        if (!controller || typeof controller.setRadius !== 'function') return;

        const radius = this.currentDiameter / 2;
        if (!force && this._lastColliderRadius !== null &&
            Math.abs(radius - this._lastColliderRadius) < COLLIDER_SYNC_STEP) {
            return;
        }

        controller.setRadius(radius);
        this._lastColliderRadius = radius;
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
        this.loserPressureActive = false;
        for (const [vehicleId, data] of this.vehicles) {
            data.eliminated = false;
            data.eliminationOrder = null;
            // Reset vehicle health
            if (data.vehicle) {
                data.vehicle.health = data.vehicle.maxHealth || 100;
                data.vehicle.isDead = false;
            }
        }

        // Reset arena shrinking
        this.shrinkingActive = false;
        this.currentDiameter = this.originalDiameter;
        if (this.wallMesh) {
            this.wallMesh.scale.set(1, 1, 1);
        }
        // Restore the physics wall to full size for the new round.
        this._syncWallCollider(true);

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
        this.roundStartTime = this._nowMs();

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
            return;
        }

        // Handle arena shrinking
        if (this.shrinkingEnabled) {
            this._updateShrinking(dt);
        }
    }

    /**
     * Update arena shrinking
     * @private
     */
    _updateShrinking(dt) {
        const combatTime = (this._nowMs() - this.roundStartTime) / 1000;

        // Check if we should start shrinking
        if (!this.shrinkingActive && combatTime >= this.shrinkStartTime) {
            this.shrinkingActive = true;
            this._emit('derby:wallsShrinking', {
                currentDiameter: this.currentDiameter,
                minDiameter: this.minDiameter,
                rate: this.shrinkRate
            });
            console.log('DerbySystem: Walls starting to shrink!');
        }

        // Shrink the arena
        if (this.shrinkingActive && this.currentDiameter > this.minDiameter) {
            const shrinkAmount = this.shrinkRate * dt;
            this.currentDiameter = Math.max(this.minDiameter, this.currentDiameter - shrinkAmount);

            // Update wall visuals
            this._updateWallVisuals();

            // Keep the physics collider in lockstep with the visual radius.
            this._syncWallCollider();

            // Push vehicles that are outside the shrinking boundary (dt-scaled).
            this._pushVehiclesInward(dt);
        }
    }

    /**
     * Update wall mesh visuals to reflect shrinking
     * @private
     */
    _updateWallVisuals() {
        if (!this.wallMesh) return;

        const scale = this.currentDiameter / this.originalDiameter;
        this.wallMesh.scale.set(scale, 1, scale);

        // Make walls glow when shrinking. The wall is a THREE.Group of child
        // meshes (track.barriers[0]), so it has no `.material` of its own -
        // traverse to reach the actual mesh materials.
        if (this.shrinkingActive) {
            const intensity = 0.5 + Math.sin(this._nowMs() / 200) * 0.3;
            this._applyWallGlow(this._warningColorHex(), intensity);
        }
    }

    /**
     * Apply an emissive glow to every mesh material under the wall object,
     * whether it is a THREE.Group (traverse children) or a bare THREE.Mesh.
     * @param {number} hex - 0xRRGGBB emissive colour
     * @param {number} intensity - Emissive intensity
     * @private
     */
    _applyWallGlow(hex, intensity) {
        const mesh = this.wallMesh;
        if (!mesh) return;

        const applyToMaterial = (material) => {
            if (!material) return;
            const materials = Array.isArray(material) ? material : [material];
            for (const m of materials) {
                if (m && m.emissive && typeof m.emissive.setHex === 'function') {
                    m.emissive.setHex(hex);
                    m.emissiveIntensity = intensity;
                }
            }
        };

        if (typeof mesh.traverse === 'function') {
            mesh.traverse((obj) => { if (obj && obj.material) applyToMaterial(obj.material); });
        } else if (mesh.material) {
            applyToMaterial(mesh.material);
        }
    }

    /**
     * Push vehicles inward if they are outside the current boundary.
     *
     * The impulse is dt-scaled (PUSH_ACCEL * dt) so the inward shove delivers
     * the same momentum per second regardless of frame rate.
     * @param {number} dt - Delta time in seconds
     * @private
     */
    _pushVehiclesInward(dt) {
        const currentRadius = this.currentDiameter / 2;
        const impulseMagnitude = PUSH_ACCEL * dt; // dt-scaled => frame-rate independent

        for (const [vehicleId, data] of this.vehicles) {
            if (data.eliminated) continue;

            const vehicle = data.vehicle;
            if (!vehicle?.mesh?.position) continue;

            const pos = vehicle.mesh.position;
            const distanceFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);

            // If vehicle is outside the shrinking boundary, push it inward
            if (distanceFromCenter > currentRadius - 2) { // 2 units buffer
                const angle = Math.atan2(pos.z, pos.x);
                const pushX = -Math.cos(angle) * impulseMagnitude;
                const pushZ = -Math.sin(angle) * impulseMagnitude;

                // Apply impulse if physics body available
                if (vehicle.physicsBody) {
                    vehicle.physicsBody.applyImpulse(
                        { x: pushX, y: 0, z: pushZ },
                        true
                    );
                }
            }
        }
    }

    /**
     * Get current arena radius (accounting for shrinking)
     * @returns {number}
     */
    getCurrentRadius() {
        return this.currentDiameter / 2;
    }

    /**
     * Check if shrinking is active
     * @returns {boolean}
     */
    isShrinking() {
        return this.shrinkingActive;
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

        this._triggerLoserPressure({
            eliminatedVehicleId: data.vehicleId,
            eliminatedPlayerId: data.playerId,
            eliminationOrder: vehicleData.eliminationOrder,
            survivors
        });

        console.log(`DerbySystem: Player ${data.playerId} eliminated. ${survivors.length} survivors remaining.`);
    }

    /**
     * Keep eliminated players engaged through visible arena pressure and room-facing context.
     * This does not reintroduce eliminated players, alter scoring, or adjust survivor speed.
     * @private
     */
    _triggerLoserPressure({ eliminatedVehicleId, eliminatedPlayerId, eliminationOrder, survivors }) {
        if (!Array.isArray(survivors) || survivors.length <= 1) return;

        const target = survivors[0] || null;
        const pressureStarted = this.shrinkingEnabled && !this.shrinkingActive;
        if (pressureStarted) {
            this.shrinkingActive = true;
            this._emit('derby:wallsShrinking', {
                currentDiameter: this.currentDiameter,
                minDiameter: this.minDiameter,
                rate: this.shrinkRate,
                reason: 'loser-pressure',
                eliminatedPlayerId
            });
            this._updateWallVisuals();
            this._syncWallCollider(true);
        }

        const event = {
            eliminatedVehicleId,
            eliminatedPlayerId,
            eliminationOrder,
            survivorsLeft: survivors.length,
            targetPlayerId: target?.playerId || null,
            targetVehicleId: target?.vehicle?.id || null,
            pressureType: pressureStarted ? 'arena-shrink-started' : 'leader-target',
            arenaPressureActive: !!this.shrinkingActive,
            reentry: 'next-round',
            noSpeedAssist: true,
            noCurrentRoundRespawn: true
        };

        this.loserPressureActive = true;
        this.loserPressureEvents.push(event);
        this._emit('derby:loserPressure', event);
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

        const roundTime = this._nowMs() - this.roundStartTime;

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
        return this._nowMs() - this.roundStartTime;
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
        this.loserPressureActive = false;
        this.loserPressureEvents = [];

        // Reset arena shrinking
        this.shrinkingActive = false;
        this.currentDiameter = this.originalDiameter;
        if (this.wallMesh) {
            this.wallMesh.scale.set(1, 1, 1);
        }
        // Restore the physics wall to full size.
        this._syncWallCollider(true);

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
     * Expose deterministic pressure state for tests and validation artifacts.
     */
    getLoserPressureDiagnostics() {
        return {
            active: this.loserPressureActive,
            eventCount: this.loserPressureEvents.length,
            lastEvent: this.loserPressureEvents[this.loserPressureEvents.length - 1] || null,
            shrinkingActive: this.shrinkingActive,
            currentDiameter: this.currentDiameter,
            state: this.state
        };
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
        this.loserPressureActive = false;
        this.loserPressureEvents = [];
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
