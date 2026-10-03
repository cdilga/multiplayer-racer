#!/usr/bin/env node
// Vendor what the design POC pages import, so art/ui/ serves them offline with no CDN (R70):
//   vendor/three/  three.module.min.js + LICENSE from the repo-root node_modules (the version Spike J was
//                  measured with)
//   vendor/cruz/   Spike J's Cruz Missile model script (model.js, atlas.js, params.json), copied verbatim
//                  with a provenance header; the spike stays the source (spikes/art-pipeline/J-cruze-lowpoly/)
// Usage: node art/ui/poc/vendor.mjs   (rerun after bumping three or changing the spike)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const three = join(repo, 'node_modules', 'three');
const { version } = JSON.parse(readFileSync(join(three, 'package.json'), 'utf8'));
mkdirSync(join(here, 'vendor', 'three'), { recursive: true });
copyFileSync(join(three, 'build', 'three.module.min.js'), join(here, 'vendor', 'three', 'three.module.min.js'));
copyFileSync(join(three, 'build', 'three.core.min.js'), join(here, 'vendor', 'three', 'three.core.min.js'));
copyFileSync(join(three, 'LICENSE'), join(here, 'vendor', 'three', 'LICENSE'));
writeFileSync(join(here, 'vendor', 'three', 'VERSION'), `three ${version} (npm), copied from the repo-root node_modules\n`);

const spike = 'spikes/art-pipeline/J-cruze-lowpoly';
const sha = execFileSync('git', ['log', '-1', '--format=%h', '--', spike], { cwd: repo }).toString().trim();
mkdirSync(join(here, 'vendor', 'cruz'), { recursive: true });
for (const f of ['model.js', 'atlas.js']) {
  const src = readFileSync(join(repo, spike, f), 'utf8');
  writeFileSync(join(here, 'vendor', 'cruz', f), `// Vendored verbatim from ${spike}/${f} at ${sha} by art/ui/poc/vendor.mjs; edit the spike, not this copy.\n${src}`);
}
copyFileSync(join(repo, spike, 'params.json'), join(here, 'vendor', 'cruz', 'params.json'));
console.log(`vendored three ${version} and the Cruz Missile model from ${spike} @ ${sha}`);
