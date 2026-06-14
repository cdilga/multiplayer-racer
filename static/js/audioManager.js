/**
 * AudioManager - Handles all game audio including music and sound effects
 *
 * Features:
 * - Background music with crossfade transitions
 * - Sound effects with volume control
 * - Engine sound with dynamic pitch based on speed
 * - Browser audio policy handling (unlock on first interaction)
 */

class AudioManager {
    constructor() {
        this.audioContext = null;
        this.musicVolume = 0.35;  // Lower music volume for better SFX clarity
        this.sfxVolume = 0.9;     // Higher SFX volume
        this.isMuted = false;

        // Music tracks
        this.musicBuffers = {};
        this.currentMusic = null;
        this.currentMusicSource = null;
        this.currentMusicGain = null;

        // Engine sound (synthesized via EngineSynth; sample loop kept as fallback)
        this.engineBuffer = null;
        this.engineSource = null;
        this.engineGain = null;
        this.enginePlaying = false;
        this.engineSynth = null;

        // SFX buffers
        this.sfxBuffers = {};

        // Per-sound cooldown tracking (prevents rapid-fire stacking/clipping)
        this.soundLastPlayed = new Map();

        // Missing-sound warnings logged once per name (not per call)
        this.warnedMissingSounds = new Set();

        // Track active one-shot sounds for stopping
        this.activeSounds = new Map();
        this.soundIdCounter = 0;

        // Track sources being faded out (to prevent overlaps)
        this.fadingOutSources = [];

        // Track loading state
        this.loaded = false;
        this.loading = false;

        // Audio unlocked state (browser policy)
        this.unlocked = false;

        // Ducking state (temporarily lower music for important sounds)
        this.isDucking = false;
        this.duckLevel = 0.3;  // Duck music to 30% of normal volume
        this.duckTimeout = null;

        // Bind methods
        this.unlock = this.unlock.bind(this);
    }

    /**
     * Initialize the audio context and set up unlock listeners
     */
    init() {
        if (this.audioContext) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Set up unlock listeners for browser audio policy
            const unlockEvents = ['click', 'touchstart', 'keydown'];
            unlockEvents.forEach(event => {
                document.addEventListener(event, this.unlock, { once: false });
            });

            // Browsers refuse to start audio before a user gesture - show a
            // hint so silence doesn't read as broken sound
            if (this.audioContext.state === 'suspended') {
                this._showUnlockHint();
            }

            console.log('[AudioManager] Initialized');
        } catch (e) {
            console.error('[AudioManager] Failed to create AudioContext:', e);
        }
    }

    /**
     * Unlock audio context after user interaction (browser policy)
     */
    async unlock() {
        if (this.unlocked || !this.audioContext) return;

        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                this.unlocked = true;
                console.log('[AudioManager] Audio context unlocked');

                // Remove unlock listeners
                const unlockEvents = ['click', 'touchstart', 'keydown'];
                unlockEvents.forEach(event => {
                    document.removeEventListener(event, this.unlock);
                });
            } catch (e) {
                console.error('[AudioManager] Failed to unlock audio context:', e);
            }
        } else {
            this.unlocked = true;
        }

        if (this.unlocked) {
            this._hideUnlockHint();
        }
    }

    /**
     * Show a small "click for sound" pill until audio is unlocked
     * @private
     */
    _showUnlockHint() {
        if (this._unlockHint || !document.body) return;

        const hint = document.createElement('div');
        hint.id = 'audio-unlock-hint';
        hint.textContent = '🔊 Click anywhere to enable sound';
        hint.style.cssText = [
            'position: fixed',
            'bottom: 18px',
            'left: 50%',
            'transform: translateX(-50%)',
            'background: rgba(0, 0, 0, 0.75)',
            'color: #fff',
            'padding: 10px 18px',
            'border-radius: 20px',
            'font-family: -apple-system, BlinkMacSystemFont, sans-serif',
            'font-size: 14px',
            'z-index: 10000',
            'pointer-events: none',
            'animation: audioHintPulse 2s ease-in-out infinite'
        ].join(';');

        const style = document.createElement('style');
        style.textContent = '@keyframes audioHintPulse { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }';
        hint.appendChild(style);

        document.body.appendChild(hint);
        this._unlockHint = hint;
    }

    /**
     * Remove the unlock hint
     * @private
     */
    _hideUnlockHint() {
        if (this._unlockHint) {
            this._unlockHint.remove();
            this._unlockHint = null;
        }
    }

    /**
     * Load all audio assets
     */
    async loadSounds() {
        if (this.loading || this.loaded) return;
        this.loading = true;

        this.init();

        const musicTracks = {
            lobby: '/static/audio/music/lobby.mp3',
            race_main: '/static/audio/music/race_main.mp3',
            race_intense: '/static/audio/music/race_intense.mp3',
            victory: '/static/audio/music/victory.mp3',
            crash: '/static/audio/music/crash.mp3',
            countdown: '/static/audio/music/countdown.mp3'
        };

        const sfxTracks = {
            engine_idle: '/static/audio/sfx/engine_idle.mp3',
            engine_rev: '/static/audio/sfx/engine_rev.mp3',
            collision_soft: '/static/audio/sfx/collision_soft.mp3',
            collision_hard: '/static/audio/sfx/collision_hard.mp3',
            tire_screech: '/static/audio/sfx/tire_screech.mp3',
            player_join: '/static/audio/sfx/player_join.mp3',
            button_click: '/static/audio/sfx/button_click.mp3',
            countdown_beep: '/static/audio/sfx/countdown_beep.mp3',
            countdown_go: '/static/audio/sfx/countdown_go.mp3'
        };

        // Load music tracks
        const musicPromises = Object.entries(musicTracks).map(async ([name, url]) => {
            try {
                const buffer = await this.loadAudioBuffer(url);
                this.musicBuffers[name] = buffer;
                console.log(`[AudioManager] Loaded music: ${name}`);
            } catch (e) {
                console.warn(`[AudioManager] Failed to load music ${name}:`, e);
            }
        });

        // Load SFX tracks
        const sfxPromises = Object.entries(sfxTracks).map(async ([name, url]) => {
            try {
                const buffer = await this.loadAudioBuffer(url);
                this.sfxBuffers[name] = buffer;
                console.log(`[AudioManager] Loaded SFX: ${name}`);
            } catch (e) {
                console.warn(`[AudioManager] Failed to load SFX ${name}:`, e);
            }
        });

        await Promise.all([...musicPromises, ...sfxPromises]);

        this.loaded = true;
        this.loading = false;
        console.log('[AudioManager] All sounds loaded');
    }

    /**
     * Load an audio buffer from URL
     */
    async loadAudioBuffer(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return await this.audioContext.decodeAudioData(arrayBuffer);
    }

    /**
     * Play a music track with optional crossfade
     * @param {string} trackName - Name of the track to play
     * @param {Object} options - { loop: true, fadeIn: 1.0 }
     */
    playMusic(trackName, options = {}) {
        if (!this.audioContext || !this.musicBuffers[trackName]) {
            console.warn(`[AudioManager] Cannot play music: ${trackName}`);
            return;
        }

        const { loop = true, fadeIn = 1.0 } = options;

        // Already playing this track - don't restart/overlap it
        if (this.currentMusic === trackName && this.currentMusicSource) {
            return;
        }

        // Something else is playing - crossfade instead of overlapping
        if (this.currentMusicSource) {
            this.crossfadeMusic(trackName, Math.max(0.5, Math.min(fadeIn, 1.0)), { loop });
            return;
        }

        this._startMusicSource(trackName, { loop, fadeIn });
        console.log(`[AudioManager] Playing music: ${trackName}`);
    }

    /**
     * Create and start a music source with fade-in (internal helper)
     * @private
     */
    _startMusicSource(trackName, { loop = true, fadeIn = 1.0 } = {}) {
        const source = this.audioContext.createBufferSource();
        source.buffer = this.musicBuffers[trackName];
        source.loop = loop;

        const gainNode = this.audioContext.createGain();
        const now = this.audioContext.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(this._musicTargetVolume(), now + fadeIn);

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        source.start(0);

        // Non-looping tracks (e.g. countdown stinger) clear state when done
        if (!loop) {
            source.onended = () => {
                if (this.currentMusicSource === source) {
                    this.currentMusicSource = null;
                    this.currentMusicGain = null;
                    this.currentMusic = null;
                }
            };
        }

        this.currentMusic = trackName;
        this.currentMusicSource = source;
        this.currentMusicGain = gainNode;
    }

    /**
     * Current target volume for music, accounting for mute and ducking
     * @private
     */
    _musicTargetVolume() {
        if (this.isMuted) return 0;
        return this.isDucking ? this.musicVolume * this.duckLevel : this.musicVolume;
    }

    /**
     * Stop current music with fade out
     * @param {number} fadeOut - Fade out duration in seconds
     */
    stopMusic(fadeOut = 0.5) {
        if (!this.currentMusicSource || !this.currentMusicGain) return;

        const gain = this.currentMusicGain;
        const source = this.currentMusicSource;

        // Track this source as fading out
        this.fadingOutSources.push(source);

        // Anchor at current value so the ramp starts from where we actually are
        const now = this.audioContext.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + fadeOut);

        // Stop after fade and clean up
        setTimeout(() => {
            try {
                source.stop();
            } catch (e) {
                // Already stopped
            }
            // Remove from fading list
            const idx = this.fadingOutSources.indexOf(source);
            if (idx > -1) this.fadingOutSources.splice(idx, 1);
        }, fadeOut * 1000);

        this.currentMusicSource = null;
        this.currentMusicGain = null;
        this.currentMusic = null;
    }

    /**
     * Immediately stop all music (no fade)
     */
    stopAllMusic() {
        // Stop current music immediately
        if (this.currentMusicSource) {
            try {
                this.currentMusicSource.stop();
            } catch (e) {}
            this.currentMusicSource = null;
            this.currentMusicGain = null;
            this.currentMusic = null;
        }

        // Stop all fading out sources
        this.fadingOutSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {}
        });
        this.fadingOutSources = [];

        // Stop all active one-shot sounds
        this.activeSounds.forEach((sound, id) => {
            try {
                sound.source.stop();
            } catch (e) {}
        });
        this.activeSounds.clear();

        // Clear any pending duck state so the next track starts at full volume
        if (this.duckTimeout) {
            clearTimeout(this.duckTimeout);
            this.duckTimeout = null;
        }
        this.isDucking = false;
    }

    /**
     * Crossfade to a new music track
     * @param {string} newTrack - Name of the new track
     * @param {number} duration - Crossfade duration in seconds
     */
    crossfadeMusic(newTrack, duration = 2.0, options = {}) {
        if (!this.audioContext || !this.musicBuffers[newTrack]) {
            console.warn(`[AudioManager] Cannot crossfade to: ${newTrack}`);
            return;
        }

        if (this.currentMusic === newTrack && this.currentMusicSource) return;

        const { loop = true } = options;
        const oldGain = this.currentMusicGain;
        const oldSource = this.currentMusicSource;
        const now = this.audioContext.currentTime;

        // Fade out old track (anchored so the ramp starts from the real value)
        if (oldGain && oldSource) {
            this.fadingOutSources.push(oldSource);
            oldGain.gain.cancelScheduledValues(now);
            oldGain.gain.setValueAtTime(oldGain.gain.value, now);
            oldGain.gain.linearRampToValueAtTime(0, now + duration);
            setTimeout(() => {
                try {
                    oldSource.stop();
                } catch (e) {
                    // Already stopped
                }
                const idx = this.fadingOutSources.indexOf(oldSource);
                if (idx > -1) this.fadingOutSources.splice(idx, 1);
            }, duration * 1000);
        }

        this.currentMusicSource = null;
        this.currentMusicGain = null;
        this._startMusicSource(newTrack, { loop, fadeIn: duration });

        console.log(`[AudioManager] Crossfading to: ${newTrack}`);
    }

    /**
     * Play a one-shot sound effect
     * @param {string} trackName - Name of the track (can reuse music buffers)
     * @param {Object} options - { volume: 1.0, cooldown: 60 }
     *   cooldown: minimum ms between plays of the same sound (prevents
     *   rapid-fire stacking into clipping)
     * @returns {number|null} Sound ID for stopping later
     */
    playSound(trackName, options = {}) {
        if (!this.audioContext) return null;

        const buffer = this.musicBuffers[trackName] || this.sfxBuffers[trackName];
        if (!buffer) {
            if (!this.warnedMissingSounds.has(trackName)) {
                this.warnedMissingSounds.add(trackName);
                console.warn(`[AudioManager] Sound not found: ${trackName}`);
            }
            return null;
        }

        const { volume = 1.0, cooldown = 60 } = options;

        // Per-sound cooldown: identical sounds triggered in rapid succession
        // (e.g. multi-body collisions in one tick) don't stack and clip
        if (cooldown > 0) {
            const lastPlayed = this.soundLastPlayed.get(trackName) || 0;
            const nowMs = performance.now();
            if (nowMs - lastPlayed < cooldown) {
                return null;
            }
            this.soundLastPlayed.set(trackName, nowMs);
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        const gainNode = this.audioContext.createGain();
        const effectiveVolume = this.isMuted ? 0 : this.sfxVolume * volume;
        const now = this.audioContext.currentTime;

        // Short attack ramp avoids clicks from samples that don't start at zero
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(effectiveVolume, now + 0.008);

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Track this sound
        const soundId = ++this.soundIdCounter;
        this.activeSounds.set(soundId, { source, gainNode, trackName });

        // Remove from tracking when ended
        source.onended = () => {
            this.activeSounds.delete(soundId);
        };

        source.start(0);
        return soundId;
    }

    /**
     * Stop a specific sound by ID
     * @param {number} soundId - Sound ID returned from playSound
     * @param {number} fadeOut - Fade out duration in seconds
     */
    stopSound(soundId, fadeOut = 0.1) {
        const sound = this.activeSounds.get(soundId);
        if (!sound) return;

        if (fadeOut > 0) {
            const now = this.audioContext.currentTime;
            sound.gainNode.gain.cancelScheduledValues(now);
            sound.gainNode.gain.setValueAtTime(sound.gainNode.gain.value, now);
            sound.gainNode.gain.linearRampToValueAtTime(0, now + fadeOut);
            setTimeout(() => {
                try {
                    sound.source.stop();
                } catch (e) {}
                this.activeSounds.delete(soundId);
            }, fadeOut * 1000);
        } else {
            try {
                sound.source.stop();
            } catch (e) {}
            this.activeSounds.delete(soundId);
        }
    }

    /**
     * Set music volume
     * @param {number} volume - Volume from 0 to 1
     */
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));

        // Short ramp (no click) toward the correct target, respecting ducking
        if (this.currentMusicGain && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.currentMusicGain.gain.cancelScheduledValues(now);
            this.currentMusicGain.gain.setValueAtTime(this.currentMusicGain.gain.value, now);
            this.currentMusicGain.gain.linearRampToValueAtTime(this._musicTargetVolume(), now + 0.05);
        }

        // Persist to localStorage
        localStorage.setItem('audioManager_musicVolume', this.musicVolume.toString());
    }

    /**
     * Set SFX volume
     * @param {number} volume - Volume from 0 to 1
     */
    setSFXVolume(volume) {
        this.sfxVolume = Math.max(0, Math.min(1, volume));
        localStorage.setItem('audioManager_sfxVolume', this.sfxVolume.toString());
    }

    /**
     * Toggle mute state
     */
    toggleMute() {
        this.isMuted = !this.isMuted;

        if (this.currentMusicGain && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.currentMusicGain.gain.cancelScheduledValues(now);
            this.currentMusicGain.gain.setValueAtTime(this.currentMusicGain.gain.value, now);
            this.currentMusicGain.gain.linearRampToValueAtTime(this._musicTargetVolume(), now + 0.1);
        }

        // Engine synth picks up the mute state on its next update, but apply
        // immediately too in case the car is idle and updates are sparse
        if (this.engineSynth && this.enginePlaying) {
            this.engineSynth.setVolume(this._engineVolume());
        }

        localStorage.setItem('audioManager_muted', this.isMuted.toString());
        return this.isMuted;
    }

    /**
     * Set mute state explicitly
     * @param {boolean} muted
     * @returns {boolean} New mute state
     */
    setMuted(muted) {
        if (this.isMuted !== !!muted) {
            this.toggleMute();
        }
        return this.isMuted;
    }

    /**
     * Load saved preferences from localStorage
     */
    loadPreferences() {
        const savedMusicVolume = localStorage.getItem('audioManager_musicVolume');
        const savedSfxVolume = localStorage.getItem('audioManager_sfxVolume');
        const savedMuted = localStorage.getItem('audioManager_muted');

        if (savedMusicVolume !== null) {
            this.musicVolume = parseFloat(savedMusicVolume);
        }
        if (savedSfxVolume !== null) {
            this.sfxVolume = parseFloat(savedSfxVolume);
        }
        if (savedMuted !== null) {
            this.isMuted = savedMuted === 'true';
        }
    }

    /**
     * Get current state for UI
     */
    getState() {
        return {
            musicVolume: this.musicVolume,
            sfxVolume: this.sfxVolume,
            isMuted: this.isMuted,
            currentTrack: this.currentMusic,
            loaded: this.loaded
        };
    }

    // ==========================================
    // ENGINE SOUND SYSTEM
    // ==========================================

    /**
     * Effective engine output volume (mute, sfx volume, tunable base level)
     * @private
     */
    _engineVolume() {
        if (this.isMuted) return 0;
        const engineBaseVolume = this.engineBaseVolume !== undefined ? this.engineBaseVolume : 0.4;
        return this.sfxVolume * engineBaseVolume;
    }

    /**
     * Resolve the EngineSynth class (loaded as an ES module by AudioSystem)
     * @private
     */
    _getEngineSynthClass() {
        return (typeof window !== 'undefined' && window.EngineSynth) ? window.EngineSynth : null;
    }

    /**
     * Start the synthesized engine sound.
     * Falls back to the old looping sample only if EngineSynth is unavailable.
     */
    startEngineSound() {
        if (this.enginePlaying || !this.audioContext) return;

        const SynthClass = this._getEngineSynthClass();
        if (SynthClass) {
            if (!this.engineSynth) {
                this.engineSynth = new SynthClass(this.audioContext);
            }
            this.engineSynth.setVolume(this._engineVolume());
            this.engineSynth.start();
            this.enginePlaying = true;
            console.log('[AudioManager] Engine synth started');
            return;
        }

        // Fallback: legacy sample loop (only if the synth module failed to load)
        const buffer = this.sfxBuffers['engine_idle'];
        if (!buffer) {
            console.warn('[AudioManager] Engine sound not available');
            return;
        }

        this.engineSource = this.audioContext.createBufferSource();
        this.engineSource.buffer = buffer;
        this.engineSource.loop = true;

        this.engineGain = this.audioContext.createGain();
        const now = this.audioContext.currentTime;
        this.engineGain.gain.setValueAtTime(0, now);
        this.engineGain.gain.linearRampToValueAtTime(this._engineVolume(), now + 0.25);

        this.engineSource.connect(this.engineGain);
        this.engineGain.connect(this.audioContext.destination);
        this.engineSource.start(0);
        this.enginePlaying = true;

        console.log('[AudioManager] Engine sound started (sample fallback)');
    }

    /**
     * Stop the engine sound
     * @param {number} fadeOut - Fade out duration in seconds
     */
    stopEngineSound(fadeOut = 0.3) {
        if (!this.enginePlaying) return;

        if (this.engineSynth && this.engineSynth.isRunning()) {
            this.engineSynth.stop(fadeOut);
            this.enginePlaying = false;
            return;
        }

        if (!this.engineSource) {
            this.enginePlaying = false;
            return;
        }

        const source = this.engineSource;
        const gain = this.engineGain;
        this.enginePlaying = false;
        this.engineSource = null;
        this.engineGain = null;

        if (fadeOut > 0 && gain) {
            const now = this.audioContext.currentTime;
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + fadeOut);
            setTimeout(() => {
                try {
                    source.stop();
                } catch (e) {}
            }, fadeOut * 1000);
        } else {
            try {
                source.stop();
            } catch (e) {}
        }
    }

    /**
     * Update engine sound based on car speed (called per-frame - no logging)
     * @param {number} speed - Current speed (0 to max)
     * @param {number} maxSpeed - Maximum speed for normalization
     * @param {boolean} isAccelerating - Whether accelerating (affects RPM/volume)
     */
    updateEngineSound(speed, maxSpeed = 50, isAccelerating = false) {
        if (!this.enginePlaying) return;

        const normalizedSpeed = Math.min(1, Math.max(0, speed / maxSpeed));

        if (this.engineSynth && this.engineSynth.isRunning()) {
            this.engineSynth.setVolume(this._engineVolume());
            this.engineSynth.update(normalizedSpeed, isAccelerating);
            return;
        }

        // Fallback sample loop: pitch/volume tracking with smooth targets
        if (!this.engineSource || !this.engineGain) return;

        const now = this.audioContext.currentTime;
        const minPitch = this.engineMinPitch || 0.8;
        const maxPitch = this.engineMaxPitch || 1.6;
        const targetPitch = minPitch + (maxPitch - minPitch) * normalizedSpeed;
        this.engineSource.playbackRate.setTargetAtTime(targetPitch, now, 0.05);

        const accelBoost = isAccelerating ? 1.2 : 1.0;
        const speedBoost = 1 + normalizedSpeed * 0.3;
        const targetVolume = Math.min(this._engineVolume() * accelBoost * speedBoost, this.sfxVolume);
        this.engineGain.gain.setTargetAtTime(targetVolume, now, 0.08);
    }

    /**
     * Play collision sound based on impact intensity.
     * Rate-limited so collision bursts don't stack into clipping, and
     * volume scales with intensity so light taps stay light.
     * @param {number} intensity - Impact intensity (0-1)
     */
    playCollisionSound(intensity = 0.5) {
        const clamped = Math.min(1, Math.max(0, intensity));

        // Ignore negligible scrapes entirely
        if (clamped < 0.05) return;

        const soundName = clamped > 0.6 ? 'collision_hard' : 'collision_soft';

        // Only duck music for substantial hits - constant ducking is annoying
        if (clamped > 0.4) {
            this.duckMusic(0.4);
        }

        this.playSound(soundName, {
            volume: 0.3 + clamped * 0.6,
            cooldown: 150
        });
    }

    /**
     * Play tire screech sound (rate-limited so it can't machine-gun)
     * @returns {number|null} Sound ID for stopping
     */
    playTireScreech() {
        return this.playSound('tire_screech', { volume: 0.4, cooldown: 400 });
    }

    // ==========================================
    // SYNTHESIZED WEAPON SFX (no samples needed)
    // ==========================================

    /**
     * Synthesized homing-missile launch: a pitch-swept rocket tone under a
     * filtered-noise whoosh. Built procedurally (like the engine) so it
     * doesn't depend on a sample that may be missing or wrong.
     * @param {number} [volume] - 0 to 1 relative level
     */
    playMissileLaunch(volume = 0.7) {
        const ctx = this.audioContext;
        if (!ctx || this.isMuted) return;

        const now = ctx.currentTime;
        const level = this.sfxVolume * volume;
        const dur = 0.55;

        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, now);
        out.gain.exponentialRampToValueAtTime(level, now + 0.03);
        out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        out.connect(ctx.destination);

        // Rocket body: square tone sweeping up as it accelerates away
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + dur);
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(0.18, now);
        osc.connect(oscGain);
        oscGain.connect(out);

        // Whoosh: bandpass noise sweeping up in frequency
        const noise = ctx.createBufferSource();
        noise.buffer = this._getSfxNoiseBuffer();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.setValueAtTime(0.9, now);
        bp.frequency.setValueAtTime(600, now);
        bp.frequency.exponentialRampToValueAtTime(2600, now + dur);
        noise.connect(bp);
        bp.connect(out);

        osc.start(now);
        noise.start(now);
        osc.stop(now + dur + 0.05);
        noise.stop(now + dur + 0.05);
    }

    /**
     * Synthesized explosion: a low filtered-noise boom with a fast decay.
     * @param {number} [volume] - 0 to 1 relative level
     */
    playExplosion(volume = 0.9) {
        const ctx = this.audioContext;
        if (!ctx || this.isMuted) return;

        const now = ctx.currentTime;
        const level = this.sfxVolume * volume;
        const dur = 0.6;

        // Duck music briefly so the boom punches through
        this.duckMusic(0.35);

        const out = ctx.createGain();
        out.gain.setValueAtTime(level, now);
        out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        out.connect(ctx.destination);

        // Body: low-passed noise sweeping down (the boom)
        const noise = ctx.createBufferSource();
        noise.buffer = this._getSfxNoiseBuffer();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(900, now);
        lp.frequency.exponentialRampToValueAtTime(120, now + dur);
        noise.connect(lp);
        lp.connect(out);

        // Sub thump for weight
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(90, now);
        sub.frequency.exponentialRampToValueAtTime(40, now + dur);
        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(level * 0.7, now);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        sub.connect(subGain);
        subGain.connect(ctx.destination);

        noise.start(now);
        sub.start(now);
        noise.stop(now + dur + 0.05);
        sub.stop(now + dur + 0.05);
    }

    /**
     * Two seconds of cached white noise for synthesized SFX
     * @private
     */
    _getSfxNoiseBuffer() {
        if (this._sfxNoiseBuffer) return this._sfxNoiseBuffer;
        const ctx = this.audioContext;
        const length = ctx.sampleRate * 2;
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this._sfxNoiseBuffer = buffer;
        return buffer;
    }

    /**
     * Play player join notification with ducking
     */
    playPlayerJoin() {
        // Duck music so the chime is clearly audible
        this.duckMusic(0.6);
        this.playSound('player_join', { volume: 1.0 });
    }

    // ==========================================
    // DUCKING (Temporarily lower music for SFX)
    // ==========================================

    /**
     * Temporarily lower music volume to let important sounds through
     * @param {number} duration - How long to duck in seconds
     */
    duckMusic(duration = 0.5) {
        if (!this.currentMusicGain || this.isMuted || !this.audioContext) return;

        // Clear any pending unduck so an earlier duck's timer can't restore
        // volume in the middle of this one
        if (this.duckTimeout) {
            clearTimeout(this.duckTimeout);
            this.duckTimeout = null;
        }

        this.isDucking = true;

        // Quick duck down (anchored ramp so it starts from the real value)
        const now = this.audioContext.currentTime;
        this.currentMusicGain.gain.cancelScheduledValues(now);
        this.currentMusicGain.gain.setValueAtTime(this.currentMusicGain.gain.value, now);
        this.currentMusicGain.gain.linearRampToValueAtTime(
            this._musicTargetVolume(),
            now + 0.05
        );

        // Schedule unduck
        this.duckTimeout = setTimeout(() => {
            this.unduckMusic();
        }, duration * 1000);
    }

    /**
     * Restore music volume after ducking.
     * Always clears the ducking state, even if no music is playing -
     * otherwise the next track would start stuck at the ducked level.
     */
    unduckMusic() {
        if (this.duckTimeout) {
            clearTimeout(this.duckTimeout);
            this.duckTimeout = null;
        }
        this.isDucking = false;

        if (!this.currentMusicGain || this.isMuted || !this.audioContext) return;

        // Gradual restore
        const now = this.audioContext.currentTime;
        this.currentMusicGain.gain.cancelScheduledValues(now);
        this.currentMusicGain.gain.setValueAtTime(this.currentMusicGain.gain.value, now);
        this.currentMusicGain.gain.linearRampToValueAtTime(
            this._musicTargetVolume(),
            now + 0.3
        );
    }
}

// Create global instance
const audioManager = new AudioManager();

// Load preferences on script load
audioManager.loadPreferences();

// Export for use in other modules
window.audioManager = audioManager;
