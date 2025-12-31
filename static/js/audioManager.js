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
        this.musicVolume = 0.5;
        this.sfxVolume = 0.7;
        this.isMuted = false;

        // Music tracks
        this.musicBuffers = {};
        this.currentMusic = null;
        this.currentMusicSource = null;
        this.currentMusicGain = null;

        // Engine sound
        this.engineBuffer = null;
        this.engineSource = null;
        this.engineGain = null;
        this.enginePlaying = false;

        // SFX buffers
        this.sfxBuffers = {};

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

        // Load music tracks
        const loadPromises = Object.entries(musicTracks).map(async ([name, url]) => {
            try {
                const buffer = await this.loadAudioBuffer(url);
                this.musicBuffers[name] = buffer;
                console.log(`[AudioManager] Loaded music: ${name}`);
            } catch (e) {
                console.warn(`[AudioManager] Failed to load music ${name}:`, e);
            }
        });

        await Promise.all(loadPromises);

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

        // Stop current music with fade out
        if (this.currentMusicSource) {
            this.stopMusic(0.5);
        }

        // Create new source
        const source = this.audioContext.createBufferSource();
        source.buffer = this.musicBuffers[trackName];
        source.loop = loop;

        // Create gain node for volume control
        const gainNode = this.audioContext.createGain();
        const effectiveVolume = this.isMuted ? 0 : this.musicVolume;
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(effectiveVolume, this.audioContext.currentTime + fadeIn);

        // Connect nodes
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        // Start playback
        source.start(0);

        this.currentMusic = trackName;
        this.currentMusicSource = source;
        this.currentMusicGain = gainNode;

        console.log(`[AudioManager] Playing music: ${trackName}`);
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

        // Fade out
        gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeOut);

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
    }

    /**
     * Crossfade to a new music track
     * @param {string} newTrack - Name of the new track
     * @param {number} duration - Crossfade duration in seconds
     */
    crossfadeMusic(newTrack, duration = 2.0) {
        if (!this.audioContext || !this.musicBuffers[newTrack]) {
            console.warn(`[AudioManager] Cannot crossfade to: ${newTrack}`);
            return;
        }

        if (this.currentMusic === newTrack) return;

        const oldGain = this.currentMusicGain;
        const oldSource = this.currentMusicSource;

        // Create new source
        const source = this.audioContext.createBufferSource();
        source.buffer = this.musicBuffers[newTrack];
        source.loop = true;

        const gainNode = this.audioContext.createGain();
        const effectiveVolume = this.isMuted ? 0 : this.musicVolume;
        gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(effectiveVolume, this.audioContext.currentTime + duration);

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        source.start(0);

        // Fade out old track
        if (oldGain) {
            oldGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration);
            setTimeout(() => {
                try {
                    oldSource.stop();
                } catch (e) {
                    // Already stopped
                }
            }, duration * 1000);
        }

        this.currentMusic = newTrack;
        this.currentMusicSource = source;
        this.currentMusicGain = gainNode;

        console.log(`[AudioManager] Crossfading to: ${newTrack}`);
    }

    /**
     * Play a one-shot sound effect
     * @param {string} trackName - Name of the track (can reuse music buffers)
     * @param {Object} options - { volume: 1.0 }
     * @returns {number} Sound ID for stopping later
     */
    playSound(trackName, options = {}) {
        if (!this.audioContext) return null;

        const buffer = this.musicBuffers[trackName] || this.sfxBuffers[trackName];
        if (!buffer) {
            console.warn(`[AudioManager] Sound not found: ${trackName}`);
            return null;
        }

        const { volume = 1.0 } = options;

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        const gainNode = this.audioContext.createGain();
        const effectiveVolume = this.isMuted ? 0 : this.sfxVolume * volume;
        gainNode.gain.setValueAtTime(effectiveVolume, this.audioContext.currentTime);

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
        console.log(`[AudioManager] Playing sound: ${trackName} (id: ${soundId})`);
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
            sound.gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + fadeOut);
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

        if (this.currentMusicGain && !this.isMuted) {
            this.currentMusicGain.gain.setValueAtTime(this.musicVolume, this.audioContext.currentTime);
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

        if (this.currentMusicGain) {
            const targetVolume = this.isMuted ? 0 : this.musicVolume;
            this.currentMusicGain.gain.linearRampToValueAtTime(
                targetVolume,
                this.audioContext.currentTime + 0.1
            );
        }

        localStorage.setItem('audioManager_muted', this.isMuted.toString());
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
}

// Create global instance
const audioManager = new AudioManager();

// Load preferences on script load
audioManager.loadPreferences();

// Export for use in other modules
window.audioManager = audioManager;
