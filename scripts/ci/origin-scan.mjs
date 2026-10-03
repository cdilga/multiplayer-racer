#!/usr/bin/env node
// Origin scan (P1-F03, R70): every host a built bundle names must be listed in docs/deps/origins.json, and the only
// runtime hosts allowed are self and the configured STUN/TURN hosts. Catches a CDN import, a remote font or a library
// that fetches its own WASM, before it ships.
//
// Usage: node scripts/ci/origin-scan.mjs [<dir>…]   (default: web/dist web/dist-qualify)
// Exit: 0 clean, 1 an unlisted host or a runtime host outside the allowed set, 2 nothing to scan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['web/dist', 'web/dist-qualify'];
const policy = JSON.parse(readFileSync(join(repo, 'docs', 'deps', 'origins.json'), 'utf8'));
const runtime = new Set(policy.runtime.allowed.map((o) => o.host));
const inert = new Set(policy.inert.map((o) => o.host));
const TEXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.map', '.svg', '.webmanifest', '.txt']);
// Absolute URLs (http, https, ws, wss), ICE URLs (stun:, turn:, turns:) and protocol-relative URLs in quotes or url().
const PATTERNS = [/\b(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g, /\b(?:stun|turns?):([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, /["'(]\/\/([A-Za-z0-9-]+\.[A-Za-z0-9.-]+)/g];

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.has(extname(p))) files.push(p);
  }
};
for (const d of dirs) {
  try { walk(resolve(repo, d)); } catch { console.error(`origin-scan: ${d} not found (build it first)`); }
}
if (!files.length) {
  console.error('origin-scan: nothing to scan');
  process.exit(2);
}

const found = new Map(); // host -> Set(files)
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const host = m[1].toLowerCase();
      if (!found.has(host)) found.set(host, new Set());
      found.get(host).add(relative(repo, f));
    }
  }
}

let bad = 0;
console.log(`origin-scan: ${files.length} files in ${dirs.join(', ')}`);
for (const [host, where] of [...found].sort()) {
  const kind = runtime.has(host) ? 'runtime (allowed)' : inert.has(host) ? 'inert' : 'NOT LISTED';
  if (kind === 'NOT LISTED') bad++;
  console.log(`  ${kind.padEnd(17)} ${host}  (${[...where].join(', ')})`);
}
if (!found.size) console.log('  no external hosts named');
console.log(bad ? `origin-scan: ${bad} unlisted host(s); add them to docs/deps/origins.json only if they're inert or allowed (R70)` : 'origin-scan: ok (self + configured STUN/TURN only at runtime)');
process.exit(bad ? 1 : 0);
