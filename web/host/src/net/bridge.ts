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
          client.input({ type: 'net', endpoint: peer.endpointId, channel, bytes });
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

  open(): Promise<void> {
    return this.hub.open();
  }

  inspect(): Record<string, unknown> {
    return { ...this.hub.inspect(), bytesIn: this.bytesIn, bytesOut: this.bytesOut, undeliverable: this.undeliverable };
  }
}
