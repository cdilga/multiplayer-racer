#!/usr/bin/env node
// Vendor what the design POC pages import, so art/ui/ serves them offline with no CDN (R70):
//   vendor/three/  three.module.min.js (WebGL), three.webgpu.min.js + three.tsl.min.js, the bloom/FXAA TSL addons and
//                  BufferGeometryUtils (the world mock bakes its static props),
//                  LICENSE, from the repo-root node_modules (the version Spike J was measured with)
//   vendor/look/   the jammers-look skill's tested look.js (P1-F11), for the in-world look (P1-U05)
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
copyFileSync(join(three, 'build', 'three.webgpu.min.js'), join(here, 'vendor', 'three', 'three.webgpu.min.js'));
copyFileSync(join(three, 'build', 'three.tsl.min.js'), join(here, 'vendor', 'three', 'three.tsl.min.js'));
mkdirSync(join(here, 'vendor', 'three', 'addons', 'tsl', 'display'), { recursive: true });
for (const f of ['BloomNode.js', 'FXAANode.js']) copyFileSync(join(three, 'examples', 'jsm', 'tsl', 'display', f), join(here, 'vendor', 'three', 'addons', 'tsl', 'display', f));
mkdirSync(join(here, 'vendor', 'three', 'addons', 'utils'), { recursive: true });
copyFileSync(join(three, 'examples', 'jsm', 'utils', 'BufferGeometryUtils.js'), join(here, 'vendor', 'three', 'addons', 'utils', 'BufferGeometryUtils.js'));
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
// The comic look's tested module (P1-F11 jammers-look skill), used by the in-world look mocks (P1-U05).
const lookSrc = '.claude/skills/jammers-look/example/look.js';
const lookSha = execFileSync('git', ['log', '-1', '--format=%h', '--', lookSrc], { cwd: repo }).toString().trim();
mkdirSync(join(here, 'vendor', 'look'), { recursive: true });
writeFileSync(join(here, 'vendor', 'look', 'look.js'), `// Vendored verbatim from ${lookSrc} at ${lookSha} by art/ui/poc/vendor.mjs; edit the skill's module, not this copy.\n${readFileSync(join(repo, lookSrc), 'utf8')}`);
console.log(`vendored three ${version} (WebGL + WebGPU + TSL builds, bloom/FXAA addons), the Cruz Missile model from ${spike} @ ${sha} and look.js @ ${lookSha}`);
