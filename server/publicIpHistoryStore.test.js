import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeWanPublicIpHistory } from './publicIpHistoryStore.js';

test('public IP history is isolated per WAN and a failed probe uses only that WAN history', () => {
  const history = {
    version: 1,
    wans: {
      wan0: { ip: '198.51.100.10', confirmedAt: '2026-08-09T10:00:00.000Z', source: 'curl-source:a', ifname: 'vlan3' },
      wan1: { ip: '203.0.113.20', confirmedAt: '2026-08-09T11:00:00.000Z', source: 'curl-source:b', ifname: 'vlan2' },
    },
  };
  const result = mergeWanPublicIpHistory([
    { id: 'wan0', ifname: 'vlan3', publicIp: '198.51.100.11', publicIpStatus: 'ok', publicIpSource: 'curl-source:https://api.ipify.org' },
    { id: 'wan1', ifname: 'vlan2', publicIp: '', publicIpStatus: 'probe_failed', publicIpSource: '' },
  ], history, '2026-08-10T12:00:00.000Z');

  assert.equal(result.wanStatus[0].publicIp, '198.51.100.11');
  assert.equal(result.wanStatus[0].publicIpStale, false);
  assert.equal(result.wanStatus[1].publicIp, '203.0.113.20');
  assert.equal(result.wanStatus[1].publicIpStatus, 'last_confirmed');
  assert.equal(result.wanStatus[1].publicIpStale, true);
  assert.equal(result.wanStatus[1].publicIpConfirmedAt, '2026-08-09T11:00:00.000Z');
});

test('legacy router cache cannot overwrite another WAN public IP history', () => {
  const result = mergeWanPublicIpHistory([
    { id: 'wan0', publicIp: '198.51.100.10', publicIpStatus: 'ok', publicIpSource: 'curl-source:https://api.ipify.org' },
    { id: 'wan1', publicIp: '198.51.100.10', publicIpStatus: 'ok', publicIpSource: 'cache' },
  ], {
    version: 1,
    wans: {
      wan0: null,
      wan1: { ip: '203.0.113.20', confirmedAt: '2026-08-09T11:00:00.000Z', source: 'curl-source:b', ifname: 'vlan2' },
    },
  }, '2026-08-10T12:00:00.000Z');

  assert.equal(result.wanStatus[0].publicIp, '198.51.100.10');
  assert.equal(result.wanStatus[1].publicIp, '203.0.113.20');
  assert.equal(result.history.wans.wan1.ip, '203.0.113.20');
});
