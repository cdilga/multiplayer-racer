// The signalling stream (plan §5.2): `fetch()` with a streamed body and our own SSE parser (not EventSource), so the
// bearer goes in a header. Comment heartbeats (every 15 s) only prove liveness; a dropped stream reconnects with
// `Last-Event-ID` and the server replays what it kept (60 s). One stream per browser endpoint.
import { underBase } from '../src/base';
import type { SignalMessage } from './api';
import { sleep } from './api';

export type StreamState = 'connecting' | 'open' | 'retrying' | 'closed';

export interface SignalStreamOptions {
  roomId: () => string;
  endpointId: string;
  secret: string;
  onMessage: (msg: SignalMessage) => void;
  /** The server doesn't know the room or endpoint (a restart dropped it): re-register, then the stream retries. */
  onUnknown: (reason: string) => Promise<void>;
  onState?: (s: StreamState) => void;
}

/** Parses SSE text incrementally; returns complete events and keeps the remainder. Comments are dropped. */
export function parseSse(buffer: string): {
  events: Array<{ id: number | null; data: string }>;
  rest: string;
} {
  const events: Array<{ id: number | null; data: string }> = [];
  const norm = buffer.replace(/\r\n?/g, '\n');
  let start = 0;
  let i: number;
  while ((i = norm.indexOf('\n\n', start)) >= 0) {
    const block = norm.slice(start, i);
    start = i + 2;
    let id: number | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':') || line === '') continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = Number(value);
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ id, data: data.join('\n') });
  }
  return { events, rest: norm.slice(start) };
}

export class SignalStream {
  state: StreamState = 'closed';
  lastEventId = 0;
  reconnects = 0;
  heartbeats = 0;
  private abort: AbortController | null = null;
  private running = false;

  constructor(private readonly o: SignalStreamOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
    this.set('closed');
  }

  /** Drops the current connection (tests: a proxy blip); the loop reconnects with Last-Event-ID. */
  drop(): void {
    this.abort?.abort();
  }

  private set(s: StreamState): void {
    if (this.state === s) return;
    this.state = s;
    this.o.onState?.(s);
  }

  private async loop(): Promise<void> {
    let wait = 500;
    while (this.running) {
      this.abort = new AbortController();
      this.set(this.reconnects === 0 && this.lastEventId === 0 ? 'connecting' : 'retrying');
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${this.o.secret}`,
        };
        if (this.lastEventId) headers['last-event-id'] = String(this.lastEventId);
        const url = underBase(`api/v1/rooms/${this.o.roomId()}/signal?endpoint=${encodeURIComponent(this.o.endpointId)}`);
        const r = await fetch(url, {
          headers,
          signal: this.abort.signal,
          cache: 'no-store',
        });
        if (r.status === 404 || r.status === 401) {
          const reason = String(((await r.json().catch(() => ({}))) as { reason?: string }).reason ?? r.status);
          await this.o.onUnknown(reason);
          continue;
        }
        if (!r.ok || !r.body) throw new Error(`signal stream ${r.status}`);
        this.set('open');
        wait = 500;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const text = dec.decode(value, { stream: true });
          if (text.startsWith(':')) this.heartbeats += 1;
          const { events, rest } = parseSse(buf + text);
          buf = rest;
          for (const e of events) {
            if (e.id !== null) this.lastEventId = e.id;
            try {
              this.o.onMessage(JSON.parse(e.data) as SignalMessage);
            } catch {
              // A malformed event never kills the stream.
            }
          }
        }
      } catch {
        // Aborted or the network dropped: reconnect below.
      }
      if (!this.running) break;
      this.reconnects += 1;
      this.set('retrying');
      await sleep(wait);
      wait = Math.min(wait * 2, 5_000);
    }
    this.set('closed');
  }
}
