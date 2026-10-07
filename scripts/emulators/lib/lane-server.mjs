// P1-F08: the lane's local server. A reverse proxy in front of jj-server that injects the test probe
// into HTML pages and collects the probe's reports. Everything is on localhost (secure context).
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const probeSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe.js'));

export function startLaneServer({ upstreamPort, port = 0, host = '127.0.0.1', dist = null }) {
  const events = [];
  const hostApi = {}; // observe(), command(c), info(): set by the stack once the real host page is up
  const cmdQueue = []; // XCUITest commands: POST /__lane/cmd (waits for the ack), GET /__lane/cmd/next (long poll)
  const cmdWaiters = new Map();
  let cmdSeq = 0;
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(v)); };
    const body = () => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r({}); } }); });
    const fx = { '/__lane/fixture-sticks.html': 'fixture-sticks.html', '/__lane/fixture-clips.html': 'fixture-clips.html' }[url.pathname];
    if (fx) { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), fx))); }
    if (url.pathname === '/__lane/clips.json' && dist) {
      const found = [];
      const walk = (d, rel) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/'); else if (/\.(ogg|opus|m4a|mp3|wav|webm|aac)$/i.test(e.name)) found.push('/' + rel + e.name); } };
      walk(dist, ''); found.sort();
      return json(200, found);
    }
    if (url.pathname === '/__lane/info') return json(200, hostApi.info?.() ?? {});
    if (url.pathname === '/__lane/host/observe') return Promise.resolve(hostApi.observe?.()).then((v) => json(200, v ?? null), (e) => json(500, { error: String(e) }));
    if (url.pathname === '/__lane/host/command' && req.method === 'POST') return body().then((c) => hostApi.command(c)).then((v) => json(200, v ?? null), (e) => json(500, { error: String(e) }));
    if (url.pathname === '/__lane/cmd' && req.method === 'POST') {
      return body().then((c) => {
        const id = ++cmdSeq; cmdQueue.push({ id, ...c });
        const t = setTimeout(() => { cmdWaiters.delete(id); json(504, { error: 'no ack' }); }, c.timeoutMs || 90000);
        cmdWaiters.set(id, (r) => { clearTimeout(t); json(200, r); });
      });
    }
    if (url.pathname === '/__lane/cmd/next') {
      const end = Date.now() + 8000;
      const tick = () => { const c = cmdQueue.shift(); if (c) return json(200, c); if (Date.now() > end) { res.writeHead(204); return res.end(); } setTimeout(tick, 100); };
      return tick();
    }
    if (url.pathname === '/__lane/cmd/ack' && req.method === 'POST') {
      return body().then((r) => { cmdWaiters.get(r.id)?.(r); cmdWaiters.delete(r.id); json(200, {}); });
    }
    if (url.pathname === '/__lane/probe.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end(probeSrc);
    }
    if (url.pathname === '/__lane/r' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try { events.push({ ...JSON.parse(body), recvAt: Date.now() }); } catch {}
        res.writeHead(204); res.end();
      });
      return;
    }
    if (url.pathname === '/__lane/has') {
      const kind = url.searchParams.get('kind');
      res.writeHead(200, { 'cache-control': 'no-store' });
      return res.end(events.some((e) => e.kind === kind) ? '1' : '0');
    }
    if (url.pathname === '/__lane/events') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(events));
    }
    if (url.pathname === '/__lane/reset') {
      events.length = 0; res.writeHead(204); return res.end();
    }
    const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}`, 'accept-encoding': 'identity' };
    const up = http.request({ host: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers }, (ur) => {
      const h = { ...ur.headers };
      delete h['content-security-policy'];
      const html = String(h['content-type'] || '').includes('text/html');
      if (!html || req.headers['x-jj-nolane']) { res.writeHead(ur.statusCode, h); return ur.pipe(res); }
      const chunks = [];
      ur.on('data', (c) => chunks.push(c));
      ur.on('end', () => {
        let b = Buffer.concat(chunks).toString('utf8');
        const tag = '<script src="/__lane/probe.js"></script>';
        b = b.includes('<head>') ? b.replace('<head>', '<head>' + tag) : tag + b;
        delete h['content-length']; delete h['etag']; h['cache-control'] = 'no-store';
        res.writeHead(ur.statusCode, h); res.end(b);
      });
    });
    up.on('error', () => { res.writeHead(502); res.end('upstream down'); });
    req.pipe(up);
  };
  const server = http.createServer(handler);
  const server6 = http.createServer(handler);
  // Node closes idle keep-alive sockets after 5 s; a client (the driver, XCUITest) reusing one then sees ECONNRESET.
  for (const sv of [server, server6]) { sv.keepAliveTimeout = 300000; sv.headersTimeout = 310000; } // Safari resolves localhost to ::1 first
  return new Promise((resolve) => server.listen(port, host, () => {
    const p = server.address().port;
    server6.on('error', () => {});
    server6.listen(p, '::1');
    resolve({
      server, events, hostApi, port: p,
      close: () => new Promise((r) => { for (const sv of [server6, server]) sv.closeAllConnections?.(); server6.close(); server.close(r); }),
    });
  }));
}
