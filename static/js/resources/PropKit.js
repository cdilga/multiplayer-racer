/**
 * PropKit - Reusable decorative prop factory for arena tracks.
 *
 * Creates low-poly primitive prop groups with no gameplay effects.
 */

import { MaterialFactory } from './MaterialFactory.js';

const KINDS = new Set([
    'crate',
    'barrel',
    'tyres',
    'cone',
    'barrier',
    'ramp',
    'sign',
    'husk',
    'drum'
]);

const KIND_DEFAULTS = {
    crate: 0xd28c63,
    barrel: 0x4a3424,
    tyres: 0x1a1a1a,
    cone: 0xffa94c,
    barrier: 0xa8a8a8,
    ramp: 0x6aa36a,
    sign: 0xfff6a9,
    husk: 0x73838f,
    drum: 0x6f4031
};

class PropKit {
    constructor(materialFactory = null) {
        this.materialFactory = materialFactory || new MaterialFactory();
    }

    createPropsList(entries = [], palette = {}) {
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries
            .map((entry) => this.createProp(entry, palette))
            .filter(Boolean);
    }

    createProp(entry = {}, palette = {}) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }

        const kind = String(entry.kind || '').toLowerCase();
        if (!KINDS.has(kind)) {
            return null;
        }

        const material = this.materialFactory.createMaterial({
            color: this._resolveColor(kind, entry.paletteKey, palette),
            type: 'flat'
        });
        const prop = new THREE.Group();
        prop.userData = {
            isPropKitProp: true,
            propKind: kind,
            paletteKey: entry.paletteKey || 'default',
            decorativeOnly: true
        };

        this._buildKindGeometry(kind, entry, palette).forEach((shape) => {
            const shapeMaterial = shape.tint && shape.tint !== material.color.getHex()
                ? this.materialFactory.createMaterial({ color: shape.tint, type: 'flat' })
                : material;
            const mesh = new THREE.Mesh(shape.geometry, shapeMaterial);
            if (shape.position) {
                mesh.position.set(shape.position.x || 0, shape.position.y || 0, shape.position.z || 0);
            }
            if (shape.rotation) {
                mesh.rotation.set(shape.rotation.x || 0, shape.rotation.y || 0, shape.rotation.z || 0);
            }
            mesh.userData = {
                isPropKitProp: true,
                propKind: kind,
                propPart: shape.part,
                geometryType: shape.type
            };
            prop.add(mesh);
        });

        prop.position.set(
            Number(entry.x ?? 0),
            Number(entry.y ?? 0),
            Number(entry.z ?? 0)
        );
        prop.rotation.set(
            Number(entry.rotationX ?? 0),
            Number(entry.rotationY ?? 0),
            Number(entry.rotationZ ?? 0)
        );
        if (Array.isArray(entry.scale) && entry.scale.length === 3) {
            prop.scale.set(entry.scale[0], entry.scale[1], entry.scale[2]);
        } else if (typeof entry.scale === 'number') {
            prop.scale.setScalar(entry.scale);
        }

        prop.userData.childCount = prop.children.length;
        return prop;
    }

    _buildKindGeometry(kind, entry = {}, palette = {}) {
        const base = Number(entry.size ?? 1);
        const tint = this._resolveColor(kind, entry.paletteKey, palette);
        const shapes = [];

        const add = (part, type, geometry, overrides = {}) => {
            shapes.push({
                part,
                type,
                tint: overrides.tint || tint,
                geometry,
                position: overrides.position,
                rotation: overrides.rotation
            });
        };

        switch (kind) {
            case 'crate':
                add('crate-body', 'BoxGeometry', new THREE.BoxGeometry(base, base, base, 1, 1, 1));
                break;
            case 'barrel':
                add('barrel-shell', 'CylinderGeometry', new THREE.CylinderGeometry(base * 0.45, base * 0.5, base * 1.4, 8, 1, false));
                break;
            case 'tyres':
                add('tyre-left', 'CylinderGeometry', new THREE.CylinderGeometry(base * 0.22, base * 0.22, base * 1.1, 10, 1, false), { position: { x: -base * 0.35, y: 0, z: 0 } });
                add('tyre-right', 'CylinderGeometry', new THREE.CylinderGeometry(base * 0.22, base * 0.22, base * 1.1, 10, 1, false), { position: { x: base * 0.35, y: 0, z: 0 } });
                break;
            case 'cone':
                add('cone-top', 'ConeGeometry', new THREE.ConeGeometry(base * 0.6, base * 1.35, 8, 1));
                break;
            case 'barrier':
                add('barrier-post', 'BoxGeometry', new THREE.BoxGeometry(base * 1.1, base * 0.7, base * 0.3, 1, 1, 1));
                add('barrier-fill', 'BoxGeometry', new THREE.BoxGeometry(base * 1.1, base * 0.18, base * 0.6, 1, 1, 1), { position: { x: 0, y: base * 0.44, z: 0 } });
                break;
            case 'ramp':
                add('ramp-slab', 'BoxGeometry', new THREE.BoxGeometry(base * 2.5, base * 0.22, base * 1.9, 1, 1, 1), { rotation: { x: Math.PI / 8, y: 0, z: 0 } });
                break;
            case 'sign':
                add('sign-post', 'BoxGeometry', new THREE.BoxGeometry(base * 0.15, base * 1.4, base * 0.15, 1, 1, 1), { position: { x: 0, y: base * 0.2, z: 0 } });
                add('sign-board', 'BoxGeometry', new THREE.BoxGeometry(base * 0.9, base * 0.6, base * 0.08, 1, 1, 1), { position: { x: 0, y: base * 0.95, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } });
                break;
            case 'husk':
                add('husk-shell', 'OctahedronGeometry', new THREE.OctahedronGeometry(base * 0.5, 0));
                break;
            case 'drum':
                add('drum-shell', 'CylinderGeometry', new THREE.CylinderGeometry(base * 0.4, base * 0.4, base * 1.05, 8, 1, false));
                break;
            default:
                return [];
        }

        return shapes;
    }

    _resolveColor(kind, paletteKey, palette = {}) {
        if (paletteKey && Object.prototype.hasOwnProperty.call(palette, paletteKey)) {
            return this._parseColor(palette[paletteKey]);
        }
        if (Object.prototype.hasOwnProperty.call(palette, kind)) {
            return this._parseColor(palette[kind]);
        }
        if (Object.prototype.hasOwnProperty.call(palette, 'default')) {
            return this._parseColor(palette.default);
        }
        return KIND_DEFAULTS[kind] || 0x808080;
    }

    _parseColor(colorValue) {
        if (typeof colorValue === 'number') {
            return colorValue;
        }
        if (typeof colorValue === 'string' && colorValue.startsWith('#')) {
            return new THREE.Color(colorValue).getHex();
        }
        return KIND_DEFAULTS[colorValue] || 0x808080;
    }
}

export { KINDS, PropKit };
