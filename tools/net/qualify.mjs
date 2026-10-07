#!/usr/bin/env node
// Network qualification harness (P1-N08): one receipt per connection path, measured through the real pages.
//
//   node tools/net/qualify.mjs --base http://HOST:PORT/ --row direct-wifi [options]
//
// A host page and a controller page join through the build's hello room (`host?hello`, `j/<code>?hello`, the G00 test
// surface `window.__jjHello`). The controller changes its stick at --hz (default 60) for --seconds (default 10); the host
// page records when each value arrives. The receipt carries the selected candidate pair (types and protocols only),
// input age p50/p95/p99 with its clock uncertainty, application payload and transport bytes per second, and the
// 2,000 B/s payload verdict. IPs, SDP and credentials never reach a receipt (qualify-lib.mjs `receiptProblems`).
//
// Options
//   --base <url>            the build's base URL, ending in `/` (required)
//   --row <name>            receipt name; written to --out (default docs/evidence/P1-N08/<row>.json)
//   --expect <kind>         selected path must be: host | srflx | coturn-relay | cloudflare-relay | relay | any (default any)
//   --policy relay          force `iceTransportPolicy: "relay"` (the real TURN path)
//   --rewrite-turn h:p      replace the host:port of every turn:/turns: URL (coturn on its LAN address, or a local container)
//   --only-url <text>       keep only ICE URLs containing this text (`:443` with `turns:` isolates Cloudflare's TLS-443 entry)
//   --drop-stun             remove STUN URLs
//   --host-cdp <url>        run the HOST page in an already-running Chrome (`--remote-debugging-port`), e.g. the Mac's, while
//                           the controller runs here: a cross-machine row. The clock offset is measured and its uncertainty quoted.
//   --insecure-origin <o>   Chromium's secure-context test flag for a plain-http LAN origin (plan §5.3)
//   --hardware/--build/--cohort/--topology <text>   what the receipt names (all required for a valid receipt)
//   --netem <text>          describe the scripted impairment already applied (tools/net/netem.sh), recorded verbatim
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { iceRewriteScript, payloadVerdict, perSecond, receiptProblems, redactedStats, summariseAges } from './qualify-lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? dflt : (argv[i + 1]?.startsWith('--') ? true : (argv[i + 1] ?? true));
};
const base = opt('base');
const row = opt('row');
if (!base || !row || !/\/$/.test(base)) {
  console.error('usage: qualify.mjs --base <url ending in /> --row <name> [options] (see the header)');
  process.exit(2);
}
const seconds = Number(opt('seconds', 10));
const hz = Number(opt('hz', 60));
const expect = opt('expect', 'any');
const out = opt('out', `docs/evidence/P1-N08/${row}.json`);
const ice = { policy: opt('policy'), rewriteTurn: opt('rewrite-turn'), onlyUrlIncludes: opt('only-url'), dropStun: argv.includes('--drop-stun') };
const insecure = opt('insecure-origin');
const hostCdp = opt('host-cdp');
const args = ['--disable-features=WebRtcHideLocalIpsWithMdns', ...(insecure ? [`--unsafely-treat-insecure-origin-as-secure=${insecure}`] : [])];
const until = (page, fn, arg, ms = 60_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });

// The host page records the arrival time of every marker x it sees, keyed by round(x * 1e4).
const hostRecorder = `(() => {
  window.__qualSeen = {};
  const tick = () => {
    const ms = window.__jjHello?.markers?.() ?? {};
    for (const m of Object.values(ms)) {
      const k = Math.round(m.x * 1e4);
      if (!(k in window.__qualSeen)) window.__qualSeen[k] = Date.now();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

/** Clock offset of `page` relative to this process (ms) and its uncertainty: the best of 25 round trips. */
async function clock(page) {
  let best = null;
  for (let i = 0; i < 25; i++) {
    const t0 = Date.now();
    const remote = await page.evaluate(() => Date.now());
    const t1 = Date.now();
    const rtt = t1 - t0;
    if (!best || rtt < best.rtt) best = { offset: remote - (t0 + t1) / 2, rtt };
  }
  return { offset: best.offset, uncertainty: best.rtt / 2 };
}

const browsers = [];
let result;
try {
  const local = await chromium.launch({ args });
  browsers.push(local);
  const hostBrowser = hostCdp ? await chromium.connectOverCDP(hostCdp) : local;
  const hostCtx = hostCdp ? hostBrowser.contexts()[0] ?? (await hostBrowser.newContext()) : await local.newContext();
  const ctlCtx = await local.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  for (const c of [hostCtx, ctlCtx]) await c.addInitScript(iceRewriteScript(ice));
  await hostCtx.addInitScript(hostRecorder);
  const host = await hostCtx.newPage();
  const ctl = await ctlCtx.newPage();
  const q = '?hello';
  await host.goto(`${base}host${q}`);
  await until(host, () => window.__jjHello?.code());
  const code = await host.evaluate(() => window.__jjHello.code());
  await ctl.goto(`${base}j/${code}${q}`);
  await until(ctl, () => window.__jjHello?.link().state === 'connected');
  await ctl.waitForTimeout(1500);

  const stats = async (page) => redactedStats(await page.evaluate(async () => {
    const out = [];
    for (const pc of window.__qualPcs ?? []) (await pc.getStats()).forEach((s) => out.push(s));
    return out;
  }));
  const sum = (s, k) => s.dataChannels.reduce((a, d) => a + (d[k] ?? 0), 0);

  // The two clocks: one machine means one clock; a remote host gets a measured offset with its uncertainty.
  const hostClock = hostCdp ? await clock(host) : { offset: 0, uncertainty: 0 };
  const ctlClock = hostCdp ? await clock(ctl) : { offset: 0, uncertainty: 0 };
  const skew = hostClock.offset - ctlClock.offset;
  const clockUncertainty = hostClock.uncertainty + ctlClock.uncertainty;

  const before = await stats(ctl);
  const t0 = Date.now();
  const sent = await ctl.evaluate(([n, hz]) => new Promise((done) => {
    const sentAt = [];
    let i = 0;
    const start = performance.now();
    const step = () => {
      if (i >= n) return done(sentAt);
      const due = start + (i * 1000) / hz;
      if (performance.now() < due) return void setTimeout(step, Math.max(0, due - performance.now() - 1));
      sentAt.push(Date.now());
      window.__jjHello.setStick(0.05 + i * 1e-4, 0);
      i++;
      setTimeout(step, 0);
    };
    step();
  }), [Math.round(seconds * hz), hz]);
  await ctl.waitForTimeout(1500);
  const t1 = Date.now();
  const after = await stats(ctl);
  const seen = await host.evaluate(() => window.__qualSeen);

  const ages = [];
  sent.forEach((at, i) => {
    const k = Math.round((0.05 + i * 1e-4) * 1e4);
    if (k in seen) ages.push(seen[k] - skew - at);
  });
  const seconds_ = (t1 - t0 - 1500) / 1000;
  const payloadBps = perSecond({ t: 0, bytes: sum(before, 'bytesSent') }, { t: seconds_ * 1000, bytes: sum(after, 'bytesSent') });
  const wireBps = perSecond({ t: 0, bytes: before.transport?.bytesSent ?? 0 }, { t: seconds_ * 1000, bytes: after.transport?.bytesSent ?? 0 });
  const pair = after.selectedPair;
  const kind = pair ? (pair.localType === 'relay' ? `${pair.relayVia}-relay` : pair.localType) : 'none';
  const pathOk = expect === 'any' ? pair != null : kind === expect || (expect === 'relay' && pair?.localType === 'relay');
  const rtt = pair?.rttMs ?? null;
  result = {
    selectedPath: { kind, ...pair },
    expected: expect,
    pathMatchesExpectation: pathOk,
    inputAge: summariseAges(ages, sent.length, clockUncertainty + (rtt == null ? 0 : rtt / 2)),
    input: { hz, seconds, endpoint: 'redacted', unobservedNote: 'values the host never showed (coalesced by the sender or dropped) count as lost' },
    bytes: {
      payloadBytesPerSecond: payloadBps,
      transportBytesPerSecond: wireBps,
      layers: 'payload = RTCDataChannel bytesSent (application messages); transport = RTCTransport bytesSent (adds SCTP/DTLS/UDP headers as the browser counts them). Neither is billed relay usage (R92).',
    },
    payloadBudget: { limitBytesPerSecond: 2000, verdict: payloadVerdict(payloadBps) },
  };
  const receipt = {
    row,
    capturedAt: new Date().toISOString(),
    hardware: opt('hardware'),
    browser: `${local.browserType().name()} ${local.version()}`,
    build: opt('build'),
    topology: opt('topology'),
    cohort: opt('cohort', `1 host page, 1 controller page, ${seconds} s at ${hz} Hz`),
    clock: hostCdp
      ? { mode: 'cross-machine', measuredSkewMs: Math.round(skew * 10) / 10, uncertaintyMs: Math.round(clockUncertainty * 10) / 10 }
      : { mode: 'same-clock (one machine)', uncertaintyMs: 0 },
    ice: { policy: ice.policy ?? 'all', rewriteTurn: ice.rewriteTurn ? 'yes' : 'no', restrictedToUrlsContaining: ice.onlyUrlIncludes ?? null, dropStun: ice.dropStun },
    netem: opt('netem', 'none'),
    result,
  };
  receipt.problems = receiptProblems(receipt);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
  const ok = pathOk && receipt.problems.length === 0 && result.payloadBudget.verdict === 'pass' && ages.length > 0;
  console.log(`qualify ${row}: ${ok ? 'OK' : 'FAIL'} path=${kind} age p50/p95/p99=${result.inputAge.p50Ms}/${result.inputAge.p95Ms}/${result.inputAge.p99Ms} ms (±${result.inputAge.uncertaintyMs}) payload=${payloadBps} B/s wire=${wireBps} B/s -> ${out}${receipt.problems.length ? ` problems: ${receipt.problems.join('; ')}` : ''}`);
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.log(`qualify ${row}: FAIL ${String(e.message ?? e).split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  for (const b of browsers) await b.close().catch(() => {});
}
