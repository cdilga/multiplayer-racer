// checks that the TSL names the recipes use exist in three@0.182 exports
import * as TSL from '../../../../node_modules/three/build/three.tsl.js';
import * as W from '../../../../node_modules/three/build/three.webgpu.js';
const tsl = 'uniform property float vec2 vec3 vec4 normalView fwidth mix smoothstep BRDF_Lambert diffuseColor attribute step min max positionGeometry positionWorld normalWorld mx_noise_float hash fract floor luminance length mrt atan time abs screenUV Fn pass output emissive directionToColor colorToDirection perspectiveDepthToViewZ screenSize dot saturate mat2 cos sin screenCoordinate renderOutput texture color'.split(' ');
console.log('missing tsl:', tsl.filter((n) => !(n in TSL)));
console.log('missing webgpu:', ['LightingModel', 'MeshToonNodeMaterial', 'PostProcessing', 'WebGPURenderer', 'NeutralToneMapping', 'NearestFilter', 'UnsignedByteType', 'InstancedBufferAttribute'].filter((n) => !(n in W)));
