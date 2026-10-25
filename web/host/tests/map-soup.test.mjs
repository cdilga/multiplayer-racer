import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MeshBasicMaterial } from 'three';
import { Soup } from '../src/render/map/soup.ts';

test('map triangle assembly retains every position, linear colour and shading normal byte', () => {
  const colours = ['#b5793f', '#f2efe6', '#1d1c21', 'rgb(20, 80, 160)', 'royalblue'];
  const soup = new Soup();
  for (let i = 0; i < 1000; i++) {
    const a = [i / 7, Math.sin(i), i / 3];
    const b = [i / 7, Math.sin(i + 1), i / 3 + 1];
    const c = [i / 7 + 1, Math.cos(i), i / 3 + 1];
    const d = [i / 7 + 1, Math.cos(i + 1), i / 3];
    soup.quad(a, b, c, d, colours[i % colours.length]);
    if (i % 23 === 0) soup.tri(a, c, d, colours[(i + 1) % colours.length], i % 46 === 0 ? [0, 1, 0] : [0, 1, 0, 0, .8, .6, 0, .6, .8]);
  }
  const material = new MeshBasicMaterial();
  const mesh = soup.mesh(material);
  try {
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.geometry.getAttribute('position').count, 6132);
    const hashes = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attr]) => [name, createHash('sha256').update(Buffer.from(attr.array.buffer)).digest('hex')]));
    // Captured from the pre-optimization implementation at d44c9093, including face/corner normal overrides.
    assert.deepEqual(hashes, {
      position: '181de591cc19002b356b757f2915133580d178e93a7f06e4062e48c7097fe6af',
      color: 'ba9800958a4a10fefe7690f0098dce2711f0d316fed0dec1998792c9c1eb6b4d',
      normal: '804818203dce64df4036860cc1dbcf33ee573ae6bee3b4897f436a4ab045856c',
    });
  } finally {
    mesh.geometry.dispose();
    material.dispose();
  }
});
