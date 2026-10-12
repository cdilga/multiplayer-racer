// Same-engine WebKit journeys need real STUN in Linux CI: the container cannot resolve .local ICE names.
// Production already supplies STUN. Reuse the transport bank's real coturn/readiness shape, with TURN disabled.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { serve } from '../../../landing/tests/lib/site.mjs';

export async function serveWithLocalStun(dist, base) {
  const free = createSocket('udp4');
  await new Promise(resolve => free.bind(0, '127.0.0.1', resolve));
  const port = free.address().port;
  free.close();
  const child = spawn('turnserver', ['-n', '--stun-only', '--no-auth', '--listening-ip=127.0.0.1',
    `--listening-port=${port}`, '--realm=jj.test', '--no-tls', '--no-cli',
    '--relay-threads=1', '--log-file=stdout'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', failure;
  child.once('error', error => { failure = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { log += chunk; });
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => { child.once('close', resolve); child.kill(); });
  };
  const request = Buffer.concat([Buffer.from([0, 1, 0, 0, 0x21, 0x12, 0xa4, 0x42]), randomBytes(12)]);
  try {
    let ready = false;
    for (const start = Date.now(); Date.now() - start < 15000 && !ready;) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`local STUN exited: ${log}`);
      ready = await new Promise(resolve => {
        const socket = createSocket('udp4');
        let finished = false;
        const done = value => {
          if (finished) return;
          finished = true; clearTimeout(timer); socket.close(); resolve(value);
        };
        const timer = setTimeout(() => done(false), 500);
        socket.on('message', packet => {
          if (packet.length >= 20 && packet.readUInt16BE(0) === 0x0101 && packet.readUInt32BE(4) === 0x2112a442
              && packet.subarray(8, 20).equals(request.subarray(8, 20))) done(true);
        });
        socket.once('error', () => done(false));
        socket.send(request, port, '127.0.0.1');
      });
      if (!ready) await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`local STUN never answered: ${log}`);
    const server = await serve(dist, base, { JJ_STUN_URLS: `stun:127.0.0.1:${port}` });
    return { ...server, close: async () => { try { await server.close(); } finally { await stop(); } } };
  } catch (error) { await stop(); throw error; }
}
