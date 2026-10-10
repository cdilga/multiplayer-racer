// The controller page (`B/c`, `B/j/<CODE>`, P1-C02/C03): the one join journey (R119). `?hello` keeps the walking skeleton (P1-G00) for the
// transport journeys. `window.__jjController` exposes the session for tests (no secrets).
import { basePath } from '../../shared/src/base';
import { applyProfile } from '../../shared/ui';
import './app/controller.css';
import { prefillName } from './app/names';
import { Session, loadInput } from './app/session';
import { applyState, fragmentState } from './app/states';
import { mountController, wakeHeld } from './app/view';

const app = document.querySelector<HTMLElement>('#app');
const params = new URLSearchParams(location.search);

function codeFromPath(): string | null {
  const m = /^j\/([A-Za-z0-9]{4})$/.exec(location.pathname.slice(basePath().length));
  return m?.[1] ? m[1].toUpperCase() : null;
}

function mountTray(): HTMLElement {
  const t = document.createElement('div');
  t.className = 'hub-tray';
  document.body.append(t);
  return t;
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
  // A state opener (#state=…): draw that §11 screen with no connection at all (R90's test surface).
  const opened = fragmentState();
  if (opened) {
    await loadInput(); // the wasm the encoders and the stick scheduler need, as session.start() would have loaded it
    session.code = code;
    applyState(session, opened);
    history.pushState({ guard: true }, '');
    addEventListener('popstate', () => history.pushState({ guard: true }, ''));
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.documentElement.dataset.jjController = 'ready';
    return;
  }
  // The §11 edge-swipe guard: an accidental back gesture stays on the controller.
  history.pushState({ guard: true }, '');
  addEventListener('popstate', () => history.pushState({ guard: true }, ''));
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  // Every joined controller carries extra players (R119): a pad or key cluster pressed on this page claims its own seat over
  // this page's one connection, whether or not its own touch player ever taps in.
  const sources = import('./sources/sources').then((m) => m.mountSources(session, mountTray(), params.get('ice') === 'relay' ? 'relay' : 'all'));
  await session.start(code);
  await sources;
  document.documentElement.dataset.jjController = 'ready';
}

if (app) void boot(app);
