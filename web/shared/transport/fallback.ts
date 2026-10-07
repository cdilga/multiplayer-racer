// The Cloudflare TURN fallback trigger (P1-N04b, plan §5.3, R92). Cloudflare credentials can't be revoked once issued, so
// they are never in the initial ICE list: a peer connection asks for them (POST /ice/fallback) only in three cases, and
// at most once per peer connection:
//   1. ICE reaches `failed`;
//   2. candidate gathering finished with no coturn `relay` candidate and the connection isn't `connected` 3 s later;
//   3. the connection still isn't `connected` 8 s after the offer (TUNE).
// No imports and no DOM: the rules are tested with fake timers (`tests/fallback.test.mjs`).

export const NO_RELAY_GRACE_MS = 3_000;
export const OFFER_TIMEOUT_MS = 8_000;

export type FallbackReason = 'ice-failed' | 'no-relay-candidate' | 'offer-timeout';

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
}

export class FallbackTrigger {
  fired: FallbackReason | null = null;
  private connected = false;
  private hasRelay = false;
  private gatheredTimer: unknown;
  private offerTimer: unknown;
  private off = false;

  private readonly fire: (reason: FallbackReason) => void;
  private readonly timers: Timers;

  constructor(
    fire: (reason: FallbackReason) => void,
    timers: Timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  ) {
    this.fire = fire;
    this.timers = timers;
  }

  private go(reason: FallbackReason): void {
    if (this.fired || this.connected || this.off) return;
    this.fired = reason;
    this.stopTimers();
    this.fire(reason);
  }

  private stopTimers(): void {
    this.timers.clearTimeout(this.gatheredTimer);
    this.timers.clearTimeout(this.offerTimer);
    this.gatheredTimer = this.offerTimer = undefined;
  }

  /** The offer (controller) or answer (host) has been sent: rule 3's clock starts. */
  offerSent(): void {
    if (this.offerTimer !== undefined || this.fired || this.connected) return;
    this.offerTimer = this.timers.setTimeout(() => this.go('offer-timeout'), OFFER_TIMEOUT_MS);
  }

  /** A local candidate of this type (`host`, `srflx`, `prflx`, `relay`) was gathered. */
  candidate(type: string | undefined): void {
    if (type === 'relay') this.hasRelay = true;
  }

  /** Gathering finished (the null candidate / `iceGatheringState === 'complete'`): rule 2's clock starts if no relay. */
  gatheringDone(): void {
    if (this.hasRelay || this.gatheredTimer !== undefined || this.fired || this.connected) return;
    this.gatheredTimer = this.timers.setTimeout(() => this.go('no-relay-candidate'), NO_RELAY_GRACE_MS);
  }

  /** `iceConnectionState` / `connectionState` became `failed` (rule 1). */
  failed(): void {
    this.connected = false;
    this.go('ice-failed');
  }

  /** The link is healthy: nothing fires after this. */
  isConnected(): void {
    this.connected = true;
    this.stopTimers();
  }

  dispose(): void {
    this.off = true;
    this.stopTimers();
  }
}

/** Entries the fallback adds to an existing list (never duplicates a URL set already present). */
export function mergeServers<T extends { urls: string[] }>(base: T[], extra: T[]): T[] {
  const have = new Set(base.flatMap((s) => s.urls));
  return [...base, ...extra.map((s) => ({ ...s, urls: s.urls.filter((u) => !have.has(u)) })).filter((s) => s.urls.length)];
}
