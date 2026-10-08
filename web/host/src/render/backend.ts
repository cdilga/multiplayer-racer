// Renderer backends (P1-R01). Three ways to draw the same three.js scene (WebGPURenderer is a lazily loaded chunk):
//   webgpu  WebGPURenderer on WebGPU (three falls back to its WebGL2 backend by itself if WebGPU is missing);
//   webgl2  WebGPURenderer forced onto its WebGL2 backend (the forced fallback path);
//   webgl   the classic WebGLRenderer.
// `?renderer=` picks one; otherwise DEFAULT_BACKEND, the measured decision in docs/evidence/P1-R01/bench.md.
import { SRGBColorSpace as SRGB, Vector4, WebGLRenderer, type Camera, type Scene } from 'three';
import { look, prepareScene } from './look';

export type BackendKind = 'webgpu' | 'webgl2' | 'webgl';
export const BACKENDS: BackendKind[] = ['webgpu', 'webgl2', 'webgl'];

/** The decision (docs/evidence/P1-R01/bench.md). */
export const DEFAULT_BACKEND: BackendKind = 'webgl';

/** The renderer API both three renderers share and the host uses. */
type ThreeRenderer = Pick<
  WebGLRenderer,
  | 'setSize'
  | 'setPixelRatio'
  | 'setViewport'
  | 'setScissor'
  | 'setScissorTest'
  | 'clear'
  | 'setClearColor'
  | 'render'
  | 'dispose'
  | 'shadowMap'
  | 'outputColorSpace'
  | 'domElement'
> & { autoClear: boolean; info: { autoReset: boolean; reset(): void; render: { calls: number; drawCalls?: number; triangles: number } } };

export interface Backend {
  /** What was asked for. */
  kind: BackendKind;
  /** What actually draws: 'WebGPU', 'WebGL2 (WebGPURenderer)' or 'WebGL2 (WebGLRenderer)'. */
  label: string;
  renderer: ThreeRenderer;
  /** The largest backing-store edge this browser allows, in device pixels. */
  maxSize: number;
  /** Waits until the GPU has finished the submitted frame (bench timing). */
  finish(): Promise<void>;
  /** Draw calls since the last reset. */
  drawCalls(): number;
  /** Triangles drawn since the last reset. */
  triangles(): number;
  render(scene: Scene, camera: Camera): void;
}

export function backendFromQuery(q: URLSearchParams): BackendKind {
  const k = q.get('renderer');
  return (BACKENDS as string[]).includes(k ?? '') ? (k as BackendKind) : DEFAULT_BACKEND;
}

const px = new Uint8Array(4);
const vp = new Vector4();

/** The look's per-viewport switch (P1-R10): the rig on first sight of a scene, then the cost tier of this viewport. */
function lookFor(r: { getViewport?: (v: Vector4) => Vector4 }, scene: Scene): void {
  prepareScene(scene);
  if (r.getViewport) {
    r.getViewport(vp);
    look.tile(vp.z, vp.w);
  }
}

export async function createBackend(kind: BackendKind, canvas: HTMLCanvasElement, opts: { antialias?: boolean } = {}): Promise<Backend> {
  const antialias = opts.antialias ?? true;
  // The look and the effects are GLSL on the WebGLRenderer route (the shipping one, P1-R01) and on by default since their GPU
  // captures were judged against the accepted look (P1-R10/R12, docs/evidence/P1-R10/). `?look=plain` draws the plain
  // materials (tests that pin exact draw-call arithmetic use it), `?fx=off` drops the effects alone, `?fx=on` keeps them
  // over the plain look. The WebGPU paths draw the plain materials until a TSL port.
  // A software rasteriser (SwiftShader, llvmpipe: no GPU, CI's runners) is a cost tier of its own: it draws the plain look,
  // as the look's tiers drop detail for small tiles. `?look=on` forces the look there.
  const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  if (kind === 'webgl') {
    const r = new WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.outputColorSpace = SRGB;
    const gl = r.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '');
    look.enabled = q.get('look') === 'on' || (q.get('look') !== 'plain' && !software);
    look.fxEnabled = q.get('fx') !== 'off' && (look.enabled || q.get('fx') === 'on');
    return {
      kind,
      label: 'WebGL2 (WebGLRenderer)',
      renderer: r,
      maxSize: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
      finish: async () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px),
      drawCalls: () => r.info.render.calls,
      triangles: () => r.info.render.triangles,
      render: (s, c) => (lookFor(r, s), r.render(s, c)),
    };
  }
  look.enabled = false;
  look.fxEnabled = false;
  const { WebGPURenderer, SRGBColorSpace } = await import('three/webgpu');
  const r = new WebGPURenderer({ canvas, antialias, forceWebGL: kind === 'webgl2', powerPreference: 'high-performance' });
  await r.init();
  r.outputColorSpace = SRGBColorSpace;
  const be = r.backend as unknown as {
    isWebGPUBackend?: boolean;
    device?: { limits: { maxTextureDimension2D: number }; queue: { onSubmittedWorkDone(): Promise<void> } };
    gl?: WebGL2RenderingContext;
  };
  if (be.isWebGPUBackend && be.device) {
    const device = be.device;
    return {
      kind,
      label: 'WebGPU',
      renderer: r as unknown as ThreeRenderer,
      maxSize: device.limits.maxTextureDimension2D,
      finish: () => device.queue.onSubmittedWorkDone(),
      drawCalls: () => r.info.render.drawCalls,
      triangles: () => r.info.render.triangles,
      render: (s, c) => (lookFor(r, s), r.render(s, c)),
    };
  }
  const gl = be.gl!;
  return {
    kind,
    label: 'WebGL2 (WebGPURenderer)',
    renderer: r as unknown as ThreeRenderer,
    maxSize: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
    finish: async () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px),
    drawCalls: () => r.info.render.drawCalls,
    triangles: () => r.info.render.triangles,
    render: (s, c) => (lookFor(r, s), r.render(s, c)),
  };
}
