import * as THREE from 'three';

export const MAX_VORONOI_CAMERA_CELLS = 8;

const FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 vUv;
    uniform sampler2D uMap0;
    uniform sampler2D uMap1;
    uniform sampler2D uMap2;
    uniform sampler2D uMap3;
    uniform sampler2D uMap4;
    uniform sampler2D uMap5;
    uniform sampler2D uMap6;
    uniform sampler2D uMap7;
    uniform vec2 uSeeds[${MAX_VORONOI_CAMERA_CELLS}];
    uniform vec4 uRects[${MAX_VORONOI_CAMERA_CELLS}];
    uniform vec2 uResolution;
    uniform int uCellCount;
    uniform float uFusion;

    vec4 sampleCamera(int index, vec2 uv) {
        vec2 safeUv = clamp(uv, vec2(0.001), vec2(0.999));
        if (index == 0) return texture2D(uMap0, safeUv);
        if (index == 1) return texture2D(uMap1, safeUv);
        if (index == 2) return texture2D(uMap2, safeUv);
        if (index == 3) return texture2D(uMap3, safeUv);
        if (index == 4) return texture2D(uMap4, safeUv);
        if (index == 5) return texture2D(uMap5, safeUv);
        if (index == 6) return texture2D(uMap6, safeUv);
        return texture2D(uMap7, safeUv);
    }

    vec4 cameraRect(int index) {
        if (index == 0) return uRects[0];
        if (index == 1) return uRects[1];
        if (index == 2) return uRects[2];
        if (index == 3) return uRects[3];
        if (index == 4) return uRects[4];
        if (index == 5) return uRects[5];
        if (index == 6) return uRects[6];
        return uRects[7];
    }

    void main() {
        int nearestIndex = 0;
        float nearestDistance = 1.0e20;
        float secondDistance = 1.0e20;

        for (int index = 0; index < ${MAX_VORONOI_CAMERA_CELLS}; index += 1) {
            if (index >= uCellCount) continue;
            vec2 delta = (vUv - uSeeds[index]) * uResolution;
            float distanceSquared = dot(delta, delta);
            if (distanceSquared < nearestDistance) {
                secondDistance = nearestDistance;
                nearestDistance = distanceSquared;
                nearestIndex = index;
            } else if (distanceSquared < secondDistance) {
                secondDistance = distanceSquared;
            }
        }

        vec4 rect = cameraRect(nearestIndex);
        vec2 localUv = (vUv - rect.xy) / max(rect.zw, vec2(0.0001));
        // When groups approach, the cameras and UVs converge to the same shared
        // full-screen image. The eventual K=1 switch is therefore visually fused,
        // not a hard tiled cut.
        vec2 cameraUv = mix(vUv, localUv, uFusion);
        vec4 color = sampleCamera(nearestIndex, cameraUv);

        float boundaryDistance = sqrt(max(secondDistance, 0.0)) - sqrt(max(nearestDistance, 0.0));
        float outerLine = (1.0 - smoothstep(1.5, 5.5, boundaryDistance)) * uFusion;
        float innerLine = (1.0 - smoothstep(0.35, 1.8, boundaryDistance)) * uFusion;
        vec3 ink = vec3(0.078, 0.067, 0.059);
        vec3 cyan = vec3(0.298, 0.788, 0.941);
        vec3 green = vec3(0.0, 1.0, 0.533);
        vec3 accent = mod(float(nearestIndex), 2.0) < 1.0 ? cyan : green;
        color.rgb = mix(color.rgb, ink, outerLine * 0.92);
        color.rgb = mix(color.rgb, accent, innerLine * 0.86);

        gl_FragColor = color;
    }
`;

const VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

function targetScaleForCount(count) {
    if (count <= 2) return 1;
    if (count <= 4) return 0.72;
    return 0.55;
}

/**
 * Render a game camera into one compositor target. setRenderTarget() installs
 * the target's physical-pixel viewport; overriding it with target.width/height
 * would apply WebGLRenderer's device pixel ratio a second time.
 */
export function renderVoronoiCameraTarget(renderer, target, scene, camera) {
    renderer.setRenderTarget(target);
    renderer.setScissorTest(false);
    // The Party camera is reused for several off-screen views and is not a
    // child of the scene, so make each lookAt()/position change authoritative
    // before WebGL reads matrixWorldInverse.
    camera.updateMatrixWorld(true);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
}

/**
 * Owns the off-screen camera targets and the full-screen Voronoi mask shader.
 * RenderSystem remains responsible for positioning each real game camera.
 */
export class VoronoiCameraCompositor {
    constructor({ maxCells = MAX_VORONOI_CAMERA_CELLS } = {}) {
        this.maxCells = Math.max(1, Math.min(MAX_VORONOI_CAMERA_CELLS, maxCells));
        this.targets = [];
        this.targetWidth = 0;
        this.targetHeight = 0;
        this.activeCellCount = 0;
        this.lastFusion = 0;

        const placeholderTexture = new THREE.Texture();
        const uniforms = {
            uSeeds: {
                value: Array.from({ length: MAX_VORONOI_CAMERA_CELLS }, () => new THREE.Vector2(0.5, 0.5))
            },
            uRects: {
                value: Array.from({ length: MAX_VORONOI_CAMERA_CELLS }, () => new THREE.Vector4(0, 0, 1, 1))
            },
            uResolution: { value: new THREE.Vector2(1, 1) },
            uCellCount: { value: 1 },
            uFusion: { value: 0 }
        };
        for (let index = 0; index < MAX_VORONOI_CAMERA_CELLS; index += 1) {
            uniforms[`uMap${index}`] = { value: placeholderTexture };
        }

        this.material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            depthTest: false,
            depthWrite: false,
            toneMapped: false
        });
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
    }

    ensureTargets(count, width, height) {
        const safeCount = Math.max(1, Math.min(this.maxCells, Math.floor(count)));
        const scale = targetScaleForCount(safeCount);
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));

        while (this.targets.length < safeCount) {
            const target = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                depthBuffer: true,
                stencilBuffer: false
            });
            target.texture.name = `jj-voronoi-camera-${this.targets.length + 1}`;
            this.targets.push(target);
        }
        this.targets.forEach((target) => {
            if (target.width !== targetWidth || target.height !== targetHeight) {
                target.setSize(targetWidth, targetHeight);
            }
        });
        this.targetWidth = targetWidth;
        this.targetHeight = targetHeight;
        this.activeCellCount = safeCount;
        return this.targets.slice(0, safeCount);
    }

    compose(renderer, layout, { fusion = 1 } = {}) {
        const count = Math.max(1, Math.min(this.activeCellCount, layout.cells.length, this.maxCells));
        const uniforms = this.material.uniforms;
        uniforms.uCellCount.value = count;
        uniforms.uFusion.value = Math.max(0, Math.min(1, fusion));
        uniforms.uResolution.value.set(layout.width, layout.height);
        this.lastFusion = uniforms.uFusion.value;

        for (let index = 0; index < count; index += 1) {
            const cell = layout.cells[index];
            const seedX = cell.seed.x / layout.width;
            const seedY = 1 - (cell.seed.y / layout.height);
            uniforms.uSeeds.value[index].set(seedX, seedY);

            const rectWidth = cell.bounds.width / layout.width;
            const rectHeight = cell.bounds.height / layout.height;
            const centerX = cell.centroid.x / layout.width;
            const centerY = 1 - (cell.centroid.y / layout.height);
            uniforms.uRects.value[index].set(
                centerX - rectWidth / 2,
                centerY - rectHeight / 2,
                rectWidth,
                rectHeight
            );
            uniforms[`uMap${index}`].value = this.targets[index].texture;
        }

        renderer.setRenderTarget(null);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, layout.width, layout.height);
        renderer.render(this.scene, this.camera);
    }

    getDiagnostics() {
        return {
            active: this.activeCellCount > 1,
            cellCount: this.activeCellCount,
            fusion: this.lastFusion,
            targetWidth: this.targetWidth,
            targetHeight: this.targetHeight
        };
    }

    dispose() {
        this.targets.forEach((target) => target.dispose());
        this.targets = [];
        this.quad.geometry.dispose();
        this.material.dispose();
        this.activeCellCount = 0;
    }
}
