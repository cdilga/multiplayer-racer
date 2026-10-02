// serve.mjs — localhost-only static server for the repo root (no caching, correct MIME types). node serve.mjs [port]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(new URL('../../..', import.meta.url).pathname), PORT = +(process.argv[2] || 8123);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.css': 'text/css', '.glb': 'model/gltf-binary' };
http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log('serving', ROOT, 'on 127.0.0.1:' + PORT));
