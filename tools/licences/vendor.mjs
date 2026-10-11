// Path-patched third-party crates still ship and still need attribution. Cargo.lock
// omits their source; distinguish them from our crates using the vendored manifests.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function vendoredCargoPackages(repo) {
  const root = resolve(repo, 'vendor');
  let dirs;
  try { dirs = readdirSync(root, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return dirs.filter((d) => d.isDirectory()).map((d) => {
    const manifest = readFileSync(resolve(root, d.name, 'Cargo.toml'), 'utf8');
    const pkg = manifest.split(/^\[package\]\s*\n/m)[1]?.split(/^\[/m)[0];
    const name = /^name\s*=\s*"([^"]+)"$/m.exec(pkg ?? '')?.[1];
    const version = /^version\s*=\s*"([^"]+)"$/m.exec(pkg ?? '')?.[1];
    if (!name || !version) throw new Error(`vendor/${d.name}: package name/version missing`);
    return `${name}@${version}`;
  }).sort();
}
