// br-dsq4: keeping the displayed track must not wait for another procgen reply while the next track builds.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { currentKey, kept, keepCurrent, setTrackSource } from '../src/round/favourites.ts';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
});

test('Keep uses the displayed code even when subsequent worker requests cannot complete', async () => {
  let calls = 0;
  setTrackSource({ current: () => ({ seed: 2, recipe: '' }), code: () => ++calls === 1 ? Promise.resolve('T32-08-2') : new Promise(() => {}) });
  assert.equal((await currentKey()).code, 'T32-08-2');
  const pending = keepCurrent();
  // A resolved code can save without any further worker task. No wall-clock deadline is needed.
  await new Promise((r) => setImmediate(r));
  assert.equal(kept()[0]?.code, 'T32-08-2');
  assert.equal((await pending).seed, 2);
  assert.equal(calls, 1);
});

test('concurrent readers share a reply; changing seed, recipe or source obtains a fresh code', async () => {
  let track = { seed: 2, recipe: '' }, calls = 0, reply;
  setTrackSource({ current: () => track, code: () => { calls++; return new Promise((r) => { reply = r; }); } });
  const first = currentKey(), second = currentKey();
  assert.equal(calls, 1);
  reply('first');
  assert.equal((await first).code, 'first');
  assert.equal((await second).code, 'first');
  track = { seed: 3, recipe: '' };
  const next = currentKey();
  reply('next');
  assert.equal((await next).code, 'next');
  track = { seed: 3, recipe: 'town' };
  const recipe = currentKey();
  reply('town');
  assert.equal((await recipe).code, 'town');
  assert.equal(calls, 3);
  setTrackSource({ current: () => track, code: async () => 'other-generator' });
  assert.equal((await currentKey()).code, 'other-generator');
});

test('a failed worker request can be retried, and tuned tracks need no share request', async () => {
  let track = { seed: 2, recipe: '' }, calls = 0;
  setTrackSource({ current: () => track, code: async () => { if (++calls === 1) throw Error('worker failed'); return 'recovered'; } });
  assert.equal((await currentKey()).code, null);
  assert.equal((await currentKey()).code, 'recovered');
  track = { ...track, generator: 'tuned' };
  assert.equal((await keepCurrent()).generator, 'tuned');
  assert.equal(kept()[0].code, null);
  assert.equal(calls, 2);
});
