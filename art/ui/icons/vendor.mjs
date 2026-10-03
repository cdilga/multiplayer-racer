#!/usr/bin/env node
// Vendor the UI icon set from lucide-static (ISC) into this folder at the token stroke width.
// One-time dev step; the SVGs are committed. Usage: node vendor.mjs <unpacked lucide-static package dir>
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = process.argv[2];
const tokens = JSON.parse(readFileSync(join(here, '..', 'tokens.json'), 'utf8'));
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
for (const name of tokens.icons.set) {
  const svg = readFileSync(join(pkg, 'icons', `${name}.svg`), 'utf8')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/stroke-width="2"/, `stroke-width="${tokens.icons.strokeWidth}"`);
  writeFileSync(join(here, `${name}.svg`), svg);
}
copyFileSync(join(pkg, 'LICENSE'), join(here, 'LICENSE'));
console.log(`vendored ${tokens.icons.set.length} icons from lucide-static ${version}`);
