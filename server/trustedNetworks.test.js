import assert from 'node:assert/strict';
import test from 'node:test';
import { ipInCidr, isTrustedLocalRequest, requestClientIp } from './trustedNetworks.js';

test('matches IPv4 addresses against trusted CIDR ranges', () => {
  assert.equal(ipInCidr('192.168.1.50', '192.168.0.0/16'), true);
  assert.equal(ipInCidr('10.8.0.3', '10.8.0.0/24'), true);
  assert.equal(ipInCidr('203.0.113.9', '192.168.0.0/16'), false);
});

test('accepts direct LAN clients and rejects public clients', () => {
  const local = { socket: { remoteAddress: '::ffff:192.168.1.50' }, headers: {} };
  const publicClient = { socket: { remoteAddress: '203.0.113.9' }, headers: {} };
  assert.equal(requestClientIp(local), '192.168.1.50');
  assert.equal(isTrustedLocalRequest(local), true);
  assert.equal(isTrustedLocalRequest(publicClient), false);
});

test('does not trust forwarded headers from an unconfigured proxy', () => {
  const previous = process.env.SMARTWAN_TRUSTED_PROXIES;
  delete process.env.SMARTWAN_TRUSTED_PROXIES;
  const request = {
    socket: { remoteAddress: '172.26.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.9' },
  };
  assert.equal(isTrustedLocalRequest(request), false);
  if (previous === undefined) delete process.env.SMARTWAN_TRUSTED_PROXIES;
  else process.env.SMARTWAN_TRUSTED_PROXIES = previous;
});
