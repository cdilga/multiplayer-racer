// Renderer backends (P1-R01). Three ways to draw the same three.js scene (WebGPURenderer is a lazily loaded chunk):
//   webgpu  WebGPURenderer on WebGPU (three falls back to its WebGL2 backend by itself if WebGPU is missing);
//   webgl2  WebGPURenderer forced onto its WebGL2 backend (the forced fallback path);
//   webgl   the classic WebGLRenderer.
// `?renderer=` picks one; otherwise DEFAULT_BACKEND, the measured decision in docs/evidence/P1-R01/bench.md.
import { SRGBColorSpace as SRGB, WebGLRenderer, type Camera, type Scene } from 'three';

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
  render(scene: Scene, camera: Camera): void;
}

export function backendFromQuery(q: URLSearchParams): BackendKind {
  const k = q.get('renderer');
  return (BACKENDS as string[]).includes(k ?? '') ? (k as BackendKind) : DEFAULT_BACKEND;
}

const px = new Uint8Array(4);

export async function createBackend(kind: BackendKind, canvas: HTMLCanvasElement, opts: { antialias?: boolean } = {}): Promise<Backend> {
  const antialias = opts.antialias ?? true;
  if (kind === 'webgl') {
    const r = new WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.outputColorSpace = SRGB;
    const gl = r.getContext();
    return {
      kind,
      label: 'WebGL2 (WebGLRenderer)',
      renderer: r,
      maxSize: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),
      finish: async () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px),
      drawCalls: () => r.info.render.calls,
      render: (s, c) => r.render(s, c),
    };
  }
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
      render: (s, c) => r.render(s, c),
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
    render: (s, c) => r.render(s, c),
  };
}
