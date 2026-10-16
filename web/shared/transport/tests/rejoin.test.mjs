// br-bxsc: a phone woken or reloaded before its network is back gets a TypeError from fetch, which says nothing about the
// room. `ControllerLink.joinRetrying` keeps trying (0.5 s doubling to 5 s, at once on `resume()`), stops the stream a
// failed attempt opened, and still ends on a definitive answer. The real link bundled for Node with fetch and
// RTCPeerConnection stubbed: no browser, no server.
//   node --test web/shared/transport/tests/rejoin.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { before, test } from 'node:test';
import { build } from 'rolldown';

let peer;
before(async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'jj-rejoin-')), 'peer.mjs');
  await build({ input: join(import.meta.dirname, '../peer.ts'), output: { file: out, format: 'esm' }, logLevel: 'silent' });
  globalThis.document = { querySelector: () => ({ content: '/' }) };
  globalThis.RTCPeerConnection = class {
    static live = 0;
    constructor() {
      globalThis.RTCPeerConnection.live += 1;
    }
    connectionState = 'new';
    signalingState = 'stable';
    iceConnectionState = 'new';
    localDescription = null;
    createDataChannel() {
      return { readyState: 'connecting', close() {} };
    }
    async createOffer() {
      if (globalThis.offerFailures > 0) {
        globalThis.offerFailures -= 1;
        throw new DOMException('offer failed', 'OperationError');
      }
      return { type: 'offer', sdp: 'v=0' };
    }
    async setLocalDescription(d) {
      this.localDescription = d;
      this.signalingState = 'have-local-offer';
    }
    close() {
      if (this.connectionState !== 'closed') globalThis.RTCPeerConnection.live -= 1;
      this.connectionState = 'closed';
    }
  };
  peer = await import(pathToFileURL(out).href);
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake server: `lookups` answers each room lookup in turn (a function throws, an object is the body). Counts the
 *  signal streams still open (a stream's fetch waits until it's aborted). */
function server({ lookups = [] }) {
  const s = { open: 0, streams: 0, lookups: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    const method = init.method ?? 'GET';
    if (method === 'GET' && /\/api\/v1\/rooms\/[^/]+$/.test(path)) {
      const a = lookups[s.lookups++] ?? { status: 'available', roomId: 'r1' };
      if (typeof a === 'function') a();
      return json(a);
    }
    if (path.endsWith('/endpoints')) return json({ iceServers: [], iceExpiresAt: Date.now() + 3_600_000 });
    if (method === 'GET' && path.includes('/signal?')) {
      s.open += 1;
      s.streams += 1;
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => {
          s.open -= 1;
          reject(new DOMException('aborted', 'AbortError'));
        }),
      );
    }
    if (path.endsWith('/signal')) return json({});
    return json({ reason: 'unexpected' }, 500);
  };
  return s;
}

const offline = () => {
  throw new TypeError('Failed to fetch');
};

test('lookup failing with a network TypeError twice, then answering: the join succeeds by retrying, backing off 0.5 s then 1 s', async () => {
  const s = server({ lookups: [offline, offline] });
  const link = new peer.ControllerLink();
  const waits = [];
  await link.joinRetrying('abcd', (_e, ms) => {
    waits.push(ms);
    setImmediate(() => link.resume()); // the 'online' event: retry at once
  });
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(link.joinRetries, 2);
  assert.equal(link.roomId, 'r1');
  assert.equal(link.state, 'connecting');
  assert.equal(s.open, 1, 'one signal stream');
  link.end();
  assert.equal(s.open, 0);
});

test('attempts that opened their signal stream and then failed leak no stream or peer connection', async () => {
  const s = server({});
  globalThis.offerFailures = 2;
  const link = new peer.ControllerLink();
  await link.joinRetrying('abcd', () => setImmediate(() => link.resume()));
  assert.equal(link.joinRetries, 2);
  assert.equal(s.streams, 3, 'each attempt opened one');
  assert.equal(s.open, 1, 'the failed attempts stopped theirs');
  assert.equal(RTCPeerConnection.live, 1, 'and closed their peer connections');
  link.end();
  assert.equal(RTCPeerConnection.live, 0);
});

test('without a wake-up the waits double to a 5 s cap', async () => {
  server({ lookups: Array(6).fill(offline) });
  const link = new peer.ControllerLink();
  const waits = [];
  await link.joinRetrying('abcd', (_e, ms) => {
    waits.push(ms);
    setImmediate(() => link.resume());
  });
  assert.deepEqual(waits, [500, 1000, 2000, 4000, 5000, 5000]);
  link.end();
});

test('definitive answers end the join at once: room ended, no such room, a retired preview', async () => {
  for (const [answer, want] of [
    [{ status: 'ended' }, /room-ended/],
    [{ status: 'not-found' }, /room-not-found/],
  ]) {
    const s = server({ lookups: [answer] });
    const link = new peer.ControllerLink();
    await assert.rejects(link.joinRetrying('abcd'), want);
    assert.equal(link.joinRetries, 0);
    assert.equal(s.open, 0);
  }
  globalThis.fetch = async () => json({ reason: 'preview-expired' }, 410);
  const link = new peer.ControllerLink();
  await assert.rejects(link.joinRetrying('abcd'), (e) => e.status === 410);
  assert.equal(link.joinRetries, 0);
});

test('end() during a backoff stops the retrying', async () => {
  server({ lookups: Array(100).fill(offline) });
  const link = new peer.ControllerLink();
  const joining = link.joinRetrying('abcd', () => setImmediate(() => link.end()));
  await assert.rejects(joining, /stopped/);
  assert.equal(link.joinRetries, 1);
});
