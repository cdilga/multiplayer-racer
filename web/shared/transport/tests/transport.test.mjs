// P1-N05 + P1-G00 journeys: the real host page (`B/host?hello`) and controller pages (`B/j/<CODE>`) from one build,
// served by the real jj-server, in Chromium contexts over loopback WebRTC. The relay case runs against a local coturn
// when `turnserver` is installed (CI installs it; `JJ_COTURN_REQUIRED=1` makes its absence a failure).
//   node --test web/shared/transport/tests/
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { after, before, describe, test } from 'node:test';
import { chromium } from 'playwright';
import { build, serve } from '../../../landing/tests/lib/site.mjs';

const BASE = '/p/n05/';
let browser;
let dist;

before(async () => {
  dist = build('./', 'n05');
  browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
});
after(async () => {
  await browser?.close();
});

const until = async (page, fn, arg, ms = 15_000) => {
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
};

async function startHost(origin, query = '') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}host?hello${query}`);
  await until(page, () => window.__jjHello?.code());
  return { ctx, page, errors, code: await page.evaluate(() => window.__jjHello.code()) };
}

async function startController(origin, code, query = '') {
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}j/${code}?hello${query.replace(/^\?/, '&')}`);
  await until(page, () => window.__jjHello?.link().state === 'connected');
  return { ctx, page, errors, link: () => page.evaluate(() => window.__jjHello.link()) };
}

const markers = (host) => host.page.evaluate(() => window.__jjHello.markers());

async function moveAndSee(host, ctl, x, y) {
  const ep = (await ctl.link()).endpointId;
  await ctl.page.evaluate(([x, y]) => window.__jjHello.setStick(x, y), [x, y]);
  await until(host.page, ([ep, x, y]) => {
    const m = window.__jjHello.markers()[ep];
    return m && Math.abs(m.x - x) < 0.01 && Math.abs(m.y - y) < 0.01;
  }, [ep, x, y]);
  return ep;
}

describe('hello room over loopback WebRTC', () => {
  let server;
  let origin;
  before(async () => {
    server = await serve(dist, BASE, { JJ_STUN_URLS: '' });
    origin = server.origin;
  });
  after(() => server.close());

  test('two controllers join and each moves its own marker; diagnostics show the selected path', async () => {
    const host = await startHost(origin);
    assert.match(host.code, /^[A-Z2-9]{4}$/);
    const qr = await host.page.locator('[data-jj-qr] svg').count();
    assert.equal(qr, 1, 'the QR renders');
    const a = await startController(origin, host.code);
    const b = await startController(origin, host.code);
    const ea = await moveAndSee(host, a, 0.8, -0.5);
    const eb = await moveAndSee(host, b, -0.3, 0.9);
    assert.notEqual(ea, eb);
    const m = await markers(host);
    assert.ok(Math.abs(m[ea].x - 0.8) < 0.01 && Math.abs(m[eb].x + 0.3) < 0.01, 'each marker follows its own stick');
    assert.notEqual(m[ea].colour, m[eb].colour);
    const paths = await host.page.evaluate(() => window.__jjHello.paths());
    for (const ep of [ea, eb]) assert.equal(paths[ep]?.kind, 'host', `${ep}: ${JSON.stringify(paths[ep])}`);
    await until(host.page, () => /host/.test(document.querySelector('[data-jj-diag]').textContent));
    const diag = await host.page.locator('[data-jj-diag]').innerText();
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(diag), `IPs are redacted: ${diag}`);
    const t = await host.page.evaluate(() => window.__jjHello.transport());
    assert.equal(t.peers.length, 2);
    assert.deepEqual([host.errors, a.errors, b.errors], [[], [], []]);
    for (const c of [host, a, b]) await c.ctx.close();
  });

  test('a lost connection restarts, then rebuilds at gen + 1 on the same endpoint without re-registering; stale gens are fenced', async () => {
    const host = await startHost(origin);
    const c = await startController(origin, host.code);
    const ep = await moveAndSee(host, c, 0.5, 0.5);
    const before = await c.link();
    await host.page.evaluate((ep) => window.__jjHello.dropPeer(ep), ep);
    await until(c.page, (gen) => window.__jjHello.link().state === 'connected' && window.__jjHello.link().gen > gen, before.gen, 30_000);
    const afterLink = await c.link();
    assert.equal(afterLink.endpointId, before.endpointId, 'the same endpoint');
    assert.equal(afterLink.registrations, 1, 'no re-registration');
    assert.ok(afterLink.gen >= before.gen + 1);
    assert.equal(await moveAndSee(host, c, -0.6, 0.2), ep, 'the marker keeps following the same controller');
    await c.page.evaluate(() => window.__jjHello.staleCandidate());
    await until(host.page, (ep) => window.__jjHello.transport().peers.find((p) => p.endpointId === ep)?.staleIgnored >= 1, ep);
    for (const x of [host, c]) await x.ctx.close();
  });

  test('a dropped signalling stream reconnects with Last-Event-ID and keeps working', async () => {
    const host = await startHost(origin);
    const c = await startController(origin, host.code);
    await c.page.evaluate(() => window.__jjHello.dropStream());
    await until(c.page, () => window.__jjHello.link().sseReconnects >= 1 && window.__jjHello.link().sse === 'open');
    // A fresh negotiation still needs signalling: force a rebuild and see it connect.
    const gen = (await c.link()).gen;
    await host.page.evaluate((ep) => window.__jjHello.dropPeer(ep), (await c.link()).endpointId);
    await until(c.page, (gen) => window.__jjHello.link().state === 'connected' && window.__jjHello.link().gen > gen, gen, 30_000);
    await moveAndSee(host, c, 0.1, -0.9);
    for (const x of [host, c]) await x.ctx.close();
  });
});

describe('server restart mid-session', () => {
  test('the data channel stays up, the host re-registers its code and the controller its endpoint', async () => {
    const port = await freePort();
    let server = await serve(dist, BASE, { JJ_BIND: `127.0.0.1:${port}`, JJ_STUN_URLS: '' });
    const host = await startHost(server.origin);
    const c = await startController(server.origin, host.code);
    await moveAndSee(host, c, 0.4, 0.4);
    await server.close();
    server = await serve(dist, BASE, { JJ_BIND: `127.0.0.1:${port}`, JJ_STUN_URLS: '' });
    // Data keeps flowing peer to peer while the server is gone and back.
    await moveAndSee(host, c, -0.4, -0.4);
    await until(host.page, () => window.__jjHello.transport().reRegistrations >= 1, undefined, 30_000);
    assert.equal(await host.page.evaluate(() => window.__jjHello.code()), host.code, 'the host keeps its code');
    await until(c.page, () => window.__jjHello.link().registrations >= 2, undefined, 30_000);
    const res = await fetch(`${server.origin}${BASE}api/v1/rooms/${host.code}`).then((r) => r.json());
    assert.equal(res.status, 'available');
    for (const x of [host, c]) await x.ctx.close();
    await server.close();
  });
});

describe('ICE credential refresh', () => {
  test('credentials refresh at 75 % of the TTL through /ice without dropping the data channels', async () => {
    const server = await serve(dist, BASE, { JJ_STUN_URLS: '', TURN_STATIC_AUTH_SECRET: 'refresh-test', JJ_TURN_URLS: 'turn:127.0.0.1:9?transport=udp', JJ_TURN_TTL_S: '8' });
    const host = await startHost(server.origin);
    const c = await startController(server.origin, host.code);
    const first = (await c.link()).iceExpiresAt;
    await until(c.page, (first) => window.__jjHello.link().iceExpiresAt > first, first, 20_000);
    const l = await c.link();
    assert.deepEqual(l.channels, { state: 'open', cmd: 'open' });
    assert.equal(l.state, 'connected');
    await moveAndSee(host, c, 0.7, 0.7);
    for (const x of [host, c]) await x.ctx.close();
    await server.close();
  });
});

const haveCoturn = (() => {
  try {
    execSync('command -v turnserver', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('relay through a local coturn', { skip: !haveCoturn && !process.env.JJ_COTURN_REQUIRED && 'coturn not installed' }, () => {
  test('iceTransportPolicy relay connects host and controller through coturn', async () => {
    const turnPort = await freePort('udp');
    const secret = 'n05-relay';
    const coturn = spawn('turnserver', [
      '-n', '--listening-ip=127.0.0.1', '--relay-ip=127.0.0.1', `--listening-port=${turnPort}`, '--use-auth-secret',
      `--static-auth-secret=${secret}`, '--realm=jj.test', '--no-tls', '--no-cli', '--allow-loopback-peers', '--fingerprint',
      '--min-port=49152', '--max-port=65535',
    ], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
    const server = await serve(dist, BASE, {
      JJ_STUN_URLS: '',
      TURN_STATIC_AUTH_SECRET: secret,
      JJ_TURN_URLS: `turn:127.0.0.1:${turnPort}?transport=udp`,
    });
    try {
      const host = await startHost(server.origin, '&ice=relay');
      const c = await startController(server.origin, host.code, '?ice=relay');
      const ep = await moveAndSee(host, c, -0.7, 0.3);
      const paths = await host.page.evaluate(() => window.__jjHello.paths());
      assert.equal(paths[ep]?.local, 'relay', JSON.stringify(paths[ep]));
      assert.equal(paths[ep]?.kind, 'coturn-relay');
      const cp = await c.page.evaluate(() => window.__jjHello.path());
      assert.equal(cp.local, 'relay');
      console.log(`# stats dump (IPs redacted): host ${JSON.stringify(paths[ep])} controller ${JSON.stringify(cp)}`);
      for (const x of [host, c]) await x.ctx.close();
    } finally {
      await server.close();
      coturn.kill();
    }
  });
});

function freePort(kind = 'tcp') {
  if (kind === 'udp') {
    return new Promise((resolve) => {
      const s = createSocket('udp4');
      s.bind(0, '127.0.0.1', () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
  }
  return import('node:net').then(
    ({ createServer }) =>
      new Promise((resolve) => {
        const s = createServer();
        s.listen(0, '127.0.0.1', () => {
          const p = s.address().port;
          s.close(() => resolve(p));
        });
      }),
  );
}
