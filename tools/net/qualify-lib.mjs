// Pure parts of the network qualification harness (P1-N08): statistics, ICE rewriting, redaction, receipt checks.
// No browser here, so `node --test tools/net/qualify.test.mjs` runs anywhere.

/** Nearest-rank percentile of a numeric array (empty gives null). */
export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Summary of input ages (ms). `uncertaintyMs` is the clock/RTT uncertainty to quote beside every figure (RTT/2). */
export function summariseAges(ages, sent, uncertaintyMs) {
  const r = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    sent,
    seen: ages.length,
    lost: sent - ages.length,
    p50Ms: r(percentile(ages, 50)),
    p95Ms: r(percentile(ages, 95)),
    p99Ms: r(percentile(ages, 99)),
    maxMs: r(ages.length ? Math.max(...ages) : null),
    uncertaintyMs: uncertaintyMs == null ? null : r(uncertaintyMs),
  };
}

/** Bytes per second from two cumulative samples `{t (ms), bytes}`. */
export function perSecond(a, b) {
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? Math.round((b.bytes - a.bytes) / dt) : null;
}

/** The 60 Hz payload budget (plan §5.4): ≤ 2,000 B/s of application payload per source. */
export const PAYLOAD_BUDGET_BPS = 2000;

export function payloadVerdict(bps) {
  return bps != null && bps <= PAYLOAD_BUDGET_BPS ? 'pass' : 'fail';
}

/**
 * Browser-side ICE rewriting, as the source of an init script (so it runs in every page before the app).
 * `opts`: `policy` ("relay" forces TURN), `rewriteTurn` ("host:port" replaces the host of every `turn:` URL, for
 * reaching coturn on its LAN address since the WAN VIP is WAN-side only), `onlyUrlIncludes` (keep only URLs containing
 * this text, e.g. "turns:" and ":443" to restrict to Cloudflare's TLS-443 entry), `dropStun`.
 */
export function iceRewriteScript(opts) {
  return `(() => {
  const opts = ${JSON.stringify(opts)};
  const Native = window.RTCPeerConnection;
  window.__qualPcs = [];
  const rewrite = (config = {}) => {
    const c = { ...config };
    if (opts.policy) c.iceTransportPolicy = opts.policy;
    c.iceServers = (c.iceServers ?? []).map((s) => {
      let urls = [].concat(s.urls);
      if (opts.rewriteTurn) urls = urls.map((u) => (/^turns?:/.test(u) ? u.replace(/^(turns?:)[^:?]+(:\\d+)?/, '$1' + opts.rewriteTurn) : u));
      if (opts.dropStun) urls = urls.filter((u) => !u.startsWith('stun:'));
      if (opts.onlyUrlIncludes) urls = urls.filter((u) => u.includes(opts.onlyUrlIncludes));
      return { ...s, urls };
    }).filter((s) => s.urls.length);
    return c;
  };
  window.RTCPeerConnection = function (config = {}, ...rest) {
    const pc = new Native(rewrite(config), ...rest);
    window.__qualPcs.push(pc);
    return pc;
  };
  // The relay fallback (and credential refreshes) hand new servers to a live connection through setConfiguration():
  // the same rewrite applies, so a row restricted to one entry stays restricted after the fallback.
  const nativeSet = Native.prototype.setConfiguration;
  Native.prototype.setConfiguration = function (config) {
    return nativeSet.call(this, rewrite(config));
  };
  window.RTCPeerConnection.prototype = Native.prototype;
  window.RTCPeerConnection.generateCertificate = Native.generateCertificate;
})();`;
}

/** Keeps only types, protocols and counters from a stats report (no IPs, ports, SDP, usernames or credentials). */
export function redactedStats(report) {
  const byId = new Map(report.map((s) => [s.id, s]));
  const transport = report.find((s) => s.type === 'transport' && s.selectedCandidatePairId);
  const pair = transport ? byId.get(transport.selectedCandidatePairId) : report.find((s) => s.type === 'candidate-pair' && s.nominated);
  const local = pair ? byId.get(pair.localCandidateId) : null;
  const remote = pair ? byId.get(pair.remoteCandidateId) : null;
  const urlHost = (u) => (u ? String(u).replace(/^(turns?|stuns?):/, '').split(/[:?]/)[0] : null);
  return {
    selectedPair: pair
      ? {
          localType: local?.candidateType ?? null,
          remoteType: remote?.candidateType ?? null,
          protocol: local?.protocol ?? null,
          relayProtocol: local?.relayProtocol ?? null,
          // The provider only: the hostname of the TURN URL, never an address.
          relayVia: local?.candidateType === 'relay' ? (/cloudflare/.test(urlHost(local.url) ?? '') ? 'cloudflare' : 'coturn') : null,
          rttMs: typeof pair.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : null,
        }
      : null,
    transport: transport ? { bytesSent: transport.bytesSent, bytesReceived: transport.bytesReceived, packetsSent: transport.packetsSent, dtlsState: transport.dtlsState } : null,
    dataChannels: report
      .filter((s) => s.type === 'data-channel')
      .map((s) => ({ label: s.label, bytesSent: s.bytesSent, messagesSent: s.messagesSent, bytesReceived: s.bytesReceived, messagesReceived: s.messagesReceived })),
  };
}

/** A receipt must name its hardware, browser, build, topology and cohort, and carry no address or secret. */
export function receiptProblems(receipt) {
  const problems = [];
  for (const k of ['row', 'hardware', 'browser', 'build', 'topology', 'cohort', 'clock', 'result']) if (receipt[k] == null) problems.push(`missing ${k}`);
  const { browser: _browser, capturedAt: _at, ...rest } = receipt; // version strings look like addresses
  const text = JSON.stringify(rest);
  if (/\b\d{1,3}(\.\d{1,3}){3}\b/.test(text)) problems.push('contains an IPv4 address');
  if (/(credential|username|candidate:|a=ice-ufrag|Bearer )/i.test(text.replace(/"(credential|username)":\s*(null|false)/gi, ''))) problems.push('contains SDP or credential text');
  return problems;
}
