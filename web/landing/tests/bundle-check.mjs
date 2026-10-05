#!/usr/bin/env node
// P1-C01 bundle check (master §3.6): the landing page and the join path (controller app) load no Three.js, world
// renderer, sim or WASM. Follows every file reachable from each page's HTML (scripts, preloads, stylesheets, and every
// quoted file reference inside the JS, dynamic imports included, so a lazy renderer chunk can't hide) and fails if any
// is a renderer/sim/model file or contains one's markers. Writes the report to docs/evidence/P1-C01/bundle-report.json.
//
// Usage: node web/landing/tests/bundle-check.mjs [web/dist] [--report <file>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

const FORBIDDEN_NAMES = /three|webgpu|webgl|sim\.worker|jj_wasm|\.wasm$|\.glb$|host-[\w-]+\.js$/i;
const FORBIDDEN_CONTENT = ['WebGLRenderer', 'WebGPURenderer', 'WebAssembly.instantiate', 'WebAssembly.compile', 'REVISION="', 'jj_wasm'];
const PAGES = { landing: 'landing/index.html', join: 'controller/index.html' };

/** Everything a page pulls in, as dist-relative paths. */
export function reachable(dist, page) {
  const seen = new Set();
  const queue = [];
  const html = readFileSync(join(dist, page), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|svg|woff2|wasm|glb))"/g)) queue.push(m[1]);
  while (queue.length) {
    const ref = queue.pop();
    // References are root-relative under the build's base (`/assets/x.js`, `/p/x/assets/x.js`) or relative to the file.
    const rel = ref.match(/(?:^|\/)((?:assets|test)\/[^/]+)$/)?.[1] ?? posix.normalize(posix.join(posix.dirname(page), ref));
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!/\.(js|css)$/.test(rel)) continue;
    let text;
    try {
      text = readFileSync(join(dist, rel), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/["'`(]((?:\.{0,2}\/)?[\w\-./]*\.(?:js|css|wasm|glb|woff2|png|svg))["'`)]/g)) {
      const next = m[1];
      const bare = next.split('/').pop();
      const dir = rel.startsWith('assets/') ? 'assets' : rel.startsWith('test/') ? 'test' : posix.dirname(rel);
      queue.push(next.includes('/') && !next.startsWith('.') ? next : `/${dir}/${bare}`);
    }
  }
  return [...seen];
}

export function analyse(dist, pages = PAGES) {
  const report = {};
  const problems = [];
  for (const [name, page] of Object.entries(pages)) {
    const files = reachable(dist, page).filter((f) => {
      try {
        readFileSync(join(dist, f));
        return true;
      } catch {
        return false;
      }
    });
    const rows = files.map((f) => {
      const bytes = readFileSync(join(dist, f));
      return { file: f, bytes: bytes.length };
    });
    for (const f of files) {
      if (FORBIDDEN_NAMES.test(f)) problems.push(`${name}: ${f} is a renderer/sim/model file`);
      if (/\.js$/.test(f)) {
        const text = readFileSync(join(dist, f), 'utf8');
        for (const marker of FORBIDDEN_CONTENT) if (text.includes(marker)) problems.push(`${name}: ${f} contains "${marker}"`);
      }
    }
    report[name] = { page, files: rows.map(({ file, bytes }) => ({ file, bytes })), totalBytes: rows.reduce((n, r) => n + r.bytes, 0) };
  }
  return { report, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--report');
  const reportFile = ri >= 0 ? args.splice(ri, 2)[1] : null;
  const dist = args[0] ?? 'web/dist';
  const { report, problems } = analyse(dist);
  if (reportFile) {
    mkdirSync(dirname(reportFile), { recursive: true });
    writeFileSync(reportFile, `${JSON.stringify({ dist, ...report, problems }, null, 2)}\n`);
  }
  for (const [name, r] of Object.entries(report)) console.log(`${name}: ${r.files.length} files, ${r.totalBytes} bytes (${r.page})`);
  if (problems.length) {
    console.error(`bundle check: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('bundle check: no Three.js, renderer, sim or WASM on the landing or join path');
}
