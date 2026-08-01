import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSmartwanConfig, configValuesToForm, parseSmartwanConfig, validatePresetName } from './smartwanConfig.js';

test('builds and parses SmartWAN config', () => {
  const raw = buildSmartwanConfig({
    enabled: true,
    activePreset: 'office',
    routingMode: 'primary_failover',
    orchestrationEnabled: true,
    orchestrationMode: 'dualwan_balanced_managed',
    autoDiscoverWans: true,
    healthProbeStrategy: 'per_wan_public_ipv4',
    healthProbePolicy: 'majority',
    failoverAction: 'runtime_policy_override',
    restoreAction: 'restore_dualwan_balance',
    conntrackOnSwitch: 'failed_wan',
    rememberedDualWanPreset: 'office-routing',
    primaryWan: 'wan0',
    failoverWan: 'wan1',
    manageMainDefault: true,
    wan0Label: 'Primary',
    wan1Label: 'Backup',
    hostRules: '10.0.0.50=wan0\n10.0.0.60=wan1',
    serviceRules: '203.0.113.10/32=wan1',
    domainRulesEnabled: true,
    domainRules: 'google.com=wan1\nyoutube.com=wan1',
    watchdogEnabled: true,
    vpnManagementEnabled: true,
    vpnInterface: 'tun21',
    vpnSubnet: '10.8.0.0/24',
    vpnAdditionalProfiles: 'tun22|10.16.0.0/24',
    vpnLanSubnet: '192.168.1.0/24',
    vpnPolicyMode: 'prefer_wan_with_failover',
    vpnPreferredWan: 'wan1',
    dmzEnabled: true,
    dmzTargetIp: '192.168.1.50',
    dmzPreferredWan: 'wan1',
    dmzFailoverMode: 'preferred_only',
    testMode: true,
  });

  const values = parseSmartwanConfig(raw);
  assert.equal(values.enabled, '1');
  assert.equal(values.active_preset, 'office');
  assert.equal(values.routing_mode, 'primary_failover');
  assert.equal(values.orchestration_enabled, '1');
  assert.equal(values.orchestration_mode, 'dualwan_balanced_managed');
  assert.equal(values.auto_discover_wans, '1');
  assert.equal(values.health_probe_strategy, 'per_wan_public_ipv4');
  assert.equal(values.health_probe_policy, 'majority');
  assert.equal(values.failover_action, 'runtime_policy_override');
  assert.equal(values.restore_action, 'restore_dualwan_balance');
  assert.equal(values.conntrack_on_switch, 'failed_wan');
  assert.equal(values.suspend_asus_rules_on_failover, '1');
  assert.equal(values.restore_asus_rules_on_recovery, '1');
  assert.equal(values.remembered_dualwan_preset, 'office-routing');
  assert.equal(values.primary_wan, 'wan0');
  assert.equal(values.failover_wan, 'wan1');
  assert.equal(values.manage_main_default, '1');
  assert.equal(values.wan1_label, 'Backup');
  assert.equal(values.host_rules, '10.0.0.50=wan0;10.0.0.60=wan1');
  assert.equal(values.service_rules, '203.0.113.10/32=wan1');
  assert.equal(values.domain_rules_enabled, '1');
  assert.equal(values.domain_rules, 'google.com=wan1;youtube.com=wan1');
  assert.equal(values.watchdog_enabled, '1');
  assert.equal(values.vpn_management_enabled, '1');
  assert.equal(values.vpn_interface, 'tun21');
  assert.equal(values.vpn_additional_profiles, 'tun22|10.16.0.0/24');
  assert.equal(values.vpn_policy_mode, 'prefer_wan_with_failover');
  assert.equal(values.vpn_preferred_wan, 'wan1');
  assert.equal(values.dmz_enabled, '1');
  assert.equal(values.dmz_target_ip, '192.168.1.50');
  assert.equal(values.dmz_preferred_wan, 'wan1');
  assert.equal(values.dmz_failover_mode, 'preferred_only');
  assert.equal(values.test_mode, '1');

  const form = configValuesToForm(values);
  assert.equal(form.enabled, true);
  assert.equal(form.hostRules, '10.0.0.50=wan0\n10.0.0.60=wan1');
  assert.equal(form.routingMode, 'primary_failover');
  assert.equal(form.orchestrationEnabled, true);
  assert.equal(form.orchestrationMode, 'dualwan_balanced_managed');
  assert.equal(form.autoDiscoverWans, true);
  assert.equal(form.healthProbePolicy, 'majority');
  assert.equal(form.failoverAction, 'runtime_policy_override');
  assert.equal(form.restoreAction, 'restore_dualwan_balance');
  assert.equal(form.conntrackOnSwitch, 'failed_wan');
  assert.equal(form.rememberedDualWanPreset, 'office-routing');
  assert.equal(form.manageMainDefault, true);
  assert.equal(form.domainRulesEnabled, true);
  assert.equal(form.domainRules, 'google.com=wan1\nyoutube.com=wan1');
  assert.equal(form.vpnManagementEnabled, true);
  assert.equal(form.vpnInterface, 'tun21');
  assert.equal(form.vpnAdditionalProfiles, 'tun22|10.16.0.0/24');
  assert.equal(form.vpnPolicyMode, 'prefer_wan_with_failover');
  assert.equal(form.dmzEnabled, true);
  assert.equal(form.dmzTargetIp, '192.168.1.50');
  assert.equal(form.dmzPreferredWan, 'wan1');
  assert.equal(form.dmzFailoverMode, 'preferred_only');
});

test('validates preset names', () => {
  assert.equal(validatePresetName('service-routing_1'), 'service-routing_1');
  assert.throws(() => validatePresetName('../bad'), /Preset name/);
});

test('uses the fast watchdog defaults for a fresh SmartWAN configuration', () => {
  const values = parseSmartwanConfig(buildSmartwanConfig({}));
  assert.equal(values.watchdog_interval, '1');
  assert.equal(values.watchdog_fail_count, '2');
  assert.equal(values.watchdog_recover_count, '3');
});
