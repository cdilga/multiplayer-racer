// check-recipes.mjs: keeps the recipe blocks in ../recipes.md (and any in SKILL.md / recipes-extra.md) identical to the code that was rendered.
//   node check-recipes.mjs           verify (exit 1 on drift)
//   node check-recipes.mjs --write   rewrite the fenced blocks from the source files
// A recipe block in the markdown looks like:
//   <!-- recipe: look.js#toon-model -->
//   ```js
//   ...verbatim body of `// region: toon-model` ... `// endregion` in example/look.js...
//   ```
//   <!-- /recipe -->
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url)), skill = path.resolve(dir, '..');
const write = process.argv.includes('--write');
const cache = {};
const region = (file, name) => {
  const src = (cache[file] ??= fs.readFileSync(path.join(dir, file), 'utf8').split('\n'));
  const a = src.findIndex((l) => l.trim() === `// region: ${name}` || l.trim() === `<!-- region: ${name} -->`);
  if (a < 0) throw new Error(`no region ${name} in ${file}`);
  const b = src.findIndex((l, i) => i > a && (l.trim() === '// endregion' || l.trim() === '<!-- endregion -->'));
  if (b < 0) throw new Error(`region ${name} in ${file} has no // endregion`);
  const body = src.slice(a + 1, b);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return body.map((l) => l.slice(indent)).join('\n');
};

let bad = 0, count = 0;
for (const md of ['SKILL.md', 'recipes.md', 'recipes-extra.md']) {
  const file = path.join(skill, md);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const out = text.replace(/<!-- recipe: (\S+)#(\S+) -->\n```(?:js|html)\n([\s\S]*?)\n```\n<!-- \/recipe -->/g, (all, f, name, body) => {
    count++;
    const want = region(f, name);
    if (body === want) return all;
    bad++; console.error(`DRIFT ${md}: ${f}#${name}`);
    return `<!-- recipe: ${f}#${name} -->\n\`\`\`${f.endsWith('.html') ? 'html' : 'js'}\n${want}\n\`\`\`\n<!-- /recipe -->`;
  });
  if (write && out !== text) fs.writeFileSync(file, out);
}
console.log(`${count} recipe blocks checked, ${bad} ${write ? 'rewritten' : 'drifted'}`);
process.exit(bad && !write ? 1 : 0);
