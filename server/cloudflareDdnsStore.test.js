import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDdnsWan } from './cloudflareDdnsStore.js';

const state = {
  status: { active_default_wan: 'wan1' },
  wanStatus: [
    { id: 'wan0', internetStatus: 'ok', publicIp: '198.51.100.10' },
    { id: 'wan1', internetStatus: 'ok', publicIp: '203.0.113.20' },
  ],
};

test('Cloudflare DDNS automatically follows the active SmartWAN default', () => {
  assert.equal(selectDdnsWan(state, 'auto')?.id, 'wan1');
});

test('Cloudflare DDNS respects an explicitly selected online WAN', () => {
  assert.equal(selectDdnsWan(state, 'wan0')?.publicIp, '198.51.100.10');
});

test('Cloudflare DDNS falls back to the remaining online WAN', () => {
  const degraded = {
    ...state,
    wanStatus: [
      { ...state.wanStatus[0], internetStatus: 'down' },
      state.wanStatus[1],
    ],
  };
  assert.equal(selectDdnsWan(degraded, 'wan0')?.id, 'wan1');
});

test('Cloudflare DDNS never publishes a last-confirmed stale WAN address', () => {
  const stateWithStaleIp = {
    status: { active_default_wan: 'wan1' },
    wanStatus: [
      { id: 'wan0', internetStatus: 'ok', publicIp: '198.51.100.10' },
      { id: 'wan1', internetStatus: 'ok', publicIp: '203.0.113.20', publicIpStale: true },
    ],
  };
  assert.equal(selectDdnsWan(stateWithStaleIp, 'auto')?.id, 'wan0');
});
