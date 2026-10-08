// P1-N08 harness logic (no browser): node --test tools/net/qualify.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iceRewriteScript, payloadVerdict, percentile, perSecond, receiptProblems, redactedStats, summariseAges } from './qualify-lib.mjs';

test('percentiles are nearest-rank and the summary counts what never arrived', () => {
  const ages = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(ages, 50), 50);
  assert.equal(percentile(ages, 95), 95);
  assert.equal(percentile(ages, 99), 99);
  assert.equal(percentile([], 50), null);
  const s = summariseAges([10, 20, 30, 40], 5, 3.14);
  assert.deepEqual([s.sent, s.seen, s.lost, s.p50Ms, s.maxMs, s.uncertaintyMs], [5, 4, 1, 20, 40, 3.1]);
});

test('payload budget: 60 Hz of changing input must stay at or under 2,000 B/s', () => {
  assert.equal(perSecond({ t: 0, bytes: 0 }, { t: 10_000, bytes: 15_000 }), 1500);
  assert.equal(payloadVerdict(1500), 'pass');
  assert.equal(payloadVerdict(2000), 'pass');
  assert.equal(payloadVerdict(2001), 'fail');
  assert.equal(payloadVerdict(null), 'fail');
});

test('the ICE rewrite script is valid JS and restricts to the TLS-443 entry', () => {
  const src = iceRewriteScript({ policy: 'relay', onlyUrlIncludes: ':443', dropStun: true });
  const log = [];
  const g = { RTCPeerConnection: class { constructor(c) { log.push(c); } static generateCertificate() {} } };
  new Function('window', src)(g);
  new g.RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ],
  });
  assert.equal(log[0].iceTransportPolicy, 'relay');
  assert.deepEqual(log[0].iceServers.map((s) => s.urls), [['turns:turn.cloudflare.com:443?transport=tcp']]);
  // The relay fallback hands its servers over with setConfiguration(): restricted the same way.
  const set = [];
  const g3 = { RTCPeerConnection: class { setConfiguration(c) { set.push(c); } } };
  new Function('window', src)(g3);
  new g3.RTCPeerConnection({}).setConfiguration({
    iceServers: [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'] }],
  });
  assert.deepEqual(set[0].iceServers.map((s) => s.urls), [['turns:turn.cloudflare.com:443?transport=tcp']]);
  assert.equal(set[0].iceTransportPolicy, 'relay');
  const lan = [];
  const g2 = { RTCPeerConnection: class { constructor(c) { lan.push(c); } } };
  new Function('window', iceRewriteScript({ rewriteTurn: '192.168.11.12:3479' }))(g2);
  new g2.RTCPeerConnection({ iceServers: [{ urls: 'turn:turn.dilger.dev:3479?transport=udp', username: 'u', credential: 'c' }] });
  assert.deepEqual(lan[0].iceServers[0].urls, ['turn:192.168.11.12:3479?transport=udp']);
});

test('stats are redacted to types, protocols and counters', () => {
  const r = redactedStats([
    { id: 't', type: 'transport', selectedCandidatePairId: 'p', bytesSent: 900, bytesReceived: 800, packetsSent: 9, dtlsState: 'connected' },
    { id: 'p', type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r', currentRoundTripTime: 0.0123 },
    { id: 'l', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls', ip: '203.0.113.7', url: 'turns:turn.cloudflare.com:443' },
    { id: 'r', type: 'remote-candidate', candidateType: 'host', ip: '192.168.1.5' },
    { id: 'd', type: 'data-channel', label: 'input', bytesSent: 500, messagesSent: 10 },
  ]);
  assert.equal(r.selectedPair.relayVia, 'cloudflare');
  assert.equal(r.selectedPair.rttMs, 12);
  assert.equal(r.dataChannels[0].bytesSent, 500);
  assert.ok(!JSON.stringify(r).includes('203.0.113.7') && !JSON.stringify(r).includes('192.168'));
});

test('a receipt must name its context and carry no address or secret', () => {
  const ok = { row: 'x', hardware: 'h', browser: 'chromium 141.0.7390.37', build: 'b', topology: 't', cohort: 'c', clock: {}, result: { kind: 'host' } };
  assert.deepEqual(receiptProblems(ok), []);
  assert.deepEqual(receiptProblems({ ...ok, build: undefined }), ['missing build']);
  assert.ok(receiptProblems({ ...ok, topology: 'via 192.168.11.12' }).includes('contains an IPv4 address'));
  assert.ok(receiptProblems({ ...ok, result: { credential: 'abc' } }).includes('contains SDP or credential text'));
});
