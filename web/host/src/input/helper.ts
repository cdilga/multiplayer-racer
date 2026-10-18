// The native input helper's client (P1-C12.1): a loopback WebSocket to `crates/jj-input-helper`, which reads every keyboard
// and pad on this computer by device. Its devices become local sources in `local.ts`, the same LocalSource path as the
// browser's own pads and key clusters.
// - Never probes on its own: it connects when the player asks (the drawer's Connect, after installing) or when this host
//   browser paired before (its token is kept), so a host without the helper never sees a local-network prompt.
// - Pairing: the helper shows a six-digit code; the drawer sends it once and keeps the token the helper answers with.
// - Protocol: crates/jj-input-helper/src/protocol.rs (fixture: crates/jj-input-helper/tests/fixtures/protocol.jsonl).
import cfg from './helper.json';
import { underBase } from '../../../shared/src/base';

export type HelperState = 'off' | 'connecting' | 'absent' | 'pairing' | 'paired';
export interface HelperDevice { id: number; kind: 'keyboard' | 'pad'; name: string; connected: boolean }
export interface HelperPad { axes: [number, number, number, number]; buttons: number }
export interface HelperDownload { os: string; label: string; href: string; mine: boolean; available: boolean }

const TOKEN_KEY = 'jj.inputHelperToken';
const get = (k: string): string | null => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const set = (k: string, v: string | null): void => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* This visit only. */ }
};

/** The visitor's OS for the Install link: the build that runs here first, the others listed after it. */
export function visitorOs(ua = navigator.userAgent): 'windows' | 'macos' | 'linux' {
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  return 'linux';
}

/** The builds this server has (`B/downloads/index.json`, written by the image build); null until fetched. */
let built: Set<string> | null = null;
export async function loadDownloads(): Promise<void> {
  try {
    const r = await fetch(underBase('downloads/index.json'), { cache: 'no-cache' });
    built = new Set(r.ok ? ((await r.json()) as { files?: string[] }).files ?? [] : []);
  } catch {
    built = new Set();
  }
}

export function downloads(ua?: string): HelperDownload[] {
  const mine = visitorOs(ua);
  return Object.entries(cfg.downloads)
    .map(([os, d]) => ({ os, label: d.label, href: underBase(`downloads/${d.file}`), mine: os === mine, available: built?.has(d.file) ?? false }))
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}

export class HelperClient {
  state: HelperState = 'off';
  /** Why the last pairing failed, for the drawer. */
  error = '';
  os = '';
  private devs = new Map<number, HelperDevice>();
  private keys = new Map<number, Set<string>>();
  private pads = new Map<number, HelperPad>();
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly url: string;
  /** Called on every change (the drawer re-renders; local.ts reads the new state on its next poll). */
  onChange: () => void = () => {};
  /** A keyboard's held keys changed (local.ts delivers a Lobby Ready press from it at once). */
  onKeys: (id: number, down: Set<string>, before: Set<string>) => void = () => {};

  constructor(port = cfg.port) {
    this.url = `ws://127.0.0.1:${port}/`;
    // Paired before on this browser: reconnect quietly (the helper may not be running yet).
    if (get(TOKEN_KEY)) this.connect();
  }

  /** Connect now (the drawer's Connect, or Pair before a connection exists). Keeps retrying until stopped. */
  connect(): void {
    if (this.ws) return;
    clearTimeout(this.retry);
    if (this.state === 'off') this.state = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.lost();
      return;
    }
    this.ws = ws;
    ws.onmessage = (e) => this.message(String(e.data));
    ws.onclose = () => this.lost();
  }

  /** Stop using the helper on this browser: forget the pairing; the browser's own keys and pads take over again. */
  disconnect(): void {
    set(TOKEN_KEY, null);
    clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.clear();
    this.state = 'off';
    this.onChange();
  }

  pair(code: string): void {
    this.error = '';
    this.ws?.send(JSON.stringify({ t: 'pair', code: code.trim() }));
  }

  /** Paired and reading devices. */
  capturing(): boolean {
    return this.state === 'paired';
  }

  devices(): HelperDevice[] {
    return [...this.devs.values()];
  }

  /** Whether the helper has any connected keyboard (pad): then the browser's own keys (pads) stand down. */
  owns(kind: HelperDevice['kind']): boolean {
    return this.capturing() && this.devices().some((d) => d.kind === kind && d.connected);
  }

  heldKeys(id: number): Set<string> {
    return this.keys.get(id) ?? new Set();
  }

  pad(id: number): HelperPad | undefined {
    return this.pads.get(id);
  }

  private clear(): void {
    this.devs.clear();
    this.keys.clear();
    this.pads.clear();
  }

  private lost(): void {
    this.ws = null;
    this.clear();
    if (this.state === 'off') return;
    // Keep looking while the drawer asked for it or a pairing exists: the player may start the helper later.
    this.state = 'absent';
    this.onChange();
    this.retry = setTimeout(() => this.connect(), cfg.retryMs);
  }

  private message(text: string): void {
    let m: { t: string; [k: string]: unknown };
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'hello') {
      this.os = String(m.os ?? '');
      const token = get(TOKEN_KEY);
      this.state = 'pairing';
      if (token) this.ws?.send(JSON.stringify({ t: 'pair', token }));
    } else if (m.t === 'paired') {
      set(TOKEN_KEY, String(m.token));
      this.state = 'paired';
      this.error = '';
    } else if (m.t === 'unpaired') {
      // A stale token (the helper's pairings were cleared) asks for the code again.
      if (get(TOKEN_KEY) && this.state !== 'paired') set(TOKEN_KEY, null);
      this.error = String(m.reason ?? 'refused');
      this.state = 'pairing';
    } else if (m.t === 'devices') {
      this.devs = new Map((m.devices as HelperDevice[]).map((d) => [d.id, d]));
      for (const d of this.devs.values()) {
        if (!d.connected) {
          this.keys.delete(d.id);
          this.pads.delete(d.id);
        }
      }
    } else if (m.t === 'keys') {
      const id = Number(m.id);
      const before = this.heldKeys(id);
      const down = new Set(m.down as string[]);
      this.keys.set(id, down);
      this.onKeys(id, down, before);
      return;
    } else if (m.t === 'pad') {
      this.pads.set(Number(m.id), { axes: m.axes as HelperPad['axes'], buttons: Number(m.buttons) });
      return;
    }
    this.onChange();
  }
}

export const helperSourceBase = cfg.sourceBase;
