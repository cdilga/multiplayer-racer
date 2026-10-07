// The connection badge (P1-C08): "Direct · 12 ms", "Relay · 48 ms" or "Reconnecting…", from the link's selected ICE path.
// The hub shows one per source row; the phone controller shows one in its strip. Text, a data attribute and the kit's
// chip classes (a brushed chip with an icon: colour is never the only cue).
import { icon } from '../../../shared/ui';
import type { Session } from '../app/session';
import './hub.css';

export type PathLabel = { kind: 'direct' | 'relay' | 'reconnecting' | 'connecting'; text: string; rttMs: number | null };

/** The badge's reading for a session now. */
export async function pathLabel(session: Session): Promise<PathLabel> {
  const link = session.link;
  // No link at all (the state opener, a page that never connected) has nothing to report.
  if (!link) return { kind: 'connecting', text: '', rttMs: null };
  if (session.phase === 'reconnecting' || session.phase === 'host-gone') return { kind: 'reconnecting', text: 'Reconnecting…', rttMs: null };
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
    el.hidden = l.text === '';
    el.dataset.path = l.kind;
    el.classList.add('chip');
    el.classList.toggle('chip-ready', l.kind === 'direct');
    // A relay path plays fine (R79), so it is information, not a warning; only reconnecting warns.
    el.classList.toggle('chip-info', l.kind === 'relay');
    el.classList.toggle('chip-warn', l.kind === 'reconnecting');
    el.classList.toggle('chip-choosing', l.kind === 'connecting');
    el.prepend(icon(l.kind === 'direct' ? 'wifi' : l.kind === 'relay' ? 'zap' : 'wifi-off'));
  };
  void tick();
  const t = setInterval(() => void tick(), everyMs);
  return () => {
    stopped = true;
    clearInterval(t);
  };
}
