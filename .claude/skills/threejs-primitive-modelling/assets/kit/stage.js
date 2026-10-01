// stage.js — renderer + lighting rig shared by the viewer and the capture script.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createStage({ canvas, width = 1280, height = 720, pixelRatio = 1, bg = '#f3e6cf', ground = '#e9d3ad' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  scene.add(new THREE.HemisphereLight('#fff4de', '#b48a5e', 0.5));
  const key = new THREE.DirectionalLight('#fff0d0', 1.9);
  key.position.set(5, 9, 6); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  const sc = key.shadow.camera; sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 30;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#cfe3ff', 0.55); fill.position.set(-6, 4, -5); scene.add(fill);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: ground, roughness: 1 }));
  floor.receiveShadow = true; floor.name = 'floor'; scene.add(floor);

  const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
  const stage = { renderer, scene, camera, key, floor, width, height };
  stage.setSize = (w, h) => { stage.width = w; stage.height = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  stage.look = (target, az, el, dist, fov = 32) => {
    const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
    camera.fov = fov; camera.aspect = stage.width / stage.height; camera.updateProjectionMatrix();
    camera.position.set(target[0] + Math.sin(a) * Math.cos(e) * dist, target[1] + Math.sin(e) * dist, target[2] + Math.cos(a) * Math.cos(e) * dist);
    camera.lookAt(...target);
  };
  stage.render = () => renderer.render(scene, camera);
  /** contact sheet: views = [{x,y,w,h, target, az, el, dist, fov}] rendered into one canvas */
  stage.renderViews = (views) => {
    renderer.setScissorTest(true); renderer.autoClear = false; renderer.setClearColor(bg); renderer.clear();
    for (const v of views) {
      const fy = stage.height - v.y - v.h; // GL origin is bottom-left
      renderer.setViewport(v.x, fy, v.w, v.h); renderer.setScissor(v.x, fy, v.w, v.h);
      camera.aspect = v.w / v.h; camera.fov = v.fov ?? 32; camera.updateProjectionMatrix();
      const a = THREE.MathUtils.degToRad(v.az), e = THREE.MathUtils.degToRad(v.el);
      camera.position.set(v.target[0] + Math.sin(a) * Math.cos(e) * v.dist, v.target[1] + Math.sin(e) * Math.cos(0) * v.dist, v.target[2] + Math.cos(a) * Math.cos(e) * v.dist);
      camera.lookAt(...v.target);
      renderer.render(scene, camera);
    }
    renderer.setScissorTest(false); renderer.autoClear = true;
  };
  return stage;
}
