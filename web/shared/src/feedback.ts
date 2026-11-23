// Player feedback (owner 2026-11-23, br-1s9h): "Send feedback" on the TV and on every phone, into the one inbox all of
// the owner's party games share (games-feedback.dilger.dev; its sheet is the same one the other games show). The sheet
// is the service's own script, loaded only when somebody asks to give feedback (or a phone asks this TV for its
// picture): until then no page talks to that host, so a room with no network beyond the LAN plays exactly as before.
// It is the owner's own service, listed in docs/deps/origins.json (R70 bars third-party hosts, not this one).
import { basePath } from './base';

export const FEEDBACK_ORIGIN = 'https://games-feedback.dilger.dev';
export const FEEDBACK_GAME = 'jammers';

/** How a phone's sheet reaches the TV for its picture (docs/FEEDBACK.md in the owner's local-multiplayer-games). */
export interface TvShot {
  snap(): Promise<boolean>;
  send(id: string, token: string): void;
  drop(): void;
}

/** `window.GamesFeedback`, as widget.js defines it (only what this game uses). */
export interface GamesFeedback {
  open(): Promise<boolean>;
  close(): void;
  setDetails(more: Record<string, string | null>): void;
  configure(next: { build?: string; version?: string; surface?: 'tv' | 'phone'; canvas?: string | null; tvShot?: TvShot | null }): void;
  capture(target?: string): Promise<Blob | null>;
  attach(id: string, token: string, blob: Blob, slot?: 'tv' | 'photo'): Promise<boolean>;
}

declare const __JJ_COMMIT__: string | undefined;

/** The build as the preview index names it: `v02-<commit8>` under `/p/<id>/`, else the commit. */
export function feedbackBuild(): string {
  const preview = /^\/p\/([a-z0-9][a-z0-9-]*)\/$/.exec(basePath())?.[1];
  const commit = typeof __JJ_COMMIT__ === 'string' ? __JJ_COMMIT__ : 'unknown';
  return preview ? `${preview} (${commit})` : commit;
}

// The page's last few script errors, kept from boot so feedback sent later can list them (the sheet's own list only
// starts when its script loads). Nothing is logged or sent until the player presses Send, and they see the list first.
const problems: string[] = [];
let watching = false;
export function watchProblems(): void {
  if (watching) return;
  watching = true;
  const note = (text: unknown) => {
    problems.push(`${new Date().toTimeString().slice(0, 8)} ${String(text ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
    if (problems.length > 8) problems.shift();
  };
  addEventListener('error', (e) => {
    if (e.message) note(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`);
  });
  addEventListener('unhandledrejection', (e) => note(`Unhandled: ${(e.reason as Error | null)?.message ?? e.reason ?? 'rejection'}`));
}
export const earlierProblems = (): string | null => (problems.length ? problems.join('\n') : null);

let loading: Promise<GamesFeedback | null> | null = null;

/**
 * The sheet, loading its script on first use. Null when the inbox can't be reached (offline, blocked): the caller says
 * so and the game carries on. A failed load is tried again on the next ask.
 */
export function loadFeedback(surface: 'tv' | 'phone', canvas?: string): Promise<GamesFeedback | null> {
  const ready = (window as unknown as { GamesFeedback?: GamesFeedback }).GamesFeedback;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GamesFeedback | null>((resolve) => {
    const s = document.createElement('script');
    const done = (ok: boolean) => {
      clearTimeout(timer);
      const api = ok ? ((window as unknown as { GamesFeedback?: GamesFeedback }).GamesFeedback ?? null) : null;
      if (!api) {
        s.remove();
        loading = null;
      }
      resolve(api);
    };
    const timer = setTimeout(() => done(false), 8000);
    s.src = `${FEEDBACK_ORIGIN}/widget.js`;
    s.async = true;
    s.dataset.game = FEEDBACK_GAME;
    s.dataset.surface = surface;
    s.dataset.button = 'off'; // each page has its own control, where it covers nothing
    s.dataset.build = feedbackBuild();
    if (canvas) s.dataset.canvas = canvas;
    s.onload = () => done(true);
    s.onerror = () => done(false);
    document.head.append(s);
  });
  return loading;
}

/** The notes a phone and its TV pass on the reliable channel as text frames (the sim never sees them). */
export type FeedbackNote =
  | { fb: 'snap'; n: number }
  | { fb: 'snapped'; n: number; ok: boolean }
  | { fb: 'send'; id: string; token: string }
  | { fb: 'drop' };

/** Reads a text frame as a feedback note; null for anything else, or anything out of shape. */
export function readNote(text: string): FeedbackNote | null {
  if (text.length > 2000) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const n = Number(m.n);
  if (m.fb === 'snap' && Number.isSafeInteger(n)) return { fb: 'snap', n };
  if (m.fb === 'snapped' && Number.isSafeInteger(n)) return { fb: 'snapped', n, ok: m.ok === true };
  if (m.fb === 'send' && typeof m.id === 'string' && /^[\w-]{1,80}$/.test(m.id) && typeof m.token === 'string' && m.token.length > 0 && m.token.length <= 1024) return { fb: 'send', id: m.id, token: m.token };
  if (m.fb === 'drop') return { fb: 'drop' };
  return null;
}
