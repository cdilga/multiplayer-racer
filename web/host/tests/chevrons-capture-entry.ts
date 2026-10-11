// Close inspection of the actual kit geometry; the runtime journey below separately checks placement.
import { AmbientLight, Color, DirectionalLight, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { chevronPost } from '../src/render/kit/wayfinding';

(window as unknown as Record<string, unknown>).Chevron = {
  async draw(width: number, height: number, view: string) {
    const canvas = document.createElement('canvas');
    document.body.replaceChildren(canvas);
    const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height);
    renderer.setClearColor(new Color('#9cc3e0'));
    const scene = new Scene();
    scene.add(new AmbientLight('#ffffff', 2));
    const light = new DirectionalLight('#ffffff', 1);
    light.position.set(3, 5, 4);
    scene.add(light);
    const material = new MeshLambertMaterial({ vertexColors: true });
    const params = { radiusMm: 60, heightCm: 240, rightArrow: Number(view === 'right') };
    const post = new Mesh(chevronPost.geometry(), material);
    post.scale.set(...chevronPost.scale(params));
    scene.add(post);
    const board = new Mesh(chevronPost.decor!.geometry(chevronPost.decor!.variant!(params)), material);
    board.position.y = chevronPost.decor!.lift!(params);
    scene.add(board);
    const camera = new PerspectiveCamera(45, width / height, 0.01, 40);
    const positions: Record<string, [number, number, number]> = {
      front: [0, 1.65, 4.4], right: [0, 1.65, 4.4], rear: [1.5, 2, -3.4], side: [1.1, 1.8, -0.9],
    };
    camera.position.set(...positions[view]!);
    camera.lookAt(0, view === 'side' ? 1.7 : 1.3, 0);
    renderer.render(scene, camera);
    // Let the canvas reach the compositor before the browser screenshot reads it.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  },
};
