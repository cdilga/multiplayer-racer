// The controller's URL-fragment state opener (P1-C03, R90): `B/j/ABCD#state=no-such-room` renders that §11 screen with
// no network at all, so every state, its wording and its next action can be looked at, captured and driven in a test
// (the POC's frames.html did the same for the mock). It never starts the session: nothing connects, nothing claims.
//   #state=<phase>                      finding, no-such-room, room-ended, preview-expired, connecting, finding-relay,
//                                       no-route, ready-to-join, joining, playing, reconnecting, host-gone, host-paused,
//                                       another-tab, update-needed
//   &seat=<n>                           the seat number for playing/reconnecting (default 12)
//   &round=lobby|countdown|racing|results   the room phase shown while playing (default lobby)
//   &ready=1                            this seat is Ready
//   &name=<text>                        the player's name
import { seatColor } from '../../../shared/ui';
import type { Phase, Session } from './session';

const PHASES: Phase[] = ['finding', 'no-such-room', 'room-ended', 'preview-expired', 'connecting', 'finding-relay', 'no-route', 'ready-to-join', 'joining', 'playing', 'reconnecting', 'host-gone', 'host-paused', 'another-tab', 'update-needed'];

/** The requested state from the URL fragment, or null when there is none (the normal join path). */
export function fragmentState(hash: string = location.hash): URLSearchParams | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const s = p.get('state');
  return s && (PHASES as string[]).includes(s) ? p : null;
}

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Puts a session into the requested state without connecting it, then asks the view to draw it. */
export function applyState(session: Session, p: URLSearchParams): void {
  const phase = p.get('state') as Phase;
  const seat = Math.max(1, Number.parseInt(p.get('seat') ?? '12', 10) || 12);
  session.persisted = true;
  if (p.get('name')) session.name = p.get('name')!;
  session.phase = phase;
  if (phase === 'playing' || phase === 'reconnecting' || phase === 'host-paused') {
    const c = seatColor(seat);
    session.you = { seat, number: seat, rgb: hexToRgb(c.hex), source: 1 };
    const round = p.get('round') ?? 'lobby';
    session.roomPhase = ({ lobby: 'Lobby', countdown: 'Countdown', racing: 'Racing', results: 'Results' } as Record<string, string>)[round] ?? 'Lobby';
    session.isReady = p.get('ready') === '1';
    session.hud = { position: round === 'racing' ? 3 : null, lap: round === 'racing' ? [2, 3] : null, boost: Number.parseInt(p.get('boost') ?? '0', 10), pause: phase === 'host-paused' ? 'HostHidden' : null };
  }
  session.onChange();
}
