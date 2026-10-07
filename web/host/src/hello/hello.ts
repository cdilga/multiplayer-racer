// The walking skeleton's host page (P1-G00, `B/host?hello`): creates a room, shows its code and a QR, and draws one
// coloured marker per joined controller that its stick moves. Unstyled on purpose (the POC verdict isn't needed).
// Diagnostics list each peer's selected path. `window.__jjHello` exposes the markers and the transport for the smoke
// and the Playwright journeys (no secrets in it).
import { renderSVG } from 'uqr';
import { HostHub, type HostPeer } from '../../../shared/transport';
import { decodeHelloStick } from '../../../shared/transport/hello';

interface Marker {
  x: number;
  y: number;
  colour: string;
  el: HTMLElement;
  updates: number;
}

const COLOURS = ['#e4572e', '#5bc0eb', '#f3a712', '#669bbc', '#a8c686', '#c879ff', '#00a6a6', '#ff6f91'];

export async function mountHello(app: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const policy = params.get('ice') === 'relay' ? 'relay' : 'all';
  app.innerHTML = `
    <section style="font:16px system-ui;color:#f4efe6;padding:12px;display:grid;grid-template-columns:auto 1fr;gap:16px;height:100%;box-sizing:border-box">
      <div>
        <h1 style="margin:0 0 8px">Room <span data-jj-code>…</span></h1>
        <div data-jj-qr style="width:180px;background:#fff"></div>
        <p data-jj-join style="font-size:12px;word-break:break-all;max-width:180px"></p>
        <pre data-jj-diag style="font-size:11px;white-space:pre-wrap;max-width:260px"></pre>
      </div>
      <div data-jj-field style="position:relative;border:2px solid #555;min-height:300px"></div>
    </section>`;
  const $ = (k: string) => app.querySelector<HTMLElement>(`[data-jj-${k}]`)!;
  const field = $('field');
  const markers = new Map<string, Marker>();

  const marker = (ep: string): Marker => {
    const found = markers.get(ep);
    if (found) return found;
    const el = document.createElement('div');
    const colour = COLOURS[markers.size % COLOURS.length] ?? '#fff';
    el.style.cssText = `position:absolute;width:28px;height:28px;border-radius:50%;background:${colour};transform:translate(-50%,-50%);left:50%;top:50%`;
    el.dataset.endpoint = ep;
    field.append(el);
    const m: Marker = { x: 0, y: 0, colour, el, updates: 0 };
    markers.set(ep, m);
    return m;
  };

  const hub = new HostHub(
    {
      onRoom: ({ code, joinUrl }) => {
        $('code').textContent = code;
        $('join').textContent = joinUrl;
        $('qr').innerHTML = renderSVG(joinUrl, { border: 1 });
      },
      onPeerOpen: (peer: HostPeer) => {
        marker(peer.endpointId);
      },
      onMessage: (peer, channel, data) => {
        if (channel !== 'state') return;
        const stick = decodeHelloStick(data);
        if (!stick) return;
        const m = marker(peer.endpointId);
        m.x = stick.x;
        m.y = stick.y;
        m.updates += 1;
        m.el.style.left = `${50 + stick.x * 45}%`;
        m.el.style.top = `${50 + stick.y * 45}%`;
      },
    },
    { iceTransportPolicy: policy },
  );
  await hub.open();

  setInterval(async () => {
    const paths = await hub.paths();
    $('diag').textContent = Object.entries(paths)
      .map(([ep, p]) => `${ep}: ${p ? `${p.kind}${p.relayProtocol ? `/${p.relayProtocol}` : ''} rtt ${p.rttMs ?? '?'} ms` : 'connecting'}`)
      .join('\n');
  }, 1000);

  (window as unknown as { __jjHello: unknown }).__jjHello = {
    code: () => hub.code,
    joinUrl: () => hub.joinUrl,
    markers: () => Object.fromEntries([...markers].map(([ep, m]) => [ep, { x: m.x, y: m.y, colour: m.colour, updates: m.updates }])),
    transport: () => hub.inspect(),
    paths: () => hub.paths(),
    dropPeer: (ep: string) => hub.dropPeer(ep),
  };
  document.documentElement.dataset.jjHost = 'hello';
}
