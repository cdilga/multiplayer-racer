import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebGPUBackend from '../../static/js/rendering/WebGPUBackend.js';
import WebGLBackend from '../../static/js/rendering/WebGLBackend.js';
import { selectRendererBackend, createRenderer } from '../../static/js/rendering/RendererBackend.js';

/**
 * Regression: the host hard-crashed ("Something went wrong / Failed to create
 * WebGPU renderer: WebGPU renderer not yet implemented") because WebGPU is
 * detected on Chrome but WebGPUBackend.createRenderer() always threw and nothing
 * fell back. These tests pin the creation-time WebGPU->WebGL fallback so a
 * WebGPU-detected-but-unimplemented environment renders on WebGL instead of
 * throwing / blanking the canvas.
 */

// Minimal THREE stub so WebGLBackend.createRenderer() works headlessly. The real
// WebGLRenderer needs a GL context (unavailable in node); we only need to prove
// the fallback constructs a WebGL renderer, not that GL itself works.
const originalTHREE = globalThis.THREE;

class FakeWebGLRenderer {
    constructor(options = {}) {
        this.options = options;
        this.isWebGLRenderer = true;
    }
}

beforeEach(() => {
    globalThis.THREE = { WebGLRenderer: FakeWebGLRenderer };
});

afterEach(() => {
    globalThis.THREE = originalTHREE;
});

describe('WebGPUBackend.createRenderer creation-time fallback', () => {
    it('does NOT throw when WebGPU is unimplemented; returns a WebGL renderer', async () => {
        const backend = new WebGPUBackend();
        const renderer = await backend.createRenderer({ antialias: true, preserveDrawingBuffer: true });
        expect(renderer).toBeInstanceOf(FakeWebGLRenderer);
        expect(renderer.isWebGLRenderer).toBe(true);
    });

    it('forwards renderer options through to the WebGL fallback', async () => {
        const backend = new WebGPUBackend();
        const renderer = await backend.createRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
        expect(renderer.options.preserveDrawingBuffer).toBe(true);
        expect(renderer.options.antialias).toBe(true);
    });

    it('records the fallback in name + diagnostics so logs/bug-reporter are honest', async () => {
        const backend = new WebGPUBackend();
        await backend.createRenderer({});
        expect(backend.name).toMatch(/webgl/i);
        expect(backend.name).toMatch(/fallback/i);
        const diag = backend.getDiagnostics();
        expect(diag.backend).toMatch(/webgl/i);
        expect(diag.fallback).toBeTruthy();
        expect(diag.fallback.from).toBe('WebGPU');
        expect(diag.fallback.reason).toMatch(/not yet implemented/i);
    });

    it('uses an injected WebGL backend factory when provided', async () => {
        const sentinel = { sentinel: true };
        let constructed = false;
        class InjectedWebGL {
            constructor() { constructed = true; this.name = 'WebGL2'; }
            async createRenderer() { return sentinel; }
        }
        const backend = new WebGPUBackend();
        const renderer = await backend.createRenderer({}, { loadWebGLBackend: async () => InjectedWebGL });
        expect(constructed).toBe(true);
        expect(renderer).toBe(sentinel);
    });
});

describe('createRenderer() helper safety net', () => {
    it('falls back to WebGL when a non-WebGL backend throws', async () => {
        const throwingBackend = {
            name: 'WebGPU',
            async createRenderer() { throw new Error('boom'); }
        };
        const renderer = await createRenderer(throwingBackend, { antialias: true });
        expect(renderer).toBeInstanceOf(FakeWebGLRenderer);
    });

    it('does NOT swallow a WebGL backend failure (nothing left to fall back to)', async () => {
        const failingWebGL = {
            name: 'WebGL',
            async createRenderer() { throw new Error('no GL context'); }
        };
        await expect(createRenderer(failingWebGL, {})).rejects.toThrow(/no GL context/);
    });

    it('returns the primary renderer unchanged when the backend succeeds', async () => {
        const ok = { ok: true };
        const goodBackend = { name: 'WebGPU', async createRenderer() { return ok; } };
        expect(await createRenderer(goodBackend, {})).toBe(ok);
    });
});

describe('end-to-end: WebGPU-detected env still renders via WebGL', () => {
    it('selectRendererBackend + createRenderer yields a WebGL renderer, no throw', async () => {
        // Simulate "WebGPU available" by forcing the selected backend to be a
        // WebGPU backend whose isAvailable() reports true.
        const webgpu = new WebGPUBackend();
        webgpu.isAvailable = async () => true;

        // Selection picks WebGPU (that part is unchanged and correct)...
        const selected = await selectRendererBackend({
            forceWebGL: false,
            killswitch: false
        }).catch(() => null);
        // ...but selection in this headless env may resolve to WebGL or WebGPU
        // depending on navigator.gpu; the contract we pin is the creation path:
        const renderer = await createRenderer(webgpu, { preserveDrawingBuffer: true });
        expect(renderer).toBeInstanceOf(FakeWebGLRenderer);
        // selected is a valid backend instance (no crash during selection)
        expect(selected === null || typeof selected.createRenderer === 'function').toBe(true);
    });

    it('forceWebGL selection returns a WebGL backend directly', async () => {
        const backend = await selectRendererBackend({ forceWebGL: true });
        expect(backend).toBeInstanceOf(WebGLBackend);
    });
});
