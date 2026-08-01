import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVpnPolicy, readOpenVpnClientProfile } from './vpnOps.js';

test('exports only SmartWAN VPN routing policy fields', () => {
  const result = exportVpnPolicy({
    vpnManagementEnabled: true,
    vpnInterface: 'tun21',
    vpnSubnet: '10.8.0.0/24',
    vpnAdditionalProfiles: 'tun22|10.16.0.0/24',
    vpnPolicyMode: 'prefer_wan_with_failover',
    vpnPreferredWan: 'wan1',
    password: 'must-not-leak',
    privateKey: 'must-not-leak',
  });

  assert.equal(result.format, 'smartwan-vpn-policy');
  assert.equal(result.policy.vpnInterface, 'tun21');
  assert.equal(result.policy.vpnAdditionalProfiles, 'tun22|10.16.0.0/24');
  assert.equal(result.policy.vpnPreferredWan, 'wan1');
  assert.equal('password' in result.policy, false);
  assert.equal('privateKey' in result.policy, false);
});

test('rejects an invalid OpenVPN server unit before connecting', async () => {
  await assert.rejects(
    readOpenVpnClientProfile({}, 3),
    /must be 1 or 2/,
  );
});
