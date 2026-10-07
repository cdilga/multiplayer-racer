// P1-D07 in CI: the public smoke's seven steps through the real pages against a local jj-server, and its manifest rules.
//   node --test web/tests/smoke/smoke.test.mjs
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from '../journeys/lib/chromium.mjs';
import { KNOWN, runSmoke } from './smoke-flow.mjs';

describe('manifest rules (no browser)', () => {
  test('dropping any mandatory step fails, naming that step', async () => {
    for (const dropped of KNOWN) {
      const r = await runSmoke({ base: 'http://x.test/p/a/', steps: KNOWN.filter((s) => s !== dropped) });
      assert.deepEqual([r.ok, r.step, r.why], [false, dropped, `mandatory step ${dropped} is missing from smoke.json`]);
    }
  });
  test('unknown steps, empty manifests and bad base URLs fail at the manifest', async () => {
    assert.equal((await runSmoke({ base: 'http://x.test/p/a/', steps: [...KNOWN, 'bogus'] })).why, 'unknown step bogus');
    assert.equal((await runSmoke({ base: 'http://x.test/p/a/', steps: [] })).why, 'no steps given');
    assert.equal((await runSmoke({ base: 'http://x.test/p/a' })).step, 'manifest');
  });
});

describe('the full smoke against a local server', () => {
  let server;
  before(async () => {
    server = await serve(build('./', 'smoke'), '/p/smoke/', { JJ_STUN_URLS: '' });
  });
  after(() => server?.close());

  test('room, join-webrtc, input, resume, drive, hud and round all pass', { timeout: 480_000 }, async () => {
    const r = await runSmoke({ base: `${server.origin}/p/smoke/`, chromiumArgs });
    assert.equal(r.ok, true, `smoke: FAIL step ${r.step}: ${r.why}`);
    assert.deepEqual(r.steps.map((s) => s.split(' ')[0]), ['room', 'join-webrtc', 'input', 'resume', 'drive', 'hud', 'round']);
  });

  test('a build that cannot do a step fails naming it (the room path is wrong)', { timeout: 120_000 }, async () => {
    const r = await runSmoke({ base: `${server.origin}/p/nope/`, steps: ['room', 'join-webrtc', 'input', 'resume'], mandatory: [], chromiumArgs });
    assert.equal(r.ok, false);
    assert.equal(r.step, 'room');
  });
});
