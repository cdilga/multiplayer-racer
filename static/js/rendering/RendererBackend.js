/**
 * Renderer backend abstraction for WebGPU-first, WebGL-fallback architecture.
 *
 * This module provides the interface for selecting and creating renderer backends.
 * The game prefers WebGPU where available and falls back to WebGL2/WebGL.
 */

/**
 * Abstract base class for renderer backends.
 * Subclasses implement createRenderer() to return a Three.js compatible renderer.
 */
export class RendererBackend {
    constructor(name, capabilities = {}) {
        this.name = name;
        this.capabilities = capabilities;
        this.renderer = null;
        this.diagnostics = {
            backend: name,
            available: true,
            reason: null,
            adapterInfo: null,
            deviceLimits: null,
            requiredFeatures: [],
            timestamp: null
        };
    }

    /**
     * Create and return a Three.js renderer instance.
     * Must be implemented by subclasses.
     * @returns {THREE.Renderer}
     */
    async createRenderer(options = {}) {
        throw new Error('createRenderer() must be implemented by subclass');
    }

    /**
     * Check if this backend is available in the current browser.
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        throw new Error('isAvailable() must be implemented by subclass');
    }

    /**
     * Get diagnostics for this backend (adapter limits, feature support, etc).
     * @returns {Object}
     */
    getDiagnostics() {
        return { ...this.diagnostics, timestamp: Date.now() };
    }

    /**
     * Set reason if backend is not available.
     * @param {string} reason
     */
    setUnavailableReason(reason) {
        this.diagnostics.available = false;
        this.diagnostics.reason = reason;
    }
}

/**
 * Detect and select the best available renderer backend.
 * Prefers WebGPU, falls back to WebGL2, then WebGL.
 * @param {Object} options - Selection options
 * @param {boolean} [options.forceWebGL] - Skip WebGPU, use WebGL
 * @param {boolean} [options.killswitch] - Disable all WebGPU
 * @returns {Promise<RendererBackend>}
 */
export async function selectRendererBackend(options = {}) {
    const { forceWebGL = false, killswitch = false } = options;

    // If WebGPU is killed or forced off, skip to WebGL
    if (!forceWebGL && !killswitch) {
        const webgpuBackend = (await import('./WebGPUBackend.js')).default;
        const backend = new webgpuBackend();
        if (await backend.isAvailable()) {
            return backend;
        }
    }

    // Fall back to WebGL2/WebGL
    const webglBackend = (await import('./WebGLBackend.js')).default;
    return new webglBackend();
}

/**
 * Create a renderer using the selected backend, with a WebGL safety net.
 *
 * If the selected backend's createRenderer() throws (e.g. WebGPU detected but
 * not actually able to create a renderer), fall back to WebGLBackend rather than
 * propagating the error and blanking the screen. Only the WebGL backend itself
 * failing is fatal — there is nothing left to fall back to.
 *
 * @param {RendererBackend} backend
 * @param {Object} options - Three.js renderer options
 * @param {Object} [deps] - injectable deps for testing
 * @param {Function} [deps.loadWebGLBackend] - async () => WebGLBackend class
 * @returns {Promise<THREE.Renderer>}
 */
export async function createRenderer(backend, options = {}, deps = {}) {
    try {
        return await backend.createRenderer(options);
    } catch (error) {
        // The WebGL backend has no further fallback; its failure is terminal.
        const isWebGL = typeof backend.name === 'string' && /webgl/i.test(backend.name);
        if (isWebGL) {
            console.error(`Failed to create renderer with backend ${backend.name}:`, error);
            throw error;
        }

        console.warn(
            `Renderer backend "${backend.name}" failed to create (${error.message}); ` +
            `falling back to WebGL.`
        );
        const loadWebGLBackend = deps.loadWebGLBackend
            || (async () => (await import('./WebGLBackend.js')).default);
        const WebGLBackend = await loadWebGLBackend();
        const webgl = new WebGLBackend();
        return await webgl.createRenderer(options);
    }
}
