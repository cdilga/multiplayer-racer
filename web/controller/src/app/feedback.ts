// The phone's side of player feedback (br-1s9h; web/shared/src/feedback.ts): "Send feedback" in the settings sheet opens
// the shared sheet, and the picture that goes with it is the TV's, taken and uploaded by the TV (the phone only asks,
// with text notes on the reliable channel). The TV shows nothing while a phone sends.
import { earlierProblems, loadFeedback, readNote, watchProblems, type FeedbackNote, type TvShot } from '../../../shared/src/feedback';
import { selectedPath } from '../../../shared/transport/stats';
import type { ControllerPreferences } from './prefs-data';
import type { Session } from './session';

/** The TV loads the sheet's script on its first picture, so it gets longer than a frame to answer. */
const SNAP_WAIT_MS = 7000;

export interface PhoneFeedback {
  /** Opens the sheet; false when the feedback inbox can't be reached from this phone just now. */
  open(): Promise<boolean>;
}

export function mountPhoneFeedback(session: Session, prefs: () => ControllerPreferences): PhoneFeedback {
  watchProblems();
  let seq = 0;
  const waiting = new Map<number, (ok: boolean) => void>();
  const tell = (note: FeedbackNote) => session.sendText(JSON.stringify(note));
  session.onText = (text) => {
    const m = readNote(text);
    if (m?.fb !== 'snapped') return;
    waiting.get(m.n)?.(m.ok);
    waiting.delete(m.n);
  };
  const tvShot: TvShot = {
    snap: () =>
      new Promise<boolean>((resolve) => {
        const n = ++seq;
        if (!tell({ fb: 'snap', n })) return resolve(false);
        waiting.set(n, resolve);
        setTimeout(() => {
          if (waiting.delete(n)) resolve(false);
        }, SNAP_WAIT_MS);
      }),
    send: (id, token) => void tell({ fb: 'send', id, token }),
    drop: () => void tell({ fb: 'drop' }),
  };

  /** "direct (udp), 6 ms" or "coturn-relay (udp), 41 ms": how this phone reaches the TV, never an address. */
  const connection = async (): Promise<string> => {
    const link = session.link;
    if (!link?.pc || link.state !== 'connected') return link ? `not connected (${link.state})` : 'not connected';
    const p = await selectedPath(link.pc).catch(() => null);
    if (!p) return 'connected';
    const via = p.kind.endsWith('relay') ? `${p.kind}${p.relayProtocol ? ` (${p.relayProtocol})` : ''}` : `direct${p.protocol ? ` (${p.protocol})` : ''}`;
    return `${via}${p.rttMs === null ? '' : `, ${p.rttMs} ms`}`;
  };

  return {
    async open() {
      const fb = await loadFeedback('phone');
      if (!fb) return false;
      const p = prefs();
      // Without a link to the TV there is no TV picture to ask for: the sheet goes without one.
      fb.configure({ surface: 'phone', tvShot: session.link?.state === 'connected' ? tvShot : null });
      fb.setDetails({
        Room: session.code || null,
        Seat: session.you ? `#${session.you.number}` : null,
        Phase: session.roomPhase ?? session.phase,
        Connection: await connection(),
        Controls: `${p.controls}, ${p.layout} sticks${p.tilt ? ', tilt' : ''}`,
        'Server build': session.build,
        'Earlier problems': earlierProblems(),
      });
      await fb.open();
      return true;
    },
  };
}
