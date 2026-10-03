// P1-F03: bundles every pinned runtime library whole (re-exports keep tree-shaking from dropping code), so the origin
// scan reads all of their code, not only what today's pages import. Built into web/dist-qualify; never shipped.
export * as three from 'three/webgpu';
export * as tsl from 'three/tsl';
export { encode as qrEncode } from 'uqr';
export { default as qrDecode } from 'jsqr';
