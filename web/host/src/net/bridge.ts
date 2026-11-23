// The host's network bridge (P1-G04): the room's WebRTC peers (N05) on one side, the sim worker (S02) on the other.
// Controller bytes go to the worker untouched as `net` input (it decodes Hello/Claim/StateBatch/Action itself); what
// the sim sends a controller (Welcome, RoomState, HUD) comes back as `outbound` and goes out on that peer's channel.
// The host never parses gameplay bytes here, and nothing counts or caps peers (R66).
import { HostHub, type TransportOptions } from '../../../shared/transport';
import type { SimClient } from '../worker/client';

export interface RoomInfo {
  code: string;
  joinUrl: string;
  roomId: string;
}

export class NetBridge {
  readonly hub: HostHub;
  bytesIn = 0;
  bytesOut = 0;
  /** Outbound messages for an endpoint whose channel isn't open (yet, or any more); dropped, counted. */
  undeliverable = 0;
  /** A controller page's text note (br-1s9h, feedback's "take the TV's picture"): never gameplay, never sent to the sim. */
  onText: (endpoint: string, text: string) => void = () => {};

  constructor(
    private readonly client: SimClient,
    onRoom: (room: RoomInfo) => void,
    opts: TransportOptions = {},
  ) {
    this.hub = new HostHub(
      {
        onRoom,
        onMessage: (peer, channel, data) => {
          const bytes = new Uint8Array(data);
          this.bytesIn += bytes.byteLength;
          client.input({ type: 'net', endpoint: peer.endpointId, channel, bytes, arrivedAt: performance.timeOrigin + performance.now() });
        },
        onText: (peer, text) => this.onText(peer.endpointId, text),
        // A closed or failed peer (not a passing `disconnected`, which ICE can recover): its seats read neutral at once
        // rather than holding the last sample through the sim's held-input window (br-f3rz).
        onPeerState: (peer, state) => {
          if (state === 'closed' || state === 'failed') client.input({ type: 'net-gone', endpoint: peer.endpointId });
        },
      },
      opts,
    );
    client.onOutbound = (endpoint, channel, bytes) => {
      const ch = this.hub.peers.get(endpoint)?.channels?.[channel];
      if (!ch || ch.readyState !== 'open') {
        this.undeliverable += 1;
        return;
      }
      this.bytesOut += bytes.byteLength;
      ch.send(bytes as Uint8Array<ArrayBuffer>);
    };
  }

  /** A text note to one controller page on its reliable channel; false when that channel isn't open. */
  sendText(endpoint: string, text: string): boolean {
    const ch = this.hub.peers.get(endpoint)?.channels?.cmd;
    if (!ch || ch.readyState !== 'open') return false;
    ch.send(text);
    return true;
  }

  open(): Promise<void> {
    return this.hub.open();
  }

  inspect(): Record<string, unknown> {
    return { ...this.hub.inspect(), bytesIn: this.bytesIn, bytesOut: this.bytesOut, undeliverable: this.undeliverable };
  }
}
