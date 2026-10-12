import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalIceServers } from '../ice.ts';

test('default TURN transports omit their redundant query, while endpoints, credentials and explicit TCP stay intact', () => {
  const input = [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:coturn:3479?transport=udp', 'turn:coturn:3479?transport=tcp', 'turns:relay:443?transport=tcp', 'turns:relay:443?transport=udp'], username: 'user', credential: 'credential' }];
  const copy = structuredClone(input);
  assert.deepEqual(canonicalIceServers(input), [{ ...input[0], urls: ['stun:stun.cloudflare.com:3478', 'turn:coturn:3479', 'turn:coturn:3479?transport=tcp', 'turns:relay:443', 'turns:relay:443?transport=udp'] }]);
  assert.deepEqual(input, copy, 'the API receipt stays unchanged');
});
