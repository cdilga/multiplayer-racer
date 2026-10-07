// The front door (P1-C01): Host a room, or Join a room with the code from the big screen. No renderer, sim or
// transport is imported here; the host app and the controller app are separate pages under the deployment base.
import { applyProfile, icon, paintKit } from '../../shared/ui';
import './landing.css';
import '../../controller/src/app/scan.css';
import { basePath } from '../../shared/src/base';
import { checkCode, normaliseCode } from './code';

// All routes sit under the deployment base path B: `/` in production, `/p/<id>/` in a preview (plan §5.1).
const base = basePath();
const routes = { host: `${base}host`, join: (code: string) => `${base}j/${code}` };

applyProfile();
paintKit(); // the brushed Host and Join buttons (the kit paints their slab and keeps it through resizes)

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`landing: #${id} missing`);
  return el as T;
};
const hostLink = $<HTMLAnchorElement>('host-link');
const form = $<HTMLFormElement>('join-form');
const input = $<HTMLInputElement>('code');
const error = $<HTMLParagraphElement>('code-error');
const scan = $<HTMLButtonElement>('scan');

hostLink.href = routes.host;
scan.append(icon('scan-qr-code'));

function showError(message: string | null): void {
  error.hidden = message === null;
  error.replaceChildren();
  if (message !== null) error.append(icon('triangle-alert'), message);
  input.toggleAttribute('aria-invalid', message !== null);
  if (message !== null) input.setAttribute('aria-invalid', 'true');
}

// Tidy the field as it's typed (case and spaces); complain about characters that can't be in a code straight away,
// but only nag about length on submit.
input.addEventListener('input', () => {
  const tidy = normaliseCode(input.value);
  if (tidy !== input.value) input.value = tidy;
  const c = checkCode(tidy);
  showError(!c.ok && c.problem === 'chars' ? c.message : null);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = checkCode(input.value);
  if (!c.ok) {
    showError(c.message);
    input.focus();
    return;
  }
  showError(null);
  location.assign(routes.join(c.code));
});

// The in-page scanner (P1-C04), loaded only when asked for: the camera opens on this tap and is always released. A
// scanned room URL or code for this realm joins; a denied or missing camera leaves code entry exactly as it was.
scan.addEventListener('click', async () => {
  const { scanRoomCode, noCameraMessage } = await import('../../controller/src/app/scan');
  const r = await scanRoomCode();
  if (r.kind === 'code') {
    input.value = r.code;
    showError(null);
    location.assign(routes.join(r.code));
  } else if (r.kind === 'no-camera') {
    showError(noCameraMessage(r.reason));
    input.focus();
  } else input.focus();
});
(window as unknown as { __jjScan: unknown }).__jjScan = { inspect: () => import('../../controller/src/app/scan').then((m) => m.scanInspect()) };
