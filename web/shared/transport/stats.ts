// The selected path (plan §5.3 diagnostics): which candidate types carry the link, over what, and the RTT. IPs are
// redacted: only types, protocols and the relay's provider are reported.

export type PathKind = 'host' | 'srflx' | 'prflx' | 'coturn-relay' | 'cloudflare-relay' | 'relay';

export interface PathStats {
  local: string;
  remote: string;
  /** The simplest description: the local side's kind (a relay names its provider). */
  kind: PathKind;
  protocol: string | null;
  relayProtocol: string | null;
  rttMs: number | null;
}

function relayKind(url: string | undefined): PathKind {
  if (!url) return 'relay';
  if (url.includes('cloudflare')) return 'cloudflare-relay';
  return 'coturn-relay';
}

export async function selectedPath(pc: RTCPeerConnection): Promise<PathStats | null> {
  const report = await pc.getStats();
  const byId = new Map<string, Record<string, unknown>>();
  report.forEach((s: Record<string, unknown>) => byId.set(String(s.id), s));
  let pair: Record<string, unknown> | undefined;
  for (const s of byId.values()) {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = byId.get(String(s.selectedCandidatePairId));
  }
  if (!pair) {
    for (const s of byId.values()) {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = s;
    }
  }
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId)) ?? {};
  const remote = byId.get(String(pair.remoteCandidateId)) ?? {};
  const localType = String(local.candidateType ?? 'unknown');
  const kind: PathKind = localType === 'relay' ? relayKind(local.url as string | undefined) : (localType as PathKind);
  const rtt = pair.currentRoundTripTime;
  return {
    local: localType,
    remote: String(remote.candidateType ?? 'unknown'),
    kind,
    protocol: (local.protocol as string) ?? null,
    relayProtocol: (local.relayProtocol as string) ?? null,
    rttMs: typeof rtt === 'number' ? Math.round(rtt * 1000) : null,
  };
}
