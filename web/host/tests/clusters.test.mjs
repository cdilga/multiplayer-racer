// P1-C05: the key-cluster map is data, and no cluster uses the bug-clip chord's key or a host UI key.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const map = JSON.parse(await readFile(new URL('../src/input/clusters.json', import.meta.url), 'utf8'));
const keysOf = (c) => [...Object.values(c.drive), ...Object.values(c.action), c.identify, c.ready];

test('every cluster is a full two-stick player with its own Identify and READY', () => {
  assert.ok(map.clusters.length >= 1);
  for (const c of map.clusters) {
    for (const stick of [c.drive, c.action]) assert.deepEqual(Object.keys(stick).sort(), ['down', 'left', 'right', 'up']);
    assert.equal(typeof c.identify, 'string');
    assert.equal(typeof c.ready, 'string');
    assert.equal(new Set(keysOf(c)).size, 10, `${c.label} uses a key twice`);
  }
  const ids = map.clusters.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'cluster ids are unique');
  for (const id of ids) assert.ok(Number.isInteger(id) && id > 0 && id < map.padSourceBase, `source ${id} is below the pads'`);
});

test('no key belongs to two clusters', () => {
  const all = map.clusters.flatMap(keysOf);
  assert.equal(new Set(all).size, all.length);
});

test('no cluster uses the bug-clip chord or a host UI key', () => {
  const reserved = new Set([...map.reserved.bugClip, ...map.reserved.hostUi]);
  assert.ok(reserved.has('KeyB') && reserved.has('Escape') && reserved.has('Tab'));
  for (const c of map.clusters) {
    const clash = keysOf(c).filter((k) => reserved.has(k));
    assert.deepEqual(clash, [], `${c.label} uses reserved keys`);
  }
});
