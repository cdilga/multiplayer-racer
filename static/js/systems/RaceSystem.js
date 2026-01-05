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

class RaceSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {Track} [options.track] - Track entity
     * @param {number} [options.laps=3] - Number of laps
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);
        this.track = options.track || null;
        this.totalLaps = options.laps || 3;
        this.mode = options.mode || 'race';

        // Race state
        this.state = 'idle';  // idle, countdown, racing, finished
        this.countdownValue = 3;
        this.countdownTimer = 0;
        this.raceStartTime = 0;
        this.raceEndTime = 0;

        // Registered vehicles
        this.vehicles = new Map();  // vehicleId -> raceData

        // Finish order
        this.finishOrder = [];

        // State
        this.initialized = false;
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
        this.vehicles.set(vehicle.id, {
            vehicle: vehicle,
            currentLap: 0,
            nextCheckpoint: 0,
            lapTimes: [],
            bestLapTime: null,
            lastCheckpointTime: 0,
            totalTime: 0,
            position: 0,
            finished: false,
            finishTime: null
        });

        // Sync to vehicle entity
        vehicle.currentLap = 0;
        vehicle.nextCheckpoint = 0;
        vehicle.lapTimes = [];
        vehicle.finished = false;
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
     * Start countdown
     */
    startCountdown() {
        this.state = 'countdown';
        this.countdownValue = 3;
        this.countdownTimer = 0;

        this._emit('race:countdown', { count: this.countdownValue });
    }

    /**
     * Start the race immediately
     */
    startRace() {
        this.state = 'racing';
        this.raceStartTime = performance.now();

        // Reset all vehicle race data
        for (const [id, data] of this.vehicles) {
            data.currentLap = 0;
            data.nextCheckpoint = 0;
            data.lapTimes = [];
            data.lastCheckpointTime = this.raceStartTime;
            data.totalTime = 0;
            data.position = 0;
            data.finished = false;
            data.finishTime = null;

            // Sync to vehicle
            data.vehicle.currentLap = 0;
            data.vehicle.nextCheckpoint = 0;
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
        const now = performance.now();

        // Check checkpoints for each vehicle
        for (const [vehicleId, data] of this.vehicles) {
            if (data.finished) continue;

            const vehicle = data.vehicle;
            const pos = vehicle.position;

            // Check if crossed next checkpoint
            if (this.track && this.track.isInCheckpoint(pos, data.nextCheckpoint)) {
                this._onCheckpointCrossed(vehicleId, data, now);
            }
        }

        // Update positions
        this._updatePositions();

        // Check if race is complete
        if (this._isRaceComplete()) {
            this._endRace();
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

        this.finishOrder.push({
            vehicleId,
            playerId: data.vehicle.playerId,
            finishTime: data.finishTime,
            position: this.finishOrder.length + 1
        });

        this._emit('race:vehicleFinished', {
            vehicleId,
            position: this.finishOrder.length,
            finishTime: data.finishTime,
            lapTimes: data.lapTimes
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
     * Check if race is complete
     * @private
     */
    _isRaceComplete() {
        // Race complete when all vehicles finished
        for (const [id, data] of this.vehicles) {
            if (!data.finished) return false;
        }
        return this.vehicles.size > 0;
    }

    /**
     * End the race
     * @private
     */
    _endRace() {
        this.state = 'finished';
        this.raceEndTime = performance.now();

        const results = this.finishOrder.map((entry, index) => {
            const data = this.vehicles.get(entry.vehicleId);
            return {
                position: index + 1,
                vehicleId: entry.vehicleId,
                playerId: entry.playerId,
                finishTime: entry.finishTime,
                lapTimes: data?.lapTimes || [],
                bestLapTime: data?.bestLapTime
            };
        });

        this._emit('race:finished', {
            results,
            totalTime: this.raceEndTime - this.raceStartTime
        });
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
        return performance.now() - this.raceStartTime;
    }

    /**
     * Get countdown value
     * @returns {number}
     */
    getCountdown() {
        return this.countdownValue;
    }

    /**
     * Reset race
     */
    reset() {
        this.state = 'idle';
        this.countdownValue = 3;
        this.countdownTimer = 0;
        this.finishOrder = [];

        for (const [id, data] of this.vehicles) {
            data.currentLap = 0;
            data.nextCheckpoint = 0;
            data.lapTimes = [];
            data.bestLapTime = null;
            data.position = 0;
            data.finished = false;
            data.finishTime = null;

            data.vehicle.resetRaceState();
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
