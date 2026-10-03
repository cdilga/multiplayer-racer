#!/usr/bin/env node
// P1-U01 token check: schema validation, references, WCAG AA for every named contrast pair, badge
// text on every identity colour, and adjacent-seat distinctness under colour-vision deficiency.
// Exits non-zero naming every failure. Usage: node art/ui/check.mjs [--json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { CVD_TYPES, contrast, deltaE2000, simulateCvd } from './lib/color.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(here, 'tokens.schema.json'), 'utf8'));
const failures = [];
const report = { schema: null, contrast: [], badges: [], cvd: [], files: [] };
const fail = (msg) => failures.push(msg);

// 1. Schema.
const ajv = new Ajv2020({ allErrors: true, strict: false });
const valid = ajv.validate(schema, tokens);
report.schema = valid ? 'valid' : ajv.errors;
if (!valid) for (const e of ajv.errors) fail(`schema: ${e.instancePath || '/'} ${e.message}`);

const palette = tokens.palette ?? {};
const hex = (ref) => {
  if (!palette[ref]) {
    fail(`reference: no palette colour "${ref}"`);
    return null;
  }
  return palette[ref].hex;
};

// 2. WCAG AA for every named pair (normal text 4.5:1; large text and UI graphics 3:1).
const MIN = { normal: 4.5, large: 3, ui: 3 };
for (const p of tokens.contrastPairs ?? []) {
  const [fg, bg] = [hex(p.fg), hex(p.bg)];
  if (!fg || !bg) continue;
  const ratio = contrast(fg, bg);
  const ok = ratio >= MIN[p.size];
  report.contrast.push({ name: p.name, fg: p.fg, bg: p.bg, size: p.size, ratio: +ratio.toFixed(2), min: MIN[p.size], ok });
  if (!ok) fail(`contrast: ${p.name} (${p.fg} on ${p.bg}) is ${ratio.toFixed(2)}:1, needs ${MIN[p.size]}:1 for ${p.size}`);
}

// 3. Badge numbers on every identity colour: bold display numbers, so the large-text minimum (3:1),
//    plus the ink outline separating the badge from any background (3:1 against the colour or paper).
const colors = tokens.identity?.colors ?? [];
for (const c of colors) {
  const on = hex(c.on);
  if (!on) continue;
  const ratio = contrast(on, c.hex);
  const ok = ratio >= MIN.large;
  report.badges.push({ color: c.name, on: c.on, ratio: +ratio.toFixed(2), ok });
  if (!ok) fail(`badge: number (${c.on}) on ${c.name} ${c.hex} is ${ratio.toFixed(2)}:1, needs 3:1`);
}

// 4. Adjacent seats (seat n and n+1, wrapping round the palette as N grows) must be told apart by
//    colour in every view; where colours ever coincide, the distinct numbers carry identity.
const views = ['normal', ...CVD_TYPES];
const see = (h, v) => (v === 'normal' ? h : simulateCvd(h, v));
const minDe = tokens.identity?.cvdMinDeltaE ?? 20;
for (let i = 0; i < colors.length; i++) {
  const a = colors[i];
  const b = colors[(i + 1) % colors.length];
  const per = Object.fromEntries(views.map((v) => [v, +deltaE2000(see(a.hex, v), see(b.hex, v)).toFixed(1)]));
  const worst = Math.min(...Object.values(per));
  const ok = worst >= minDe;
  report.cvd.push({ seats: `${a.name}→${b.name}`, deltaE: per, worst, byColour: ok, byNumber: true });
  if (!ok) fail(`cvd: adjacent seats ${a.name}→${b.name} differ by only ΔE00 ${worst} in some view (min ${minDe})`);
}

// 5. Each profile's minimum cap height must be reachable at its minimum text size.
for (const [name, prof] of Object.entries(tokens.type?.profiles ?? {})) {
  const reachable = prof.minTextPx * (tokens.type.capHeightRatio ?? 0);
  if (prof.minCapHeightPx > reachable + 1e-6) fail(`type: ${name} minCapHeightPx ${prof.minCapHeightPx} exceeds minTextPx ${prof.minTextPx} × cap ratio (${reachable.toFixed(2)})`);
}

// 6. Files the tokens promise.
const files = [
  tokens.fonts?.display?.licenceFile,
  ...(tokens.fonts?.display?.files ?? []).map((f) => f.file),
  ...(tokens.fonts?.body?.files ?? []).map((f) => f.file),
  tokens.icons?.licenceFile,
  ...(tokens.icons?.set ?? []).map((n) => `icons/${n}.svg`),
].filter(Boolean);
for (const f of files) {
  const ok = existsSync(join(here, f));
  report.files.push({ file: f, ok });
  if (!ok) fail(`file: art/ui/${f} is missing`);
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: failures.length === 0, failures, report }, null, 2));
else {
  console.log(`schema: ${valid ? 'valid' : 'INVALID'}`);
  for (const c of report.contrast) console.log(`contrast ${c.ok ? 'ok  ' : 'FAIL'} ${c.ratio.toFixed(2).padStart(5)}:1 (min ${c.min}) ${c.name}: ${c.fg} on ${c.bg}`);
  for (const b of report.badges) console.log(`badge    ${b.ok ? 'ok  ' : 'FAIL'} ${b.ratio.toFixed(2).padStart(5)}:1 ${b.on} on ${b.color}`);
  for (const c of report.cvd) console.log(`cvd      ${c.byColour ? 'ok  ' : 'FAIL'} worst ΔE00 ${String(c.worst).padStart(5)} ${c.seats} ${JSON.stringify(c.deltaE)}`);
  console.log(`files: ${report.files.filter((f) => f.ok).length}/${report.files.length} present`);
  for (const f of failures) console.error(`FAIL ${f}`);
  console.log(failures.length ? `token check: ${failures.length} failure(s)` : 'token check: ok');
}
process.exit(failures.length ? 1 : 0);
