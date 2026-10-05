// The front door (P1-C01): Host a room, or Join a room with the code from the big screen. No renderer, sim or
// transport is imported here; the host app and the controller app are separate pages under the deployment base.
import { applyProfile, icon, toast } from '../../shared/ui';
import './landing.css';
import { checkCode, normaliseCode } from './code';

// All routes sit under the deployment base path B: `/` in production, `/p/<id>/` in a preview (plan §5.1).
const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const routes = { host: `${base}host`, join: (code: string) => `${base}j/${code}` };

applyProfile();

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

// Stub: the scanner is P1-C04's. The button is in place so the layout and the join path are final.
scan.addEventListener('click', () => toast("Scanning isn't ready yet. Type the code from the big screen instead.", 'info'));
