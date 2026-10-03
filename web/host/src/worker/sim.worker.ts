// The host's shipped sim worker (P1-S02): jj-wasm-host built without the `testing` feature, behind the shared loop.
import * as wasm from './pkg/jj_wasm_host.js';
import { SimWorker } from './core';

new SimWorker(wasm);
