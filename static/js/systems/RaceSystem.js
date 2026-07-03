/**
 * RaceSystem - Manages race logic
 *
 * Responsibilities:
 * - Track lap progress
 * - Detect checkpoint crossings
 * - Calculate positions
 * - Handle countdown
 * - Determine race finish
 *
 * Usage:
 *   const race = new RaceSystem({ eventBus, track });
 *   race.startCountdown();
 *   race.update(dt);
 */

import { RealClock } from '../engine/Clock.js';

class RaceSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {Track} [options.track] - Track entity
     * @param {number} [options.laps=3] - Number of laps
     * @param {number} [options.finishGraceMs=30000] - Finish grace duration in ms
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.track = options.track || null;
        this.totalLaps = options.laps || 3;
        this.mode = options.mode || 'race';
        this.finishGraceMs = options.finishGraceMs || 30000;

        // Deterministic run context (set by Engine). Race timers read sim time
        // from it; falls back to wall time only when no context is attached.
        this.runContext = options.runContext || null;
        this._realClock = new RealClock();

        // Race state
        this.state = 'idle';  // idle, countdown, racing, grace, finished
        this.countdownValue = 3;
        this.countdownTimer = 0;
        this.raceStartTime = 0;
        this.raceEndTime = 0;
        this.firstFinisherTime = null;
        this.graceStartTime = null;

        // Registered vehicles
        this.vehicles = new Map();  // vehicleId -> raceData

        // Finish order
        this.finishOrder = [];

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
     * Initialize race system
     */
    async init() {
        if (this.initialized) return;

        console.log('RaceSystem: Initializing...');

        this.initialized = true;
        this._emit('race:ready');
        console.log('RaceSystem: Ready');
    }

    /**
     * Set the track
     * @param {Track} track
     */
    setTrack(track) {
        this.track = track;
        this.totalLaps = track.defaultLaps || this.totalLaps;
    }

    /**
     * Set game mode
     * @param {string} mode - 'race', 'derby', 'fight'
     */
    setMode(mode) {
        this.mode = mode;
        console.log('RaceSystem: Mode set to', mode);
    }

    /**
     * Set number of laps
     * @param {number} laps
     */
    setLaps(laps) {
        this.totalLaps = laps;
    }

    /**
     * Register a vehicle for the race
     * @param {Vehicle} vehicle
     */
    registerVehicle(vehicle) {
        const firstTarget = this._getFirstCheckpointTarget();
        const pos = this._getVehiclePosition(vehicle);
        this.vehicles.set(vehicle.id, {
            vehicle: vehicle,
            currentLap: 0,
            nextCheckpoint: firstTarget,
            lapTimes: [],
            bestLapTime: null,
            lastCheckpointTime: 0,
            totalTime: 0,
            position: 0,
            prevPosition: { x: pos.x, y: pos.y, z: pos.z }, // Track previous frame position for crossing detection
            finished: false,
            finishTime: null
        });

        // Sync to vehicle entity
        vehicle.currentLap = 0;
        vehicle.nextCheckpoint = firstTarget;
        vehicle.lapTimes = [];
        vehicle.finished = false;
    }

    /**
     * First checkpoint to chase after the start. Cars line up on the finish
     * line, so targeting it first would award a free lap immediately.
     * @private
     * @returns {number}
     */
    _getFirstCheckpointTarget() {
        if (!this.track || this.track.getCheckpointCount() < 2) return 0;
        return this.track.getNextCheckpointIndex(this.track.finishLineIndex);
    }

    /**
     * Snapshot a vehicle position for checkpoint segment tests.
     * @private
     * @param {Object} vehicle
     * @returns {{x:number,y:number,z:number}}
     */
    _getVehiclePosition(vehicle) {
        const source = vehicle?.position || vehicle?.mesh?.position || {};
        const x = Number.isFinite(source.x) ? source.x : 0;
        const y = Number.isFinite(source.y) ? source.y : 0;
        const z = Number.isFinite(source.z) ? source.z : 0;
        return { x, y, z };
    }

    /**
     * Unregister a vehicle
     * @param {string} vehicleId
     */
    unregisterVehicle(vehicleId) {
        this.vehicles.delete(vehicleId);
    }

    /**
     * Clear all vehicles
     */
    clearVehicles() {
        this.vehicles.clear();
        this.finishOrder = [];
    }

    /**
     * Check if running in test mode (for faster tests)
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
     * Start countdown
     */
    startCountdown() {
        // Skip countdown in test mode for faster tests
        if (this._isTestMode()) {
            console.log('RaceSystem: Test mode - skipping countdown');
            this._emit('race:countdown', { count: 0, testMode: true });
            this.startRace();
            return;
        }

        this.state = 'countdown';
        this.countdownValue = 3;
        this.countdownTimer = 0;

        this._emit('race:countdown', { count: this.countdownValue });
    }

    /**
     * Start the race immediately
     */
    startRace() {
        // A started race is active: allow update() (checkpoints, grace, DNF) to run
        // even when init() was never awaited (init() only emits the ready event).
        this.initialized = true;
        this.state = 'racing';
        this.raceStartTime = this._nowMs();

        // Reset all vehicle race data
        const firstTarget = this._getFirstCheckpointTarget();
        for (const [id, data] of this.vehicles) {
            data.currentLap = 0;
            data.nextCheckpoint = firstTarget;
            data.lapTimes = [];
            data.lastCheckpointTime = this.raceStartTime;
            data.totalTime = 0;
            data.position = 0;
            data.prevPosition = this._getVehiclePosition(data.vehicle);
            data.finished = false;
            data.finishTime = null;

            // Sync to vehicle
            data.vehicle.currentLap = 0;
            data.vehicle.nextCheckpoint = firstTarget;
            data.vehicle.lapTimes = [];
            data.vehicle.finished = false;
        }

        this.finishOrder = [];

        this._emit('race:start', { startTime: this.raceStartTime });
    }

    /**
     * Update race system
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.initialized) return;

        if (this.state === 'countdown') {
            this._updateCountdown(dt);
        } else if (this.state === 'racing') {
            this._updateRace(dt);
        } else if (this.state === 'grace') {
            this._updateGrace(dt);
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
                this._emit('race:countdown', { count: this.countdownValue });
            } else {
                this.startRace();
            }
        }
    }

    /**
     * Update race logic
     * @private
     */
    _updateRace(dt) {
        const now = this._nowMs();

        // Check checkpoints for each vehicle (dead cars don't progress)
        for (const [vehicleId, data] of this.vehicles) {
            if (data.finished || data.vehicle.isDead) continue;

            const vehicle = data.vehicle;
            const currPos = this._getVehiclePosition(vehicle);

            // Check if crossed next checkpoint using frame-to-frame gate detection
            if (this.track && this.track.checkCrossing(data.prevPosition, currPos, data.nextCheckpoint)) {
                this._onCheckpointCrossed(vehicleId, data, now);
            }

            // Update previous position for next frame
            data.prevPosition = { x: currPos.x, y: currPos.y, z: currPos.z };
        }

        // Update positions
        this._updatePositions();

        // Check if first finisher crossed finish line; start grace
        if (this._hasFirstFinisher() && !this._inGracePhase()) {
            this._startGrace(now);
        }
    }

    /**
     * Handle checkpoint crossing
     * @private
     */
    _onCheckpointCrossed(vehicleId, data, now) {
        const checkpoint = this.track.getCheckpoint(data.nextCheckpoint);
        const isFinishLine = checkpoint?.isFinishLine || false;

        // Record checkpoint time
        const checkpointTime = now - data.lastCheckpointTime;
        data.lastCheckpointTime = now;

        // Move to next checkpoint
        const prevCheckpoint = data.nextCheckpoint;
        data.nextCheckpoint = this.track.getNextCheckpointIndex(data.nextCheckpoint);

        this._emit('race:checkpoint', {
            vehicleId,
            checkpoint: prevCheckpoint,
            time: checkpointTime
        });

        // Check for lap completion
        if (isFinishLine && data.currentLap > 0) {
            this._onLapComplete(vehicleId, data, now);
        }

        // If this is finish line, increment lap
        if (isFinishLine) {
            data.currentLap++;
            data.vehicle.currentLap = data.currentLap;

            // Check for race finish
            if (data.currentLap >= this.totalLaps) {
                this._onVehicleFinish(vehicleId, data, now);
            }
        }

        // Sync to vehicle entity
        data.vehicle.nextCheckpoint = data.nextCheckpoint;
    }

    /**
     * Handle lap completion
     * @private
     */
    _onLapComplete(vehicleId, data, now) {
        const lapTime = now - this.raceStartTime - data.lapTimes.reduce((a, b) => a + b, 0);
        data.lapTimes.push(lapTime);
        data.vehicle.lapTimes = [...data.lapTimes];

        // Update best lap time
        if (!data.bestLapTime || lapTime < data.bestLapTime) {
            data.bestLapTime = lapTime;
            data.vehicle.bestLapTime = lapTime;
        }

        this._emit('race:lapComplete', {
            vehicleId,
            lap: data.currentLap,
            lapTime,
            bestLapTime: data.bestLapTime
        });
    }

    /**
     * Handle vehicle finishing
     * @private
     */
    _onVehicleFinish(vehicleId, data, now) {
        data.finished = true;
        data.finishTime = now - this.raceStartTime;
        data.vehicle.finished = true;
        data.isLateJoin = data.isLateJoin || false;

        this.finishOrder.push({
            vehicleId,
            playerId: data.vehicle.playerId,
            finishTime: data.finishTime,
            position: this.finishOrder.length + 1,
            isLateJoin: data.isLateJoin
        });

        this._emit('race:vehicleFinished', {
            vehicleId,
            position: this.finishOrder.length,
            finishTime: data.finishTime,
            lapTimes: data.lapTimes,
            isLateJoin: data.isLateJoin
        });
    }

    /**
     * Update race positions
     * @private
     */
    _updatePositions() {
        // Sort vehicles by progress (lap * 1000 + checkpoint progress)
        const sortedVehicles = Array.from(this.vehicles.entries())
            .map(([id, data]) => ({
                id,
                data,
                progress: this._calculateProgress(data)
            }))
            .sort((a, b) => b.progress - a.progress);

        // Assign positions
        sortedVehicles.forEach((entry, index) => {
            const position = index + 1;
            entry.data.position = position;
            entry.data.vehicle.racePosition = position;
        });
    }

    /**
     * Calculate progress for sorting
     * @private
     */
    _calculateProgress(data) {
        if (data.finished) {
            // Finished vehicles sorted by finish time (inverted so lower is better)
            return 100000 - data.finishTime / 1000;
        }

        const checkpointCount = this.track?.getCheckpointCount() || 4;
        const checkpointProgress = data.nextCheckpoint / checkpointCount;
        return data.currentLap + checkpointProgress;
    }

    /**
     * Check if at least one vehicle has finished
     * @private
     */
    _hasFirstFinisher() {
        return this.finishOrder.length > 0;
    }

    /**
     * Check if in grace phase
     * @private
     */
    _inGracePhase() {
        return this.state === 'grace';
    }

    /**
     * Start finish grace period
     * @private
     */
    _startGrace(now) {
        this.state = 'grace';
        this.firstFinisherTime = now - this.raceStartTime;
        this.graceStartTime = now;

        this._emit('race:graceStarted', {
            firstFinisherTime: this.firstFinisherTime,
            graceDurationMs: this.finishGraceMs
        });
    }

    /**
     * Update grace phase
     * @private
     */
    _updateGrace(dt) {
        const now = this._nowMs();
        const graceElapsed = now - this.graceStartTime;

        // Check if grace has expired
        if (graceElapsed >= this.finishGraceMs) {
            this._endGraceAndRank(now);
            return;
        }

        // Continue processing checkpoints during grace (late finishers can still cross)
        for (const [vehicleId, data] of this.vehicles) {
            if (data.finished || data.vehicle.isDead) continue;

            const vehicle = data.vehicle;
            const currPos = this._getVehiclePosition(vehicle);

            if (this.track && this.track.checkCrossing(data.prevPosition, currPos, data.nextCheckpoint)) {
                this._onCheckpointCrossed(vehicleId, data, now);
            }

            // Update previous position for next frame
            data.prevPosition = { x: currPos.x, y: currPos.y, z: currPos.z };
        }

        // Check if all vehicles finished (early close)
        if (this._allVehiclesFinished()) {
            this._endGraceAndRank(now);
            return;
        }

        // Update positions for display during grace
        this._updatePositions();

        // Emit grace update
        const timeRemaining = this.finishGraceMs - graceElapsed;
        this._emit('race:graceUpdate', {
            timeRemainingMs: timeRemaining,
            unfinishedCount: this._countUnfinished()
        });
    }

    /**
     * Check if all vehicles are finished
     * @private
     */
    _allVehiclesFinished() {
        for (const [id, data] of this.vehicles) {
            if (!data.finished) return false;
        }
        return this.vehicles.size > 0;
    }

    /**
     * Count unfinished vehicles
     * @private
     */
    _countUnfinished() {
        let count = 0;
        for (const [id, data] of this.vehicles) {
            if (!data.finished) count++;
        }
        return count;
    }

    /**
     * End grace and rank remaining vehicles as DNF
     * @private
     */
    _endGraceAndRank(now) {
        this.state = 'finished';
        this.raceEndTime = now;

        // Rank unfinished vehicles by progress
        const unfinished = Array.from(this.vehicles.entries())
            .filter(([id, data]) => !data.finished)
            .map(([id, data]) => ({
                id,
                data,
                progress: this._calculateDNFProgress(data),
                seatId: this._extractSeatId(data.vehicle)
            }))
            .sort((a, b) => {
                if (b.progress !== a.progress) return b.progress - a.progress;
                return a.seatId - b.seatId;
            });

        // Add DNF vehicles to results
        let dnfPosition = this.finishOrder.length + 1;
        for (const {id, data, seatId} of unfinished) {
            this.finishOrder.push({
                vehicleId: id,
                playerId: data.vehicle.playerId,
                finishTime: null,
                position: dnfPosition,
                isLateJoin: data.isLateJoin || false,
                isDNF: true,
                dnfProgress: this._calculateDNFProgress(data)
            });
            dnfPosition++;
        }

        // Emit finished event with full results
        const results = this.finishOrder.map((entry, index) => {
            const data = this.vehicles.get(entry.vehicleId);
            return {
                position: index + 1,
                vehicleId: entry.vehicleId,
                playerId: entry.playerId,
                finishTime: entry.finishTime,
                lapTimes: data?.lapTimes || [],
                bestLapTime: data?.bestLapTime,
                isLateJoin: entry.isLateJoin,
                isDNF: entry.isDNF || false,
                dnfProgress: entry.dnfProgress
            };
        });

        this._emit('race:finished', {
            results,
            totalTime: this.raceEndTime - this.raceStartTime,
            graceExpired: true,
            graceTimeMs: this.finishGraceMs
        });
    }

    /**
     * Calculate DNF progress for ranking (lap, checkpoint, distance estimate, lastProgressTime, seatId)
     * @private
     */
    _calculateDNFProgress(data) {
        const checkpointCount = this.track?.getCheckpointCount() || 4;
        return {
            lap: data.currentLap,
            checkpoint: data.nextCheckpoint,
            checkpointRatio: data.nextCheckpoint / checkpointCount,
            lastProgressTimeMs: data.lastCheckpointTime
        };
    }

    /**
     * Extract or generate stable seat ID for tiebreaker display
     * @private
     */
    _extractSeatId(vehicle) {
        return vehicle.seatId || vehicle.id?.charCodeAt(0) || 0;
    }

    /**
     * Get race state
     * @returns {string}
     */
    getState() {
        return this.state;
    }

    /**
     * Get vehicle race data
     * @param {string} vehicleId
     * @returns {Object|null}
     */
    getVehicleData(vehicleId) {
        return this.vehicles.get(vehicleId) || null;
    }

    /**
     * Get current positions
     * @returns {Object[]}
     */
    getPositions() {
        return Array.from(this.vehicles.values())
            .sort((a, b) => a.position - b.position)
            .map(data => ({
                vehicleId: data.vehicle.id,
                playerId: data.vehicle.playerId,
                position: data.position,
                lap: data.currentLap,
                finished: data.finished
            }));
    }

    /**
     * Get race time elapsed
     * @returns {number} Time in milliseconds
     */
    getRaceTime() {
        if (this.state !== 'racing') return 0;
        return this._nowMs() - this.raceStartTime;
    }

    /**
     * Get countdown value
     * @returns {number}
     */
    getCountdown() {
        return this.countdownValue;
    }

    /**
     * Mark vehicle as late join
     * @param {string} vehicleId
     */
    markAsLateJoin(vehicleId) {
        const data = this.vehicles.get(vehicleId);
        if (data) {
            data.isLateJoin = true;
        }
    }

    /**
     * Check if vehicle can join active race (before first finisher, before 50% expected duration)
     * @param {number} elapsedMs - Elapsed race time in ms
     * @returns {boolean}
     */
    canJoinActiveRace(elapsedMs) {
        if (this.state !== 'racing') return false;
        if (this._hasFirstFinisher()) return false;

        const expectedRaceDurationMs = this.totalLaps * 60000;
        const threshold50Percent = expectedRaceDurationMs * 0.5;
        return elapsedMs < threshold50Percent;
    }

    /**
     * Check if late joiners should spectate or queue
     * @returns {boolean} True if in grace phase or finished
     */
    shouldLateJoinSpectate() {
        return this.state === 'grace' || this.state === 'finished';
    }

    /**
     * Get current grace time remaining (for UI display)
     * @returns {number} Time remaining in ms, or 0 if not in grace phase
     */
    getGraceTimeRemaining() {
        if (this.state !== 'grace' || !this.graceStartTime) return 0;
        const now = this._nowMs();
        const elapsed = now - this.graceStartTime;
        return Math.max(0, this.finishGraceMs - elapsed);
    }

    /**
     * Get race results (finishers + DNF ranked by progress)
     * @returns {Object[]}
     */
    getResults() {
        return this.finishOrder.map((entry, index) => {
            const data = this.vehicles.get(entry.vehicleId);
            return {
                position: index + 1,
                vehicleId: entry.vehicleId,
                playerId: entry.playerId,
                finishTime: entry.finishTime,
                lapTimes: data?.lapTimes || [],
                bestLapTime: data?.bestLapTime,
                isLateJoin: entry.isLateJoin || false,
                isDNF: entry.isDNF || false,
                restrictedPodium: entry.isLateJoin || entry.isDNF
            };
        });
    }

    /**
     * Reset race
     */
    reset() {
        this.state = 'idle';
        this.countdownValue = 3;
        this.countdownTimer = 0;
        this.finishOrder = [];
        this.firstFinisherTime = null;
        this.graceStartTime = null;

        for (const [id, data] of this.vehicles) {
            data.currentLap = 0;
            data.nextCheckpoint = 0;
            data.lapTimes = [];
            data.bestLapTime = null;
            data.position = 0;
            data.finished = false;
            data.finishTime = null;
            data.isLateJoin = false;

            if (data.vehicle.resetRaceState) {
                data.vehicle.resetRaceState();
            }
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
     * Destroy race system
     */
    destroy() {
        this.vehicles.clear();
        this.finishOrder = [];
        this.initialized = false;
    }
}

// Export for ES Modules
export { RaceSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.RaceSystem = RaceSystem;
}
