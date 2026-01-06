/**
 * ColorGradingShader - Custom shader for color grading and vignette
 * 
 * Provides:
 * - Teal-orange cinematic color grading (boost teal, crush orange)
 * - Vignette effect (dark edges)
 * 
 * Usage:
 *   import { ColorGradingShader } from './shaders/ColorGradingShader.js';
 *   const pass = new ShaderPass(ColorGradingShader);
 */

export const ColorGradingShader = {
    uniforms: {
        tDiffuse: { value: null },
        gradingIntensity: { value: 0.5 },
        vignetteAmount: { value: 0.3 }
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
        uniform float vignetteAmount;
        
        varying vec2 vUv;
        
        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // Color grading: boost teal/cyan, crush orange
            // Convert to HSV-like manipulation for more control
            vec3 color = texel.rgb;
            
            // Boost cyan/teal channel (mix towards cyan)
            vec3 cyanBoost = vec3(0.0, 1.0, 1.0); // Pure cyan
            color = mix(color, mix(color, cyanBoost, 0.3), gradingIntensity);
            
            // Crush orange (reduce red in warm tones)
            float orangeMask = smoothstep(0.3, 0.7, color.r) * (1.0 - color.b * 0.5);
            color.rgb = mix(color.rgb, color.rgb * vec3(0.85, 0.95, 1.0), orangeMask * gradingIntensity * 0.4);
            
            // Vignette effect (darken edges)
            vec2 center = vUv - 0.5;
            float dist = length(center);
            float vignette = 1.0 - smoothstep(0.3, 1.2, dist) * vignetteAmount;
            
            // Apply vignette
            color.rgb *= vignette;
            
            gl_FragColor = vec4(color, texel.a);
        }
    `
};

