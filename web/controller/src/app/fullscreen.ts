// Full screen on the phone controller (P1-C02b): one control that enters and leaves it, its state read from
// `fullscreenchange` (so an exit by a system gesture, a swipe or a rotation shows), and whether a lost full screen was the
// player's own choice. iPhone Safari has no Fullscreen API for pages (and a page opened from the Home Screen is already
// full screen): there the control explains Add to Home Screen instead of pretending to toggle.

import './fullscreen.css';

type Doc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type El = HTMLElement & { webkitRequestFullscreen?: (o?: FullscreenOptions) => Promise<void> | void };

export type FullscreenMode = 'api' | 'home-screen' | 'standalone';

export const A2HS_TEXT = 'This browser can’t go full screen from a page. For full screen: Share, then Add to Home Screen, and open the room from there.';

export class FullscreenControl {
  /** 'api': the toggle works; 'home-screen': no API, explain Add to Home Screen; 'standalone': opened from the Home Screen, already full screen. */
  readonly mode: FullscreenMode;
  /** Full screen was lost without the player asking (system gesture, rotation, the browser's own control). */
  lostUnasked = false;
  private asked = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly doc: Doc = document as Doc,
    win: Window = window,
  ) {
    const el = doc.documentElement as El;
    const standalone = win.matchMedia?.('(display-mode: standalone)').matches || (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? true;
    const api = enabled !== false && (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function');
    this.mode = standalone ? 'standalone' : api ? 'api' : 'home-screen';
    const changed = () => {
      // Leaving full screen without the player's tap is "lost"; going back in (by any route) clears it.
      if (!this.active) {
        this.lostUnasked = !this.asked;
      } else this.lostUnasked = false;
      this.asked = false;
      for (const f of this.listeners) f();
    };
    doc.addEventListener('fullscreenchange', changed);
    doc.addEventListener('webkitfullscreenchange', changed);
  }

  get active(): boolean {
    return !!(this.doc.fullscreenElement ?? this.doc.webkitFullscreenElement);
  }

  /** Called on every change of state (enter, exit by any route). Returns the unsubscribe. */
  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** From a tap (the browser needs the user gesture). */
  async enter(): Promise<boolean> {
    if (this.mode !== 'api' || this.active) return this.active;
    const el = this.doc.documentElement as El;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else await el.webkitRequestFullscreen?.();
    } catch {
      return false;
    }
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      // Only some phones lock orientation, and only in full screen.
    }
    return this.active;
  }

  /** The player's own exit: no "Back to full screen" prompt follows it. */
  async exit(): Promise<void> {
    if (!this.active) return;
    this.asked = true;
    try {
      if (this.doc.exitFullscreen) await this.doc.exitFullscreen();
      else await this.doc.webkitExitFullscreen?.();
    } catch {
      this.asked = false;
    }
  }

  toggle(): Promise<unknown> {
    return this.active ? this.exit() : this.enter();
  }

  /** The prompt was dismissed (or the race ended): forget the loss. */
  dismiss(): void {
    if (!this.lostUnasked) return;
    this.lostUnasked = false;
    for (const f of this.listeners) f();
  }
}
