/**
 * AudioSystem - Manages game audio
 *
 * Wraps the existing audioManager to integrate with the event-driven architecture.
 *
 * Responsibilities:
 * - Play background music
 * - Play sound effects
 * - Handle audio ducking
 * - Respond to game events
 *
 * Usage:
 *   const audio = new AudioSystem({ eventBus });
 *   await audio.init();
 */

class AudioSystem {
    /**
     * @param {Object} options
     * @param {EventBus} [options.eventBus]
     * @param {AudioManager} [options.audioManager] - Existing AudioManager instance
     */
    constructor(options = {}) {
        this.eventBus = options.eventBus ||
            (typeof window !== 'undefined' ? window.eventBus : null);

        // Use existing audioManager or create reference
        this.audioManager = options.audioManager ||
            (typeof window !== 'undefined' ? window.audioManager : null);

        // State
        this.initialized = false;
        this.enabled = true;
    }

    /**
     * Initialize audio system
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        console.log('AudioSystem: Initializing...');

        // Initialize and load sounds from audioManager
        if (this.audioManager) {
            this.audioManager.init();
            await this.audioManager.loadSounds();
            this.audioManager.loadPreferences();
        }

        // Subscribe to game events
        this._subscribeToEvents();

        this.initialized = true;
        this._emit('audio:ready');
        console.log('AudioSystem: Ready');
    }

    /**
     * Subscribe to game events
     * @private
     */
    _subscribeToEvents() {
        if (!this.eventBus) return;

        // Game state events
        this.eventBus.on('game:lobby', () => {
            this.stopEngineSound();
            this.playMusic('lobby');
        });

        this.eventBus.on('game:countdown', () => {
            this.playSound('countdown');
        });

        this.eventBus.on('game:racing', () => {
            this.playMusic('racing');
            this.startEngineSound();
        });

        this.eventBus.on('game:results', () => {
            this.stopEngineSound();
            this.playMusic('results');
        });

        // Player events
        this.eventBus.on('network:playerJoined', () => {
            this.playPlayerJoin();
        });

        // Physics events
        this.eventBus.on('physics:collision', (data) => {
            this.playCollisionSound(data);
        });

        // Checkpoint events
        this.eventBus.on('race:checkpoint', () => {
            this.playSound('checkpoint');
        });

        this.eventBus.on('race:lapComplete', () => {
            this.playSound('lap_complete');
        });

        this.eventBus.on('race:finished', () => {
            this.playSound('race_finish');
        });
    }

    /**
     * Play background music
     * @param {string} trackName - Music track name
     */
    playMusic(trackName) {
        if (!this.enabled || !this.audioManager) return;

        // Map track names to actual music files (must match audioManager loaded tracks)
        const musicMap = {
            'lobby': 'lobby',
            'racing': 'race_main',
            'results': 'victory',
            'menu': 'lobby',
            'countdown': 'countdown'
        };

        const actualTrack = musicMap[trackName] || trackName;

        try {
            this.audioManager.playMusic(actualTrack);
        } catch (error) {
            console.warn(`AudioSystem: Failed to play music '${trackName}'`, error);
        }
    }

    /**
     * Stop all music
     */
    stopMusic() {
        if (!this.audioManager) return;
        this.audioManager.stopAllMusic();
    }

    /**
     * Play sound effect
     * @param {string} soundName
     * @param {Object} [options]
     */
    playSound(soundName, options = {}) {
        if (!this.enabled || !this.audioManager) return;

        try {
            this.audioManager.playSound(soundName, options);
        } catch (error) {
            console.warn(`AudioSystem: Failed to play sound '${soundName}'`, error);
        }
    }

    /**
     * Play player join sound with ducking
     */
    playPlayerJoin() {
        if (!this.enabled || !this.audioManager) return;

        try {
            if (typeof this.audioManager.playPlayerJoin === 'function') {
                this.audioManager.playPlayerJoin();
            } else {
                this.audioManager.duckMusic(0.5);
                this.audioManager.playSound('player_join', { volume: 0.8 });
            }
        } catch (error) {
            console.warn('AudioSystem: Failed to play player join sound', error);
        }
    }

    /**
     * Play collision sound
     * @param {Object} collisionData
     */
    playCollisionSound(collisionData) {
        if (!this.enabled || !this.audioManager) return;

        // Calculate intensity from collision (if velocity available)
        let intensity = 0.5;
        if (collisionData.entityA?.velocity && collisionData.entityB?.velocity) {
            const velA = collisionData.entityA.velocity;
            const velB = collisionData.entityB.velocity || { x: 0, y: 0, z: 0 };

            const relVel = {
                x: velA.x - velB.x,
                y: velA.y - velB.y,
                z: velA.z - velB.z
            };
            const speed = Math.sqrt(relVel.x * relVel.x + relVel.y * relVel.y + relVel.z * relVel.z);
            intensity = Math.min(1, speed / 20);  // Normalize to 0-1
        }

        try {
            if (typeof this.audioManager.playCollisionSound === 'function') {
                this.audioManager.playCollisionSound(intensity);
            } else {
                const soundName = intensity > 0.6 ? 'collision_hard' : 'collision_soft';
                this.audioManager.playSound(soundName, { volume: 0.5 + intensity * 0.5 });
            }
        } catch (error) {
            console.warn('AudioSystem: Failed to play collision sound', error);
        }
    }

    /**
     * Set master volume
     * @param {number} volume - 0 to 1
     */
    setMasterVolume(volume) {
        if (!this.audioManager) return;

        if (typeof this.audioManager.setMasterVolume === 'function') {
            this.audioManager.setMasterVolume(volume);
        }
    }

    /**
     * Set music volume
     * @param {number} volume - 0 to 1
     */
    setMusicVolume(volume) {
        if (!this.audioManager) return;

        if (typeof this.audioManager.setMusicVolume === 'function') {
            this.audioManager.setMusicVolume(volume);
        }
    }

    /**
     * Set SFX volume
     * @param {number} volume - 0 to 1
     */
    setSfxVolume(volume) {
        if (!this.audioManager) return;

        if (typeof this.audioManager.setSfxVolume === 'function') {
            this.audioManager.setSfxVolume(volume);
        }
    }

    /**
     * Mute/unmute audio
     * @param {boolean} muted
     */
    setMuted(muted) {
        if (!this.audioManager) return;

        if (typeof this.audioManager.setMuted === 'function') {
            this.audioManager.setMuted(muted);
        }
    }

    /**
     * Enable audio
     */
    enable() {
        this.enabled = true;
    }

    /**
     * Disable audio
     */
    disable() {
        this.enabled = false;
        this.stopMusic();
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

    // ==========================================
    // ENGINE SOUND SYSTEM
    // ==========================================

    /**
     * Start the engine sound loop
     */
    startEngineSound() {
        if (!this.enabled || !this.audioManager) return;

        try {
            if (typeof this.audioManager.startEngineSound === 'function') {
                this.audioManager.startEngineSound();
            }
        } catch (error) {
            console.warn('AudioSystem: Failed to start engine sound', error);
        }
    }

    /**
     * Stop the engine sound
     */
    stopEngineSound() {
        if (!this.audioManager) return;

        try {
            if (typeof this.audioManager.stopEngineSound === 'function') {
                this.audioManager.stopEngineSound();
            }
        } catch (error) {
            console.warn('AudioSystem: Failed to stop engine sound', error);
        }
    }

    /**
     * Update engine sound based on vehicle state
     * @param {number} speed - Current vehicle speed
     * @param {number} maxSpeed - Maximum vehicle speed
     * @param {boolean} isAccelerating - Whether vehicle is accelerating
     */
    updateEngineSound(speed, maxSpeed = 50, isAccelerating = false) {
        if (!this.enabled || !this.audioManager) return;

        try {
            if (typeof this.audioManager.updateEngineSound === 'function') {
                this.audioManager.updateEngineSound(speed, maxSpeed, isAccelerating);
            }
        } catch (error) {
            // Don't log every frame, too noisy
        }
    }

    /**
     * Destroy audio system
     */
    destroy() {
        this.stopEngineSound();
        this.stopMusic();
        this.initialized = false;
    }
}

// Export for ES Modules
export { AudioSystem };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.AudioSystem = AudioSystem;
}
