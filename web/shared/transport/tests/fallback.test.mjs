// P1-N04b: the §5.3 fallback trigger fires in exactly three cases, on virtual time (no browser).
//   node --test web/shared/transport/tests/fallback.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FallbackTrigger, mergeServers, NO_RELAY_GRACE_MS, OFFER_TIMEOUT_MS } from '../fallback.ts';

/** Virtual timers: `advance(ms)` runs everything due, in order. */
function clock() {
  let now = 0;
  let next = 1;
  const pending = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => (pending.set(next, { at: now + ms, fn }), next++),
      clearTimeout: (h) => pending.delete(h),
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
    get now() {
      return now;
    },
  };
}

function setup() {
  const c = clock();
  const fired = [];
  const t = new FallbackTrigger((r) => fired.push([c.now, r]), c.timers);
  return { c, t, fired };
}

test('case 1: ICE reaching failed fires at once, once', () => {
  const { t, fired, c } = setup();
  t.offerSent();
  c.advance(1000);
  t.failed();
  t.failed();
  c.advance(60_000);
  assert.deepEqual(fired, [[1000, 'ice-failed']]);
});

test('case 2: gathering done with no relay candidate and not connected 3 s later', () => {
  const { t, fired, c } = setup();
  t.candidate('host');
  t.candidate('srflx');
  c.advance(500);
  t.gatheringDone();
  c.advance(NO_RELAY_GRACE_MS - 1);
  assert.deepEqual(fired, [], 'not before 3 s');
  c.advance(1);
  assert.deepEqual(fired, [[500 + NO_RELAY_GRACE_MS, 'no-relay-candidate']]);
});

test('case 2 does not fire when the connection comes up inside the 3 s, or when a coturn relay candidate exists', () => {
  const a = setup();
  a.t.gatheringDone();
  a.c.advance(2000);
  a.t.isConnected();
  a.c.advance(60_000);
  assert.deepEqual(a.fired, []);

  const b = setup();
  b.t.candidate('relay');
  b.t.gatheringDone();
  b.c.advance(NO_RELAY_GRACE_MS + 1000);
  assert.deepEqual(b.fired, [], 'a coturn relay candidate means coturn is reachable');
});

test('case 3: not connected 8 s after the offer', () => {
  const { t, fired, c } = setup();
  c.advance(100);
  t.offerSent();
  c.advance(OFFER_TIMEOUT_MS - 1);
  assert.deepEqual(fired, []);
  c.advance(1);
  assert.deepEqual(fired, [[100 + OFFER_TIMEOUT_MS, 'offer-timeout']]);
});

test('a connection that comes up never fires, and a relay candidate does not stop case 3', () => {
  const a = setup();
  a.t.offerSent();
  a.t.gatheringDone();
  a.c.advance(1500);
  a.t.isConnected();
  a.c.advance(120_000);
  assert.deepEqual(a.fired, []);

  const b = setup();
  b.t.offerSent();
  b.t.candidate('relay');
  b.t.gatheringDone();
  b.c.advance(OFFER_TIMEOUT_MS);
  assert.deepEqual(b.fired, [[OFFER_TIMEOUT_MS, 'offer-timeout']]);
});

test('at most one request per peer connection, whichever case comes first', () => {
  const { t, fired, c } = setup();
  t.offerSent();
  t.gatheringDone();
  c.advance(NO_RELAY_GRACE_MS);
  t.failed();
  c.advance(60_000);
  assert.deepEqual(fired.map((f) => f[1]), ['no-relay-candidate']);
});

test('a link that connected and then fails asks for the fallback', () => {
  const { t, fired, c } = setup();
  t.offerSent();
  t.isConnected();
  c.advance(5000);
  t.failed();
  assert.deepEqual(fired, [[5000, 'ice-failed']]);
});

test('a disposed trigger is silent', () => {
  const { t, fired, c } = setup();
  t.offerSent();
  t.dispose();
  t.failed();
  c.advance(60_000);
  assert.deepEqual(fired, []);
});

test('merging adds Cloudflare entries and never repeats a URL', () => {
  const base = [{ urls: ['stun:a:1'] }, { urls: ['turn:coturn:3479'], username: 'u' }];
  const cf = [{ urls: ['turn:cf:3478', 'turns:cf:443'], username: 'x' }, { urls: ['stun:a:1'] }];
  const m = mergeServers(base, cf);
  assert.deepEqual(m.map((s) => s.urls), [['stun:a:1'], ['turn:coturn:3479'], ['turn:cf:3478', 'turns:cf:443']]);
  assert.deepEqual(mergeServers(base, []), base);
});
