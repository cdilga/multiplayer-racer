// The in-page QR scanner (P1-C04): the landing page's "Scan QR code". It opens the camera only when asked (video only),
// decodes on the phone with the native `BarcodeDetector` when there is one, else the bundled `jsqr` (pure JS, fetches
// nothing: R70), and accepts only a room URL for THIS realm (same origin, same base path: the preview id or production)
// or a bare room code. Anything else is turned away with a word and scanning goes on. Every camera track is stopped on
// success, cancel, the page going to the background and the page going away. A denied or missing camera hands back to
// code entry. The page's own code field is never touched: Cancel / "Enter the code instead" keep what was typed.
import { basePath } from '../../../shared/src/base';
import { checkCode } from '../../../landing/src/code';

export type ScanResult = { kind: 'code'; code: string } | { kind: 'cancelled' } | { kind: 'no-camera'; reason: 'denied' | 'missing' | 'failed' };

/** The 4-character room code a scanned text means for this realm, or null. Pure, so tests and the page share it. */
export function roomCodeFromScan(text: string, here: { origin: string; base: string } = { origin: location.origin, base: basePath() }): string | null {
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      return null;
    }
    if (u.origin !== here.origin || !u.pathname.startsWith(here.base)) return null;
    const m = /^j\/([^/]+)\/?$/.exec(u.pathname.slice(here.base.length));
    if (!m?.[1]) return null;
    const c = checkCode(m[1]);
    return c.ok ? c.code : null;
  }
  const c = checkCode(t);
  return c.ok ? c.code : null;
}

interface Detector {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

/** The native detector when the browser has one that reads QR codes; else null (the bundled decoder is used). */
async function nativeDetector(): Promise<Detector | null> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    return new BD({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

const DECODE_MS = 100;
/** The longest side the bundled decoder works on: a phone's full frame is far more than a QR needs. */
const DECODE_PX = 640;
const NOT_OURS = "That QR code isn't for this room. Scan the one on the big screen.";

let live: { stop: () => void; tracks: MediaStreamTrack[]; decoder: string } | null = null;

/** Test readout: whether the scanner is open, which decoder it uses and how many camera tracks are still live. */
export function scanInspect(): { open: boolean; decoder: string | null; liveTracks: number } {
  return { open: live !== null, decoder: live?.decoder ?? null, liveTracks: live ? live.tracks.filter((t) => t.readyState === 'live').length : 0 };
}

/** Opens the scanner over the page. Resolves once with the outcome; the camera is always released first. */
export async function scanRoomCode(): Promise<ScanResult> {
  if (live) return { kind: 'cancelled' };
  if (!navigator.mediaDevices?.getUserMedia) return { kind: 'no-camera', reason: 'missing' };
  const opener = document.activeElement as HTMLElement | null;

  const scrim = document.createElement('div');
  scrim.className = 'scrim scan';
  scrim.dataset.overlay = 'scan';
  scrim.innerHTML = `<div class="panel modal scan-panel" role="dialog" aria-modal="true" aria-labelledby="scan-title">
    <h2 class="modal-title" id="scan-title">Scan the big screen</h2>
    <div class="scan-view"><video playsinline muted autoplay></video><span class="scan-frame" aria-hidden="true"></span></div>
    <p class="scan-note" role="status" aria-live="polite">Point the camera at the QR code on the big screen.</p>
    <div class="btnrow"><button type="button" class="btn btn-secondary" data-act="cancel">Enter the code instead</button><button type="button" class="btn btn-quiet" data-act="close">Cancel</button></div>
  </div>`;
  const video = scrim.querySelector('video')!;
  const note = scrim.querySelector<HTMLElement>('.scan-note')!;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    const name = (e as DOMException).name;
    return { kind: 'no-camera', reason: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'failed' };
  }
  const tracks = stream.getTracks();
  const detector = await nativeDetector();

  return new Promise<ScanResult>((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: ScanResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(noteTimer);
      for (const t of tracks) t.stop();
      video.pause();
      video.srcObject = null;
      document.removeEventListener('visibilitychange', onHide);
      removeEventListener('pagehide', onGone);
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      live = null;
      opener?.focus?.();
      resolve(r);
    };
    const onHide = () => document.visibilityState === 'hidden' && finish({ kind: 'cancelled' });
    const onGone = () => finish({ kind: 'cancelled' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish({ kind: 'cancelled' });
    };
    live = { stop: () => finish({ kind: 'cancelled' }), tracks, decoder: detector ? 'barcode-detector' : 'jsqr' };
    document.addEventListener('visibilitychange', onHide);
    addEventListener('pagehide', onGone);
    document.addEventListener('keydown', onKey, true);
    scrim.querySelector('[data-act=cancel]')!.addEventListener('click', () => finish({ kind: 'cancelled' }));
    scrim.querySelector('[data-act=close]')!.addEventListener('click', () => finish({ kind: 'cancelled' }));
    document.body.append(scrim);
    scrim.querySelector<HTMLElement>('[data-act=cancel]')!.focus();
    video.srcObject = stream;
    void video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let jsqr: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    const loadJsqr = detector
      ? Promise.resolve()
      : import('jsqr').then((m) => {
          jsqr = (m.default as unknown as typeof jsqr)!;
        });

    const say = (text: string, warn = false) => {
      note.textContent = text;
      note.classList.toggle('warn', warn);
      clearTimeout(noteTimer);
      if (warn) noteTimer = setTimeout(() => say('Point the camera at the QR code on the big screen.'), 3000);
    };

    const read = async (): Promise<string | null> => {
      if (video.readyState < 2 || !video.videoWidth) return null;
      if (detector) return (await detector.detect(video))[0]?.rawValue ?? null;
      if (!ctx || !jsqr) return null;
      const k = Math.min(1, DECODE_PX / Math.max(video.videoWidth, video.videoHeight));
      const w = Math.max(1, Math.round(video.videoWidth * k));
      const h = Math.max(1, Math.round(video.videoHeight * k));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      return jsqr(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
    };

    const tick = async () => {
      if (finished) return;
      try {
        const text = await read();
        if (text !== null && !finished) {
          const code = roomCodeFromScan(text);
          if (code) return finish({ kind: 'code', code });
          say(NOT_OURS, true);
        }
      } catch {
        // A frame that can't be read is skipped; the next one may be fine.
      }
      if (!finished) timer = setTimeout(() => void tick(), DECODE_MS);
    };
    void loadJsqr.then(() => void tick());
  });
}

/** What to tell a player whose camera couldn't be used. Code entry stays as it was. */
export function noCameraMessage(reason: 'denied' | 'missing' | 'failed'): string {
  if (reason === 'denied') return 'Camera access is blocked, so type the code from the big screen instead.';
  if (reason === 'missing') return "This phone has no camera we can use, so type the code from the big screen instead.";
  return "The camera wouldn't start, so type the code from the big screen instead.";
}
