import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateIpv4, normalizeDmzPolicy } from './dmzOps.js';

test('managed DMZ accepts only private IPv4 LAN targets', () => {
  assert.equal(isPrivateIpv4('192.168.1.50'), true);
  assert.equal(isPrivateIpv4('10.0.0.8'), true);
  assert.equal(isPrivateIpv4('172.20.1.9'), true);
  assert.equal(isPrivateIpv4('203.0.113.20'), false);
  assert.equal(isPrivateIpv4('192.168.1.999'), false);
});

test('managed DMZ normalizes WAN and failover behavior safely', () => {
  assert.deepEqual(normalizeDmzPolicy({
    enabled: true,
    targetIp: ' 192.168.1.50 ',
    preferredWan: 'WAN1',
    failoverMode: 'preferred_only',
  }), {
    enabled: true,
    targetIp: '192.168.1.50',
    preferredWan: 'wan1',
    failoverMode: 'preferred_only',
  });
  assert.equal(normalizeDmzPolicy({ preferredWan: 'invalid' }).preferredWan, 'wan1');
  assert.equal(normalizeDmzPolicy({ failoverMode: 'invalid' }).failoverMode, 'follow_failover');
  assert.equal(normalizeDmzPolicy({ enabled: true, dmzEnabled: false }).enabled, false);
});
