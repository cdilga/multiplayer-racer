/**
 * WebGL renderer backend.
 * Prefers WebGL2, falls back to WebGL1 if needed.
 */

import { RendererBackend } from './RendererBackend.js';

export default class WebGLBackend extends RendererBackend {
    constructor() {
        super('WebGL');
        this.contextInfo = null;
    }

    /**
     * Check if WebGL is available.
     * WebGL2 is preferred; WebGL1 is fallback.
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
        try {
            const canvas = document.createElement('canvas');

            // Try WebGL2 first
            const webgl2Context = canvas.getContext('webgl2', { antialias: true, alpha: false });
            if (webgl2Context) {
                this.contextInfo = this._captureContextInfo(webgl2Context, 'WebGL2');
                this.diagnostics.available = true;
                this.diagnostics.adapterInfo = { vendor: 'WebGL2' };
                this.diagnostics.deviceLimits = this.contextInfo.limits;
                return true;
            }

            // Fall back to WebGL1
            const webgl1Context = canvas.getContext('webgl', { antialias: true, alpha: false });
            if (webgl1Context) {
                this.contextInfo = this._captureContextInfo(webgl1Context, 'WebGL1');
                this.diagnostics.available = true;
                this.diagnostics.reason = 'WebGL2 unavailable, using WebGL1 fallback';
                this.diagnostics.adapterInfo = { vendor: 'WebGL1' };
                this.diagnostics.deviceLimits = this.contextInfo.limits;
                return true;
            }

            this.setUnavailableReason('WebGL not available on this system');
            return false;
        } catch (error) {
            this.setUnavailableReason(`WebGL detection error: ${error.message}`);
            return false;
        }
    }

    /**
     * Create a Three.js WebGLRenderer.
     * @returns {Promise<THREE.Renderer>}
     */
    async createRenderer(options = {}) {
        // Assume THREE is available globally (loaded by Vite entry point)
        if (typeof THREE === 'undefined') {
            throw new Error('THREE.js not loaded');
        }

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
            ...options
        });

        this.renderer = renderer;
        return renderer;
    }

    /**
     * Capture WebGL context capabilities and limits.
     * @private
     * @param {WebGLRenderingContext} context
     * @param {string} version - "WebGL1" or "WebGL2"
     * @returns {Object}
     */
    _captureContextInfo(context, version) {
        const ext = context.getExtension('WEBGL_debug_renderer_info');
        const vendor = ext ? context.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'Unknown';
        const renderer = ext ? context.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'Unknown';

        return {
            version,
            vendor,
            renderer,
            limits: {
                maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
                maxCubeMapTextureSize: context.getParameter(context.MAX_CUBE_MAP_TEXTURE_SIZE),
                maxRenderbufferSize: context.getParameter(context.MAX_RENDERBUFFER_SIZE),
                maxViewportDimensions: context.getParameter(context.MAX_VIEWPORT_DIMS),
                maxVertexAttribs: context.getParameter(context.MAX_VERTEX_ATTRIBS),
                maxVertexUniformVectors: context.getParameter(context.MAX_VERTEX_UNIFORM_VECTORS),
                maxVaryingVectors: context.getParameter(context.MAX_VARYING_VECTORS),
                maxFragmentUniformVectors: context.getParameter(context.MAX_FRAGMENT_UNIFORM_VECTORS),
                maxDrawBuffers: context.getParameter(context.MAX_DRAW_BUFFERS || 1)
            }
        };
    }
}
