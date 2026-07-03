/**
 * Selective-bloom layer convention (br-skip-bin-arcade-design-language-5k3.6).
 *
 * Full-frame UnrealBloom is inverted into an emissive-only diegetic glow: a mesh
 * blooms IFF it is on BLOOM_LAYER. The RenderSystem darkens everything NOT on the
 * layer before the bloom pass, so only neon signage / headlights / pickups /
 * danger strips bleed — the grimy world does not.
 *
 * A mesh becomes bloom-eligible when it carries a lit emissive channel
 * (material.emissiveIntensity > 0) OR is explicitly opted in via
 * `userData.bloomEligible = true` (for unlit full-bright loud props — headlight
 * lenses, weapon pickups/projectiles — that have no emissive channel).
 */

/** Reserved THREE layer index for bloom-eligible objects. */
export const BLOOM_LAYER = 1;

/**
 * True when a mesh should contribute to the bloom pass.
 * @param {Object} mesh - a THREE.Mesh-like object
 * @returns {boolean}
 */
export function isBloomEligible(mesh) {
    if (!mesh) return false;
    if (mesh.userData && mesh.userData.bloomEligible === true) return true;
    const material = mesh.material;
    const mats = Array.isArray(material) ? material : (material ? [material] : []);
    for (const mat of mats) {
        if (mat && typeof mat.emissiveIntensity === 'number' && mat.emissiveIntensity > 0) {
            return true;
        }
    }
    return false;
}

/**
 * Enable BLOOM_LAYER on an object and all of its descendants (so a whole prop
 * blooms together). Safe on plain objects that lack `.layers`.
 * @param {Object} object - a THREE.Object3D-like node
 */
export function enableBloom(object) {
    if (!object) return;
    const apply = (node) => {
        if (node && node.layers && typeof node.layers.enable === 'function') {
            node.layers.enable(BLOOM_LAYER);
        }
    };
    apply(object);
    if (typeof object.traverse === 'function') {
        object.traverse(apply);
    } else if (Array.isArray(object.children)) {
        for (const child of object.children) enableBloom(child);
    }
}

export default { BLOOM_LAYER, isBloomEligible, enableBloom };
