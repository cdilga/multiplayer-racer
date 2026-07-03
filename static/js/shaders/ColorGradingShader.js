/**
 * ColorGradingShader - Skip Bin Arcade posterize + Bayer dither grade.
 *
 * Provides:
 * - muted skip-bin palette bias via saturation/value shaping
 * - tunable posterize band count
 * - ordered 4x4 Bayer dithering
 * - optional low-intensity scanlines
 * - vignette effect (dark edges)
 * - animated camcorder film grain (screen-space hash noise, time-stepped)
 *
 * Usage:
 *   import { ColorGradingShader } from './shaders/ColorGradingShader.js';
 *   const pass = new ShaderPass(ColorGradingShader);
 */

export const ColorGradingShader = {
    uniforms: {
        tDiffuse: { value: null },
        gradingIntensity: { value: 0.5 },
        posterizeBandCount: { value: 7.0 },
        ditherStrength: { value: 0.55 },
        scanlineAmount: { value: 0.08 },
        vignetteAmount: { value: 0.3 },
        // Animated film grain. `filmGrainAmount` is the tier-driven strength
        // (0 = off, e.g. reduce-effects / fallback tier). `filmGrainScale` sets
        // the grain block size in pixels (chunky, not per-pixel fizz).
        // `filmGrainSpeed` is how many discrete noise frames per second (a
        // camcorder look), advanced via the `time` uniform each render.
        filmGrainAmount: { value: 0.0 },
        filmGrainScale: { value: 1.5 },
        filmGrainSpeed: { value: 12.0 },
        time: { value: 0.0 }
    },

    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float gradingIntensity;
        uniform float posterizeBandCount;
        uniform float ditherStrength;
        uniform float scanlineAmount;
        uniform float vignetteAmount;
        uniform float filmGrainAmount;
        uniform float filmGrainScale;
        uniform float filmGrainSpeed;
        uniform float time;

        varying vec2 vUv;

        // Cheap screen-space hash noise (no texture). Deterministic per cell/frame.
        float grainHash(vec2 p) {
            p = fract(p * vec2(123.34, 345.45));
            p += dot(p, p + 34.345);
            return fract(p.x * p.y);
        }

        float bayer4x4(vec2 fragCoord) {
            vec2 cell = mod(floor(fragCoord), 4.0);

            if (cell.y < 0.5) {
                if (cell.x < 0.5) return 0.0 / 16.0;
                if (cell.x < 1.5) return 8.0 / 16.0;
                if (cell.x < 2.5) return 2.0 / 16.0;
                return 10.0 / 16.0;
            }

            if (cell.y < 1.5) {
                if (cell.x < 0.5) return 12.0 / 16.0;
                if (cell.x < 1.5) return 4.0 / 16.0;
                if (cell.x < 2.5) return 14.0 / 16.0;
                return 6.0 / 16.0;
            }

            if (cell.y < 2.5) {
                if (cell.x < 0.5) return 3.0 / 16.0;
                if (cell.x < 1.5) return 11.0 / 16.0;
                if (cell.x < 2.5) return 1.0 / 16.0;
                return 9.0 / 16.0;
            }

            if (cell.x < 0.5) return 15.0 / 16.0;
            if (cell.x < 1.5) return 7.0 / 16.0;
            if (cell.x < 2.5) return 13.0 / 16.0;
            return 5.0 / 16.0;
        }

        vec3 applySkipBinGrade(vec3 color, float amount) {
            float luminance = dot(color, vec3(0.299, 0.587, 0.114));
            vec3 muted = mix(vec3(luminance), color, 0.58);
            vec3 warmLift = muted * vec3(0.94, 0.90, 0.82);
            vec3 coolShadow = mix(vec3(luminance * 0.72), warmLift, 0.78);
            return mix(color, coolShadow, clamp(amount, 0.0, 1.0));
        }

        vec3 posterizeWithDither(vec3 color, vec2 fragCoord, float bands, float strength) {
            float levels = max(2.0, bands);
            float threshold = bayer4x4(fragCoord) - 0.5;
            vec3 offset = vec3(
                threshold,
                fract(threshold + 0.3333333) - 0.5,
                fract(threshold + 0.6666667) - 0.5
            );
            vec3 scaled = color * (levels - 1.0);
            vec3 quantized = floor(scaled + 0.5 + offset * clamp(strength, 0.0, 1.0));
            return clamp(quantized / (levels - 1.0), 0.0, 1.0);
        }
        
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);

            vec3 color = applySkipBinGrade(texel.rgb, gradingIntensity);
            color = posterizeWithDither(
                color,
                gl_FragCoord.xy,
                posterizeBandCount,
                ditherStrength
            );

            vec2 center = vUv - 0.5;
            float dist = length(center);
            float vignette = 1.0 - smoothstep(0.3, 1.2, dist) * vignetteAmount;

            color.rgb *= vignette;

            // Thin, screen-space CRT/camcorder scanline dimming. Kept subtle at
            // tier defaults; manual settings can force 0..1.
            float scanline = mod(floor(gl_FragCoord.y), 2.0);
            float scanlineDim = mix(1.0, mix(0.84, 1.0, scanline), clamp(scanlineAmount, 0.0, 1.0));
            color.rgb *= scanlineDim;

            // Animated camcorder grain: chunky screen-space noise re-seeded on
            // discrete time steps (filmGrainSpeed). filmGrainAmount 0 => no grain.
            vec2 grainCell = floor(gl_FragCoord.xy / max(filmGrainScale, 1.0));
            float grainFrame = floor(time * filmGrainSpeed);
            float grain = grainHash(grainCell + vec2(grainFrame, grainFrame * 1.7)) - 0.5;
            color.rgb = clamp(color.rgb + grain * filmGrainAmount, 0.0, 1.0);

            gl_FragColor = vec4(color, texel.a);
        }
    `
};
