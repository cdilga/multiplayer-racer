#!/usr/bin/env node
// P1-U01 style frames through Meta's Muse Image (Meta Model API, muse-image-1.0, flat $0.01 per image).
// Usage: node art/ui/frames/generate.mjs <name> [--n 3] [--suffix -b] [--size 1536x1024]
//   Prompt: prompts/<name>.txt, used verbatim (MASTER + UI block + H4 direction + subject + GUARDS).
//   References go to /v1/images/edits: H4 (the house style, always first), plus Spike J's Cruz Missile render
//   for TV frames, or M2's controls and the car render for the phone frame.
//   Output: <name><suffix>-<k>.png beside this script; every call appends to ledger.jsonl (what was asked,
//   what came back, what it cost).
// Key: MUSE_API_KEY from the environment or the repo's git-ignored .env; never printed or written anywhere.
// Budget: the owner allowed $2.50 (250 images) on 2026-10-03; the ledger refuses a call that would pass it.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, openAsBlob, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const BASE = 'https://api.meta.ai/v1';
const MODEL = 'muse-image-1.0';
const PRICE_USD = 0.01;
const BUDGET_IMAGES = 250;
const ledgerPath = join(here, 'ledger.jsonl');

const args = process.argv.slice(2);
const name = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const n = Number(opt('--n', '3'));
const suffix = opt('--suffix', '');
if (!name || !existsSync(join(here, 'prompts', `${name}.txt`)) || !(n >= 1 && n <= 4)) {
  console.error('usage: generate.mjs <name with prompts/<name>.txt> [--n 1..4] [--suffix -x]');
  process.exit(2);
}

const H4 = 'docs/plans/ux-study-2026-09-29/images/H4-host-round-results-v2.png';
const CAR = 'spikes/art-pipeline/J-cruze-lowpoly/out/evidence/ladder_L0_hero.png';
const M2 = 'docs/plans/ux-study-2026-09-29/images/M2-mobile-control-settings-v2.png';
const refs = name.startsWith('phone') ? [H4, M2, CAR] : [H4, CAR];
const size = opt('--size', '1536x1024');

const key = process.env.MUSE_API_KEY ?? (() => {
  const env = join(repo, '.env');
  if (!existsSync(env)) return undefined;
  const m = readFileSync(env, 'utf8').match(/^\s*(?:export\s+)?MUSE_API_KEY=["']?([^"'\n]+)["']?\s*$/m);
  return m?.[1];
})();
if (!key) { console.error('MUSE_API_KEY not set (environment or repo .env)'); process.exit(2); }

const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const spent = ledger.reduce((a, e) => a + (e.images_billed ?? 0), 0);
if (spent + n > BUDGET_IMAGES) {
  console.error(`budget: ${spent} images already billed; ${n} more would pass the owner's ${BUDGET_IMAGES} ($${(BUDGET_IMAGES * PRICE_USD).toFixed(2)})`);
  process.exit(3);
}

const prompt = readFileSync(join(here, 'prompts', `${name}.txt`), 'utf8').trim();
const form = new FormData();
form.append('model', MODEL);
form.append('prompt', prompt);
form.append('size', size);
form.append('n', String(n));
form.append('response_format', 'b64_json');
for (const r of refs) form.append('image', await openAsBlob(join(repo, r), { type: 'image/png' }), basename(r));

const t0 = Date.now();
const res = await fetch(`${BASE}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
const images = Array.isArray(body.data) ? body.data.filter((d) => d.b64_json) : [];
const files = images.map((d, k) => {
  const file = `${name}${suffix}-${k + 1}.png`;
  writeFileSync(join(here, file), Buffer.from(d.b64_json, 'base64'));
  return file;
});
const entry = {
  at: new Date().toISOString(), name, model: MODEL, endpoint: 'images/edits', size, n, refs,
  prompt_file: `prompts/${name}.txt`, prompt_sha256: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
  http: res.status, ms: Date.now() - t0, files, images_billed: images.length, usd: +(images.length * PRICE_USD).toFixed(2),
  ...(res.ok ? {} : { error: body.error?.message ?? body.error ?? body.raw ?? `HTTP ${res.status}` }),
};
appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
const total = spent + images.length;
console.log(`${res.status} ${files.join(' ') || '(no images)'}${entry.error ? ` error: ${String(entry.error).slice(0, 300)}` : ''}`);
console.log(`spend: ${total} images, $${(total * PRICE_USD).toFixed(2)} of $${(BUDGET_IMAGES * PRICE_USD).toFixed(2)}`);
process.exit(res.ok && files.length ? 0 : 1);
