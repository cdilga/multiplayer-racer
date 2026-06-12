/**
 * EngineSynth - Procedural engine sound synthesized with the Web Audio API
 *
 * Replaces the old looping engine_idle.mp3 sample (the "whub whub").
 *
 * Architecture:
 *   [saw osc]----[gain]--\
 *   [sub sine]---[gain]---+--[waveshaper]--[lowpass]--[master gain]--> destination
 *   [detuned saw][gain]--/                                 ^
 *   [white noise]--[bandpass]--[gain]--------------------- |  (exhaust texture)
 *
 * - Oscillator frequencies track a virtual engine RPM (4-cylinder firing
 *   frequency: rpm / 60 * 2), so 900-6800 RPM maps to roughly 30-227 Hz.
 * - A simple 5-speed virtual gearbox maps normalized road speed to RPM:
 *   RPM climbs within a gear band and drops on the upshift, giving the
 *   characteristic rev-up / shift-down contour instead of a monotone loop.
 * - RPM is slew-rate limited so it never jumps, and every AudioParam is
 *   driven with setTargetAtTime for click-free, zipper-free updates.
 */

const ENGINE_DEFAULTS = {
    idleRpm: 900,
    maxRpm: 6800,
    // Normalized speed (0-1) boundaries for each gear band
    gearBoundaries: [0, 0.14, 0.30, 0.50, 0.73, 1.0001],
    // RPM the engine settles to right after an upshift
    shiftRpm: 2600,
    // RPM at the top of a gear band (just before the upshift)
    revLimitRpm: 6300,
    // RPM slew rates (rpm per second)
    slewUp: 4500,
    slewDown: 5500,
    // Overall output level before the external volume scalar is applied.
    // Intentionally low - the engine is background texture, not noise.
    baseLevel: 0.3
};

class EngineSynth {
    /**
     * @param {AudioContext} audioContext
     * @param {Object} [options]
     * @param {AudioNode} [options.destination] - Output node (defaults to context destination)
     */
    constructor(audioContext, options = {}) {
        this.audioContext = audioContext;
        this.destination = options.destination || (audioContext ? audioContext.destination : null);

        this.config = Object.assign({}, ENGINE_DEFAULTS, options.config || {});

        // RPM state
        this.rpm = this.config.idleRpm;
        this.targetRpm = this.config.idleRpm;
        this.lastUpdateTime = 0;

        // External volume scalar (sfxVolume * engine volume * mute), set by owner
        this.volume = 1.0;

        this.running = false;
        this.nodes = null;

        // Cached resources (created lazily, reused across start/stop cycles)
        this._noiseBuffer = null;
        this._shaperCurve = null;
    }

    /**
     * Whether the synth is currently producing sound
     * @returns {boolean}
     */
    isRunning() {
        return this.running;
    }

    /**
     * Build the audio graph and start producing sound (click-free fade in)
     */
    start() {
        if (this.running || !this.audioContext || !this.destination) return;

        const ctx = this.audioContext;
        const now = ctx.currentTime;

        // Master gain - envelope from silence so there is never a click
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0, now);
        masterGain.connect(this.destination);

        // Lowpass filter - cutoff opens with RPM
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, now);
        filter.Q.setValueAtTime(0.8, now);
        filter.connect(masterGain);

        // Waveshaper for grit (gentle tanh soft clip)
        const shaper = ctx.createWaveShaper();
        shaper.curve = this._getShaperCurve();
        shaper.oversample = '2x';
        shaper.connect(filter);

        const baseFreq = this._rpmToFrequency(this.rpm);

        // Fundamental: sawtooth at the firing frequency
        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(baseFreq, now);
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.setValueAtTime(0.5, now);
        osc1.connect(osc1Gain);
        osc1Gain.connect(shaper);

        // Sub-octave sine for body
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(baseFreq * 0.5, now);
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.setValueAtTime(0.6, now);
        osc2.connect(osc2Gain);
        osc2Gain.connect(shaper);

        // Detuned harmonic sawtooth - slow beating thickens the tone
        const osc3 = ctx.createOscillator();
        osc3.type = 'sawtooth';
        osc3.frequency.setValueAtTime(baseFreq, now);
        osc3.detune.setValueAtTime(11, now);
        const osc3Gain = ctx.createGain();
        osc3Gain.gain.setValueAtTime(0.3, now);
        osc3.connect(osc3Gain);
        osc3Gain.connect(shaper);

        // Filtered noise for exhaust texture (bypasses the shaper)
        const noise = ctx.createBufferSource();
        noise.buffer = this._getNoiseBuffer();
        noise.loop = true;
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.setValueAtTime(500, now);
        noiseFilter.Q.setValueAtTime(0.7, now);
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.05, now);
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc3.start(now);
        noise.start(now);

        this.nodes = {
            masterGain,
            filter,
            shaper,
            osc1,
            osc2,
            osc3,
            noise,
            noiseFilter,
            noiseGain
        };

        // Reset RPM state and fade in over 250ms
        this.rpm = this.config.idleRpm;
        this.targetRpm = this.config.idleRpm;
        this.lastUpdateTime = now;
        this.running = true;

        masterGain.gain.linearRampToValueAtTime(
            this._currentMasterLevel(0, false),
            now + 0.25
        );
    }

    /**
     * Per-frame update. Maps normalized speed through the virtual gearbox
     * to a target RPM, slews the actual RPM toward it, and retunes the graph.
     * Intentionally contains no logging - this runs every frame.
     *
     * @param {number} normalizedSpeed - 0 (stopped) to 1 (max speed)
     * @param {boolean} [isAccelerating] - Throttle flag
     */
    update(normalizedSpeed, isAccelerating = false) {
        if (!this.running || !this.nodes || !this.audioContext) return;

        const ctx = this.audioContext;
        const now = ctx.currentTime;
        const dt = Math.min(0.1, Math.max(0, now - this.lastUpdateTime));
        this.lastUpdateTime = now;

        const speed = Math.min(1, Math.max(0, normalizedSpeed));

        // Virtual gearbox -> target RPM
        this.targetRpm = this._speedToRpm(speed, isAccelerating);

        // Slew-rate limit so RPM glides instead of jumping
        const delta = this.targetRpm - this.rpm;
        const maxRise = this.config.slewUp * dt;
        const maxFall = this.config.slewDown * dt;
        this.rpm += Math.min(maxRise, Math.max(-maxFall, delta));

        const { idleRpm, maxRpm } = this.config;
        const normalizedRpm = Math.min(1, Math.max(0,
            (this.rpm - idleRpm) / (maxRpm - idleRpm)
        ));
        const baseFreq = this._rpmToFrequency(this.rpm);

        const { osc1, osc2, osc3, filter, noiseFilter, noiseGain, masterGain } = this.nodes;

        // setTargetAtTime gives smooth exponential approach - no clicks,
        // and per-frame calls never stomp each other
        osc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
        osc2.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.03);
        osc3.frequency.setTargetAtTime(baseFreq, now, 0.03);

        // Filter opens up with RPM for a brighter sound at high revs
        const cutoff = 220 + Math.pow(normalizedRpm, 1.25) * 2600;
        filter.frequency.setTargetAtTime(cutoff, now, 0.06);

        // Exhaust noise follows RPM and throttle
        noiseFilter.frequency.setTargetAtTime(400 + normalizedRpm * 1400, now, 0.08);
        const noiseLevel = (0.04 + normalizedRpm * 0.1) * (isAccelerating ? 1.25 : 1.0);
        noiseGain.gain.setTargetAtTime(noiseLevel, now, 0.08);

        masterGain.gain.setTargetAtTime(
            this._currentMasterLevel(normalizedRpm, isAccelerating),
            now,
            0.08
        );
    }

    /**
     * Set the external volume scalar (owner applies sfx volume / mute here)
     * @param {number} volume - 0 to 1
     */
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
    }

    /**
     * Fade out and tear down the audio graph
     * @param {number} [fadeOut] - Fade duration in seconds
     */
    stop(fadeOut = 0.3) {
        if (!this.running || !this.nodes || !this.audioContext) return;

        const ctx = this.audioContext;
        const now = ctx.currentTime;
        const nodes = this.nodes;
        const fade = Math.max(0.02, fadeOut);

        // Ramp to silence, then stop sources slightly after the fade ends
        nodes.masterGain.gain.cancelScheduledValues(now);
        nodes.masterGain.gain.setValueAtTime(nodes.masterGain.gain.value, now);
        nodes.masterGain.gain.linearRampToValueAtTime(0, now + fade);

        const stopAt = now + fade + 0.05;
        [nodes.osc1, nodes.osc2, nodes.osc3, nodes.noise].forEach(source => {
            try {
                source.stop(stopAt);
            } catch (e) {
                // Already stopped
            }
        });

        // Disconnect once everything has stopped
        setTimeout(() => {
            try {
                nodes.masterGain.disconnect();
            } catch (e) {
                // Already disconnected
            }
        }, (fade + 0.1) * 1000);

        this.nodes = null;
        this.running = false;
    }

    // ==========================================
    // Internals
    // ==========================================

    /**
     * Virtual gearbox: normalized speed -> target RPM.
     * RPM climbs within each gear band and drops back to shiftRpm
     * at the next band, producing the upshift rev-drop.
     * @private
     */
    _speedToRpm(speed, isAccelerating) {
        const { gearBoundaries, idleRpm, shiftRpm, revLimitRpm, maxRpm } = this.config;

        let gear = gearBoundaries.length - 2;
        for (let i = 0; i < gearBoundaries.length - 1; i++) {
            if (speed < gearBoundaries[i + 1]) {
                gear = i;
                break;
            }
        }

        const lo = gearBoundaries[gear];
        const hi = gearBoundaries[gear + 1];
        const t = Math.min(1, Math.max(0, (speed - lo) / (hi - lo)));

        // First gear pulls from idle; later gears start at the post-shift RPM
        const gearStartRpm = gear === 0 ? idleRpm : shiftRpm;
        let rpm = gearStartRpm + t * (revLimitRpm - gearStartRpm);

        // Throttle raises the target slightly, lift-off lets it sag
        rpm *= isAccelerating ? 1.04 : 0.94;

        // Small rev when blipping the throttle from a standstill
        if (isAccelerating && speed < 0.04) {
            rpm = Math.max(rpm, idleRpm * 1.7);
        }

        return Math.min(maxRpm, Math.max(idleRpm, rpm));
    }

    /**
     * 4-cylinder, 4-stroke firing frequency
     * @private
     */
    _rpmToFrequency(rpm) {
        return (rpm / 60) * 2;
    }

    /**
     * Output level shape: quiet at idle, a little louder at revs / throttle
     * @private
     */
    _currentMasterLevel(normalizedRpm, isAccelerating) {
        const shape = (0.7 + normalizedRpm * 0.3) * (isAccelerating ? 1.1 : 1.0);
        return Math.min(1, this.config.baseLevel * this.volume * shape);
    }

    /**
     * One second of cached white noise
     * @private
     */
    _getNoiseBuffer() {
        if (this._noiseBuffer) return this._noiseBuffer;

        const ctx = this.audioContext;
        const length = ctx.sampleRate;
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this._noiseBuffer = buffer;
        return buffer;
    }

    /**
     * Gentle tanh soft-clip curve for the waveshaper
     * @private
     */
    _getShaperCurve() {
        if (this._shaperCurve) return this._shaperCurve;

        const samples = 1024;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i / (samples - 1)) * 2 - 1;
            curve[i] = Math.tanh(2.5 * x);
        }
        this._shaperCurve = curve;
        return curve;
    }
}

// Export for ES Modules
export { EngineSynth };
export default EngineSynth;

// Expose globally so the non-module audioManager.js can find it
if (typeof window !== 'undefined') {
    window.EngineSynth = EngineSynth;
}
