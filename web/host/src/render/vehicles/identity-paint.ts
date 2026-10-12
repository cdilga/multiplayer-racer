// P1-R13: a shared pattern atlas sampled only through the model atlas's white paint channel.
// The pattern path is the same catalogue used by the UI. Per-instance UV rows add no meshes or draws.
import { BufferAttribute, CanvasTexture, LinearFilter, Vector3, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { tokenData } from '../../../../shared/ui/tokens.generated';
import { seatPattern } from '../../../../shared/ui/patterns';

export function patternData(number: number): [number, number] {
  const p = seatPattern(number);
  return [p.index, p.cellM];
}

/** Four-digit chunks preserve every u32 seat number exactly in GPU floats, including numbers above 2^24. */
export function numberData(number: number): [number, number, number, number] {
  return [number % 10000, Math.floor(number / 10000) % 10000, Math.floor(number / 100000000), String(number).length];
}

/** Geometry remains unchanged; this channel anchors paint to its original car-local frame, even on detached parts. */
export function patternGeometry(source: BufferGeometry, pivot: Vector3): BufferGeometry {
  const geometry = source.clone();
  const position = source.getAttribute('position');
  const local = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    local.set([position.getX(i) + pivot.x, position.getY(i) + pivot.y, position.getZ(i) + pivot.z], i * 3);
  }
  geometry.setAttribute('identityPosition', new BufferAttribute(local, 3));
  return geometry;
}

export function identityPaint(material: MeshStandardMaterial, roof?: number[]): void {
  const count = tokenData.seatPatterns.length;
  const cell = 64;
  const width = cell * Math.max(count, 10);
  let atlas: CanvasTexture | undefined;
  const enabled = { value: 1 };
  material.userData.jjPatternEnabled = enabled;
  material.addEventListener('dispose', () => atlas?.dispose());
  material.onBeforeCompile = (sh) => {
    // Constructing/placing a model also works in native fixtures. Only shader compilation needs a browser canvas.
    if (!atlas) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = 160;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    tokenData.seatPatterns.forEach((p, i) => {
      g.save(); g.translate(i * cell, 0); g.scale(cell / 32, cell / 32); g.fill(new Path2D(p.svg)); g.restore();
    });
    // A single digit bank paints any seat number onto the existing roof triangles: no number meshes/materials.
    g.font = '900 80px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let digit = 0; digit < 10; digit++) g.fillText(String(digit), digit * cell + cell / 2, 112, 56);
    atlas = new CanvasTexture(canvas);
    atlas.flipY = false;
    atlas.minFilter = LinearFilter;
    atlas.magFilter = LinearFilter;
    atlas.generateMipmaps = false;
    }
    sh.uniforms.jjPatternAtlas = { value: atlas };
    sh.uniforms.jjPatternEnabled = enabled;
    sh.uniforms.jjRoof = { value: new Vector3().fromArray(roof ?? [0, 1.6, 0]) };
    sh.vertexShader = `attribute vec3 identityPosition;\nattribute vec2 identityPattern;\nattribute vec4 identityNumber;\nvarying vec3 jjPatternPosition;\nvarying vec3 jjPatternNormal;\nvarying vec2 jjPattern;\nvarying vec4 jjNumber;\n${sh.vertexShader}`;
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\njjPatternPosition = identityPosition; jjPatternNormal = normal; jjPattern = identityPattern; jjNumber = identityNumber;');
    sh.fragmentShader = `uniform sampler2D jjPatternAtlas;\nuniform float jjPatternEnabled;\nuniform vec3 jjRoof;\nvarying vec3 jjPatternPosition;\nvarying vec3 jjPatternNormal;\nvarying vec2 jjPattern;\nvarying vec4 jjNumber;\n${sh.fragmentShader}`;
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `
      #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        float paintMask = step(0.985, min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b)));
        vec3 axes = abs(jjPatternNormal);
        vec2 pos = axes.y >= max(axes.x, axes.z) ? jjPatternPosition.xz :
                   axes.x >= axes.z ? jjPatternPosition.zy : jjPatternPosition.xy;
        vec2 uv = fract(pos / max(jjPattern.y, .001));
        float motif = texture2D(jjPatternAtlas, vec2((jjPattern.x + uv.x) * ${cell / width}, uv.y * .4)).a;
        vec3 identity = mix(vColor.rgb, vec3(.0075, .0144, .0423), motif * .28 * jjPatternEnabled);
        diffuseColor.rgb *= mix(vec3(1.0), identity, paintMask);
        // Varyings interpolate even a constant instance value with tiny rounding error. Round before digit extraction.
        vec4 number = floor(jjNumber + .5);
        vec2 label = vec2(.5 - (jjPatternPosition.x - jjRoof.x) / 1.15, .5 - (jjPatternPosition.z - jjRoof.z) / .9);
        if (number.w > 0.0 && jjPatternNormal.y > .65 && abs(jjPatternPosition.y - jjRoof.y) < .25 &&
            label.x >= 0.0 && label.x <= 1.0 && label.y >= 0.0 && label.y <= 1.0 && paintMask > .5) {
          float index = max(0.0, number.w - 1.0 - floor(label.x * number.w));
          float chunk = index >= 8.0 ? number.z : index >= 4.0 ? number.y : number.x;
          float digit = mod(floor(chunk / pow(10.0, mod(index, 4.0)) + .001), 10.0);
          float ink = texture2D(jjPatternAtlas, vec2((digit + fract(label.x * number.w)) * ${cell / width}, .4 + label.y * .6)).a;
          diffuseColor.rgb = mix(vec3(.9, .88, .83), vec3(.0075, .0144, .0423), ink);
        }
      #endif`);
  };
  material.customProgramCacheKey = () => `jj-identity-paint-${count}`;
}
