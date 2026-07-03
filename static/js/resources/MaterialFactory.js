/**
 * MaterialFactory - Creates matte materials for the Skip Bin Arcade visual language
 *
 * Replaces PBR (MeshStandardMaterial) with flat/toon shading to match the
 * lo-fi retro design direction. All materials are matte (no specular/plastic).
 *
 * Usage:
 *   const factory = new MaterialFactory();
 *   const carBody = factory.createMaterial({ color: 0xff0000, type: 'flat' });
 *   const track = factory.createMaterial({ color: 0x2a2620, type: 'toon' });
 */

class MaterialFactory {
    constructor() {
        this.materials = new Map();
        this.toonEnabled = true;
    }

    /**
     * Create a matte material (flat or toon).
     * @param {Object} options
     * @param {number} options.color - Hex color
     * @param {string} options.type - 'flat' (basic) or 'toon' (gradients)
     * @param {number} [options.emissive] - Emissive color for neon/lights
     * @param {number} [options.emissiveIntensity] - 0-1, default 0
     * @returns {THREE.Material}
     */
    createMaterial(options = {}) {
        const {
            color = 0xffffff,
            type = 'flat',
            emissive = 0,
            emissiveIntensity = 0,
            loFiWarp = null
        } = options;

        let material;
        if (type === 'toon' && this.toonEnabled) {
            material = this.createToonMaterial(color, emissive, emissiveIntensity);
        } else {
            material = this.createFlatMaterial(color, emissive, emissiveIntensity);
        }

        return configureLoFiWarpMaterial(material, loFiWarp);
    }

    createFlatMaterial(color, emissive, emissiveIntensity) {
        // MeshBasicMaterial is unlit and matte: it renders `color` at full
        // brightness with no specular/plastic response, so a loud color is its
        // own diegetic glow (bloom-eligible). It ignores emissive/emissiveIntensity,
        // so we deliberately do not forward them (avoids spurious THREE warnings).
        return new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide
        });
    }

    createToonMaterial(color, emissive, emissiveIntensity) {
        const toonMaterial = new THREE.MeshToonMaterial({
            color,
            emissive,
            emissiveIntensity,
            side: THREE.DoubleSide,
            wireframe: false
        });

        // Assign the shared 2-band toon ramp to EVERY toon material (browser only).
        // Ramp creation is cached on the static; assignment must happen per-material.
        if (typeof document !== 'undefined') {
            if (!MaterialFactory.toonRamp) {
                MaterialFactory.toonRamp = this.createToonRamp();
            }
            if (MaterialFactory.toonRamp) {
                toonMaterial.gradientMap = MaterialFactory.toonRamp;
            }
        }

        return toonMaterial;
    }

    /**
     * Create a simple 2-color toon gradient ramp texture.
     * Dark band for shadow, light band for highlight.
     * Only available in browser environment.
     */
    createToonRamp() {
        if (typeof document === 'undefined') {
            return null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#444444';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = '#cccccc';
        ctx.fillRect(1, 0, 1, 1);

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        return texture;
    }

    /**
     * Batch replace materials in a mesh/object hierarchy.
     * Skips existing non-Standard materials.
     */
    replacePBRMaterials(object, type = 'flat') {
        object.traverse((child) => {
            if (child.material) {
                if (child.material.isMeshStandardMaterial) {
                    const oldColor = child.material.color?.getHex() || 0xffffff;
                    const oldEmissive = child.material.emissive?.getHex() || 0;
                    const oldEmissiveIntensity = child.material.emissiveIntensity || 0;

                    const newMaterial = this.createMaterial({
                        color: oldColor,
                        type,
                        emissive: oldEmissive,
                        emissiveIntensity: oldEmissiveIntensity
                    });

                    child.material.dispose();
                    child.material = newMaterial;
                }
            }
        });
    }

    /**
     * Toggle between toon and flat globally (for adaptive quality controller).
     */
    setToonEnabled(enabled) {
        this.toonEnabled = enabled;
    }

    /**
     * Configure one material for the optional PS1-style vertex snap / affine
     * warp hook. Disabled by default and kept as a material-local onBeforeCompile
     * patch so the repo's flat/toon material approach stays intact.
     * @param {THREE.Material} material
     * @param {Object|null} options
     * @returns {THREE.Material}
     */
    configureLoFiWarpMaterial(material, options = {}) {
        return configureLoFiWarpMaterial(material, options);
    }

    /**
     * Toggle the lo-fi warp hook for one material.
     * @param {THREE.Material} material
     * @param {boolean} enabled
     * @returns {THREE.Material}
     */
    setLoFiWarpEnabled(material, enabled) {
        return setLoFiWarpEnabled(material, enabled);
    }

    /**
     * Update warp intensities for one material.
     * @param {THREE.Material} material
     * @param {Object} options
     * @returns {THREE.Material}
     */
    setLoFiWarpIntensity(material, options = {}) {
        return setLoFiWarpIntensity(material, options);
    }

    /**
     * Dispose all cached materials.
     */
    dispose() {
        this.materials.forEach(mat => mat.dispose());
        this.materials.clear();
        if (MaterialFactory.toonRamp) {
            MaterialFactory.toonRamp.dispose();
            MaterialFactory.toonRamp = null;
        }
    }
}

// Static toon ramp shared across all instances
MaterialFactory.toonRamp = null;

const READABILITY_EXEMPT_ROLES = new Set([
    'vehicle-readable',
    'danger-readable',
    'ui',
    'hud',
    'player-identity'
]);

const DEFAULT_WARP = Object.freeze({
    enabled: false,
    eligible: false,
    exempt: false,
    role: 'unclassified',
    vertexSnapIntensity: 0,
    affineIntensity: 0,
    snapGridSize: 0.25
});

function normalizeLoFiWarpOptions(options = {}) {
    const source = options && typeof options === 'object' ? options : {};
    const role = String(source.role || DEFAULT_WARP.role);
    const roleExempt = READABILITY_EXEMPT_ROLES.has(role);
    const exempt = Boolean(source.exempt) || roleExempt;
    const vertexSnapIntensity = clamp01(source.vertexSnapIntensity ?? source.vertexSnap ?? 0);
    const affineIntensity = clamp01(source.affineIntensity ?? source.affine ?? 0);
    const snapGridSize = clampPositive(source.snapGridSize ?? source.gridSize ?? DEFAULT_WARP.snapGridSize, DEFAULT_WARP.snapGridSize);
    const enabled = Boolean(source.enabled) && !exempt && (vertexSnapIntensity > 0 || affineIntensity > 0);
    const eligible = Boolean(source.eligible) || enabled;

    return {
        enabled,
        eligible,
        exempt,
        role,
        vertexSnapIntensity,
        affineIntensity,
        snapGridSize
    };
}

function configureLoFiWarpMaterial(material, options = {}) {
    if (!material) return material;

    const config = normalizeLoFiWarpOptions(options);
    material.userData = material.userData || {};
    material.userData.skipBinWarp = config;
    material.needsUpdate = true;

    if (!material.userData.skipBinWarpHookInstalled) {
        material.userData.skipBinWarpBaseOnBeforeCompile = material.onBeforeCompile;
        material.userData.skipBinWarpHookInstalled = true;
    }
    material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
        const previousOnBeforeCompile = this.userData?.skipBinWarpBaseOnBeforeCompile;
        if (typeof previousOnBeforeCompile === 'function') {
            previousOnBeforeCompile.call(this, shader, renderer);
        }
        installLoFiWarpShaderHook(shader, material.userData.skipBinWarp);
    };

    material.customProgramCacheKey = function customProgramCacheKey() {
        const warp = this.userData?.skipBinWarp || DEFAULT_WARP;
        return [
            'skip-bin-warp',
            warp.role,
            warp.eligible ? 'eligible' : 'ineligible',
            warp.exempt ? 'exempt' : 'active'
        ].join(':');
    };

    return material;
}

function setLoFiWarpEnabled(material, enabled) {
    if (!material) return material;
    const current = material.userData?.skipBinWarp || DEFAULT_WARP;
    configureLoFiWarpMaterial(material, { ...current, enabled });
    return material;
}

function setLoFiWarpIntensity(material, options = {}) {
    if (!material) return material;
    const current = material.userData?.skipBinWarp || DEFAULT_WARP;
    configureLoFiWarpMaterial(material, { ...current, ...options });
    return material;
}

function installLoFiWarpShaderHook(shader, config = DEFAULT_WARP) {
    if (!shader) return;

    const warp = normalizeLoFiWarpOptions(config);
    shader.uniforms = shader.uniforms || {};
    shader.uniforms.skipBinWarpEnabled = { value: warp.enabled ? 1 : 0 };
    shader.uniforms.skipBinVertexSnapIntensity = { value: warp.vertexSnapIntensity };
    shader.uniforms.skipBinAffineIntensity = { value: warp.affineIntensity };
    shader.uniforms.skipBinSnapGridSize = { value: warp.snapGridSize };

    if (typeof shader.vertexShader === 'string') {
        shader.vertexShader = injectVertexWarp(shader.vertexShader);
    }
    if (typeof shader.fragmentShader === 'string') {
        shader.fragmentShader = injectAffineWarp(shader.fragmentShader);
    }
}

function injectVertexWarp(vertexShader) {
    const uniforms = [
        'uniform float skipBinWarpEnabled;',
        'uniform float skipBinVertexSnapIntensity;',
        'uniform float skipBinSnapGridSize;'
    ].join('\n');

    let shader = vertexShader.includes('uniform float skipBinWarpEnabled;')
        ? vertexShader
        : vertexShader.replace('#include <common>', `#include <common>\n${uniforms}`);

    const hook = [
        '#include <begin_vertex>',
        'if (skipBinWarpEnabled > 0.5 && skipBinVertexSnapIntensity > 0.0 && skipBinSnapGridSize > 0.0) {',
        '    vec3 skipBinSnapped = floor(transformed / skipBinSnapGridSize + 0.5) * skipBinSnapGridSize;',
        '    transformed = mix(transformed, skipBinSnapped, clamp(skipBinVertexSnapIntensity, 0.0, 1.0));',
        '}'
    ].join('\n');

    return shader.includes('skipBinSnapped')
        ? shader
        : shader.replace('#include <begin_vertex>', hook);
}

function injectAffineWarp(fragmentShader) {
    const uniforms = 'uniform float skipBinAffineIntensity;';
    let shader = fragmentShader.includes('uniform float skipBinAffineIntensity;')
        ? fragmentShader
        : fragmentShader.replace('#include <common>', `#include <common>\n${uniforms}`);

    const hook = [
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'diffuseColor.rgb = mix(diffuseColor.rgb, floor(diffuseColor.rgb * 16.0) / 16.0, clamp(skipBinAffineIntensity, 0.0, 1.0) * 0.08);'
    ].join('\n');

    return shader.includes('skipBinAffineIntensity, 0.0, 1.0')
        ? shader
        : shader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', hook);
}

function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function clampPositive(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

export {
    MaterialFactory,
    configureLoFiWarpMaterial,
    setLoFiWarpEnabled,
    setLoFiWarpIntensity
};
if (typeof window !== 'undefined') {
    window.MaterialFactory = MaterialFactory;
    window.configureLoFiWarpMaterial = configureLoFiWarpMaterial;
    window.setLoFiWarpEnabled = setLoFiWarpEnabled;
    window.setLoFiWarpIntensity = setLoFiWarpIntensity;
}
