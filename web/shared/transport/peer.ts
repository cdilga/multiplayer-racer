// WebRTC between the host and controllers (plan §5.3). The controller offers; both sides pre-negotiate two data
// channels (id 0 `state`: unordered, no retransmits; id 1 `cmd`: reliable, ordered). Every offer, answer and
// candidate carries the negotiation generation `gen`; the host fences older generations. Recovery on the controller:
// 3 s `disconnected` (or a page resume) → `restartIce()` with a new offer at gen + 1; still not connected 5 s later →
// a new peer connection at gen + 1. The server never sees gameplay (R77); nothing here caps peers (R66).
import { api, type IceServer, newId, newSecret, secretHash, type SignalMessage, withBackoff } from './api';
import { SignalStream, type StreamState } from './sse';
import { type PathStats, selectedPath } from './stats';

export const HOST = 'host';
export const RESTART_AFTER_MS = 3_000;
export const REBUILD_AFTER_MS = 5_000;
/** Refresh ICE credentials at this share of their lifetime. */
export const REFRESH_AT = 0.75;

export type LinkState = 'idle' | 'joining' | 'connecting' | 'connected' | 'restarting' | 'rebuilding' | 'ended' | 'failed';

export interface Channels {
  state: RTCDataChannel;
  cmd: RTCDataChannel;
}

export interface TransportOptions {
  /** Test-only: force TURN (`relay`) to prove the relay path. */
  iceTransportPolicy?: RTCIceTransportPolicy;
}

function openChannels(pc: RTCPeerConnection): Channels {
  const state = pc.createDataChannel('state', {
    negotiated: true,
    id: 0,
    ordered: false,
    maxRetransmits: 0,
  });
  const cmd = pc.createDataChannel('cmd', {
    negotiated: true,
    id: 1,
    ordered: true,
  });
  state.binaryType = 'arraybuffer';
  cmd.binaryType = 'arraybuffer';
  return { state, cmd };
}

function scheduleRefresh(expiresAt: number, refresh: () => void): ReturnType<typeof setTimeout> {
  const left = Math.max(5_000, (expiresAt - Date.now()) * REFRESH_AT);
  return setTimeout(refresh, Math.min(left, 2 ** 31 - 1));
}

// ---------------------------------------------------------------- controller

export interface ControllerEvents {
  onState?: (s: LinkState) => void;
  onOpen?: (ch: Channels) => void;
  onMessage?: (channel: 'state' | 'cmd', data: ArrayBuffer) => void;
}

/** One controller endpoint's link to the host. */
export class ControllerLink {
  state: LinkState = 'idle';
  /** Seeded from the clock (tenths of a second since 2023-11), so a reloaded page with the same endpoint is always a
   *  newer generation than anything its last life sent; each negotiation adds one. Fits u32 until the 2030s. */
  gen = Math.floor((Date.now() - 1_700_000_000_000) / 100);
  roomId = '';
  code = '';
  readonly endpointId: string;
  /** The endpoint secret: the bearer for signalling, and `Hello{resume}` to get the same seat back. */
  readonly secret: string;
  private iceServers: IceServer[] = [];
  private iceExpiresAt = 0;
  pc: RTCPeerConnection | null = null;
  channels: Channels | null = null;
  stream: SignalStream | null = null;
  registrations = 0;
  restarts = 0;
  rebuilds = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private ended = false;
  private signals: Promise<void> = Promise.resolve();
  private early: RTCIceCandidateInit[] = [];

  /** Signals apply one at a time, in order: a candidate must never race ahead of its description. */
  private enqueue(m: SignalMessage): void {
    this.signals = this.signals.then(() => this.onSignal(m)).catch(() => undefined);
  }

  constructor(
    private readonly events: ControllerEvents = {},
    private readonly opts: TransportOptions = {},
    identity?: { endpointId: string; secret: string },
  ) {
    this.endpointId = identity?.endpointId ?? newId('c');
    this.secret = identity?.secret ?? newSecret();
  }

  private set(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.events.onState?.(s);
  }

  /** Resolves the code, registers this endpoint, opens the stream and offers at once. */
  async join(code: string): Promise<void> {
    this.set('joining');
    this.code = code.toUpperCase();
    const found = await api.lookup(this.code);
    if (found.status === 'ended') throw new Error('room-ended');
    if (found.status === 'not-found' || !found.roomId) throw new Error('room-not-found');
    this.roomId = found.roomId;
    await this.register();
    this.stream = new SignalStream({
      roomId: () => this.roomId,
      endpointId: this.endpointId,
      secret: this.secret,
      onMessage: (m) => this.enqueue(m),
      onUnknown: async (reason) => {
        if (reason === 'unknown-room' || reason === 'unknown-endpoint') await this.register();
        else throw new Error(reason);
      },
    });
    this.stream.start();
    await this.build();
  }

  /** (Re-)registers the endpoint with backoff (a restarted server forgot it); same id and secret every time. */
  private async register(): Promise<void> {
    const hash = await secretHash(this.secret);
    const reg = await withBackoff(() => api.registerEndpoint(this.roomId, this.endpointId, hash));
    this.registrations += 1;
    this.iceServers = reg.iceServers;
    this.iceExpiresAt = reg.iceExpiresAt;
    this.pc?.setConfiguration({
      ...this.pc.getConfiguration(),
      iceServers: this.iceServers,
    });
    clearTimeout(this.refreshTimer);
    this.refreshTimer = scheduleRefresh(this.iceExpiresAt, () => void this.refreshIce());
  }

  /** Fresh credentials through `/ice` and `setConfiguration()`; the data channels stay up. */
  async refreshIce(): Promise<void> {
    try {
      const list = await api.ice(this.roomId, this.endpointId, this.secret);
      this.iceServers = list.iceServers;
      this.iceExpiresAt = list.expiresAt;
      this.pc?.setConfiguration({
        ...this.pc.getConfiguration(),
        iceServers: this.iceServers,
      });
    } catch {
      // Keep the old list; try again shortly.
      this.iceExpiresAt = Date.now() + 20_000;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = scheduleRefresh(this.iceExpiresAt, () => void this.refreshIce());
  }

  private send(kind: SignalMessage['kind'], payload: string): Promise<unknown> {
    const msg: SignalMessage = {
      from: this.endpointId,
      to: HOST,
      kind,
      gen: this.gen,
      payload,
    };
    return withBackoff(() => api.signal(this.roomId, msg, this.secret)).catch(() => undefined);
  }

  /** A new peer connection at gen + 1 (first connect, or the rebuild step of recovery). */
  private async build(): Promise<void> {
    this.pc?.close();
    this.gen += 1;
    this.early = [];
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.opts.iceTransportPolicy ?? 'all',
    });
    this.pc = pc;
    this.channels = openChannels(pc);
    for (const name of ['state', 'cmd'] as const) {
      const ch = this.channels[name];
      ch.onmessage = (e) => this.events.onMessage?.(name, e.data as ArrayBuffer);
    }
    const channels = this.channels;
    channels.cmd.onopen = () => {
      if (this.pc !== pc) return;
      this.watch(pc);
      this.events.onOpen?.(channels);
    };
    // The host closing its side (or the SCTP association dying) closes the channel: recover at once.
    channels.cmd.onclose = () => this.watch(pc);
    pc.onicecandidate = (e) => {
      if (e.candidate && this.pc === pc) void this.send('candidate', JSON.stringify(e.candidate.toJSON()));
    };
    pc.onconnectionstatechange = () => this.watch(pc);
    this.set('connecting');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.send('offer', pc.localDescription!.sdp);
  }

  /** Connected means ICE/DTLS up and the reliable channel open. */
  private healthy(pc: RTCPeerConnection): boolean {
    return pc.connectionState === 'connected' && this.channels?.cmd.readyState === 'open';
  }

  /** Dead means nothing on this connection can come back: rebuild rather than restart ICE. */
  private dead(pc: RTCPeerConnection): boolean {
    return pc.connectionState === 'closed' || pc.signalingState === 'closed' || this.channels?.cmd.readyState === 'closed';
  }

  private watch(pc: RTCPeerConnection): void {
    if (pc !== this.pc || this.ended) return;
    const s = pc.connectionState;
    if (this.healthy(pc)) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = undefined;
      this.set('connected');
    } else if (this.dead(pc) || s === 'failed') {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => void this.recover(), 0);
    } else if (s === 'disconnected' && this.recoveryTimer === undefined) {
      this.recoveryTimer = setTimeout(() => void this.recover(), RESTART_AFTER_MS);
    }
  }

  private rebuild(): void {
    this.recoveryTimer = undefined;
    this.rebuilds += 1;
    this.set('rebuilding');
    void this.build();
  }

  /** Step 1: ICE restart on the same connection (gen + 1); step 2 after 5 s more: a new connection (gen + 1). */
  async recover(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.ended) return;
    if (this.healthy(pc)) return void (this.recoveryTimer = undefined);
    // A closed connection or channel can't be restarted: straight to a new connection.
    if (this.dead(pc)) return this.rebuild();
    this.restarts += 1;
    this.set('restarting');
    this.gen += 1;
    this.early = [];
    try {
      pc.restartIce();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await this.send('restart', pc.localDescription!.sdp);
    } catch {
      // Fall through to the rebuild.
    }
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      if (this.pc === pc && !this.healthy(pc) && !this.ended) this.rebuild();
    }, REBUILD_AFTER_MS);
  }

  /** Test hook: a signalling message at an arbitrary generation (stale-generation fencing). */
  debugSignal(kind: SignalMessage['kind'], gen: number, payload: string): Promise<unknown> {
    const msg: SignalMessage = { from: this.endpointId, to: HOST, kind, gen, payload };
    return api.signal(this.roomId, msg, this.secret);
  }

  /** Page resume: check the link and recover straight away if it isn't connected. */
  resume(): void {
    if (this.pc && !this.healthy(this.pc) && this.recoveryTimer === undefined) void this.recover();
  }

  private async onSignal(m: SignalMessage): Promise<void> {
    const pc = this.pc;
    if (!pc || m.from !== HOST) return;
    if (m.kind === 'bye') {
      this.end();
      return;
    }
    if (m.gen !== this.gen) return; // a late message for an old negotiation
    if (m.kind === 'answer') {
      if (pc.signalingState === 'have-local-offer')
        await pc.setRemoteDescription({ type: 'answer', sdp: m.payload }).catch(() => undefined);
      // Candidates that beat the answer here (separate POSTs) apply now.
      for (const c of this.early.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
    } else if (m.kind === 'candidate') {
      const c = JSON.parse(m.payload) as RTCIceCandidateInit;
      if (!pc.remoteDescription || pc.signalingState === 'have-local-offer') this.early.push(c);
      else await pc.addIceCandidate(c).catch(() => undefined);
    }
  }

  end(): void {
    this.ended = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.recoveryTimer);
    this.stream?.stop();
    this.pc?.close();
    this.set('ended');
  }

  async path(): Promise<PathStats | null> {
    return this.pc ? selectedPath(this.pc) : null;
  }

  /** Diagnostics (R90): no secrets. */
  inspect(): Record<string, unknown> {
    return {
      state: this.state,
      gen: this.gen,
      endpointId: this.endpointId,
      roomId: this.roomId,
      code: this.code,
      pc: this.pc?.connectionState ?? null,
      ice: this.pc?.iceConnectionState ?? null,
      signaling: this.pc?.signalingState ?? null,
      early: this.early.length,
      sse: this.stream?.state ?? 'closed',
      sseReconnects: this.stream?.reconnects ?? 0,
      registrations: this.registrations,
      restarts: this.restarts,
      rebuilds: this.rebuilds,
      iceExpiresAt: this.iceExpiresAt,
      channels: this.channels
        ? {
            state: this.channels.state.readyState,
            cmd: this.channels.cmd.readyState,
          }
        : null,
    };
  }
}

// ---------------------------------------------------------------- host

export interface HostPeer {
  endpointId: string;
  gen: number;
  pc: RTCPeerConnection;
  channels: Channels;
  /** Candidates that arrived for a generation we haven't seen the offer for yet. */
  pending: Map<number, RTCIceCandidateInit[]>;
  staleIgnored: number;
}

export interface HostEvents {
  onPeerOpen?: (peer: HostPeer) => void;
  onPeerState?: (peer: HostPeer, state: RTCPeerConnectionState) => void;
  onMessage?: (peer: HostPeer, channel: 'state' | 'cmd', data: ArrayBuffer) => void;
  onRoom?: (room: { code: string; joinUrl: string; roomId: string }) => void;
  onStreamState?: (s: StreamState) => void;
}

const HOST_KEY = 'jj.host.room';

/** The host's side: one room, one signalling stream, one peer connection per controller endpoint. */
export class HostHub {
  roomId = '';
  code = '';
  joinUrl = '';
  private ticket = '';
  private secret = '';
  private hash = '';
  private iceServers: IceServer[] = [];
  readonly peers = new Map<string, HostPeer>();
  stream: SignalStream | null = null;
  reRegistrations = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private signals: Promise<void> = Promise.resolve();

  /** Signals apply one at a time, in order: a candidate must never race ahead of its description. */
  private enqueue(m: SignalMessage): void {
    this.signals = this.signals.then(() => this.onSignal(m)).catch(() => undefined);
  }

  constructor(
    private readonly events: HostEvents = {},
    private readonly opts: TransportOptions = {},
  ) {}

  /** Creates the room (a retry with the same request id returns the same room) and opens the stream. */
  async open(): Promise<void> {
    this.secret = newSecret();
    this.hash = await secretHash(this.secret);
    const requestId = newId('r');
    const room = await withBackoff(() => api.createRoom(requestId, this.hash));
    this.roomId = room.roomId;
    this.code = room.code;
    this.joinUrl = room.joinUrl;
    this.ticket = room.roomTicket;
    this.iceServers = room.iceServers;
    this.remember();
    this.events.onRoom?.({
      code: this.code,
      joinUrl: this.joinUrl,
      roomId: this.roomId,
    });
    this.refreshTimer = scheduleRefresh(room.iceExpiresAt, () => void this.refreshIce());
    this.stream = new SignalStream({
      roomId: () => this.roomId,
      endpointId: HOST,
      secret: this.secret,
      onMessage: (m) => this.enqueue(m),
      onUnknown: (reason) => this.reRegister(reason),
      onState: (s) => this.events.onStreamState?.(s),
    });
    this.stream.start();
  }

  private remember(): void {
    try {
      sessionStorage.setItem(HOST_KEY, JSON.stringify({ roomId: this.roomId, code: this.code }));
    } catch {
      // Private mode: nothing to keep.
    }
  }

  /** After a server restart (`404 unknown-room`): `PUT` with the ticket; the code survives unless it was taken. */
  private async reRegister(reason: string): Promise<void> {
    if (reason !== 'unknown-room') throw new Error(reason);
    const r = await withBackoff(() => api.reRegister(this.code, this.roomId, this.hash, this.ticket, this.secret));
    this.reRegistrations += 1;
    if (r.code !== this.code) {
      this.code = r.code;
      this.joinUrl = this.joinUrl.replace(/\/j\/[A-Z0-9]+$/, `/j/${r.code}`);
      this.events.onRoom?.({
        code: this.code,
        joinUrl: this.joinUrl,
        roomId: this.roomId,
      });
    }
    this.ticket = r.roomTicket;
    this.remember();
  }

  async refreshIce(): Promise<void> {
    let expiresAt = Date.now() + 20_000;
    try {
      const list = await api.ice(this.roomId, HOST, this.secret);
      this.iceServers = list.iceServers;
      expiresAt = list.expiresAt;
      for (const p of this.peers.values())
        p.pc.setConfiguration({
          ...p.pc.getConfiguration(),
          iceServers: this.iceServers,
        });
    } catch {
      // Retry soon.
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = scheduleRefresh(expiresAt, () => void this.refreshIce());
  }

  private send(to: string, kind: SignalMessage['kind'], gen: number, payload: string): Promise<unknown> {
    return withBackoff(() => api.signal(this.roomId, { from: HOST, to, kind, gen, payload }, this.secret)).catch(() => undefined);
  }

  private newPeer(endpointId: string, gen: number): HostPeer {
    this.peers.get(endpointId)?.pc.close();
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.opts.iceTransportPolicy ?? 'all',
    });
    const peer: HostPeer = {
      endpointId,
      gen,
      pc,
      channels: openChannels(pc),
      pending: new Map(),
      staleIgnored: 0,
    };
    for (const name of ['state', 'cmd'] as const) {
      peer.channels[name].onmessage = (e) => this.events.onMessage?.(peer, name, e.data as ArrayBuffer);
    }
    peer.channels.cmd.onopen = () => this.events.onPeerOpen?.(peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.send(endpointId, 'candidate', peer.gen, JSON.stringify(e.candidate.toJSON()));
    };
    pc.onconnectionstatechange = () => this.events.onPeerState?.(peer, pc.connectionState);
    this.peers.set(endpointId, peer);
    return peer;
  }

  private async onSignal(m: SignalMessage): Promise<void> {
    const ep = m.from;
    if (ep === HOST) return;
    let peer = this.peers.get(ep);
    if (m.kind === 'bye') {
      peer?.pc.close();
      this.peers.delete(ep);
      return;
    }
    if (peer && m.gen < peer.gen) {
      peer.staleIgnored += 1; // fenced: an older negotiation
      return;
    }
    if (m.kind === 'candidate') {
      if (!peer || m.gen > peer.gen) {
        // The offer for this generation hasn't arrived yet: hold the candidate.
        const target = peer ?? this.newPendingHolder(ep);
        const list = target.pending.get(m.gen) ?? [];
        list.push(JSON.parse(m.payload) as RTCIceCandidateInit);
        target.pending.set(m.gen, list);
        return;
      }
      await peer.pc.addIceCandidate(JSON.parse(m.payload) as RTCIceCandidateInit).catch(() => undefined);
      return;
    }
    if (m.kind === 'offer' || m.kind === 'restart') {
      const held = peer?.pending ?? new Map<number, RTCIceCandidateInit[]>();
      if (!peer || m.kind === 'offer' || peer.pc.connectionState === 'closed') {
        // A new connection (first contact or the controller's rebuild).
        peer = this.newPeer(ep, m.gen);
      }
      peer.gen = m.gen;
      peer.pending = held;
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: m.payload });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await this.send(ep, 'answer', m.gen, peer.pc.localDescription!.sdp);
      for (const [g, list] of held) {
        if (g === m.gen) for (const c of list) await peer.pc.addIceCandidate(c).catch(() => undefined);
        if (g <= m.gen) held.delete(g);
      }
    }
  }

  /** A placeholder entry so early candidates have somewhere to wait (replaced when the offer lands). */
  private newPendingHolder(ep: string): HostPeer {
    const existing = this.peers.get(ep);
    if (existing) return existing;
    const pc = new RTCPeerConnection();
    pc.close();
    const holder = {
      endpointId: ep,
      gen: 0,
      pc,
      channels: null as unknown as Channels,
      pending: new Map(),
      staleIgnored: 0,
    } as HostPeer;
    this.peers.set(ep, holder);
    return holder;
  }

  /** Test hook: closes one controller's connection from the host side, as a network loss would. */
  dropPeer(endpointId: string): void {
    this.peers.get(endpointId)?.pc.close();
  }

  /** Ends the room for everyone (Disband): a `bye` to each controller, then `POST end`. */
  async end(): Promise<void> {
    await Promise.all([...this.peers.keys()].map((ep) => this.send(ep, 'bye', this.peers.get(ep)!.gen, '')));
    await api.end(this.roomId, this.secret).catch(() => undefined);
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.stream?.stop();
    clearTimeout(this.refreshTimer);
  }

  async paths(): Promise<Record<string, PathStats | null>> {
    const out: Record<string, PathStats | null> = {};
    for (const [ep, p] of this.peers) out[ep] = p.channels ? await selectedPath(p.pc) : null;
    return out;
  }

  inspect(): Record<string, unknown> {
    return {
      roomId: this.roomId,
      code: this.code,
      sse: this.stream?.state ?? 'closed',
      sseReconnects: this.stream?.reconnects ?? 0,
      reRegistrations: this.reRegistrations,
      peers: [...this.peers.values()]
        .filter((p) => p.channels)
        .map((p) => ({
          endpointId: p.endpointId,
          gen: p.gen,
          pc: p.pc.connectionState,
          staleIgnored: p.staleIgnored,
          channels: {
            state: p.channels.state.readyState,
            cmd: p.channels.cmd.readyState,
          },
        })),
    };
  }
}
