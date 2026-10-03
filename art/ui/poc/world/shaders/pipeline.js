// pipeline.js — the in-world look's post chain for the shader and lighting POC (P1-U05.5, R108). It extends the jammers-look
// skill's comicPipeline (../../vendor/look/look.js, the tested reference; edit the skill to change that) with what the owner's
// round 2 asked for, so the variants can be switched and costed on one scene:
//   - ink: 'outer' (recommended: a thick line round each car's outer silhouette, a light one inside), 'silhouette' (outer
//     only, the object-ID edge), 'full' (round 0: depth + normal + id everywhere) or 'none' (POC2-10);
//   - halftone on static surfaces only, so a car's own shadow side is never dotted; its cast shadow on the ground still is
//     (POC2-13);
//   - a split-tone grade (teal shadows, warm highlights), contrast, saturation and highlight bleach, dust haze by depth and
//     heat shimmer near the horizon: the Mad Max looks (POC2-09);
//   - ambient occlusion (GTAO) and SMAA as options with their cost (POC2-11, POC2-12).
// Every option that is off is left out of the graph, so its cost is really gone.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, property, mix, step, smoothstep, fract, length, abs, max, saturate, sin, cos, mat2,
  dot, hash, luminance, fwidth, mrt, pass, output, emissive, normalView, time, directionToColor, colorToDirection,
  screenCoordinate, screenUV, screenSize, perspectiveDepthToViewZ, renderOutput, mx_noise_float, sample,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js';

// The toon lighting model in look.js writes this per fragment (0 lit … 1 in shadow); a property of the same name is the same
// shader variable.
const jjShade = property('float', 'jjShade');

/** The grade, haze and shimmer uniforms the looks set (shaders/looks.json); added to the skill's look object once. */
export function extendLook(look) {
  if (look.ext) return look;
  Object.assign(look, {
    ext: true,
    shadowMul: uniform(new THREE.Vector3(0.9, 1, 1.06)), highMul: uniform(new THREE.Vector3(1.08, 1, 0.9)), split: uniform(0.35),
    contrast: uniform(1), saturation: uniform(1), bleachHi: uniform(0),
    hazeColor: uniform(new THREE.Color('#E8B98A')), hazeAmt: uniform(0), hazeNear: uniform(60), hazeFar: uniform(420),
    shimmerAmt: uniform(0), outerPx: uniform(1.6), innerInk: uniform(0.45),
  });
  return look;
}

export function jjPipeline(renderer, scene, camera, look, opts = {}) {
  extendLook(look);
  const { bloom: useBloom = true, halftone: useHalftone = true, ink = 'outer', fxaa: useFxaa = true, smaa: useSmaa = false,
    ao: useAo = false, haze: useHaze = true, shimmer: useShimmer = false, halftoneOnCars = false, debug = null } = opts;
  const scenePass = pass(scene, camera, { samples: 0 });               // no MSAA: ids and normals must not blend
  scenePass.setMRT(mrt({
    output,
    emissive: vec4(emissive, 1),
    normal: vec4(directionToColor(normalView), jjShade),
    objectId: vec4(0, 0, 0, 1),
  }));
  scenePass.getTexture('normal').type = THREE.UnsignedByteType;
  for (const n of ['normal', 'objectId', 'depth']) { const t = scenePass.getTexture(n); t.minFilter = t.magFilter = THREE.NearestFilter; }

  const colTex = scenePass.getTextureNode('output'), emiTex = scenePass.getTextureNode('emissive');
  const nrmTex = scenePass.getTextureNode('normal'), idTex = scenePass.getTextureNode('objectId');
  const depTex = scenePass.getTextureNode('depth');
  const px = vec2(1).div(screenSize);
  const dAt = (uvN) => depTex.sample(uvN).r;
  const zOf = (d) => perspectiveDepthToViewZ(d, look.near, look.far).negate();
  const isSky = (uvN) => step(0.99999, depTex.sample(uvN).r);
  const depthScale = look.far.mul(look.near).div(look.far.sub(look.near));
  const zHere = zOf(dAt(screenUV));

  const glow = useBloom ? bloom(emiTex, 0.6, 0.3, 0.0).rgb.mul(look.bloomOn) : vec3(0);

  // Ink. Object-ID edges are a car's (or a debris piece's) outer silhouette: the car's parts share its id, so no line runs
  // inside it. 'outer' samples that edge further out (outerPx × inkPx), so the silhouette is the heavy line, and keeps the
  // depth + normal interior edges at innerInk strength.
  const tapsAt = (r) => [vec2(r, 0), vec2(r.negate(), 0), vec2(0, r), vec2(0, r.negate())].map((d) => screenUV.add(d.mul(px)));
  const silhouette = (r) => Fn(() => {
    const skyC = isSky(screenUV), idC = idTex.sample(screenUV).r;
    let iD = float(0), skyEdge = float(0), dyn = idTex.sample(screenUV).g;
    tapsAt(r).forEach((u) => {
      const idN = idTex.sample(u);
      iD = max(iD, step(0.02, abs(idN.r.sub(idC))));
      skyEdge = max(skyEdge, abs(isSky(u).sub(skyC))); dyn = max(dyn, idN.g);
    });
    return max(iD.mul(float(1).sub(skyC)), skyEdge.mul(dyn));
  })();
  const interior = (r) => Fn(() => {
    let nD = float(0), anySky = isSky(screenUV);
    const o = tapsAt(r);
    o.forEach((u) => { anySky = max(anySky, isSky(u)); nD = max(nD, float(1).sub(dot(colorToDirection(nrmTex.sample(screenUV).rgb), colorToDirection(nrmTex.sample(u).rgb)))); });
    const dC = dAt(screenUV), ds = o.map(dAt);
    const lap = abs(ds[0].add(ds[1]).sub(dC.mul(2))).add(abs(ds[2].add(ds[3]).sub(dC.mul(2)))).mul(zOf(dC)).div(depthScale);
    return max(smoothstep(0.05, 0.15, lap), smoothstep(0.1, 0.25, nD)).mul(float(1).sub(anySky));
  })();
  const r0 = look.inkPx.mul(0.5).ceil().max(1);
  let edge = float(0);
  if (ink === 'full') edge = max(interior(r0), silhouette(r0));
  else if (ink === 'silhouette') edge = silhouette(r0);
  else if (ink === 'outer') edge = max(silhouette(look.inkPx.mul(look.outerPx).mul(0.5).ceil().max(1)), interior(r0).mul(look.innerInk));
  edge = edge.mul(look.outline);

  // Halftone, on static surfaces only (objectId .g = 1 marks the cars and other dynamic things): POC2-13.
  const halftone = !useHalftone ? float(0) : Fn(() => {
    const a = float(Math.PI / 4), rot = mat2(cos(a), sin(a).negate(), sin(a), cos(a));
    const cellUv = rot.mul(screenCoordinate.xy).div(look.cell);
    const dist = length(fract(cellUv).sub(0.5));
    const shade = nrmTex.sample(screenUV).a;
    const radius = smoothstep(0.42, 1.0, shade).mul(0.42);
    const aa = fwidth(dist).mul(0.75);
    const dots = float(1).sub(smoothstep(radius.sub(aa), radius.add(aa), dist));
    const lit = saturate(luminance(emiTex.sample(screenUV).rgb).mul(2));
    const onStatic = halftoneOnCars ? float(1) : float(1).sub(idTex.sample(screenUV).g); // halftoneOnCars: round 1's behaviour, for the before
    return dots.mul(look.halftone).mul(float(1).sub(isSky(screenUV))).mul(float(1).sub(lit)).mul(onStatic);
  })();

  // Heat shimmer: far ground wobbles sideways a pixel or two, strongest near the horizon (never the near road or the cars).
  let uvC = screenUV;
  if (useShimmer) {
    const far = smoothstep(80, 320, zHere).mul(float(1).sub(isSky(screenUV))).mul(float(1).sub(idTex.sample(screenUV).g));
    const n = mx_noise_float(vec3(screenUV.mul(vec2(60, 220)), time.mul(2.2)));
    uvC = screenUV.add(vec2(n, n.mul(0.3)).mul(px).mul(look.shimmerAmt).mul(far));
  }
  let c = colTex.sample(uvC).rgb.add(glow);
  if (useAo) { // GTAO wants view-space normals; ours ride the MRT colour-encoded
    const aoPass = gtao(depTex, sample((uv) => colorToDirection(nrmTex.sample(uv).rgb)), opts.aoCamera ?? camera);
    aoPass.resolutionScale = 0.5; // half resolution, the usual trade: AO is low frequency
    c = c.mul(mix(float(1), aoPass.getTextureNode().r, 0.85));
  }
  c = mix(c, mix(c.mul(0.5), look.ink, 0.4), halftone.mul(0.9));
  c = mix(c, look.ink, edge);

  // Dust haze by depth (the volumetric-style option): far things fade into the dust colour; the sky is already haze.
  if (useHaze) c = mix(c, vec3(look.hazeColor), smoothstep(look.hazeNear, look.hazeFar, zHere).mul(look.hazeAmt).mul(float(1).sub(isSky(screenUV))));

  // Grade: split tone (teal shadows, warm highlights), contrast round mid grey, saturation, and a bleach of the highlights.
  const lum = luminance(c);
  c = mix(c, mix(c.mul(look.shadowMul), c.mul(look.highMul), smoothstep(0.1, 0.8, lum)), look.split); // round 1's warm grade with split 0.35
  c = c.sub(0.18).mul(look.contrast).add(0.18).max(0);
  c = mix(vec3(luminance(c)), c, look.saturation);
  c = mix(c, vec3(luminance(c)).mul(1.05), smoothstep(0.55, 1.1, luminance(c)).mul(look.bleachHi));
  const dirV = screenUV.sub(0.5);
  c = c.mul(float(1).sub(look.vignette.mul(smoothstep(0.55, 1.1, length(dirV.mul(vec2(look.aspect, 1)).mul(1.1))))));
  c = c.add(hash(screenCoordinate.x.add(screenCoordinate.y.mul(4001.0)).add(time.mul(97.0))).sub(0.5).mul(look.grainAmt));

  const channels = { halftone: vec3(halftone), dynamic: vec3(idTex.sample(screenUV).g), edge: vec3(edge), shade: vec3(nrmTex.sample(screenUV).a), glow };
  if (debug) c = channels[debug];
  const shown = renderOutput(vec4(c, 1));
  const post = new THREE.PostProcessing(renderer);
  post.outputColorTransform = false;
  post.outputNode = debug ? shown : useSmaa ? smaa(shown) : useFxaa ? fxaa(shown) : shown;
  return { post, scenePass };
}
