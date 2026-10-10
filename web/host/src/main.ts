// The host page. Until the round flow (G01) lands, it boots the sim worker on the greybox and draws it (P1-R01).
// `?test` (held, frame-stepped) or `?test=live` loads the test surface chunk (P1-F05b): a production-realm server
// doesn't serve that chunk, so there the import fails and the host runs as shipped.
// Renderer options: `?renderer=webgpu|webgl2|webgl` (backend.ts), `?res=0.75` (override of the Render resolution setting, R111; also turns auto-lowering off), `?autores=off|injected`, `?maxcanvas=<px>` (test: a small browser canvas limit),
// `?synthetic=<cars>[&freeze=<tick>][&damage[=strip]]` (draw from the synthetic snapshot source instead of the sim), `?bench`
// (P1-R01), `?tiles=<n>[&lods=0,2][&follow=2,2][&orbit=120,120]`, `?map` (the greybox under the synthetic source), `?kitx=<n>`, `?cams=fp,tp,…`, `?camdist=near|mid|far`, `?mapUrl=<url>` (a plain chase-camera tile view until the grid, P1-R04).
import greyboxJson from '../../../maps/greybox-loop.json?raw';
import { BUILD_LABEL } from '../../shared/src/build';
import { mountAudio } from './audio';
import { mountDrawer } from './input/drawer';
import { mountGridOverlay } from './layout/overlay';
import { LocalInput } from './input/local';
import { backendFromQuery, createBackend } from './render/backend';
import { checkCapability, showUnsupported } from './render/capability';
import { MapRenderer } from './render/map/map';
import { paperQrCard } from '../../shared/ui';
import { NetBridge } from './net/bridge';
import { mountRoundScreens, type RoundScreens } from './round/screens';
import { HostHub } from '../../shared/transport';
import { ClipRecorder, installHotkey } from './clips/recorder';
import { SessionRecorder } from './clips/session';
import { IdbStore } from './clips/store';
import { mountOverlay } from './render/overlay';
import { loadChoice, saveChoice } from './render/resolution';
import { mountResolutionSetting } from './render/settings';
import { SyntheticSource } from './render/synthetic';
import { rosterProfiles } from './render/vehicles/registry';
import { World } from './render/world';
import { SimClient } from './worker/client';

const app = document.querySelector<HTMLElement>('#app')!;

/** The room's round screens (lobby, results, per-tile HUD), once a real room has opened. */
let roundScreens: RoundScreens | null = null;

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
    /** Paused drawing (owner playtest 1): whether the world is held and how many frames it has skipped. */
    idle: () => ({ held: world.isHeld, skips: world.heldSkips }),
    frame: () => world.frame(),
    /** Compiled shader programs so far (WebGL backend; null elsewhere): a rise during a frame is a shader compile (P1-Q01's
     *  hitch attribution). Read by the perf helper once per frame; never logged. */
    programs: () => (world.backend.renderer as unknown as { info: { programs?: unknown[] } }).info.programs?.length ?? null,
    /** Capture hook (P1-R12): stops the frame loop, so the canvas keeps the frame just drawn (a short-lived flash included)
     *  for a screenshot that takes longer than the effect lives. */
    hold: () => world.stop(),
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
    /** The cars the grid's tiles follow, tile 1 first (a room's seated cars in seat-number order). */
    follow: () => world.tiles?.follow?.slice() ?? null,
    /** Cars showing Identify's number over them now (P1-R06). */
    identifyMarks: () => world.identifyMarks.active(),
    /** Every Identify mark put up over a car (car, label), oldest first. */
    identifyMarksShown: () => world.identifyMarks.shown.slice(),
    /** Per tile: on-screen size of the other cars (the far car's N px). */
    farCars: () => world.farCars(),
    /** Per tile: which of the world points (x, y, z) its camera has in view (P1-G05: is the debris visible there). */
    tilesSee: (pts: [number, number, number][]) => world.tilesSee(pts),
  };

  // Round-screen fixtures (P1-R07): `?roundfixture=lobby-32` draws a screen state from a fixture room view, no server.
  const fixture = params.get('roundfixture');
  if (fixture) {
    (await import('./round/fixture-testing')).mountFixture(app, world, fixture);
    return;
  }

  if (params.has('synthetic')) {
    const freeze = params.get('freeze');
    const source = new SyntheticSource({
      cars: Number(params.get('synthetic')) || 24,
      freezeAt: freeze === null ? undefined : Number(freeze),
      damage: params.has('damage'),
      strip: params.get('damage') === 'strip',
      mixed: params.get('vehicles') === 'mixed',
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
  await client.start({ mapJson: greybox, seed, vehicles: rosterProfiles() }, testing ? { live: params.get('test') === 'live', describe: true } : {});
  client.followVisibility();
  // Bug clips and the dev session recorder (P1-F07, P1-F12): Ctrl/Cmd+Shift+B saves a clip; the test surface attaches
  // its own recorders.
  if (!testing) {
    const clips = new ClipRecorder().attach(client);
    installHotkey(clips);
    new SessionRecorder(clips, { store: new IdbStore() }).start(client);
    (window as unknown as { __jjClips: ClipRecorder }).__jjClips = clips;
  }
  canvas.addEventListener('webglcontextlost', () => client.lifecycle(document.visibilityState === 'visible', false));
  canvas.addEventListener('webglcontextrestored', () => client.lifecycle(document.visibilityState === 'visible', true));
  // Host pads and key clusters (P1-C05): players from their first press, listed in the input drawer.
  const input = new LocalInput(client);
  input.start();
  mountDrawer(document.body, input);
  testing?.attach(client, { mapJson: greybox, seed, input });
  // The round loop (P1-G01) runs in the worker. A host page opens a room: the Lobby has no driving cars (R110) and a
  // round puts the players on the grid. Free drive (P1-G04, `?drive`) is the dev/test mode where claimed seats drive at
  // once; test-surface pages (`?test`) drive the same way unless they ask for the real room (`?room`). `?tiles` and
  // plain test pages stay offline (no server).
  const freeDrive = params.has('drive') || (testing !== null && !params.has('room'));
  if (freeDrive) client.input({ type: 'ui', ui: 'free-drive', on: true });
  const laps = Number(params.get('laps'));
  if (laps > 0) client.input({ type: 'ui', ui: `laps:${laps}` });
  const online = params.has('drive') || params.has('room') || (testing === null && !params.has('tiles'));
  if (online) await openRoom(client, world, params, freeDrive);
  // The real room prepares each round's map in the procgen worker (P1-M08a); free drive and plain test pages race the start map.
  if (online && !freeDrive) await (await import('./procgen/start')).startPreparation(client, world, params);
  (window as unknown as { __jjRoom: unknown }).__jjRoom = {
    view: () => client.room,
    start: () => client.input({ type: 'ui', ui: 'start' }),
    end: () => client.input({ type: 'ui', ui: 'end' }),
    /** The room's recent sim events with the host time they arrived (introspection, R90): the newest 500. */
    events: () => recentEvents.slice(),
    /** Identify pulses shown on the TV: seat, when the event arrived and the pulse went up (performance.now()), and
     *  the wall clock then (to time a phone's press on the same machine). */
    identified: () => identified.slice(),
  };
  const recentEvents: Array<{ at: number; event: Record<string, unknown> }> = [];
  const identified: Array<{ seat: number; at: number; shownAt: number; wall: number }> = [];
  // Each player's camera choice belongs to their car; tiles reflow as seats come and go, so it's reapplied per tile.
  const camOfCar = new Map<number, 'fp' | 'tp'>();
  // A player's own camera distance (C07): by seat, so it holds before the seat has a car and across tile reflows.
  const distOfSeat = new Map<number, 'near' | 'far'>();
  const applyDistances = () => {
    const follow = world.tiles?.follow;
    if (!follow) return;
    follow.forEach((car, k) => {
      const seat = client.room?.seats.find((st) => st.car === car)?.seat;
      world.rig.setDistance(k + 1, (seat !== undefined ? distOfSeat.get(seat) : undefined) ?? null);
    });
  };
  const applyCams = () => {
    applyDistances();
    const follow = world.tiles?.follow;
    for (const [car, mode] of camOfCar) {
      const tile = (follow ? follow.indexOf(car) : car) + 1;
      if (tile > 0) world.rig.setMode(tile, mode);
    }
    if (follow) follow.forEach((car, k) => camOfCar.has(car) || world.rig.setMode(k + 1, 'tp'));
  };
  // A phone's camera toggle (SetCamera, P1-R05) switches its own tile: tiles follow cars, tile k is car k.
  client.onEvents = (events) => {
    const at = performance.now();
    for (const e of events) {
      recentEvents.push({ at, event: e as Record<string, unknown> });
      if (recentEvents.length > 500) recentEvents.shift();
      // Identify (P1-R06): the seat's tile pulses; when it showed is recorded for the press-to-visible samples.
      const id = (e as { Identify?: { seat: number } }).Identify;
      if (id) {
        // Over the car in every view, and the pulse on its own tile (the HUD shows only in a race).
        const st = client.room?.seats.find((x) => x.seat === id.seat);
        if (st && st.car !== null) {
          const ink = getComputedStyle(document.documentElement).getPropertyValue(`--id-${st.colourIndex % 12}-on`).trim() || '#15203A';
          world.identifyMarks.flash(st.car, `#${st.number}`, `rgb(${st.rgb.join(' ')})`, ink);
        }
        if (roundScreens?.hud.identify(id.seat)) identified.push({ seat: id.seat, at, shownAt: performance.now(), wall: Date.now() });
      }
      const dist = e.CameraDistanceSet;
      if (dist) {
        if (dist.distance === 'Near') distOfSeat.set(Number(dist.seat), 'near');
        else if (dist.distance === 'Far') distOfSeat.set(Number(dist.seat), 'far');
        else distOfSeat.delete(Number(dist.seat));
        applyDistances();
        continue;
      }
      const cam = e.CameraSet;
      if (!cam) continue;
      camOfCar.set(Number(cam.car), cam.camera === 'FirstPerson' ? 'fp' : 'tp');
      applyCams();
    }
  };
  // Identity (P1-R06): each car is painted in its seat's colour, the same colour as that player's phone.
  let seatPaint = new Map<number, string>();
  let painted = false;
  client.watchRoom((room) => {
    // The page knows the round's phase (the input drawer folds away while racing so it covers no tile).
    document.body.dataset.jjPhase = room.phase;
    // In a room the grid's tiles are the seated cars in seat-number order: a car withdrawn by Leave or Sit out stays in
    // the world as scenery but loses its tile, so the grid reflows (G02).
    if (world.tiles?.auto) {
      const follow = room.seats.filter((st) => st.car !== null).sort((a, b) => a.number - b.number).map((st) => st.car!);
      if (follow.join() !== world.tiles.follow?.join()) {
        world.tiles.follow = follow;
        applyCams();
      }
    }
    seatPaint = new Map(room.seats.filter((st) => st.car !== null).map((st) => [st.car!, `#${st.rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`]));
    const v = world.vehicles;
    // The cars the seats picked in the lobby load their models now, so they are ready when the grid forms (R123).
    for (const st of room.seats) if (st.vehicle) void v?.ensureId(st.vehicle);
    if (!v || painted) return;
    painted = true;
    const palette = v.paintOf;
    v.paintOf = (car) => seatPaint.get(car) ?? palette(car);
  });
  world.attach(client);
  // The owner tuning menu (br-2sdu.1): previews only, and only in a browser the owner switched on with `?tune`
  // (remembered; `?tune=off` switches it off). Its code is a separate chunk that a production build never contains.
  if (__JJ_OWNER_TOOLS__ && ownerTools(params)) {
    void import('./tuning/panel').then(async (m) => {
      const prep = (window as unknown as { __jjPrepare?: { seeds(): Array<{ preparation: number; seed: number; lengthM?: number; reliefM?: number }>; regenerate(g?: string): void } }).__jjPrepare;
      // The generator rows exist where rounds are prepared in the procgen worker (the real room), not on free-drive pages.
      const generator = prep ? await import('./tuning/generator').then((g) => g.generatorHooks(prep)) : undefined;
      const panel = await m.mountTuningPanel(client, generator);
      (window as unknown as { __jjTune: unknown }).__jjTune = panel;
    });
  }
  // Paused means paused (owner playtest 1): the world stops drawing while the worker holds the sim, and wakes for a
  // moment when the room, an event, a setting or the page changes so menus and resizes still show.
  client.onPause = (reasons) => world.hold(reasons.length > 0);
  client.watchRoom(() => world.invalidate());
  client.watchEvents(() => world.invalidate());
  for (const t of ['pointerdown', 'keydown', 'input', 'resize'] as const) addEventListener(t, () => world.invalidate(), { passive: true });
  // Audio (P1-A03/A05/A07) taps the client's snapshot, event and room feeds last, so it wraps whatever the page set.
  mountAudio(client);
  world.start();
  document.documentElement.dataset.jjHost = testing ? 'test' : 'ready';
}

async function openRoom(client: SimClient, world: World, params: URLSearchParams, freeDrive: boolean): Promise<void> {
  const bridge = new NetBridge(client, () => {}, { iceTransportPolicy: params.get('ice') === 'relay' ? 'relay' : 'all' });
  world.tiles = { count: 1, auto: true };
  try {
    // A reload ends the room this tab left behind, then opens a new one; leaving the page ends this one (R84).
    await HostHub.endPrevious();
    await bridge.open();
    addEventListener('pagehide', () => bridge.hub.endOnUnload());
  } catch (e) {
    // No server (a bare dev server): drive locally with pads and keys only.
    console.warn('jj: no room server; free drive is local only', e);
  }
  const joinUrl = bridge.hub.joinUrl || new URL('../c', location.href).href;
  const overlay = mountGridOverlay(app, joinUrl);
  // Free drive always shows the paper QR with the code, so phones can join any time; a real room's join panel is the
  // round screens' (R07).
  if (freeDrive && bridge.hub.code) {
    const card = paperQrCard({ url: joinUrl, code: bridge.hub.code, domain: new URL(joinUrl).host, size: 112 });
    card.classList.add('jj-drive-qr');
    card.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2;margin:0';
    app.append(card);
  }
  world.onArrows = (arrows, scale) => overlay.arrows(arrows, scale);
  // The round screens (P1-R07) own the lobby and results; the per-tile HUD follows the tile rects the grid reports.
  // Diagnostics read the real network paths and the host's own numbers (owner playtest 1: the panel showed none);
  // Disband ends the room on the network side too.
  const hostStats = async () => {
    const pads = await client.inputStats().catch(() => []);
    const ages = pads.filter((p) => p.samples > 0).map((p) => p.p50);
    return { frameMs: world.stats.frameMs, p95Ms: world.stats.p95Ms ?? null, padAgeMs: ages.length ? Math.max(...ages) : null };
  };
  const screens = !freeDrive && bridge.hub.code ? mountRoundScreens(client, { code: bridge.hub.code, joinUrl, paths: () => bridge.hub.paths(), onDisband: () => void bridge.hub.end(), hostStats }) : null;
  roundScreens = screens;
  world.onLayout = (layout, scale) => {
    overlay.render(layout, scale);
    screens?.place(world.tileRects(), scale);
  };
  (window as unknown as { __jjNet: unknown }).__jjNet = {
    code: () => bridge.hub.code,
    joinUrl: () => bridge.hub.joinUrl,
    inspect: () => bridge.inspect(),
    paths: () => bridge.hub.paths(),
    dropPeer: (ep: string) => bridge.hub.dropPeer(ep),
  };
}

/** The owner flag: `?tune` switches the owner's tools on in this browser, `?tune=off` off; storage may be missing. */
function ownerTools(params: URLSearchParams): boolean {
  const KEY = 'jj-owner-tools';
  try {
    if (params.get('tune') === 'off') localStorage.removeItem(KEY);
    else if (params.has('tune')) localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch {
    return params.has('tune') && params.get('tune') !== 'off';
  }
}

declare const __JJ_OWNER_TOOLS__: boolean;

void boot();
