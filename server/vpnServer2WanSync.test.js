import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferServerWanFromRules,
  inferServerWanFromSmartwanForm,
  setServerWanInDualWanForm,
  setServerWanInSmartwanForm,
  inferServer2WanFromRules,
  inferServer2WanFromSmartwanForm,
  setServer2WanInDualWanForm,
  setServer2WanInSmartwanForm,
} from './vpnServer2WanSync.js';

test('detects and updates the independently configured WAN for Server 1', () => {
  const updatedRules = setServerWanInDualWanForm({ rules: [
    { source: '10.8.0.0/24', destination: '1.0.0.0/1', unit: '1' },
    { source: '10.8.0.0/24', destination: '128.0.0.0/1', unit: '1' },
  ] }, 'wan0', 1);
  assert.equal(inferServerWanFromRules(updatedRules.form.rules, 1), 'wan0');

  const updatedConfig = setServerWanInSmartwanForm({ vpnPreferredWan: 'wan1' }, 'wan0', 1);
  assert.equal(inferServerWanFromSmartwanForm(updatedConfig.form, 1), 'wan0');
});

test('detects the WAN used for all Server 2 traffic', () => {
  assert.equal(inferServer2WanFromRules([
    { source: '10.16.0.0/24', destination: '1.0.0.0/1', unit: '1' },
    { source: '10.16.0.0/24', destination: '128.0.0.0/1', unit: '1' },
  ]), 'wan1');
});

test('updates every whole-traffic Server 2 rule without touching other sources', () => {
  const result = setServer2WanInDualWanForm({
    rules: [
      { source: '10.16.0.0/24', destination: '1.0.0.0/1', unit: '0' },
      { source: '10.16.0.0/24', destination: '128.0.0.0/1', unit: '0' },
      { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '1' },
    ],
  }, 'wan1');
  assert.equal(result.changed, true);
  assert.deepEqual(result.form.rules.map((rule) => rule.unit), ['1', '1', '1']);
});

test('updates the SmartWAN Server 2 failover profile', () => {
  const result = setServer2WanInSmartwanForm({
    vpnAdditionalProfiles: 'tun23|10.24.0.0/24|wan0\ntun22|10.16.0.0/24|wan0',
  }, 'wan1');
  assert.equal(result.changed, true);
  assert.match(result.form.vpnAdditionalProfiles, /tun22\|10\.16\.0\.0\/24\|wan1/);
  assert.equal(inferServer2WanFromSmartwanForm(result.form), 'wan1');
});
