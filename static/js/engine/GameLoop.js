/**
 * GameLoop - Fixed timestep game loop with interpolation
 *
 * Uses a fixed timestep for physics (deterministic) while allowing
 * variable render rate for smooth visuals.
 *
 * Usage:
 *   import { GameLoop } from './engine/GameLoop.js';
 *   import { eventBus } from './engine/EventBus.js';
 *
 *   const loop = new GameLoop({ fixedTimestep: 1/60, eventBus });
 *   loop.start();
 *
 * Events emitted:
 *   - 'loop:update' { dt, accumulator } - Fixed timestep update (for physics)
 *   - 'loop:render' { dt, interpolation } - Variable render update
 *   - 'loop:start' - Loop started
 *   - 'loop:stop' - Loop stopped
 *   - 'loop:pause' - Loop paused
 *   - 'loop:resume' - Loop resumed
 */

class GameLoop {
    /**
     * @param {Object} options
     * @param {number} [options.fixedTimestep=1/60] - Physics timestep in seconds
     * @param {number} [options.maxFrameTime=0.25] - Max frame time to prevent spiral of death
     * @param {EventBus} [options.eventBus] - EventBus instance for emitting events
     */
    constructor(options = {}) {
        this.fixedTimestep = options.fixedTimestep || 1 / 60;  // 60 Hz physics
        this.maxFrameTime = options.maxFrameTime || 0.25;      // Cap at 250ms
        this.eventBus = options.eventBus || (typeof window !== 'undefined' ? window.eventBus : null);

        this.accumulator = 0;
        this.lastTime = 0;
        this.running = false;
        this.paused = false;
        this.animationFrameId = null;

        // Performance tracking
        this.frameCount = 0;
        this.fps = 0;
        this.lastFpsUpdate = 0;

        // Bind methods for RAF callback
        this._tick = this._tick.bind(this);
    }

    /**
     * Start the game loop
     */
    start() {
        if (this.running) return;

        this.running = true;
        this.paused = false;
        this.lastTime = performance.now() / 1000;
        this.accumulator = 0;
        this.frameCount = 0;
        this.lastFpsUpdate = this.lastTime;

        this._emit('loop:start');
        this.animationFrameId = requestAnimationFrame(this._tick);

        // Add setInterval fallback for headless/background mode where rAF is throttled
        // This ensures physics updates still happen even when rAF is not firing
        this._fallbackInterval = setInterval(() => {
            if (!this.running || this.paused) return;

            const now = performance.now();
            // Only trigger fallback if rAF hasn't fired for 100ms (throttled)
            if (now - (this._lastRafTime || 0) > 100) {
                this._tick(now);
            }
        }, 16); // ~60 Hz
    }

    /**
     * Stop the game loop completely
     */
    stop() {
        if (!this.running) return;

        this.running = false;
        this.paused = false;

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Clear fallback interval
        if (this._fallbackInterval) {
            clearInterval(this._fallbackInterval);
            this._fallbackInterval = null;
        }

        this._emit('loop:stop');
    }

    /**
     * Pause the loop (keeps RAF running but doesn't update)
     */
    pause() {
        if (!this.running || this.paused) return;

        this.paused = true;
        this._emit('loop:pause');
    }

    /**
     * Resume from pause
     */
    resume() {
        if (!this.running || !this.paused) return;

        this.paused = false;
        this.lastTime = performance.now() / 1000;
        this.accumulator = 0;
        this._emit('loop:resume');
    }

    /**
     * Toggle pause state
     */
    togglePause() {
        if (this.paused) {
            this.resume();
        } else {
            this.pause();
        }
    }

    /**
     * Main tick function called by requestAnimationFrame or fallback
     * @private
     */
    _tick(timestamp) {
        if (!this.running) return;

        // Track when tick was last called (for fallback detection)
        this._lastRafTime = performance.now();

        // Always schedule next rAF frame (rAF will handle deduplication)
        this.animationFrameId = requestAnimationFrame(this._tick);

        // Convert to seconds
        const currentTime = timestamp / 1000;
        let frameTime = currentTime - this.lastTime;
        this.lastTime = currentTime;

        // Skip updates if paused
        if (this.paused) return;

        // Prevent spiral of death
        if (frameTime > this.maxFrameTime) {
            frameTime = this.maxFrameTime;
        }

        // Update FPS counter
        this.frameCount++;
        if (currentTime - this.lastFpsUpdate >= 1.0) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = currentTime;
        }

        // Accumulate time for fixed updates
        this.accumulator += frameTime;

        // Fixed timestep updates (physics)
        while (this.accumulator >= this.fixedTimestep) {
            this._emit('loop:update', {
                dt: this.fixedTimestep,
                accumulator: this.accumulator,
                time: currentTime
            });
            this.accumulator -= this.fixedTimestep;
        }

        // Render with interpolation
        const interpolation = this.accumulator / this.fixedTimestep;
        this._emit('loop:render', {
            dt: frameTime,
            interpolation,
            fps: this.fps,
            time: currentTime
        });
    }

    /**
     * Emit an event if eventBus is available
     * @private
     */
    _emit(event, data) {
        if (this.eventBus) {
            this.eventBus.emit(event, data);
        }
    }

    /**
     * Get current FPS
     * @returns {number}
     */
    getFps() {
        return this.fps;
    }

    /**
     * Check if loop is running
     * @returns {boolean}
     */
    isRunning() {
        return this.running;
    }

    /**
     * Check if loop is paused
     * @returns {boolean}
     */
    isPaused() {
        return this.paused;
    }
}

// Export for ES Modules
export { GameLoop };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.GameLoop = GameLoop;
}
