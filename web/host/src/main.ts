// The host page. Until the round flow (G01) lands, it boots the sim worker on the greybox and draws it (P1-R01).
// `?test` (held, frame-stepped) or `?test=live` loads the test surface chunk (P1-F05b): a production-realm server
// doesn't serve that chunk, so there the import fails and the host runs as shipped.
// Renderer options: `?renderer=webgpu|webgl2|webgl` (backend.ts), `?res=0.75` (override of the Render resolution setting, R111; also turns auto-lowering off), `?autores=off|injected`, `?maxcanvas=<px>` (test: a small browser canvas limit),
// `?synthetic=<cars>[&freeze=<tick>][&damage[=strip]]` (draw from the synthetic snapshot source instead of the sim), `?bench`
// (P1-R01), `?tiles=<n>[&lods=0,2][&follow=2,2][&orbit=120,120]`, `?map` (the greybox under the synthetic source), `?kitx=<n>`, `?cams=fp,tp,…`, `?camdist=near|mid|far`, `?mapUrl=<url>` (a plain chase-camera tile view until the grid, P1-R04).
import greyboxJson from '../../../maps/greybox-loop.json?raw';
import { BUILD_LABEL } from '../../shared/src/build';
import { mountDrawer } from './input/drawer';
import { mountGridOverlay } from './layout/overlay';
import { LocalInput } from './input/local';
import { backendFromQuery, createBackend } from './render/backend';
import { checkCapability, showUnsupported } from './render/capability';
import { MapRenderer } from './render/map/map';
import { paperQrCard } from '../../shared/ui';
import { NetBridge } from './net/bridge';
import { mountOverlay } from './render/overlay';
import { loadChoice, saveChoice } from './render/resolution';
import { mountResolutionSetting } from './render/settings';
import { SyntheticSource } from './render/synthetic';
import { World } from './render/world';
import { SimClient } from './worker/client';

const app = document.querySelector<HTMLElement>('#app')!;

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  // The walking skeleton (P1-G00): a room, a QR and one marker per controller.
  if (params.has('hello')) {
    (await import('./hello/hello')).mountHello(app);
    return;
  }
  if (params.has('bench')) {
    (await import('./render/bench')).mountBench(app);
    return;
  }
  // No room before the check passes (plan §10): a host that can't run explains why and offers Join.
  const cap = await checkCapability();
  if (!cap.ok) {
    showUnsupported(app, cap, new URL('../controller/', location.href).href);
    document.documentElement.dataset.jjHost = 'unsupported';
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'jj-world';
  app.replaceChildren(canvas);
  const backend = await createBackend(backendFromQuery(params), canvas);
  // The Render resolution (R111): `?res=` overrides (tests), otherwise the host's saved choice, otherwise Native.
  const override = params.has('res') ? Number(params.get('res')) : null;
  const chosen = override !== null && override > 0 && override <= 1 ? override : (loadChoice() ?? 1);
  const maxCanvas = Number(params.get('maxcanvas')); // test hook: pretends the browser's max canvas edge is this small
  if (maxCanvas > 0) backend.maxSize = Math.min(backend.maxSize, maxCanvas);
  const world = new World(backend, canvas, chosen);
  world.autoLower = override === null && params.get('autores') !== 'off';
  world.realFrameTimes = params.get('autores') !== 'injected';
  await world.loadVehicles();
  // `?mapUrl=<url>` drives a map from elsewhere (a procgen spike's output, P1-M02) instead of the greybox.
  const mapUrl = params.get('mapUrl');
  const greybox = mapUrl ? await (await fetch(mapUrl)).text() : greyboxJson;
  // The greybox until the round flow prepares maps (G01/M08a); `?kitx=10` repeats its dressing (a draw-count probe).
  const withMap = !params.has('synthetic') || params.has('map');
  if (withMap) world.loadMap(JSON.parse(greybox), { repeat: Number(params.get('kitx')) || 1 });
  const list = (k: string) => params.get(k)?.split(',').map(Number);
  if (params.has('tiles')) {
    world.tiles = { count: Number(params.get('tiles')) || 1, lods: list('lods'), follow: list('follow'), orbit: list('orbit') };
    // The grid's spare cells (P1-R04): the join QR points at the join page until rooms exist (G00).
    const overlay = mountGridOverlay(app, new URL('../controller/', location.href).href);
    world.onLayout = (layout, scale) => overlay.render(layout, scale);
    world.onArrows = (arrows, scale) => overlay.arrows(arrows, scale);
    // Cameras (P1-R05): `?cams=fp,tp,…` sets each seat's starting mode, `?camdist=near|mid|far` the host default.
    params.get('cams')?.split(',').forEach((m, k) => world.rig.setMode(k + 1, m === 'fp' ? 'fp' : 'tp'));
    const camdist = params.get('camdist');
    if (camdist === 'near' || camdist === 'mid' || camdist === 'far') world.rig.hostDistance = camdist;
  }
  const chip = mountOverlay(document.body, world, BUILD_LABEL);
  mountResolutionSetting(document.body, world, chip);
  (window as unknown as { __jjRender: unknown }).__jjRender = {
    stats: () => ({ ...world.stats }),
    frame: () => world.frame(),
    vehicles: (car?: number) => world.vehicles?.inspect(car),
    map: () => (world.map ? { ...world.map.stats, kit: Object.fromEntries([...world.map.kit].map(([id, im]) => [id, im.count])) } : null),
    kitBounds: () => MapRenderer.kitBounds(),
    props: () => world.propCounts(),
    cameras: () => world.rig.inspect(),
    setCamera: (seat: number, mode: 'fp' | 'tp') => world.rig.setMode(seat, mode),
    project: (x: number, y: number, z: number) => world.project(x, y, z),
    /** The host's Render resolution choice, as the setting does it (applied live, saved). */
    setResolution: (scale: number) => {
      world.setUserScale(scale);
      saveChoice(scale);
    },
    /** Test hook: feeds `seconds` of frame intervals of `ms` each to the frame budget, as if measured (virtual time). */
    injectFrameTimes: (ms: number, seconds: number) => {
      for (let t = 0; t < seconds * 1000; t += ms) world.noteFrameTime(ms);
      world.frame();
    },
    /** Per tile: its device-pixel rect on the canvas backing store (null without the grid). */
    tileRects: () => world.tileRects(),
    /** Per tile: on-screen size of the other cars (the far car's N px). */
    farCars: () => world.farCars(),
  };

  if (params.has('synthetic')) {
    const freeze = params.get('freeze');
    const source = new SyntheticSource({
      cars: Number(params.get('synthetic')) || 24,
      freezeAt: freeze === null ? undefined : Number(freeze),
      damage: params.has('damage'),
      strip: params.get('damage') === 'strip',
    });
    world.attach(source);
    if (freeze !== null) world.interp.fixedTick = Number(freeze) - 0.5;
    source.start();
    world.start();
    document.documentElement.dataset.jjHost = 'synthetic';
    return;
  }

  let testing: typeof import('./testing/testing') | null = null;
  if (params.has('test')) {
    try {
      testing = await import('./testing/testing');
    } catch {
      testing = null;
    }
  }
  const seed = 1;
  const client = new SimClient(testing?.createWorker());
  await client.start({ mapJson: greybox, seed }, testing ? { live: params.get('test') === 'live', describe: true } : {});
  client.followVisibility();
  canvas.addEventListener('webglcontextlost', () => client.lifecycle(document.visibilityState === 'visible', false));
  canvas.addEventListener('webglcontextrestored', () => client.lifecycle(document.visibilityState === 'visible', true));
  // Host pads and key clusters (P1-C05): players from their first press, listed in the input drawer.
  const input = new LocalInput(client);
  input.start();
  mountDrawer(document.body, input);
  testing?.attach(client, { mapJson: greybox, seed, input });
  // Free drive (P1-G04, a dev/test flag; the lobby never shows driving cars, R110): a room on the server, phones join
  // over WebRTC and drive Cruz Missiles on the greybox beside the host's pads and keys, one tile per car.
  if (params.has('drive')) await openFreeDrive(client, world, params);
  // A phone's camera toggle (SetCamera, P1-R05) switches its own tile: tiles follow cars, tile k is car k.
  client.onEvents = (events) => {
    for (const e of events) {
      const cam = e.CameraSet;
      if (cam) world.rig.setMode(Number(cam.car) + 1, cam.camera === 'FirstPerson' ? 'fp' : 'tp');
    }
  };
  world.attach(client);
  world.start();
  document.documentElement.dataset.jjHost = testing ? 'test' : 'ready';
}

async function openFreeDrive(client: SimClient, world: World, params: URLSearchParams): Promise<void> {
  const bridge = new NetBridge(client, () => {}, { iceTransportPolicy: params.get('ice') === 'relay' ? 'relay' : 'all' });
  world.tiles = { count: 1, auto: true };
  try {
    await bridge.open();
  } catch (e) {
    // No server (a bare dev server): drive locally with pads and keys only.
    console.warn('jj: no room server; free drive is local only', e);
  }
  const joinUrl = bridge.hub.joinUrl || new URL('../c', location.href).href;
  const overlay = mountGridOverlay(app, joinUrl);
  // Free drive always shows the paper QR with the code (the lobby's join panel is R07's), so phones can join any time.
  if (bridge.hub.code) {
    const card = paperQrCard({ url: joinUrl, code: bridge.hub.code, domain: new URL(joinUrl).host, size: 112 });
    card.classList.add('jj-drive-qr');
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2;margin:0';
    app.append(card);
  }
  world.onLayout = (layout, scale) => overlay.render(layout, scale);
  world.onArrows = (arrows, scale) => overlay.arrows(arrows, scale);
  (window as unknown as { __jjNet: unknown }).__jjNet = {
    code: () => bridge.hub.code,
    joinUrl: () => bridge.hub.joinUrl,
    inspect: () => bridge.inspect(),
    paths: () => bridge.hub.paths(),
    dropPeer: (ep: string) => bridge.hub.dropPeer(ep),
  };
}

void boot();
