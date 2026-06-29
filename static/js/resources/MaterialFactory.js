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
        const { color = 0xffffff, type = 'flat', emissive = 0, emissiveIntensity = 0 } = options;

        if (type === 'toon' && this.toonEnabled) {
            return this.createToonMaterial(color, emissive, emissiveIntensity);
        }
        return this.createFlatMaterial(color, emissive, emissiveIntensity);
    }

    createFlatMaterial(color, emissive, emissiveIntensity) {
        return new THREE.MeshBasicMaterial({
            color,
            emissive,
            emissiveIntensity,
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

        // Use a simple 2-color toon ramp (only in browser environment)
        if (typeof document !== 'undefined' && !MaterialFactory.toonRamp) {
            MaterialFactory.toonRamp = this.createToonRamp();
            toonMaterial.gradientMap = MaterialFactory.toonRamp;
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

export { MaterialFactory };
if (typeof window !== 'undefined') {
    window.MaterialFactory = MaterialFactory;
}
