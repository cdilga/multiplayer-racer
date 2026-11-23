// The TV's side of player feedback (br-1s9h; web/shared/src/feedback.ts): the footer's quiet Feedback button opens the
// shared sheet with a picture of the world, and a phone that sends feedback gets this TV's picture with it. The TV is
// the main screen: nothing here pauses the round, and nothing shows on the TV when a phone sends.
import { earlierProblems, loadFeedback, readNote, type FeedbackNote, type GamesFeedback } from '../../shared/src/feedback';
import type { PathStats } from '../../shared/transport/stats';

/** The picture: the world, and the round-highlights reel when the results show it. Page elements are not in it. */
export const FEEDBACK_CANVAS = 'canvas.jj-world, .jj-reel canvas';
/** One picture per phone at a time, and no more often than this (a phone can't make the TV encode frames in a loop). */
const SNAP_EVERY_MS = 3000;
const HOLD_MS = 15 * 60_000;

export interface HostFeedbackOptions {
  /** The footer's button (round/chrome.ts). */
  button: HTMLButtonElement;
  /** A held or covered world draws again for a moment, so the picture is of a frame just drawn. */
  redraw(): void;
  /** What helps triage, label to value, read when the sheet opens. */
  details(): Record<string, string | null>;
  paths?: () => Promise<Record<string, PathStats | null>>;
  /** A text note to one controller page. */
  send(endpoint: string, text: string): boolean;
}

/** "3 direct, 1 coturn-relay (udp)": how the phones reach this TV, never an address. */
export function pathWords(paths: Record<string, PathStats | null>): string {
  const count = new Map<string, number>();
  for (const p of Object.values(paths)) {
    const word = !p ? 'not connected' : p.kind.endsWith('relay') ? `${p.kind}${p.relayProtocol ? ` (${p.relayProtocol})` : ''}` : 'direct';
    count.set(word, (count.get(word) ?? 0) + 1);
  }
  return [...count].map(([word, n]) => `${n} ${word}`).join(', ') || 'no phones';
}

export function mountHostFeedback(o: HostFeedbackOptions): { note(endpoint: string, text: string): void; forget(endpoint: string): void } {
  const held = new Map<string, { blob: Blob; at: number }>();
  const asked = new Map<string, number>();
  const label = o.button.textContent ?? 'Feedback';
  let opening = false;

  const sheet = async (): Promise<GamesFeedback | null> => {
    const fb = await loadFeedback('tv', FEEDBACK_CANVAS);
    if (!fb) return null;
    const paths = (await o.paths?.().catch(() => null)) ?? null;
    fb.setDetails({ ...o.details(), Phones: paths ? pathWords(paths) : null, 'Earlier problems': earlierProblems() });
    return fb;
  };

  o.button.hidden = false;
  o.button.addEventListener('click', () => {
    if (opening) return;
    opening = true;
    void sheet()
      .then(async (fb) => {
        if (fb) {
          o.redraw(); // the sheet takes its picture in the next frame, after the world has drawn it
          return void (await fb.open());
        }
        o.button.textContent = 'Feedback is offline';
        setTimeout(() => (o.button.textContent = label), 3000);
      })
      .finally(() => (opening = false));
  });
  // The same shortcut the sheet gives a page that uses its own corner control.
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      o.button.click();
    }
  });

  const snap = async (endpoint: string, n: number): Promise<void> => {
    const now = Date.now();
    let ok = false;
    if (now - (asked.get(endpoint) ?? 0) >= SNAP_EVERY_MS) {
      asked.set(endpoint, now);
      const fb = await loadFeedback('tv', FEEDBACK_CANVAS);
      o.redraw();
      const blob = (await fb?.capture(FEEDBACK_CANVAS).catch(() => null)) ?? null;
      for (const [ep, h] of held) if (now - h.at > HOLD_MS) held.delete(ep);
      if (blob) held.set(endpoint, { blob, at: now });
      else held.delete(endpoint);
      ok = blob !== null;
    }
    o.send(endpoint, JSON.stringify({ fb: 'snapped', n, ok } satisfies FeedbackNote));
  };

  return {
    note(endpoint, text) {
      const m = readNote(text);
      if (!m) return;
      if (m.fb === 'snap') void snap(endpoint, m.n);
      else if (m.fb === 'drop') held.delete(endpoint);
      else if (m.fb === 'send') {
        const h = held.get(endpoint);
        held.delete(endpoint);
        if (h) void loadFeedback('tv', FEEDBACK_CANVAS).then((fb) => fb?.attach(m.id, m.token, h.blob, 'tv'));
      }
    },
    forget(endpoint) {
      held.delete(endpoint);
      asked.delete(endpoint);
    },
  };
}
