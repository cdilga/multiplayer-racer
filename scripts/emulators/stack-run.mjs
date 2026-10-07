#!/usr/bin/env node
// P1-F08: the lane's server side, run on eris (browsers and heavy work are not run on the Mac): jj-server, the lane
// proxy with the probe, and a real host page in Chromium. Prints `READY {"port":N,"code":"ABCD"}` and serves the
// lane's HTTP API (events, host observe/command, XCUITest command queue) until stdin closes or it is killed.
//   node scripts/emulators/stack-run.mjs --port 7461 [--dist web/dist-test/f08] [--gpu vulkan|native|swiftshader]
import path from 'node:path';
import { startHost, startStack, repo } from './lib/stack.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const dist = path.resolve(repo, opt('dist', 'web/dist-test/f08'));
const stack = await startStack({ dist, port: +opt('port', '0') });
const host = await startHost(stack.port, { gpu: opt('gpu', 'swiftshader') });
stack.hostApi.observe = host.observe;
stack.hostApi.command = host.command;
stack.hostApi.info = () => ({ code: host.code, errors: host.errors, port: stack.port });
const bye = async () => { try { await host.close(); await stack.stop(); } finally { process.exit(0); } };
process.stdin.on('end', bye); process.stdin.resume();
process.on('SIGTERM', bye); process.on('SIGINT', bye);
console.log('READY ' + JSON.stringify({ port: stack.port, code: host.code }));
