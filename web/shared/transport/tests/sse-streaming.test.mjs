// Real quiet SSE responses must arrive without another event/heartbeat flushing them.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'rolldown';
import { chromium, webkit } from 'playwright';
import { serve } from '../../../landing/tests/lib/site.mjs';

const BASE = '/p/sse-streaming/';
let dist, server;
before(async () => {
  dist = mkdtempSync(join(tmpdir(), 'jj-sse-streaming-'));
  mkdirSync(join(dist, 'assets'));
  mkdirSync(join(dist, 'landing'));
  writeFileSync(join(dist, 'landing/index.html'), '<!doctype html><html><head></head><body></body></html>');
  await build({ input: join(import.meta.dirname, '../sse.ts'), output: { file: join(dist, 'assets/sse.mjs'), format: 'esm' }, logLevel: 'silent' });
  server = await serve(dist, BASE, { JJ_STUN_URLS: '' });
});
after(async () => { await server?.close(); if (dist) rmSync(dist, { recursive: true, force: true }); });
const api = async (path, body, secret) => {
  const r = await fetch(server.origin + BASE + 'api/v1/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.ok(r.ok, `real API ${path}: ${r.status}`);
  return r.json();
};
async function open(browser) {
  const host = randomUUID(), sender = randomUUID();
  const hash = s => createHash('sha256').update(s).digest('base64url');
  const room = await api('rooms', { requestId: randomUUID(), hostSecretHash: hash(host) });
  const path = `rooms/${room.roomId}`;
  await api(`${path}/endpoints`, { requestId: randomUUID(), endpointId: 'probe', endpointSecretHash: hash(sender) });
  const ctx = await browser.newContext(), page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.origin + BASE);
  await page.evaluate(async ({ base, roomId, host }) => {
    const { SignalStream } = await import(base + 'assets/sse.mjs');
    window.__events = [];
    window.__stream = new SignalStream({ roomId: () => roomId, endpointId: 'host', secret: host,
      onMessage: msg => window.__events.push(msg), onUnknown: async reason => { throw new Error(reason); } });
    window.__stream.start();
  }, { base: BASE, roomId: room.roomId, host });
  await page.waitForFunction(() => window.__stream.state === 'open');
  const send = payload => api(`${path}/signal`, { from: 'probe', to: 'host', kind: 'candidate', gen: 1, payload }, sender);
  return { ctx, page, errors, send };
}
for (const engine of [chromium, webkit]) {
  test(`${engine.name()}: one quiet SSE event arrives complete before another write`, { timeout: 30000 }, async () => {
    const browser = await engine.launch();
    try {
      const { ctx, page, errors, send } = await open(browser);
      try {
        const payload = 'a quiet offer — \r\n'.repeat(64);
        await send(payload);
        // The existing fast-stream qualification uses 2 s; no later write may finish this event.
        await page.waitForFunction(() => window.__events.length === 1, undefined, { timeout: 2000 });
        assert.deepEqual(await page.evaluate(() => window.__events.map(e => e.payload)), [payload]);
        assert.deepEqual(errors, []);
      } finally { await page.evaluate(() => window.__stream.stop()); await ctx.close(); }
    } finally { await browser.close(); }
  });
  test(`${engine.name()}: bounded response-text rotation resumes every event once`, { timeout: 30000 }, async () => {
    const browser = await engine.launch();
    try {
      const { ctx, page, errors, send } = await open(browser);
      try {
        // Each signal is below the unchanged 64 KiB body bound; together these need a stream rotation.
        const payloads = Array.from({ length: 24 }, (_, i) => `${i}:` + 'x'.repeat(48 * 1024));
        for (const payload of payloads) await send(payload);
        await page.waitForFunction(() => window.__events.length === 24 && window.__stream.rotations > 0, undefined, { timeout: 10000 });
        await page.waitForFunction(() => window.__stream.state === 'open');
        await send('after rotation');
        await page.waitForFunction(() => window.__events.length === 25, undefined, { timeout: 2000 });
        assert.deepEqual(await page.evaluate(() => window.__events.map(e => e.payload)), [...payloads, 'after rotation']);
        assert.deepEqual(errors, []);
      } finally { await page.evaluate(() => window.__stream.stop()); await ctx.close(); }
    } finally { await browser.close(); }
  });
}
