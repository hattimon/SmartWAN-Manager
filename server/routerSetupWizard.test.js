import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWizardProfile, compareSetupProfiles } from './routerSetupWizard.js';

const current = {
  identity: { model: 'RT-N18U', firmware: '386.3_3' },
  dualWan: {
    enabled: true,
    primary: 'lan',
    secondary: 'wan',
    mode: 'lb',
    ratioPrimary: '1',
    ratioSecondary: '9',
    routingEnabled: true,
    rules: [
      { source: '192.168.1.50', destination: '1.0.0.0/1', unit: '0' },
      { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '0' },
    ],
  },
  smartwan: {
    wan0Label: 'Fiber',
    wan1Label: 'LTE',
    watchdogTargets: '1.1.1.1\n8.8.8.8',
    vpnSubnet: '10.8.0.0/24',
    vpnLanSubnet: '192.168.1.0/24',
  },
};

test('first-run wizard preserves the current ASUS routing rule list', () => {
  const profile = buildWizardProfile(current, {
    name: 'RT-N18U reference',
    primaryPort: 'lan',
    secondaryPort: 'wan',
    mode: 'lb',
    ratioPrimary: '1',
    ratioSecondary: '9',
    routingEnabled: true,
    wan0Label: 'Fiber',
    wan1Label: 'LTE',
  });

  assert.deepEqual(profile.dualWan.rules, current.dualWan.rules);
  assert.equal(profile.identity.model, 'RT-N18U');
  assert.equal(profile.smartwan.orchestrationMode, 'dualwan_balanced_managed');
  assert.equal(profile.smartwan.healthProbeStrategy, 'per_wan_public_ipv4');
  assert.equal(profile.smartwan.watchdogInterval, '1');
  assert.equal(profile.smartwan.watchdogFailCount, '2');
  assert.equal(profile.smartwan.watchdogRecoverCount, '3');
  assert.equal(profile.smartwan.runtimeDir, '/tmp');
});

test('first-run wizard preview reports only changed operating fields', () => {
  const profile = buildWizardProfile(current, {
    primaryPort: 'lan',
    secondaryPort: 'wan',
    mode: 'lb',
    ratioPrimary: '2',
    ratioSecondary: '8',
    wan0Label: 'Fiber',
    wan1Label: 'LTE',
  });
  const changes = compareSetupProfiles(current, profile);

  assert.ok(changes.some((change) => change.key === 'dualWan.ratioPrimary'));
  assert.ok(changes.some((change) => change.key === 'dualWan.ratioSecondary'));
  assert.ok(!changes.some((change) => change.key.includes('rules')));
});
