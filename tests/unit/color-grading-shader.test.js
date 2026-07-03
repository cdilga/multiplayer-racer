import { describe, it, expect } from 'vitest';
import { ColorGradingShader } from '../../static/js/shaders/ColorGradingShader.js';

/**
 * br-skip-bin-arcade-design-language-5k3.8 — animated film grain + vignette.
 *
 * Proves the ColorGradingShader carries the film-grain uniforms AND consumes
 * them in the GLSL (not dead metadata), that grain is time-animated, and that
 * the pre-existing vignette + posterize/dither (5k3.4) are preserved.
 */

const frag = ColorGradingShader.fragmentShader;
// Collapse whitespace so we can assert on GLSL expressions robustly.
const fragFlat = frag.replace(/\s+/g, ' ');

describe('ColorGradingShader — film grain uniforms exist with sane defaults', () => {
    it('declares filmGrainAmount/scale/speed + time uniforms', () => {
        const u = ColorGradingShader.uniforms;
        expect(u.filmGrainAmount).toBeTruthy();
        expect(u.filmGrainScale).toBeTruthy();
        expect(u.filmGrainSpeed).toBeTruthy();
        expect(u.time).toBeTruthy();
        // Amount defaults OFF; RenderSystem drives it from the grade tier.
        expect(u.filmGrainAmount.value).toBe(0);
        expect(u.filmGrainScale.value).toBeGreaterThan(0);
        expect(u.filmGrainSpeed.value).toBeGreaterThan(0);
    });

    it('preserves the existing vignette + posterize/dither uniforms (5k3.4)', () => {
        const u = ColorGradingShader.uniforms;
        expect(u.vignetteAmount).toBeTruthy();
        expect(u.posterizeBandCount).toBeTruthy();
        expect(u.ditherStrength).toBeTruthy();
    });
});

describe('ColorGradingShader — GLSL actually CONSUMES the grain uniforms', () => {
    it('declares the grain uniforms in the fragment shader', () => {
        expect(fragFlat).toMatch(/uniform float filmGrainAmount;/);
        expect(fragFlat).toMatch(/uniform float filmGrainScale;/);
        expect(fragFlat).toMatch(/uniform float filmGrainSpeed;/);
        expect(fragFlat).toMatch(/uniform float time;/);
    });

    it('adds a grain term scaled by filmGrainAmount into the output color', () => {
        // The final color must be perturbed by grain * filmGrainAmount — this is
        // the consumption that makes filmGrainAmount=0 a true no-op.
        expect(fragFlat).toMatch(/color\.rgb\s*\+\s*grain\s*\*\s*filmGrainAmount/);
    });

    it('animates the grain via the time uniform and filmGrainSpeed (not static)', () => {
        // grain frame is derived from time*filmGrainSpeed -> changes each tick.
        expect(fragFlat).toMatch(/time\s*\*\s*filmGrainSpeed/);
        // grain is seeded per screen-space cell (chunky, from gl_FragCoord).
        expect(fragFlat).toMatch(/gl_FragCoord\.xy\s*\/\s*max\(\s*filmGrainScale/);
    });

    it('still applies vignette (multiplies color by the vignette factor)', () => {
        expect(fragFlat).toMatch(/color\.rgb\s*\*=\s*vignette;/);
        expect(fragFlat).toMatch(/smoothstep\(0\.3, 1\.2, dist\)\s*\*\s*vignetteAmount/);
    });

    it('still runs posterize+dither before grain (5k3.4 not regressed)', () => {
        expect(fragFlat).toMatch(/posterizeWithDither\(/);
        expect(fragFlat).toMatch(/bayer4x4\(/);
    });
});
