// The connection badge (P1-C08): "Direct · 12 ms", "Relay · 48 ms" or "Reconnecting…", from the link's selected ICE path.
// The hub shows one per source row; the phone controller shows one in its strip. Text and a data attribute only.
import type { Session } from '../app/session';

export type PathLabel = { kind: 'direct' | 'relay' | 'reconnecting' | 'connecting'; text: string; rttMs: number | null };

/** The badge's reading for a session now. */
export async function pathLabel(session: Session): Promise<PathLabel> {
  const link = session.link;
  if (!link || session.phase === 'reconnecting' || session.phase === 'host-gone') return { kind: 'reconnecting', text: 'Reconnecting…', rttMs: null };
  const p = await link.path().catch(() => null);
  if (!p) return { kind: 'connecting', text: 'Connecting…', rttMs: null };
  const relay = p.kind === 'coturn-relay' || p.kind === 'cloudflare-relay' || p.kind === 'relay';
  const rtt = p.rttMs === null ? '' : ` · ${p.rttMs} ms`;
  return { kind: relay ? 'relay' : 'direct', text: `${relay ? 'Relay' : 'Direct'}${rtt}`, rttMs: p.rttMs };
}

/** Keeps `el` showing `session`'s path every `everyMs`; returns the stop function. */
export function watchBadge(session: Session, el: HTMLElement, everyMs = 2000): () => void {
  let stopped = false;
  const tick = async () => {
    const l = await pathLabel(session);
    if (stopped) return;
    el.textContent = l.text;
    el.dataset.path = l.kind;
  };
  void tick();
  const t = setInterval(() => void tick(), everyMs);
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
