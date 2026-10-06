// P1-N02 SSE qualification against the real jj-server binary, through a local streaming proxy (the way Cloudflare
// Tunnel sits in front of it): a stream stays up for JJ_SOAK_S seconds (300 in CI) with heartbeats at most ~15 s
// apart, a slow reader doesn't hold up anyone else, and a reconnect with Last-Event-ID gets exactly what it missed.
//   JJ_SOAK_S=40 node --test crates/jj-server/tests/sse.test.mjs
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { serve } from '../../../web/landing/tests/lib/site.mjs';

const SOAK_S = Number(process.env.JJ_SOAK_S ?? 300);
const BASE = '/p/x/';
let server;
let proxy;
let origin;

before(async () => {
  server = await serve(mkdtempSync(join(tmpdir(), 'jj-sse-')), BASE);
  const upstream = new URL(server.origin);
  proxy = createServer((req, res) => {
    const up = httpRequest(
      { host: upstream.hostname, port: upstream.port, method: req.method, path: req.url, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on('error', () => res.destroy());
    req.on('error', () => up.destroy());
    req.pipe(up);
    res.on('close', () => up.destroy());
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${proxy.address().port}${BASE}`;
});
after(async () => {
  proxy?.closeAllConnections?.();
  proxy?.close();
  await server?.close();
});

const secret = () => randomBytes(16).toString('base64url');
const hash = (s) => createHash('sha256').update(s).digest('base64url');
const api = async (method, path, body, bearer) => {
  const r = await fetch(origin + path, {
    method,
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

async function room() {
  const host = secret();
  const created = await api('POST', 'api/v1/rooms', { requestId: secret(), hostSecretHash: hash(host) });
  assert.equal(created.status, 201);
  return { id: created.body.roomId, host };
}

async function endpoint(roomId, id) {
  const s = secret();
  assert.equal((await api('POST', `api/v1/rooms/${roomId}/endpoints`, { requestId: id, endpointId: id, endpointSecretHash: hash(s) })).status, 201);
  return s;
}

const send = (roomId, from, to, bearer, payload) =>
  api('POST', `api/v1/rooms/${roomId}/signal`, { from, to, kind: 'candidate', gen: 1, payload }, bearer);

/** Opens an SSE stream with fetch (bearer in a header, as the clients do) and parses it as it arrives. */
function stream(roomId, ep, bearer, lastEventId) {
  const ctrl = new AbortController();
  const events = [];
  const beats = [];
  const waiters = [];
  const done = (async () => {
    const r = await fetch(`${origin}api/v1/rooms/${roomId}/signal?endpoint=${ep}`, {
      headers: { authorization: `Bearer ${bearer}`, ...(lastEventId ? { 'last-event-id': String(lastEventId) } : {}) },
      signal: ctrl.signal,
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/event-stream');
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.startsWith(':')) beats.push(Date.now());
        else {
          const id = Number(/^id: (\d+)$/m.exec(block)?.[1]);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          events.push({ id, msg: JSON.parse(data), at: Date.now() });
          waiters.splice(0).forEach((w) => w());
        }
      }
    }
  })().catch((e) => (e.name === 'AbortError' ? undefined : Promise.reject(e)));
  const next = (n) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${n} events (have ${events.length})`)), 10_000);
      const check = () => (events.length >= n ? (clearTimeout(t), resolve(events.slice(0, n))) : waiters.push(check));
      check();
    });
  return { events, beats, next, close: () => ctrl.abort(), done };
}

test(`a stream through the proxy stays up ${SOAK_S} s with heartbeats at most 15 s apart`, { timeout: (SOAK_S + 60) * 1000 }, async () => {
  const { id, host } = await room();
  const c = await endpoint(id, 'c-soak');
  const s = stream(id, 'host', host);
  const start = Date.now();
  let sent = 0;
  while (Date.now() - start < SOAK_S * 1000) {
    await new Promise((r) => setTimeout(r, Math.min(20_000, SOAK_S * 1000 - (Date.now() - start))));
    assert.equal((await send(id, 'c-soak', 'host', c, `t${sent}`)).status, 202);
    sent += 1;
    await s.next(sent);
  }
  const times = [start, ...s.beats];
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(s.beats.length >= Math.floor(SOAK_S / 15) - 1, `${s.beats.length} heartbeats in ${SOAK_S} s`);
  assert.ok(Math.max(...gaps) <= 16_500, `largest heartbeat gap ${Math.max(...gaps)} ms`);
  assert.deepEqual(s.events.map((e) => e.msg.payload), Array.from({ length: sent }, (_, i) => `t${i}`));
  s.close();
  await s.done;
});

test("a slow reader doesn't block other streams", async () => {
  const { id, host } = await room();
  const fast = await endpoint(id, 'c-fast');
  const slowSecret = await endpoint(id, 'c-slow');
  // The slow reader opens its stream and never reads it.
  const slow = await fetch(`${origin}api/v1/rooms/${id}/signal?endpoint=c-slow`, { headers: { authorization: `Bearer ${slowSecret}` } });
  assert.equal(slow.status, 200);
  const big = 'x'.repeat(16 * 1024);
  // Flood it past any socket buffer (signal posts are rate-limited per sender, so spread over senders).
  const senders = await Promise.all(Array.from({ length: 8 }, (_, i) => endpoint(id, `c-flood${i}`).then((s) => [`c-flood${i}`, s])));
  await Promise.all(senders.map(async ([from, s]) => {
    for (let i = 0; i < 60; i++) assert.equal((await send(id, from, 'c-slow', s, big)).status, 202);
  }));
  const h = stream(id, 'host', host);
  const t0 = Date.now();
  assert.equal((await send(id, 'c-fast', 'host', fast, 'ping')).status, 202);
  await h.next(1);
  assert.ok(Date.now() - t0 < 2_000, `the host got its message in ${Date.now() - t0} ms beside a stalled reader`);
  h.close();
  await slow.body.cancel();
});

test('Last-Event-ID resume delivers what was missed exactly once', async () => {
  const { id, host } = await room();
  const c = await endpoint(id, 'c-r');
  const a = stream(id, 'host', host);
  for (const p of ['a', 'b']) await send(id, 'c-r', 'host', c, p);
  const first = await a.next(2);
  a.close();
  await a.done;
  for (const p of ['c', 'd']) await send(id, 'c-r', 'host', c, p);
  const b = stream(id, 'host', host, first[1].id);
  const resumed = await b.next(2);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(b.events.map((e) => e.msg.payload), ['c', 'd'], 'no duplicates, nothing lost');
  assert.deepEqual(resumed.map((e) => e.id), [first[1].id + 1, first[1].id + 2]);
  b.close();
  await b.done;
});
