// Process-boundary regression for the journey fixture, independent of Docker/GPU availability.
// A slow container launch must not consume the real STUN binding-response readiness deadline.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveWithLocalStun } from './lib/stun.mjs';

test('STUN readiness starts after Docker starts the container, and teardown removes it', { timeout: 35_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-stun-startup-'));
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const previous = { PATH: process.env.PATH, JJ_SERVER_BIN: process.env.JJ_SERVER_BIN };
  const script = (name, source) => {
    const file = join(dir, name);
    writeFileSync(file, `#!${process.execPath}\n${source}`);
    chmodSync(file, 0o755);
    return file;
  };
  // Only Docker's lifecycle is substituted. Readiness still requires an actual loopback UDP response,
  // with the STUN success type, magic cookie and matching transaction ID used by the real fixture.
  script('which', 'process.exit(1);');
  script('docker', `
    const fs = require('node:fs'), dgram = require('node:dgram');
    const args = process.argv.slice(2), file = ${JSON.stringify(join(dir, 'args.json'))};
    if (args[0] === 'run') {
      fs.writeFileSync(file, JSON.stringify(args));
      setTimeout(() => { console.log('fixture-container'); }, 15_500);
    } else if (args[0] === 'logs') {
      const saved = JSON.parse(fs.readFileSync(file));
      const port = Number(saved.find(a => a.startsWith('--listening-port=')).split('=')[1]);
      const socket = dgram.createSocket('udp4');
      socket.on('message', (packet, peer) => {
        const reply = Buffer.from(packet); reply.writeUInt16BE(0x0101, 0);
        socket.send(reply, peer.port, peer.address);
      });
      socket.bind(port, '127.0.0.1');
    } else if (args[0] === 'rm') fs.writeFileSync(${JSON.stringify(join(dir, 'removed'))}, args.at(-1));
  `);
  const serverBin = script('server', `
    console.error('listening on 127.0.0.1:12345');
    setInterval(() => {}, 1000);
  `);
  let server;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.PATH = `${dir}:${previous.PATH}`;
    process.env.JJ_SERVER_BIN = serverBin;
    server = await serveWithLocalStun(dir, '/');
    assert.equal(server.origin, 'http://127.0.0.1:12345');
    assert.ok(JSON.parse(readFileSync(join(dir, 'args.json'))).includes('--detach'));
    await server.close();
    server = null;
    assert.match(readFileSync(join(dir, 'removed'), 'utf8'), /^jj-journey-stun-/);
  } finally {
    await server?.close();
    Object.defineProperty(process, 'platform', platform);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
