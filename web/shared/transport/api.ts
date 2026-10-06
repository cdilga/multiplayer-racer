// Server API v1 (plan §5.1; crates/jj-server/src/app.rs; bodies are jj_protocol::signal, camelCase JSON). Secrets
// never leave this browser except as `Authorization: Bearer`; the server only ever sees their SHA-256 hashes.
import { underBase } from '../src/base';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}
export interface RoomCreated {
  roomId: string;
  code: string;
  joinUrl: string;
  hostEndpointId: string;
  roomTicket: string;
  iceServers: IceServer[];
  iceExpiresAt: number;
}
export type RoomStatus = 'available' | 'host-unreachable' | 'ended' | 'not-found';
export interface RoomLookup {
  status: RoomStatus;
  roomId?: string;
  build?: string;
  realm?: string;
}
export type SignalKind = 'offer' | 'answer' | 'candidate' | 'restart' | 'bye';
export interface SignalMessage {
  from: string;
  to: string;
  kind: SignalKind;
  gen: number;
  payload: string;
}
export interface IceList {
  iceServers: IceServer[];
  expiresAt: number;
}

/** A non-2xx answer: `reason` from `{reason}`, `retryAfterMs` from a 429. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly retryAfterMs = 0,
  ) {
    super(`${status} ${reason}`);
  }
}

/** 128-bit random, base64url (plan §5.1). */
export function newSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return b64url(b);
}

export function newId(prefix: string): string {
  return `${prefix}-${[...crypto.getRandomValues(new Uint8Array(6))].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `base64url(SHA-256(secret))`, as `hostSecretHash`/`endpointSecretHash`. Needs a secure context (HTTPS or localhost). */
export async function secretHash(secret: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))));
}

async function call<T>(method: string, path: string, body?: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await fetch(underBase(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!r.ok) throw new ApiError(r.status, String(json.reason ?? r.statusText), Number(json.retryAfterMs ?? 0));
  return json as T;
}

export const api = {
  createRoom: (requestId: string, hostSecretHash: string) => call<RoomCreated>('POST', 'api/v1/rooms', { requestId, hostSecretHash }),
  reRegister: (code: string, roomId: string, hostSecretHash: string, roomTicket: string, hostSecret: string) =>
    call<{ code: string; roomTicket: string }>('PUT', `api/v1/rooms/${code}`, { roomId, hostSecretHash, roomTicket }, hostSecret),
  lookup: (code: string) => call<RoomLookup>('GET', `api/v1/rooms/${encodeURIComponent(code)}`),
  registerEndpoint: (roomId: string, endpointId: string, endpointSecretHash: string) =>
    call<{ iceServers: IceServer[]; iceExpiresAt: number }>('POST', `api/v1/rooms/${roomId}/endpoints`, {
      requestId: endpointId,
      endpointId,
      endpointSecretHash,
    }),
  signal: (roomId: string, msg: SignalMessage, secret: string) => call<unknown>('POST', `api/v1/rooms/${roomId}/signal`, msg, secret),
  ice: (roomId: string, endpointId: string, secret: string) => call<IceList>('POST', 'api/v1/ice', { roomId, endpointId }, secret),
  iceFallback: (roomId: string, endpointId: string, reason: string, secret: string) =>
    call<IceList>('POST', 'api/v1/ice/fallback', { roomId, endpointId, reason }, secret),
  end: (roomId: string, secret: string) => call<unknown>('POST', `api/v1/rooms/${roomId}/end`, undefined, secret),
};

/** Retries `fn` on 429 and on `404 unknown-room` (a server restart), backing off 0.5 s doubling to 5 s (plan §5.1). */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  onRetry?: (e: ApiError, waitMs: number) => void,
): Promise<T> {
  let wait = 500;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e instanceof ApiError && (e.status === 429 || (e.status === 404 && e.reason === 'unknown-room') || e.status >= 500);
      if (!retryable || signal?.aborted) throw e;
      const ms = Math.max(wait, (e as ApiError).retryAfterMs);
      onRetry?.(e as ApiError, ms);
      await sleep(ms, signal);
      wait = Math.min(wait * 2, 5_000);
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), {
      once: true,
    });
  });
}
