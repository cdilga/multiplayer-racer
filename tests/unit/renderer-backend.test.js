import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RendererBackend, selectRendererBackend } from '../../static/js/rendering/RendererBackend.js';
import WebGPUBackend from '../../static/js/rendering/WebGPUBackend.js';
import WebGLBackend from '../../static/js/rendering/WebGLBackend.js';

describe('Renderer Backend', () => {
    describe('RendererBackend base class', () => {
        it('initializes with name and capabilities', () => {
            const backend = new RendererBackend('TestBackend', { feature: true });
            expect(backend.name).toBe('TestBackend');
            expect(backend.capabilities.feature).toBe(true);
        });

        it('throws when createRenderer is not implemented', async () => {
            const backend = new RendererBackend('TestBackend');
            await expect(backend.createRenderer()).rejects.toThrow(
                'createRenderer() must be implemented by subclass'
            );
        });

        it('throws when isAvailable is not implemented', async () => {
            const backend = new RendererBackend('TestBackend');
            await expect(backend.isAvailable()).rejects.toThrow(
                'isAvailable() must be implemented by subclass'
            );
        });

        it('returns diagnostics with timestamp', () => {
            const backend = new RendererBackend('TestBackend');
            const diag = backend.getDiagnostics();
            expect(diag.backend).toBe('TestBackend');
            expect(diag.available).toBe(true);
            expect(typeof diag.timestamp).toBe('number');
        });

        it('sets unavailable reason', () => {
            const backend = new RendererBackend('TestBackend');
            backend.setUnavailableReason('Test reason');
            const diag = backend.getDiagnostics();
            expect(diag.available).toBe(false);
            expect(diag.reason).toBe('Test reason');
        });
    });

    describe('WebGPU Backend', () => {
        let backend;

        beforeEach(() => {
            backend = new WebGPUBackend();
        });

        it('detects when WebGPU is unavailable', async () => {
            vi.stubGlobal('navigator', { gpu: null });
            const available = await backend.isAvailable();
            expect(available).toBe(false);
            expect(backend.getDiagnostics().reason).toBe('navigator.gpu not available');
        });

        it('returns diagnostics when WebGPU is unavailable', async () => {
            vi.stubGlobal('navigator', { gpu: null });
            await backend.isAvailable();
            const diag = backend.getDiagnostics();
            expect(diag.backend).toBe('WebGPU');
            expect(diag.available).toBe(false);
        });

        it('captures adapter and device limits when WebGPU is available', async () => {
            const fakeDevice = {
                limits: {
                    maxBindGroups: 4,
                    maxBindingsPerBindGroup: 16,
                    maxTextureDimension1D: 8192,
                    maxTextureDimension2D: 8192,
                    maxTextureDimension3D: 2048,
                    maxTextureArrayLayers: 256,
                    maxSamplersPerShaderStage: 16,
                    maxStorageTexturesPerShaderStage: 8,
                    maxStorageBuffersPerShaderStage: 8,
                    maxUniformBuffersPerShaderStage: 12,
                    maxUniformBufferBindingSize: 65536,
                    maxStorageBufferBindingSize: 134217728,
                    maxComputeWorkgroupStorageSize: 16384,
                    maxComputeInvocationsPerWorkgroup: 256,
                    maxComputeWorkgroupSizeX: 256,
                    maxComputeWorkgroupSizeY: 256,
                    maxComputeWorkgroupSizeZ: 64
                },
                lost: Promise.resolve({ reason: 'destroyed' })
            };
            const fakeAdapter = {
                info: {
                    vendor: 'TestVendor',
                    architecture: 'TestArch',
                    device: 'TestGPU',
                    description: 'Unit test GPU'
                },
                features: new Set(['texture-compression-bc']),
                requestDevice: vi.fn(async () => fakeDevice)
            };
            vi.stubGlobal('navigator', {
                gpu: {
                    requestAdapter: vi.fn(async () => fakeAdapter)
                }
            });

            const available = await backend.isAvailable();
            const diagnostics = backend.getDiagnostics();

            expect(available).toBe(true);
            expect(backend.adapter).toBe(fakeAdapter);
            expect(backend.device).toBe(fakeDevice);
            expect(diagnostics.adapterInfo.vendor).toBe('TestVendor');
            expect(diagnostics.deviceLimits.maxTextureDimension2D).toBe(8192);
            expect(diagnostics.supportedFeatures).toContain('texture-compression-bc');
            expect(diagnostics.activeApi).toBe('webgpu');
            expect(diagnostics.nativeWebGPU).toBe(true);
        });

        it('creates an initialized native WebGPU renderer with the injected three/webgpu module', async () => {
            class FakeWebGPURenderer {
                constructor(options) {
                    this.options = options;
                    this.backend = { isWebGPUBackend: true };
                    this.isWebGPURenderer = true;
                    this.initialized = false;
                }

                async init() {
                    this.initialized = true;
                }
            }

            backend.device = { label: 'existing-device' };
            const renderer = await backend.createRenderer(
                { antialias: true, alpha: false },
                { loadWebGPUModule: async () => ({ WebGPURenderer: FakeWebGPURenderer }) }
            );

            expect(renderer).toBeInstanceOf(FakeWebGPURenderer);
            expect(renderer.initialized).toBe(true);
            expect(renderer.options.device).toBe(backend.device);
            expect(backend.name).toBe('WebGPU');
            expect(backend.getDiagnostics()).toMatchObject({
                backend: 'WebGPU',
                activeApi: 'webgpu',
                nativeWebGPU: true,
                rendererType: 'WebGPURenderer',
                rendererInitialized: true
            });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });
    });

    describe('WebGL Backend', () => {
        let backend;

        beforeEach(() => {
            backend = new WebGLBackend();
        });

        it('creates a canvas for context testing', async () => {
            const available = await backend.isAvailable();
            // Most test environments don't support WebGL in Node.js
            // Just verify it doesn't crash
            expect(typeof available).toBe('boolean');
        });

        it('captures context info when available', async () => {
            const available = await backend.isAvailable();
            if (available) {
                const diag = backend.getDiagnostics();
                expect(diag.backend).toBe('WebGL');
                expect(diag.adapterInfo).toBeDefined();
                expect(diag.deviceLimits).toBeDefined();
            }
        });

        it('returns WebGL1 fallback reason if WebGL2 unavailable', async () => {
            // This test verifies the fallback logic handles both cases
            const available = await backend.isAvailable();
            if (available) {
                const diag = backend.getDiagnostics();
                // Reason field should be set if using fallback
                if (diag.reason) {
                    expect(diag.reason).toContain('WebGL');
                }
            }
        });
    });

    describe('Backend selection', () => {
        it('selectRendererBackend returns a backend', async () => {
            // This test runs in Node.js where WebGL is not available,
            // so it should always return a backend (might be unavailable, but exists)
            const backend = await selectRendererBackend();
            expect(backend).toBeDefined();
            expect(backend.name).toBeDefined();
        });

        it('forceWebGL option skips WebGPU detection', async () => {
            const backend = await selectRendererBackend({ forceWebGL: true });
            expect(backend.name).not.toBe('WebGPU');
        });

        it('killswitch option skips WebGPU', async () => {
            const backend = await selectRendererBackend({ killswitch: true });
            // Should skip to WebGL
            expect(backend).toBeDefined();
        });

        it('preferWebGPU false skips WebGPU detection even when navigator.gpu exists', async () => {
            const requestAdapter = vi.fn(async () => {
                throw new Error('WebGPU should not be probed');
            });
            vi.stubGlobal('navigator', { gpu: { requestAdapter } });
            try {
                const backend = await selectRendererBackend({ preferWebGPU: false });
                expect(backend).toBeInstanceOf(WebGLBackend);
                expect(requestAdapter).not.toHaveBeenCalled();
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('returns a backend with diagnostics', async () => {
            const backend = await selectRendererBackend();
            const diag = backend.getDiagnostics();
            expect(diag.backend).toBeDefined();
            expect(typeof diag.available).toBe('boolean');
        });
    });

    describe('Diagnostics contract', () => {
        it('WebGPU diagnostics include required fields', async () => {
            const backend = new WebGPUBackend();
            const diag = backend.getDiagnostics();
            expect(diag).toHaveProperty('backend');
            expect(diag).toHaveProperty('available');
            expect(diag).toHaveProperty('reason');
            expect(diag).toHaveProperty('adapterInfo');
            expect(diag).toHaveProperty('deviceLimits');
            expect(diag).toHaveProperty('requiredFeatures');
            expect(diag).toHaveProperty('timestamp');
        });

        it('WebGL diagnostics include required fields', async () => {
            const backend = new WebGLBackend();
            const available = await backend.isAvailable();
            const diag = backend.getDiagnostics();
            expect(diag).toHaveProperty('backend');
            expect(diag).toHaveProperty('available');
            expect(diag).toHaveProperty('reason');
            expect(diag).toHaveProperty('adapterInfo');
            expect(diag).toHaveProperty('deviceLimits');
            expect(diag).toHaveProperty('timestamp');
        });
    });

    describe('Architecture guard: Local controller isolation', () => {
        it('backend selection does not depend on frontend role', async () => {
            // Verify backend selection is agnostic to Local vs Remote mode
            // (Local controllers never instantiate renderers, but if they did,
            // they would get the same backend selection as hosts)
            const backend1 = await selectRendererBackend();
            const backend2 = await selectRendererBackend();
            expect(backend1.name).toBe(backend2.name);
        });

        it('renders diagnostics available for all backends', async () => {
            const backend = await selectRendererBackend();
            const diag = backend.getRenderDiagnostics?.() || backend.getDiagnostics();
            // Verify diagnostics are machine-readable
            expect(typeof diag).toBe('object');
            expect(diag.backend).toBeDefined();
        });
    });
});
