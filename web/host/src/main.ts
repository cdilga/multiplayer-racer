// The host page. Until the round flow (G01) and the renderer (R01) land, it boots the sim worker on the greybox and
// shows its build line. `?test` (held, frame-stepped) or `?test=live` loads the test surface chunk (P1-F05b): a
// production-realm server doesn't serve that chunk, so there the import fails and the host runs as shipped.
import greybox from '../../../maps/greybox-loop.json?raw';
import { BUILD_LABEL } from '../../shared/src/build';
import { SimClient } from './worker/client';

const app = document.querySelector<HTMLElement>('#app');
if (app) app.textContent = `${BUILD_LABEL} · host`;

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
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
  await client.start({ mapJson: greybox, seed }, testing ? { live: params.get('test') === 'live' } : {});
  client.followVisibility();
  testing?.attach(client, { mapJson: greybox, seed });
  document.documentElement.dataset.jjHost = testing ? 'test' : 'ready';
}

void boot();
