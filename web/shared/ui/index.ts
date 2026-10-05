// Shared UI (P1-C01): importing this pulls in the generated token variables and the component styles, and exposes the
// few behaviours the CSS can't do (profile selection, toasts, confirmations). No renderer, sim or network code.
import './tokens.generated.css';
import './components.css';
import { icon } from './icons';

export { icon } from './icons';
export { tornBanner, tornPath } from './paint';

export type Profile = 'handheld' | 'desk' | 'tv';

/** The profile a viewport gets: a TV-sized landscape output, a desk-sized one, otherwise handheld (tokens.type.profiles). */
export function profileFor(width: number, height: number): Profile {
  if (width >= 1600 && height >= 900) return 'tv';
  if (width >= 900 && height >= 700) return 'desk';
  return 'handheld';
}

/** Sets data-profile (and the TV scale, output height / 1080) on <html>, and keeps them current on resize. */
export function applyProfile(root: HTMLElement = document.documentElement): void {
  const apply = () => {
    const p = profileFor(window.innerWidth, window.innerHeight);
    root.dataset.profile = p;
    root.style.setProperty('--ui-scale', p === 'tv' ? String(window.innerHeight / 1080) : '1');
  };
  apply();
  window.addEventListener('resize', apply);
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
const TOAST_ICON: Record<ToastKind, string> = { info: 'circle-help', success: 'check', warning: 'triangle-alert', error: 'triangle-alert' };

/** A toast that slides in and goes after `ms` (tokens motion.toast: 4 s). Returns a dismiss function. */
export function toast(message: string, kind: ToastKind = 'info', ms = 4000): () => void {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  const tile = document.createElement('span');
  tile.className = 'tile';
  tile.append(icon(TOAST_ICON[kind]));
  const text = document.createElement('p');
  text.textContent = message;
  el.append(tile, text);
  host.append(el);
  const dismiss = () => el.remove();
  setTimeout(dismiss, ms);
  return dismiss;
}

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirm: string;
  cancel?: string;
  destructive?: boolean;
}

/** A modal confirmation: resolves true on the confirm button, false on cancel or Escape. Focus returns to the opener. */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  const opener = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const modal = document.createElement('div');
  modal.className = 'panel modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  const title = document.createElement('h2');
  title.className = 'modal-title';
  title.id = `dlg-${Math.random().toString(36).slice(2)}`;
  title.textContent = o.title;
  modal.setAttribute('aria-labelledby', title.id);
  modal.append(title);
  if (o.body) {
    const p = document.createElement('p');
    p.textContent = o.body;
    modal.append(p);
  }
  const row = document.createElement('div');
  row.className = 'btnrow';
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn-secondary';
  no.textContent = o.cancel ?? 'Cancel';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = `btn ${o.destructive ? 'btn-destructive' : 'btn-primary'}`;
  yes.textContent = o.confirm;
  row.append(no, yes);
  modal.append(row);
  scrim.append(modal);
  document.body.append(scrim);
  no.focus();
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      scrim.remove();
      document.removeEventListener('keydown', onKey, true);
      opener?.focus();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const order = [no, yes];
        const i = order.indexOf(document.activeElement as HTMLButtonElement);
        order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey, true);
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    scrim.addEventListener('pointerdown', (e) => e.target === scrim && done(false));
  });
}
