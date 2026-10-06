// The walking skeleton's controller (P1-G00): joins the room in the URL (`B/j/<CODE>`, or a typed code on `B/c`),
// connects over WebRTC (N05) and sends its stick at up to 60 Hz on the `state` channel. Unstyled; C02 replaces it.
// `window.__jjHello` exposes the link for tests (no secrets).
import { basePath } from '../../../shared/src/base';
import { ControllerLink } from '../../../shared/transport';
import { encodeHelloStick } from '../../../shared/transport/hello';

export function codeFromPath(): string | null {
  const rest = location.pathname.slice(basePath().length);
  const m = /^j\/([A-Za-z0-9]{4})$/.exec(rest);
  return m?.[1] ? m[1].toUpperCase() : null;
}

export async function mountHello(app: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  app.innerHTML = `
    <section style="font:16px system-ui;padding:12px;color:#f4efe6;touch-action:none;user-select:none">
      <p><b data-jj-status>Finding room…</b> <span data-jj-path style="font-size:12px"></span></p>
      <form data-jj-form hidden><input data-jj-code maxlength="4" autocomplete="off" placeholder="Code"><button>Join</button></form>
      <div data-jj-pad style="position:relative;width:260px;height:260px;border-radius:50%;background:#333;margin:24px auto;touch-action:none">
        <div data-jj-knob style="position:absolute;width:80px;height:80px;border-radius:50%;background:#ffd23f;left:90px;top:90px"></div>
      </div>
    </section>`;
  const $ = <T extends HTMLElement>(k: string) => app.querySelector<T>(`[data-jj-${k}]`)!;
  const status = $('status');
  let stick = { x: 0, y: 0 };
  let dirty = true;

  const link = new ControllerLink(
    {
      onState: (s) => {
        status.textContent = {
          idle: '',
          joining: 'Finding room…',
          connecting: 'Connecting…',
          connected: 'Connected',
          restarting: 'Reconnecting…',
          rebuilding: 'Reconnecting…',
          ended: 'That room has ended',
          failed: "Couldn't connect",
        }[s];
      },
      onOpen: () => (dirty = true),
    },
    { iceTransportPolicy: params.get('ice') === 'relay' ? 'relay' : 'all' },
  );

  // The stick: a pointer anywhere on the pad, clamped to the circle; release springs to centre.
  const pad = $('pad');
  const knob = $('knob');
  const move = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const len = Math.hypot(x, y);
    if (len > 1) [x, y] = [x / len, y / len];
    setStick(x, y);
  };
  const setStick = (x: number, y: number) => {
    stick = { x, y };
    dirty = true;
    knob.style.left = `${90 + x * 90}px`;
    knob.style.top = `${90 + y * 90}px`;
  };
  pad.addEventListener('pointerdown', (e) => (pad.setPointerCapture(e.pointerId), move(e)));
  pad.addEventListener('pointermove', (e) => pad.hasPointerCapture(e.pointerId) && move(e));
  for (const t of ['pointerup', 'pointercancel'] as const) pad.addEventListener(t, () => setStick(0, 0));

  // 60 Hz on change, 20 Hz refresh (the state channel is unreliable).
  let last = 0;
  setInterval(() => {
    const ch = link.channels?.state;
    if (!ch || ch.readyState !== 'open') return;
    const now = performance.now();
    if (dirty || now - last > 50) {
      ch.send(encodeHelloStick(stick.x, stick.y));
      dirty = false;
      last = now;
    }
  }, 16);
  setInterval(async () => {
    const p = await link.path();
    $('path').textContent = p ? `(${p.kind}${p.rttMs !== null ? `, ${p.rttMs} ms` : ''})` : '';
  }, 1000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && link.resume());

  (window as unknown as { __jjHello: unknown }).__jjHello = {
    link: () => link.inspect(),
    path: () => link.path(),
    setStick,
    /** Test hook: closes the peer connection's transport as a network loss would (restart → rebuild path). */
    breakLink: () => link.pc?.close(),
    dropStream: () => link.stream?.drop(),
    staleCandidate: () =>
      link.debugSignal('candidate', link.gen - 1, JSON.stringify({ candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 })),
  };

  const join = async (code: string) => {
    try {
      await link.join(code);
    } catch (e) {
      status.textContent = (e as Error).message === 'room-ended' ? 'That room has ended' : `No room with code ${code}`;
    }
  };
  const code = codeFromPath();
  if (code) await join(code);
  else {
    status.textContent = 'Type the room code';
    const form = $<HTMLFormElement>('form');
    form.hidden = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void join($<HTMLInputElement>('code').value.trim());
    });
  }
  document.documentElement.dataset.jjController = 'hello';
}
