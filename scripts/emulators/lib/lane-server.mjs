// P1-F08: the lane's local server. A reverse proxy in front of jj-server that injects the test probe
// into HTML pages and collects the probe's reports. Everything is on localhost (secure context).
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const probeSrc = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'probe.js'));

export function startLaneServer({ upstreamPort, port = 0,  }) {
  const events = [];
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://x');
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
      if (!html) { res.writeHead(ur.statusCode, h); return ur.pipe(res); }
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
  const server6 = http.createServer(handler); // Safari resolves localhost to ::1 first
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const p = server.address().port;
    server6.on('error', () => {});
    server6.listen(p, '::1');
    resolve({
      server, events, port: p,
      close: () => new Promise((r) => { for (const sv of [server6, server]) sv.closeAllConnections?.(); server6.close(); server.close(r); }),
    });
  }));
}
