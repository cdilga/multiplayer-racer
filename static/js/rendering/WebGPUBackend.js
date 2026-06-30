/**
 * WebGPU renderer backend.
 * Detects WebGPU support and creates a Three.js WebGPURenderer.
 */

import { RendererBackend } from './RendererBackend.js';

export default class WebGPUBackend extends RendererBackend {
    constructor() {
        super('WebGPU');
        this.adapter = null;
        this.device = null;
    }

    /**
     * Check if WebGPU is available in this browser.
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        if (typeof navigator === 'undefined' || !navigator.gpu) {
            this.setUnavailableReason('navigator.gpu not available');
            return false;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                this.setUnavailableReason('No WebGPU adapter found');
                return false;
            }
            this.adapter = adapter;

            // Capture adapter info if available (WebGPU spec)
            if (adapter.info) {
                this.diagnostics.adapterInfo = {
                    vendor: adapter.info.vendor,
                    architecture: adapter.info.architecture,
                    device: adapter.info.device,
                    description: adapter.info.description
                };
            }

            // Test device creation
            const device = await adapter.requestDevice();
            if (!device) {
                this.setUnavailableReason('Failed to create WebGPU device');
                return false;
            }
            this.device = device;

            // Capture device limits
            if (device.limits) {
                this.diagnostics.deviceLimits = {
                    maxBindGroups: device.limits.maxBindGroups,
                    maxBindingsPerBindGroup: device.limits.maxBindingsPerBindGroup,
                    maxTextureDimension1D: device.limits.maxTextureDimension1D,
                    maxTextureDimension2D: device.limits.maxTextureDimension2D,
                    maxTextureDimension3D: device.limits.maxTextureDimension3D,
                    maxTextureArrayLayers: device.limits.maxTextureArrayLayers,
                    maxSamplersPerShaderStage: device.limits.maxSamplersPerShaderStage,
                    maxStorageTexturesPerShaderStage: device.limits.maxStorageTexturesPerShaderStage,
                    maxStorageBuffersPerShaderStage: device.limits.maxStorageBuffersPerShaderStage,
                    maxUniformBuffersPerShaderStage: device.limits.maxUniformBuffersPerShaderStage,
                    maxUniformBufferBindingSize: device.limits.maxUniformBufferBindingSize,
                    maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
                    maxComputeWorkgroupStorageSize: device.limits.maxComputeWorkgroupStorageSize,
                    maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup,
                    maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
                    maxComputeWorkgroupSizeY: device.limits.maxComputeWorkgroupSizeY,
                    maxComputeWorkgroupSizeZ: device.limits.maxComputeWorkgroupSizeZ
                };
            }

            // Capture required features if using any
            if (adapter.features) {
                this.diagnostics.requiredFeatures = Array.from(adapter.features);
            }

            this.diagnostics.available = true;
            this.diagnostics.reason = null;
            return true;
        } catch (error) {
            this.setUnavailableReason(`WebGPU detection error: ${error.message}`);
            return false;
        }
    }

    /**
     * Create a renderer.
     *
     * WebGPU is detected as *available* on Chrome, but the WebGPU-native path
     * below is not implemented yet. Rather than throw (which previously killed
     * the host with a blank "Something went wrong" screen — the "falling back to
     * WebGL" message was a lie, no fallback happened), we perform a real
     * creation-time fallback: construct a WebGLBackend and use its renderer.
     *
     * When the native WebGPU path is enabled (uncomment below), the same
     * try/catch keeps the WebGL safety net for adapter/device/runtime failures.
     *
     * @param {Object} options - Three.js renderer options
     * @param {Object} [deps] - injectable deps for testing
     * @param {Function} [deps.loadWebGLBackend] - async () => WebGLBackend class
     * @returns {Promise<THREE.Renderer>}
     */
    async createRenderer(options = {}, deps = {}) {
        try {
            // TODO: enable when Three.js WebGPURenderer is stable + well-tested.
            /*
            if (!this.device) {
                throw new Error('WebGPU device not initialized');
            }
            const { WebGPURenderer } = await import('three/examples/jsm/renderers/webgpu/WebGPURenderer.js');
            const renderer = new WebGPURenderer({ device: this.device, ...options });
            this.renderer = renderer;
            return renderer;
            */

            throw new Error('WebGPU renderer not yet implemented');
        } catch (error) {
            // Creation-time fallback to WebGL. WebGPU was detected (isAvailable)
            // but cannot actually produce a renderer here, so swap to WebGL2/WebGL
            // so the host renders instead of crashing.
            return this._fallbackToWebGL(options, error, deps);
        }
    }

    /**
     * Construct a WebGLBackend and create its renderer, recording that this
     * WebGPU backend fell back. Updates name/diagnostics so logs and the bug
     * reporter reflect the actually-active backend.
     * @private
     * @param {Object} options
     * @param {Error} reason - the WebGPU creation failure that triggered fallback
     * @param {Object} [deps]
     * @returns {Promise<THREE.Renderer>}
     */
    async _fallbackToWebGL(options, reason, deps = {}) {
        const loadWebGLBackend = deps.loadWebGLBackend
            || (async () => (await import('./WebGLBackend.js')).default);
        const WebGLBackend = await loadWebGLBackend();

        const webgl = new WebGLBackend();
        const renderer = await webgl.createRenderer(options);

        this.fallbackBackend = webgl;
        this.renderer = renderer;
        // Reflect the real active backend in name + diagnostics (RenderSystem
        // logs `${backend.name}` and the bug reporter reads diagnostics).
        this.name = 'WebGL (WebGPU fallback)';
        this.diagnostics.backend = webgl.name;
        this.diagnostics.fallback = {
            from: 'WebGPU',
            to: webgl.name,
            reason: reason && reason.message ? reason.message : String(reason)
        };
        if (webgl.diagnostics) {
            this.diagnostics.adapterInfo = webgl.diagnostics.adapterInfo || this.diagnostics.adapterInfo;
            this.diagnostics.deviceLimits = webgl.diagnostics.deviceLimits || this.diagnostics.deviceLimits;
        }
        console.warn(
            `WebGPUBackend: WebGPU createRenderer failed (${this.diagnostics.fallback.reason}); ` +
            `using ${webgl.name} fallback.`
        );
        return renderer;
    }
}
