// Kept in jammers-deploy for P1-D03 AC2 (receipt: multiplayer-racer docs/evidence/P1-D03/).
// P1-D03 AC2: an SSE stream through Cloudflare Tunnel + the preview edge keeps streaming for SOAK_S seconds.
// node sse-soak.mjs https://jammers-preview.dilger.dev/p/<id>/ [seconds]
// Creates a room and two endpoints, holds endpoint A's signalling stream open, and every 30 s sends a signal from B
// to A; prints each heartbeat gap and every signal's arrival, then a PASS/FAIL line.
import { createHash, randomBytes } from 'node:crypto';

const base = process.argv[2];
const SOAK_S = Number(process.argv[3] ?? 300);
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const secret = () => randomBytes(16).toString('base64url');
const hash = (s) => createHash('sha256').update(s).digest('base64url');
const api = async (method, path, body, bearer) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const fail = (why) => {
  console.log(`sse-soak: FAIL ${why}`);
  process.exit(1);
};

const host = secret();
const created = await api('POST', 'api/v1/rooms', { requestId: secret(), hostSecretHash: hash(host) });
if (created.status !== 201) fail(`room create answered ${created.status} ${JSON.stringify(created.body)}`);
const roomId = created.body.roomId;
const sa = secret();
const sb = secret();
for (const [id, s] of [['a', sa], ['b', sb]]) {
  const r = await api('POST', `api/v1/rooms/${roomId}/endpoints`, { requestId: id, endpointId: id, endpointSecretHash: hash(s) });
  if (r.status !== 201) fail(`endpoint ${id} answered ${r.status}`);
}
console.log(`${at()} room ${created.body.code ?? roomId} through ${base}`);

const ctrl = new AbortController();
const r = await fetch(`${base}api/v1/rooms/${roomId}/signal?endpoint=a`, { headers: { authorization: `Bearer ${sa}` }, signal: ctrl.signal });
if (r.status !== 200 || r.headers.get('content-type') !== 'text/event-stream') fail(`stream answered ${r.status} ${r.headers.get('content-type')}`);
console.log(`${at()} stream open (${r.headers.get('content-type')}, cf-ray ${r.headers.get('cf-ray') ?? 'none'})`);
let lastByte = Date.now();
let maxGap = 0;
let beats = 0;
const got = new Set();
let sent = 0;
const reader = (async () => {
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of r.body) {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - lastByte);
      lastByte = now;
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^:/m.test(block) && !/^data:/m.test(block)) beats++;
        const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        const m = /soak-(\d+)/.exec(data);
        if (m) got.add(Number(m[1])), console.log(`${at()} signal ${m[1]} arrived`);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.log(`${at()} stream error ${e.message}`);
  }
  return 'ended';
})();
for (let s = 30; s <= SOAK_S; s += 30) {
  await new Promise((res) => setTimeout(res, 30_000));
  sent++;
  const sr = await api('POST', `api/v1/rooms/${roomId}/signal`, { from: 'b', to: 'a', kind: 'candidate', gen: 1, payload: `soak-${sent}` }, sb);
  console.log(`${at()} sent signal ${sent} (${sr.status}); heartbeats so far ${beats}, longest silence ${(maxGap / 1000).toFixed(1)} s`);
}
await new Promise((res) => setTimeout(res, 5_000));
const ended = await Promise.race([reader, new Promise((res) => setTimeout(() => res('open'), 10))]);
ctrl.abort();
const missing = [...Array(sent).keys()].map((i) => i + 1).filter((n) => !got.has(n));
const line = `held ${((Date.now() - t0) / 1000).toFixed(0)} s, stream ${ended === 'open' ? 'still open' : 'ENDED'}, ${beats} heartbeats, longest silence ${(maxGap / 1000).toFixed(1)} s, signals ${got.size}/${sent}`;
if (ended !== 'open' || missing.length || maxGap > 30_000) fail(line + (missing.length ? `, missing ${missing}` : ''));
console.log(`sse-soak: PASS ${line}`);
