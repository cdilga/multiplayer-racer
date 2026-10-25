// Localhost static server for art/ui/ (the design POC root): the sheets, the POC mocks and their capture
// scripts load fonts, tokens, icons and vendored libraries from here, never from a CDN (R70).
// serveArtUi() → { base, close }. Run directly to browse: node art/ui/lib/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.glb': 'model/gltf-binary', '.md': 'text/markdown; charset=utf-8',
  '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export async function serveArtUi(port = 0) {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT + sep)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
      // Native video controls seek with byte ranges; the deployed POC edge does this too.
      if (extname(file) === '.mp4') {
        headers['accept-ranges'] = 'bytes';
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          let start = match?.[1] ? Number(match[1]) : 0;
          let end = match?.[2] ? Number(match[2]) : body.length - 1;
          if (match && !match[1] && match[2]) { start = Math.max(0, body.length - end); end = body.length - 1; }
          if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= body.length) {
            res.writeHead(416, { ...headers, 'content-range': `bytes */${body.length}` }).end();
            return;
          }
          end = Math.min(end, body.length - 1);
          res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
          res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
          return;
        }
      }
      res.writeHead(200, { ...headers, 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { base } = await serveArtUi(+(process.argv[2] || 8124));
  console.log(`serving art/ui at ${base}/  (POC: ${base}/poc/tv/)`);
}
