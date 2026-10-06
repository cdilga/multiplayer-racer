// The controller page (`B/c`, `B/j/<CODE>`, P1-C02/C03). `?hello` keeps the walking skeleton (P1-G00) for the
// transport journeys. `window.__jjController` exposes the session for tests (no secrets).
import { basePath } from '../../shared/src/base';
import { applyProfile } from '../../shared/ui';
import './app/controller.css';
import names from './app/names.json';
import { Session } from './app/session';
import { mountController, wakeHeld } from './app/view';

const app = document.querySelector<HTMLElement>('#app');
const params = new URLSearchParams(location.search);

function codeFromPath(): string | null {
  const m = /^j\/([A-Za-z0-9]{4})$/.exec(location.pathname.slice(basePath().length));
  return m?.[1] ? m[1].toUpperCase() : null;
}

function prefillName(): string {
  const ok = names.names.filter((n) => n.familyFriendly);
  return ok[Math.floor(Math.random() * ok.length)]?.name ?? 'Mate';
}

async function boot(root: HTMLElement): Promise<void> {
  if (params.has('hello')) return (await import('./hello/hello')).mountHello(root);
  const code = codeFromPath();
  if (!code) {
    // No code in the URL: the landing page's join card asks for one.
    location.replace(basePath());
    return;
  }
  applyProfile();
  const session = new Session({ iceTransportPolicy: params.get('ice') === 'relay' ? 'relay' : 'all' });
  mountController(root, session, prefillName);
  (window as unknown as { __jjController: unknown }).__jjController = {
    inspect: () => session.inspect(),
    claim: (name: string) => session.claim(name),
    setSticks: (d: { x: number; y: number; touch: boolean }, a: { x: number; y: number; touch: boolean }) => session.setSticks(d, a),
    identify: () => session.identify(),
    wakeHeld,
  };
  // The §11 edge-swipe guard: an accidental back gesture stays on the controller.
  history.pushState({ guard: true }, '');
  addEventListener('popstate', () => history.pushState({ guard: true }, ''));
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  await session.start(code);
  document.documentElement.dataset.jjController = 'ready';
}

if (app) void boot(app);
