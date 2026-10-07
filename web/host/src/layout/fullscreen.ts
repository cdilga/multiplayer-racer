// Full screen and screen wake lock for a phone host (P1-R08): both are requested from a user gesture (the host menu's
// button). iPhone Safari has no Fullscreen API for pages, so it gets the Add to Home Screen hint instead.
export interface FullscreenSupport {
  fullscreen: boolean;
  wakeLock: boolean;
  /** iOS without the Fullscreen API: show the Add to Home Screen hint. */
  addToHomeScreenHint: boolean;
}

export function fullscreenSupport(doc: Document = document, nav: Navigator = navigator): FullscreenSupport {
  const fullscreen = typeof doc.documentElement.requestFullscreen === 'function';
  return {
    fullscreen,
    wakeLock: 'wakeLock' in nav,
    addToHomeScreenHint: !fullscreen && /iPhone|iPad|iPod/.test(nav.userAgent),
  };
}

let lock: WakeLockSentinel | null = null;

/** Call from a click handler. Returns what was granted. */
export async function enterFullscreen(): Promise<{ fullscreen: boolean; wakeLock: boolean }> {
  const out = { fullscreen: false, wakeLock: false };
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    out.fullscreen = true;
  } catch {
    // Refused or unsupported.
  }
  try {
    lock = (await navigator.wakeLock?.request('screen')) ?? null;
    out.wakeLock = !!lock;
    // The browser drops the lock when the tab hides; take it again when it returns.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && lock?.released) lock = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
    });
  } catch {
    // No wake lock (or the page isn't visible).
  }
  return out;
}
