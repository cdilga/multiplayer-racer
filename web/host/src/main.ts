// The host page. Until the round flow (G01) lands, it boots the sim worker on the greybox and draws it (P1-R01).
// `?test` (held, frame-stepped) or `?test=live` loads the test surface chunk (P1-F05b): a production-realm server
// doesn't serve that chunk, so there the import fails and the host runs as shipped.
// Renderer options: `?renderer=webgpu|webgl2|webgl` (backend.ts), `?res=0.75` (the Render resolution setting, R111),
// `?synthetic=<cars>[&freeze=<tick>]` (draw from the synthetic snapshot source instead of the sim), `?bench` (P1-R01).
import greybox from '../../../maps/greybox-loop.json?raw';
import { BUILD_LABEL } from '../../shared/src/build';
import { mountDrawer } from './input/drawer';
import { LocalInput } from './input/local';
import { backendFromQuery, createBackend } from './render/backend';
import { checkCapability, showUnsupported } from './render/capability';
import { mountOverlay } from './render/overlay';
import { SyntheticSource } from './render/synthetic';
import { World } from './render/world';
import { SimClient } from './worker/client';

const app = document.querySelector<HTMLElement>('#app')!;

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
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
  const scale = Number(params.get('res') ?? 1);
  const world = new World(backend, canvas, scale > 0 && scale <= 1 ? scale : 1);
  mountOverlay(document.body, world, BUILD_LABEL);
  (window as unknown as { __jjRender: unknown }).__jjRender = { stats: () => ({ ...world.stats }), frame: () => world.frame() };

  if (params.has('synthetic')) {
    const freeze = params.get('freeze');
    const source = new SyntheticSource({ cars: Number(params.get('synthetic')) || 24, freezeAt: freeze === null ? undefined : Number(freeze) });
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
  world.attach(client);
  world.start();
  document.documentElement.dataset.jjHost = testing ? 'test' : 'ready';
}

void boot();
