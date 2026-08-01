import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDualWanPatch,
  resolveSmartWanPatch,
  resolveVpnPatch,
  smartWanConflictMessages,
  syncConfigWithDetectedWans,
} from '../src/configConflicts.js';

test('SmartWAN orchestration selects the conflict-free runtime ownership model', () => {
  const result = resolveSmartWanPatch({
    enabled: false,
    orchestrationEnabled: false,
    routingMode: 'manual_rules',
    manageMainDefault: true,
    watchdogEnabled: false,
    primaryWan: 'wan1',
    failoverWan: 'wan0',
  }, { orchestrationEnabled: true });

  assert.equal(result.config.enabled, true);
  assert.equal(result.config.routingMode, 'primary_failover');
  assert.equal(result.config.manageMainDefault, false);
  assert.equal(result.config.watchdogEnabled, true);
  assert.equal(result.config.failoverAction, 'runtime_policy_override');
});

test('SmartWAN never permits the same primary and failover WAN', () => {
  const result = resolveSmartWanPatch({
    primaryWan: 'wan0',
    failoverWan: 'wan1',
  }, { primaryWan: 'wan1' });

  assert.equal(result.config.primaryWan, 'wan1');
  assert.equal(result.config.failoverWan, 'wan0');
  assert.ok(result.messages.includes('conflictSameWan'));
});

test('ASUS routing rules automatically require load balance mode', () => {
  const result = resolveDualWanPatch({
    enabled: true,
    mode: 'fo',
    routingEnabled: false,
    primary: 'wan',
    secondary: 'lan',
  }, { routingEnabled: true });

  assert.equal(result.config.mode, 'lb');
  assert.equal(result.config.routingEnabled, true);
  assert.ok(result.messages.includes('conflictRulesRequireLoadBalance'));
});

test('VPN LAN-only access cannot retain internet NAT', () => {
  const result = resolveVpnPatch({
    vpnPolicyMode: 'lan_only',
    vpnAllowInternet: true,
    vpnNatEnabled: true,
  }, {});

  assert.equal(result.config.vpnAllowInternet, false);
  assert.equal(result.config.vpnNatEnabled, false);
});

test('orchestrator reports retained SmartWAN normal rules as inactive', () => {
  assert.deepEqual(
    smartWanConflictMessages({
      orchestrationEnabled: true,
      serviceRules: '8.8.8.0/24=wan1',
      hostRules: '',
      enabled: true,
      testMode: false,
      watchdogEnabled: true,
      manageMainDefault: false,
      routingMode: 'primary_failover',
      orchestrationMode: 'dualwan_balanced_managed',
      failoverAction: 'runtime_policy_override',
      suspendAsusRulesOnFailover: true,
      restoreAsusRulesOnRecovery: true,
    }, { mode: 'lb' }),
    ['conflictNormalRuleOwner'],
  );
});

test('detected interfaces keep Fiber and LTE semantic roles after ASUS port order changes', () => {
  const synced = syncConfigWithDetectedWans({
    autoDiscoverWans: true,
    primaryWan: 'wan0',
    failoverWan: 'wan1',
    vpnPreferredWan: 'wan0',
    wan0Label: 'Fiber',
    wan1Label: 'LTE',
  }, [
    { id: 'wan0', label: 'LTE', ifname: 'vlan3', gateway: '192.168.2.1', table: 'wan0' },
    { id: 'wan1', label: 'Fiber', ifname: 'vlan2', gateway: '192.168.3.1', table: 'wan1' },
  ]);

  assert.equal(synced.primaryWan, 'wan1');
  assert.equal(synced.failoverWan, 'wan0');
  assert.equal(synced.vpnPreferredWan, 'wan1');
  assert.equal(synced.wan0Label, 'LTE');
  assert.equal(synced.wan1Label, 'Fiber');
});
