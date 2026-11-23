// TEST FIXTURE: a copy of https://games-feedback.dilger.dev/widget.js (client 1.12.0, fetched 2026-11-23), served to
// web/tests/journeys/feedback.test.mjs in place of the real host, so a test run never talks to the inbox (br-1s9h).
// The game itself loads the live script (web/shared/src/feedback.ts). Refresh this copy when the sheet changes.
// games-feedback widget: made from party-kit's lib/feedback.js by feedback-service/tools/build-widget.mjs. Do not edit.
(() => {
'use strict';
if (globalThis.GamesFeedback) return;
// party-kit: "Send feedback". One sheet, the same on a phone, on the big screen and in a game that does not
// use the kit: Bug / Idea / Other, a few words, a picture of the screen (taken first, shown, and left out if the
// sender says so), an optional photo, and the list of details that go with it, exactly as they are sent. It posts
// to the one inbox every game shares (games-feedback.dilger.dev; see docs/FEEDBACK.md in the kit's home repo).
//
// This file imports nothing: the same source is served as https://games-feedback.dilger.dev/widget.js for games
// outside the kit (feedback-service/tools/build-widget.mjs wraps it), where it is used as
//
//   <script src="https://games-feedback.dilger.dev/widget.js" data-game="jammers" data-canvas="canvas#game" defer></script>
//   GamesFeedback.open();  GamesFeedback.setDetails({ Room: 'ABCD' });
//
// Nobody is identified: no name, account or address is asked for or sent.

const FEEDBACK_ENDPOINT = 'https://games-feedback.dilger.dev';
const FEEDBACK_CLIENT = '1.12.0';
const MAX_IMAGE = 1_800_000; // the service takes 2 MB
const KINDS = [['bug', 'Bug', 'What happened, and what did you expect?'], ['idea', 'Idea', 'What would make it better?'], ['other', 'Other', 'Go on.']];

// ── recent page errors ──────────────────────────────────────────────────────
const problems = [];
let watching = false;
/** Start remembering this page's last few errors (once). They are listed to the sender before anything is sent. */
function watchProblems(target = globalThis) {
  if (watching || !target?.addEventListener) return;
  watching = true;
  const note = (text) => {
    problems.push({ at: Date.now(), text: String(text ?? '').replace(/\s+/g, ' ').slice(0, 240) });
    if (problems.length > 10) problems.shift();
  };
  target.addEventListener('error', (event) => {
    if (!event?.message) return; // a resource that failed to load, not a script error
    const where = event.filename ? ` (${String(event.filename).split('/').pop()}:${event.lineno ?? 0})` : '';
    note(`${event.message}${where}`);
  });
  target.addEventListener('unhandledrejection', (event) => note(`Unhandled: ${event?.reason?.message ?? event?.reason ?? 'rejection'}`));
}
const recentProblems = () => problems.map((p) => `${new Date(p.at).toTimeString().slice(0, 8)} ${p.text}`);

// ── what is sent besides the words ──────────────────────────────────────────
/** A browser's user agent in three or four words ("iPhone, Safari 19"). The whole string is sent as well. */
function deviceWords(ua = globalThis.navigator?.userAgent ?? '') {
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : /TV|Tizen|Web0S/i.test(ua) ? 'TV' : 'Unknown device';
  const pick = (re) => re.exec(ua)?.[1];
  const browser = pick(/Edg(?:e|A|iOS)?\/(\d+)/) ? `Edge ${pick(/Edg(?:e|A|iOS)?\/(\d+)/)}` : pick(/Firefox\/(\d+)/) ? `Firefox ${pick(/Firefox\/(\d+)/)}`
    : pick(/FxiOS\/(\d+)/) ? `Firefox ${pick(/FxiOS\/(\d+)/)}` : pick(/CriOS\/(\d+)/) ? `Chrome ${pick(/CriOS\/(\d+)/)}` : pick(/Chrome\/(\d+)/) ? `Chrome ${pick(/Chrome\/(\d+)/)}`
      : pick(/Version\/(\d+)[\d.]* .*Safari/) ? `Safari ${pick(/Version\/(\d+)[\d.]* .*Safari/)}` : /Safari/.test(ua) ? 'Safari' : 'unknown browser';
  return `${device}, ${browser}`;
}

/** The details every piece of feedback carries, label → value, in the order they are listed. */
function baseDetails({ game, build, version, surface }, win = globalThis) {
  const d = {};
  d.Game = String(game ?? '');
  if (build) d.Build = String(build);
  if (version) d.Version = String(version);
  d['Sent from'] = surface === 'tv' ? 'the big screen' : surface === 'phone' ? 'a phone' : surface === 'index' ? 'the builds page' : 'a page';
  d.Device = deviceWords(win.navigator?.userAgent ?? '');
  const w = win.innerWidth ?? 0;
  const h = win.innerHeight ?? 0;
  d.Screen = `${w}×${h} CSS px at ${Math.round((win.devicePixelRatio || 1) * 100) / 100}×, ${w >= h ? 'landscape' : 'portrait'}`;
  return d;
}

// ── pictures ────────────────────────────────────────────────────────────────
const toBlob = (canvas, quality) => new Promise((resolve) => {
  try { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality); } catch { resolve(null); }
});

async function encode(canvas) {
  let source = canvas;
  for (const [quality, shrink] of [[0.82, 1], [0.6, 1], [0.6, 0.6], [0.5, 0.4]]) {
    if (shrink !== 1) {
      source = document.createElement('canvas');
      source.width = Math.max(1, Math.round(canvas.width * shrink));
      source.height = Math.max(1, Math.round(canvas.height * shrink));
      source.getContext('2d').drawImage(canvas, 0, 0, source.width, source.height);
    }
    const blob = await toBlob(source, quality);
    if (blob && blob.size <= MAX_IMAGE) return blob;
    if (!blob) return null;
  }
  return null;
}

/** Is everything in this canvas one colour (a WebGL buffer that was already cleared, a page with nothing drawn)? */
function blank(canvas) {
  try {
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 64;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false; // a small thing on a plain background must not be averaged away
    ctx.drawImage(canvas, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    for (let i = 4; i < data.length; i += 4) {
      if (Math.abs(data[i] - data[0]) > 6 || Math.abs(data[i + 1] - data[1]) > 6 || Math.abs(data[i + 2] - data[2]) > 6) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function visibleCanvases(target) {
  const list = typeof target === 'string' ? [...document.querySelectorAll(target)]
    : target && typeof target === 'object' && 'getContext' in target ? [target] : [...document.querySelectorAll('canvas')];
  return list.filter((canvas) => {
    if (!canvas?.getBoundingClientRect || canvas.closest?.('.gfb-root')) return false;
    const r = canvas.getBoundingClientRect();
    if (r.width < 32 || r.height < 32 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    const style = getComputedStyle(canvas);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  });
}

/**
 * A picture of what the game is drawing now: every visible canvas, where it is on the screen, as a JPEG blob (or
 * null when there is nothing to take). It is drawn inside the page's own animation frame, after the game has
 * drawn that frame, so a WebGL canvas is not caught already cleared. Text and buttons that are ordinary page
 * elements are not in it. `target` narrows it: a selector, a canvas, or a function returning a canvas or a blob.
 */
async function captureFrame(target = null, { maxWidth = 1280 } = {}) {
  if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') return null;
  try {
    if (typeof target === 'function') {
      const made = await target();
      if (!made) return null;
      if (typeof Blob !== 'undefined' && made instanceof Blob) return made.size <= MAX_IMAGE && /^image\/(jpeg|png|webp)$/.test(made.type) ? made : null;
      target = made;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const drawn = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 1500); // a page in the background gets no frames
        requestAnimationFrame(() => {
          clearTimeout(timer);
          try {
            const canvases = visibleCanvases(target);
            if (!canvases.length) return resolve(null);
            // The picture is the part of the screen the canvases cover (the whole screen, for most games).
            const rects = canvases.map((canvas) => canvas.getBoundingClientRect());
            const left = Math.max(0, Math.min(...rects.map((r) => r.left)));
            const top = Math.max(0, Math.min(...rects.map((r) => r.top)));
            const width = Math.min(innerWidth, Math.max(...rects.map((r) => r.right))) - left;
            const height = Math.min(innerHeight, Math.max(...rects.map((r) => r.bottom))) - top;
            const scale = Math.min(1, maxWidth / Math.max(1, width));
            const out = document.createElement('canvas');
            out.width = Math.max(1, Math.round(width * scale));
            out.height = Math.max(1, Math.round(height * scale));
            const ctx = out.getContext('2d');
            ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#000';
            ctx.fillRect(0, 0, out.width, out.height);
            canvases.forEach((canvas, i) => {
              const r = rects[i];
              if (canvas.width && canvas.height) ctx.drawImage(canvas, (r.left - left) * scale, (r.top - top) * scale, r.width * scale, r.height * scale);
            });
            resolve(out);
          } catch {
            resolve(null);
          }
        });
      });
      if (!drawn) return null;
      // One plain colour may be a buffer caught empty: look at the next frame, twice. Still plain after that, it is
      // what the game is showing (a fade, a blank title card), and that is the picture.
      if (attempt === 2 || !blank(drawn)) return await encode(drawn);
    }
    return null;
  } catch {
    return null;
  }
}

/** A photo the sender chose, made small enough to send (a JPEG, 1600 px on its longer side at most). */
async function pictureFromFile(file) {
  if (!file || !/^image\//.test(file.type) || file.type === 'image/svg+xml') throw new Error('Choose a picture.');
  let source;
  let w;
  let h;
  try {
    source = await createImageBitmap(file);
    w = source.width;
    h = source.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('That picture could not be read.'));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    w = source.naturalWidth;
    h = source.naturalHeight;
  }
  const scale = Math.min(1, 1600 / Math.max(w, h, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await encode(canvas);
  if (!blob) throw new Error('That picture is too large to send.');
  return blob;
}

// ── talking to the inbox ────────────────────────────────────────────────────
/** Send the words and details. Resolves to `{ id, upload: { token } }`; rejects with a sentence for the sender. */
async function postFeedback(endpoint, record, fetcher = globalThis.fetch) {
  let response;
  try {
    response = await fetcher(`${endpoint}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record) });
  } catch {
    throw new Error('It could not be sent: there is no connection to the feedback inbox. Try again in a moment.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ? `It could not be sent: ${data.error}.`.replace(/\.\.$/, '.') : `It could not be sent (${response.status}).`);
  return data;
}

/** Add a picture to feedback that was just sent: `slot` is 'tv' (the screen) or 'photo'. Resolves to true or false. */
async function postShot(endpoint, id, token, slot, blob, fetcher = globalThis.fetch) {
  try {
    const response = await fetcher(`${endpoint}/api/feedback/${encodeURIComponent(id)}/shot?slot=${slot}`, {
      method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg', 'x-upload-token': token }, body: blob,
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ── the sheet ───────────────────────────────────────────────────────────────
const CSS = `
.gfb-root,.gfb-root *{all:revert;box-sizing:border-box}
.gfb-root{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:rgba(10,12,18,.62);
  font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#14151a;touch-action:pan-y;-webkit-text-size-adjust:100%;
  padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}
.gfb-root .gfb-panel{width:min(34rem,100%);max-height:100%;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:#fffdf6;color:#14151a;
  border-radius:14px;padding:16px 18px 18px;box-shadow:0 18px 60px rgba(0,0,0,.45);-webkit-user-select:text;user-select:text}
.gfb-root .gfb-title{font-size:1.25rem;font-weight:700;margin:0 0 2px}
.gfb-root .gfb-sub{margin:0 0 12px;color:#55586a;font-size:.9rem}
.gfb-root .gfb-kinds{display:flex;gap:8px;margin:0 0 10px;padding:0;border:0}
.gfb-root .gfb-kind{flex:1 1 0;min-height:44px;border:2px solid #c9c4b4;border-radius:10px;background:#fffdf6;color:#14151a;font:inherit;font-weight:600;cursor:pointer;touch-action:manipulation}
.gfb-root .gfb-kind[aria-pressed="true"]{border-color:#14151a;background:#14151a;color:#fffdf6}
.gfb-root .gfb-text{display:block;width:100%;min-height:5.2em;resize:vertical;border:2px solid #c9c4b4;border-radius:10px;padding:10px;font:inherit;font-size:16px;background:#fff;color:#14151a}
.gfb-root .gfb-text:focus,.gfb-root .gfb-kind:focus-visible,.gfb-root .gfb-btn:focus-visible,.gfb-root .gfb-check input:focus-visible{outline:3px solid #2f6fed;outline-offset:2px}
.gfb-root .gfb-row{display:flex;align-items:center;gap:10px;margin:10px 0 0;min-height:44px}
.gfb-root .gfb-check{display:flex;align-items:center;gap:10px;flex:1 1 auto;min-height:44px;cursor:pointer;touch-action:manipulation}
.gfb-root .gfb-check input{width:22px;height:22px;flex:none;margin:0;accent-color:#14151a}
.gfb-root .gfb-thumb{flex:none;max-width:112px;max-height:72px;border:1px solid #c9c4b4;border-radius:6px;display:block}
.gfb-root .gfb-note{margin:6px 0 0;color:#55586a;font-size:.85rem}
.gfb-root .gfb-error{margin:10px 0 0;color:#a3171c;font-weight:600}
.gfb-root .gfb-btn{min-height:44px;padding:0 16px;border:2px solid #14151a;border-radius:10px;background:#fffdf6;color:#14151a;font:inherit;font-weight:600;cursor:pointer;touch-action:manipulation}
.gfb-root .gfb-btn[data-primary]{background:#14151a;color:#fffdf6}
.gfb-root .gfb-btn[data-quiet]{border-color:#c9c4b4;font-weight:500}
.gfb-root .gfb-btn:disabled{opacity:.5;cursor:default}
.gfb-root .gfb-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.gfb-root .gfb-details{margin:12px 0 0;border-top:1px solid #dcd7c8;padding-top:8px}
.gfb-root .gfb-details h3{margin:0 0 4px;font-size:.85rem;font-weight:700;color:#55586a}
.gfb-root .gfb-details dl{margin:0;font-size:.82rem;display:grid;grid-template-columns:max-content 1fr;gap:2px 10px}
.gfb-root .gfb-details dt{color:#55586a;margin:0}
.gfb-root .gfb-details dd{margin:0;white-space:pre-line;overflow-wrap:anywhere}
.gfb-root .gfb-actions{display:flex;gap:10px;justify-content:flex-end;margin:14px 0 0}
.gfb-root .gfb-thanks{margin:8px 0 14px;font-size:1.1rem;font-weight:600}
.gfb-chip{all:revert;position:fixed;z-index:2147482800;margin:1.2vmin;padding:.35em .8em;border:0;border-radius:999px;background:rgba(20,21,26,.55);color:#fff;
  font:600 max(11px,1.5vmin)/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;opacity:.5;transition:opacity .15s}
.gfb-chip:hover,.gfb-chip:focus-visible{opacity:1;outline:2px solid #fff;outline-offset:1px}
.gfb-chip[data-corner="bottom-right"]{bottom:0;right:0}.gfb-chip[data-corner="bottom-left"]{bottom:0;left:0}
.gfb-chip[data-corner="top-right"]{top:0;right:0}.gfb-chip[data-corner="top-left"]{top:0;left:0}
.gfb-root [hidden]{display:none}
@media (max-height:480px){.gfb-root .gfb-panel{padding:10px 14px 12px}.gfb-root .gfb-sub{display:none}.gfb-root .gfb-text{min-height:3.4em}}
`;
let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  // A constructed sheet is not an inline style, so a page with a strict style policy takes it too.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return;
  } catch { /* an older browser: a style element */ }
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/**
 * The feedback sheet for one page.
 * @param {{ game: string, endpoint?: string, build?: string, version?: string, surface?: 'phone'|'tv'|'index'|'other',
 *   canvas?: string|HTMLCanvasElement|Function|null, details?: object|Function,
 *   tvShot?: { snap(): Promise<boolean>, send(id: string, token: string): void, drop(): void }|null,
 *   onOpen?: Function, onClose?: Function }} config
 * `tvShot` is for a phone: it asks the big screen to take the picture and, on Send, to add it. Without it the
 * page takes a picture of its own canvases.
 */
function createFeedback(config = {}) {
  const settings = { endpoint: FEEDBACK_ENDPOINT, surface: 'other', canvas: null, tvShot: null, ...config };
  settings.endpoint = String(settings.endpoint || '').replace(/\/+$/, '');
  let extra = {};
  let sheet = null;
  let chip = null;
  let onKey = null;
  watchProblems();

  const details = (surface) => {
    const own = typeof settings.details === 'function' ? settings.details() : settings.details;
    const d = { ...baseDetails({ ...settings, surface }), ...(own ?? {}), ...extra };
    const errors = recentProblems();
    d['Recent problems'] = errors.length ? errors.join('\n') : 'none';
    const out = {};
    for (const [key, value] of Object.entries(d).slice(0, 30)) if (value !== null && value !== undefined && value !== '') out[String(key).slice(0, 40)] = String(value).slice(0, 4000);
    return out;
  };

  function close() {
    if (!sheet) return;
    const { root, urls, tv } = sheet;
    if (tv?.asked && !sheet.sent) settings.tvShot?.drop?.();
    for (const url of urls) URL.revokeObjectURL(url);
    root.remove();
    sheet = null;
    settings.onClose?.();
  }

  async function open(options = {}) {
    if (sheet || typeof document === 'undefined' || !settings.endpoint) return false;
    addStyle();
    const surface = options.surface ?? settings.surface;
    const state = { root: null, urls: [], kind: 'bug', shot: null, photo: null, sent: false, busy: false, tv: null };
    sheet = state;
    const tvShot = options.tvShot ?? settings.tvShot;
    // The picture comes first: what was on the screen when feedback was asked for, not the sheet.
    if (tvShot) state.tv = { asked: true, ready: null };
    else if (options.capture !== false) state.shot = options.shot ?? await captureFrame(options.canvas ?? settings.canvas);
    if (sheet !== state) return false; // closed while the picture was being taken
    const sending = details(surface);

    const error = el('p', { class: 'gfb-error', role: 'alert', hidden: true });
    const text = el('textarea', { class: 'gfb-text', rows: '3', maxlength: '4000', 'aria-label': 'Your feedback', placeholder: KINDS[0][2], 'data-gfb': 'message' });
    const kinds = el('div', { class: 'gfb-kinds', role: 'group', 'aria-label': 'What kind of feedback' }, KINDS.map(([id, label, hint]) => el('button', {
      class: 'gfb-kind', type: 'button', text: label, 'aria-pressed': id === state.kind ? 'true' : 'false', 'data-gfb-kind': id,
      onclick: () => {
        state.kind = id;
        for (const b of kinds.children) b.setAttribute('aria-pressed', b.dataset.gfbKind === id ? 'true' : 'false');
        text.placeholder = hint;
      },
    })));

    // The picture of the screen: shown, ticked, and left out when unticked.
    let shotRow = null;
    let shotBox = null;
    if (state.shot) {
      const url = URL.createObjectURL(state.shot);
      state.urls.push(url);
      shotBox = el('input', { type: 'checkbox', checked: true, 'data-gfb': 'include-shot' });
      shotRow = el('div', { class: 'gfb-row' }, [el('label', { class: 'gfb-check' }, [shotBox, el('span', { text: 'Include this picture of the screen' })]), el('img', { class: 'gfb-thumb', src: url, alt: 'The screen when you opened this' })]);
    } else if (state.tv) {
      shotBox = el('input', { type: 'checkbox', checked: true, 'data-gfb': 'include-tv' });
      const words = el('span', { text: 'Include a picture of the TV' });
      shotRow = el('div', { class: 'gfb-row' }, [el('label', { class: 'gfb-check' }, [shotBox, words])]);
      state.tv.ready = Promise.resolve(tvShot.snap()).then((ok) => {
        if (sheet !== state) return false;
        if (!ok) {
          shotBox.checked = false;
          shotBox.disabled = true;
          words.textContent = 'The TV could not take a picture just now';
        } else words.textContent = 'Include a picture of the TV (taken when you opened this)';
        shotRow.dataset.tv = ok ? 'ready' : 'none';
        return Boolean(ok);
      }, () => false);
    }

    // A photo of the sender's own choosing (the camera, or one they already have).
    const file = el('input', { class: 'gfb-file', type: 'file', accept: 'image/*', tabindex: '-1', 'aria-hidden': 'true', 'data-gfb': 'file' });
    const photoThumb = el('img', { class: 'gfb-thumb', alt: 'The photo you added', hidden: true });
    const addPhoto = el('button', { class: 'gfb-btn', type: 'button', 'data-quiet': true, text: 'Add a photo', 'data-gfb': 'add-photo', onclick: () => {
      if (state.photo) {
        state.photo = null;
        photoThumb.hidden = true;
        addPhoto.textContent = 'Add a photo';
        file.value = '';
      } else file.click();
    } });
    file.addEventListener('change', async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      error.hidden = true;
      try {
        state.photo = await pictureFromFile(chosen);
        const url = URL.createObjectURL(state.photo);
        state.urls.push(url);
        photoThumb.src = url;
        photoThumb.hidden = false;
        addPhoto.textContent = 'Remove the photo';
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
      }
    });

    const list = el('dl', {}, Object.entries(sending).flatMap(([key, value]) => [el('dt', { text: key }), el('dd', { text: value })]));
    const send = el('button', { class: 'gfb-btn', type: 'button', 'data-primary': true, text: 'Send', 'data-gfb': 'send' });
    const cancel = el('button', { class: 'gfb-btn', type: 'button', 'data-quiet': true, text: 'Cancel', 'data-gfb': 'cancel', onclick: close });
    const panel = el('div', { class: 'gfb-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Send feedback', 'data-gfb': 'sheet' }, [
      el('h2', { class: 'gfb-title', text: 'Send feedback' }),
      el('p', { class: 'gfb-sub', text: 'Something wrong, or an idea? It goes to the person who makes the game.' }),
      kinds, text, shotRow,
      el('div', { class: 'gfb-row' }, [addPhoto, photoThumb, file]),
      error,
      el('div', { class: 'gfb-actions' }, [cancel, send]),
      el('div', { class: 'gfb-details', 'data-gfb': 'details' }, [el('h3', { text: 'Sent with it (nothing else is, and no name)' }), list]),
    ]);
    const root = el('div', { class: 'gfb-root', 'data-gfb': 'root' }, [panel]);
    state.root = root;

    send.addEventListener('click', async () => {
      if (state.busy) return;
      const message = text.value.trim();
      if (message.length < 3) {
        error.textContent = 'Say what happened or what you would like first.';
        error.hidden = false;
        text.focus();
        return;
      }
      state.busy = true;
      send.disabled = true;
      send.textContent = 'Sending…';
      error.hidden = true;
      try {
        const made = await postFeedback(settings.endpoint, {
          game: settings.game, build: settings.build ?? '', kind: state.kind, message, surface,
          page: options.page ?? `${location.pathname}`.slice(0, 300), version: settings.version ?? '', debug: sending,
        });
        state.sent = true;
        const token = made.upload?.token;
        const jobs = [];
        if (token && state.shot && shotBox?.checked) jobs.push(postShot(settings.endpoint, made.id, token, 'tv', state.shot));
        if (token && state.photo) jobs.push(postShot(settings.endpoint, made.id, token, 'photo', state.photo));
        if (state.tv) {
          const ready = await Promise.race([state.tv.ready, new Promise((resolve) => setTimeout(() => resolve(false), 3000))]);
          if (token && ready && shotBox.checked) tvShot.send(made.id, token);
          else tvShot.drop?.();
        }
        const added = await Promise.all(jobs);
        const missed = added.includes(false);
        panel.replaceChildren(
          el('h2', { class: 'gfb-title', text: 'Thanks' }),
          el('p', { class: 'gfb-thanks', 'data-gfb': 'thanks', text: missed ? 'Sent, but a picture could not be added.' : 'Sent. It will be read.' }),
          el('div', { class: 'gfb-actions' }, [el('button', { class: 'gfb-btn', type: 'button', 'data-primary': true, text: 'Back', 'data-gfb': 'done', onclick: close })]),
        );
        settings.onSent?.(made.id);
        setTimeout(() => { if (sheet === state) close(); }, 2600);
      } catch (problem) {
        state.busy = false;
        send.disabled = false;
        send.textContent = 'Send';
        error.textContent = problem.message;
        error.hidden = false;
      }
    });

    // What is typed or tapped here is not for the game underneath.
    for (const type of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'wheel']) {
      root.addEventListener(type, (event) => {
        if (type === 'keydown' && event.key === 'Escape') close();
        event.stopPropagation();
      });
    }
    root.addEventListener('pointerdown', (event) => { if (event.target === root) close(); });
    document.body.append(root);
    settings.onOpen?.();
    // On a big screen the words can be typed at once; on a phone the keyboard waits for a tap (it would cover the sheet).
    if (!(globalThis.matchMedia?.('(pointer: coarse)').matches)) text.focus();
    return true;
  }

  /** The small control for a big screen: one quiet word in a corner, and Ctrl+Shift+F. */
  function button({ corner = 'bottom-right', label = 'Feedback', key = true } = {}) {
    if (typeof document === 'undefined') return null;
    addStyle();
    chip?.remove();
    chip = el('button', { class: 'gfb-chip', type: 'button', text: label, title: 'Send feedback about this game (Ctrl+Shift+F)', 'data-corner': corner, 'data-gfb': 'chip', onclick: () => open() });
    document.body.append(chip);
    if (key && !onKey) {
      onKey = (event) => {
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
          event.preventDefault();
          if (sheet) close();
          else open();
        }
      };
      globalThis.addEventListener('keydown', onKey);
    }
    return chip;
  }

  return {
    open, close, button, details,
    get isOpen() { return Boolean(sheet); },
    /** More details to list and send with every piece of feedback from this page (label → value; null removes one). */
    setDetails(more) {
      extra = { ...extra, ...(more ?? {}) };
    },
    set(next) { Object.assign(settings, next ?? {}); },
    remove() {
      close();
      chip?.remove();
      chip = null;
      if (onKey) globalThis.removeEventListener('keydown', onKey);
      onKey = null;
    },
  };
}

/**
 * For a page that loads this as a plain script (widget.js): reads the script tag's data attributes, puts the
 * small control on the page unless `data-button="off"`, and returns what becomes `window.GamesFeedback`.
 */
function startWidget(script, win = globalThis) {
  const data = script?.dataset ?? {};
  let endpoint = data.endpoint || FEEDBACK_ENDPOINT;
  try { if (!data.endpoint && script?.src) endpoint = new URL(script.src).origin; } catch { /* keep the default */ }
  const coarse = Boolean(win.matchMedia?.('(pointer: coarse)').matches) && Math.min(win.innerWidth ?? 0, win.innerHeight ?? 0) < 600;
  const feedback = createFeedback({
    endpoint, game: data.game ?? '', build: data.build ?? '', version: data.version ?? '',
    surface: data.surface || (coarse ? 'phone' : 'tv'), canvas: data.canvas || null,
  });
  const api = {
    version: FEEDBACK_CLIENT,
    open: (options) => feedback.open(options),
    close: () => feedback.close(),
    setDetails: (more) => feedback.setDetails(more),
    /** Change what was given on the script tag: `{ game, build, version, surface, canvas, tvShot }`. */
    configure: (next) => feedback.set(next),
    button: (options) => feedback.button(options),
    /** A picture of the game's canvases now, as a JPEG blob (for a big screen asked by a phone). */
    capture: (target) => captureFrame(target ?? data.canvas ?? null),
    /** Add a picture to feedback another page just sent (the id and token are what that page's `tvShot.send` was given). */
    attach: (id, token, blob, slot = 'tv') => postShot(endpoint, id, token, slot, blob),
  };
  const place = () => { if (data.button !== 'off' && data.game) feedback.button({ corner: data.corner || 'bottom-right', label: data.label || 'Feedback' }); };
  if (win.document?.body) place();
  else win.addEventListener?.('DOMContentLoaded', place);
  return api;
}

globalThis.GamesFeedback = startWidget(document.currentScript);
})();
