import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVpnProfile } from '../src/vpnProfiles.js';

test('preferred VPN profile keeps the selected ISP and permits SmartWAN failover', () => {
  const result = applyVpnProfile(
    { primaryWan: 'wan1', failoverWan: 'wan0', vpnPreferredWan: 'wan1' },
    'preferred_failover',
  );
  assert.equal(result.vpnManagementEnabled, true);
  assert.equal(result.vpnPolicyMode, 'prefer_wan_with_failover');
  assert.equal(result.vpnPreferredWan, 'wan1');
  assert.equal(result.vpnNatEnabled, true);
});

test('force failover profile follows the configured failover WAN role', () => {
  const result = applyVpnProfile(
    { primaryWan: 'wan1', failoverWan: 'wan0' },
    'force_failover',
  );
  assert.equal(result.vpnPolicyMode, 'force_wan');
  assert.equal(result.vpnPreferredWan, 'wan0');
});

test('LAN-only profile disables Internet forwarding and NAT', () => {
  const result = applyVpnProfile({}, 'lan_only');
  assert.equal(result.vpnAllowRouter, true);
  assert.equal(result.vpnAllowLan, true);
  assert.equal(result.vpnAllowInternet, false);
  assert.equal(result.vpnNatEnabled, false);
});
