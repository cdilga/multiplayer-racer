// P1-N05: signalling retries. A 429 or a `404 unknown-room` (a restarted server) is retried with backoff from 0.5 s
// doubling to 5 s, a 429's retryAfterMs is honoured, and anything else fails at once. `withBackoff` from the shared
// transport, bundled for Node (it imports the base-path helper) and run on mocked timers.
//   node --test web/shared/transport/tests/backoff.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, mock, test } from 'node:test';
import { build } from 'rolldown';

let api;
before(async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'jj-backoff-')), 'api.mjs');
  await build({ input: join(import.meta.dirname, '../api.ts'), output: { file: out, format: 'esm' }, logLevel: 'silent' });
  api = await import(pathToFileURL(out).href);
});

/** Runs withBackoff over `errors` (then a success) on mocked timers; returns the waits it chose. */
async function waits(errors) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const seen = [];
    let k = 0;
    const result = await api.withBackoff(
      async () => {
        if (k < errors.length) throw errors[k++];
        return 'ok';
      },
      undefined,
      (_e, ms) => {
        seen.push(ms);
        // The sleep starts right after this callback: advance the clock once it's armed.
        setImmediate(() => mock.timers.tick(ms));
      },
    );
    assert.equal(result, 'ok');
    return seen;
  } finally {
    mock.timers.reset();
  }
}

test('429s back off from 0.5 s doubling to a 5 s ceiling', async () => {
  const e = () => new api.ApiError(429, 'rate', 0);
  assert.deepEqual(await waits([e(), e(), e(), e(), e(), e()]), [500, 1000, 2000, 4000, 5000, 5000]);
});

test("a 429's retryAfterMs is honoured when it's longer than the backoff", async () => {
  assert.deepEqual(await waits([new api.ApiError(429, 'rate', 3000), new api.ApiError(429, 'rate', 0)]), [3000, 1000]);
});

test('a 404 unknown-room (a restarted server) is retried; other 404s and 401s fail at once', async () => {
  assert.deepEqual(await waits([new api.ApiError(404, 'unknown-room')]), [500]);
  for (const e of [new api.ApiError(404, 'no-such-code'), new api.ApiError(401, 'bad-bearer')]) {
    await assert.rejects(
      api.withBackoff(async () => {
        throw e;
      }),
      (got) => got === e,
    );
  }
});
