import assert from 'node:assert/strict';
import test from 'node:test';
import { tailscalePreferenceArgs, validateTailscaleAccessConfig } from './tailscaleAccessStore.js';

test('normalizes Tailscale subnet router settings', () => {
  const config = validateTailscaleAccessConfig({
    enabled: true,
    hostname: 'SmartWAN-Panel',
    advertiseRoutes: ['192.168.1.0/24', '10.8.0.0/24', '192.168.1.0/24'],
    advertiseExitNode: true,
  });

  assert.equal(config.enabled, true);
  assert.equal(config.hostname, 'smartwan-panel');
  assert.deepEqual(config.advertiseRoutes, ['192.168.1.0/24', '10.8.0.0/24']);
  assert.equal(config.advertiseExitNode, true);
});

test('rejects invalid Tailscale routes and device names', () => {
  assert.throws(
    () => validateTailscaleAccessConfig({ hostname: 'bad name', advertiseRoutes: ['192.168.1.0/24'] }),
    /device name/i,
  );
  assert.throws(
    () => validateTailscaleAccessConfig({ hostname: 'panel', advertiseRoutes: ['192.168.1.0/99'] }),
    /Invalid IPv4 subnet/,
  );
});

test('builds explicit preferences that can enable and disable exit-node advertising', () => {
  const enabled = validateTailscaleAccessConfig({
    hostname: 'panel',
    advertiseRoutes: ['192.168.1.0/24'],
    advertiseExitNode: true,
  });
  const disabled = { ...enabled, advertiseExitNode: false };

  assert.ok(tailscalePreferenceArgs(enabled).includes('--advertise-exit-node=true'));
  assert.ok(tailscalePreferenceArgs(disabled).includes('--advertise-exit-node=false'));
});
