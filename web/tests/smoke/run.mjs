#!/usr/bin/env node
// Runs the public smoke against a base URL, or against a fresh local jj-server when none is given (what CI does).
//   node web/tests/smoke/run.mjs                                    local server, all seven steps
//   node web/tests/smoke/run.mjs https://jammers-preview.dilger.dev/p/<id>/ [room,join-webrtc,...]
// Environment: SMOKE_ICE=relay (force TURN), SMOKE_OTHERS=<base>,… , SMOKE_MANDATORY=a,b ('' = none), SMOKE_JSON=1,
// JJ_CHROMIUM_GPU (as the journeys). Exit 0 on pass, 1 on a failed step (named in the output), 2 on usage.
import { build, serve } from '../../landing/tests/lib/site.mjs';
import { chromiumArgs } from '../journeys/lib/chromium.mjs';
import { KNOWN, runSmoke } from './smoke-flow.mjs';

const [baseArg, list] = process.argv.slice(2);
let server = null;
let base = baseArg;
try {
  if (!base) {
    server = await serve(build('./', 'smoke'), '/p/smoke/', { JJ_STUN_URLS: '' });
    base = `${server.origin}/p/smoke/`;
  }
  const r = await runSmoke({
    base,
    steps: list ? list.split(',').filter(Boolean) : KNOWN,
    mandatory: process.env.SMOKE_MANDATORY === undefined ? KNOWN : process.env.SMOKE_MANDATORY.split(',').filter(Boolean),
    relay: process.env.SMOKE_ICE === 'relay',
    others: (process.env.SMOKE_OTHERS ?? '').split(',').filter(Boolean),
    chromiumArgs,
  });
  console.log(process.env.SMOKE_JSON ? JSON.stringify(r) : r.ok ? `smoke: PASS ${r.steps.join(', ')}` : `smoke: FAIL step ${r.step}: ${r.why}`);
  process.exitCode = r.ok ? 0 : 1;
} finally {
  await server?.close();
}
