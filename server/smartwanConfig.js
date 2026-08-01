const SAFE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function shellConfigValue(value) {
  return `'${String(value ?? '').replace(/'/g, `'"'"'`)}'`;
}

export function validatePresetName(name) {
  if (!SAFE_NAME.test(name || '')) {
    throw new Error('Preset name must use 1-64 letters, numbers, dot, dash, or underscore characters.');
  }
  return name;
}

export function parseSmartwanConfig(raw = '') {
  const values = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, valueRaw] = match;
    let value = valueRaw.trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value.replace(/'"'"'/g, "'");
  }
  return values;
}

function normalizeBoolean(value) {
  return value === true || value === '1' || value === 'true' || value === 'on' ? '1' : '0';
}

function normalizeList(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(';');
}

function normalizeScalar(value, fallback = '') {
  return String(value ?? fallback)
    .replace(/[\r\n]/g, ' ')
    .trim();
}

export function buildSmartwanConfig(input = {}) {
  const generatedAt = new Date().toISOString();
  const values = {
    enabled: normalizeBoolean(input.enabled),
    active_preset: normalizeScalar(input.activePreset),
    routing_mode: normalizeScalar(input.routingMode, 'manual_rules'),
    orchestration_enabled: normalizeBoolean(input.orchestrationEnabled),
    orchestration_mode: normalizeScalar(input.orchestrationMode, 'observe_only'),
    auto_discover_wans: normalizeBoolean(input.autoDiscoverWans ?? true),
    health_probe_strategy: normalizeScalar(input.healthProbeStrategy, 'per_wan_public_ipv4'),
    health_probe_policy: normalizeScalar(input.healthProbePolicy, 'majority'),
    failover_action: normalizeScalar(input.failoverAction, 'runtime_policy_override'),
    restore_action: normalizeScalar(input.restoreAction, 'restore_dualwan_balance'),
    suspend_asus_rules_on_failover: normalizeBoolean(input.suspendAsusRulesOnFailover ?? true),
    restore_asus_rules_on_recovery: normalizeBoolean(input.restoreAsusRulesOnRecovery ?? true),
    conntrack_on_switch: normalizeScalar(input.conntrackOnSwitch, 'failed_wan'),
    remembered_dualwan_preset: normalizeScalar(input.rememberedDualWanPreset),
    primary_wan: normalizeScalar(input.primaryWan, 'wan0'),
    failover_wan: normalizeScalar(input.failoverWan, 'wan1'),
    manage_main_default: normalizeBoolean(input.manageMainDefault),
    wan0_label: normalizeScalar(input.wan0Label),
    wan1_label: normalizeScalar(input.wan1Label),
    wan0_ifname: normalizeScalar(input.wan0Ifname),
    wan1_ifname: normalizeScalar(input.wan1Ifname),
    wan0_gateway: normalizeScalar(input.wan0Gateway),
    wan1_gateway: normalizeScalar(input.wan1Gateway),
    wan0_table: normalizeScalar(input.wan0Table, '100'),
    wan1_table: normalizeScalar(input.wan1Table, '101'),
    service_rules: normalizeList(input.serviceRules),
    domain_rules_enabled: normalizeBoolean(input.domainRulesEnabled),
    domain_rules: normalizeList(input.domainRules),
    host_rules: normalizeList(input.hostRules),
    watchdog_enabled: normalizeBoolean(input.watchdogEnabled),
    watchdog_targets: normalizeList(input.watchdogTargets),
    watchdog_interval: normalizeScalar(input.watchdogInterval, '1'),
    watchdog_fail_count: normalizeScalar(input.watchdogFailCount, '2'),
    watchdog_recover_count: normalizeScalar(input.watchdogRecoverCount, '3'),
    vpn_management_enabled: normalizeBoolean(input.vpnManagementEnabled),
    vpn_interface: normalizeScalar(input.vpnInterface, 'tun21'),
    vpn_subnet: normalizeScalar(input.vpnSubnet, '10.8.0.0/24'),
    vpn_additional_profiles: normalizeList(input.vpnAdditionalProfiles),
    vpn_lan_subnet: normalizeScalar(input.vpnLanSubnet, '192.168.1.0/24'),
    vpn_policy_mode: normalizeScalar(input.vpnPolicyMode, 'prefer_wan_with_failover'),
    vpn_preferred_wan: normalizeScalar(input.vpnPreferredWan, 'wan1'),
    vpn_allow_router: normalizeBoolean(input.vpnAllowRouter ?? true),
    vpn_allow_lan: normalizeBoolean(input.vpnAllowLan ?? true),
    vpn_allow_internet: normalizeBoolean(input.vpnAllowInternet ?? true),
    vpn_nat_enabled: normalizeBoolean(input.vpnNatEnabled ?? true),
    dmz_enabled: normalizeBoolean(input.dmzEnabled),
    dmz_target_ip: normalizeScalar(input.dmzTargetIp),
    dmz_preferred_wan: normalizeScalar(input.dmzPreferredWan, 'wan1'),
    dmz_failover_mode: normalizeScalar(input.dmzFailoverMode, 'follow_failover'),
    runtime_dir: normalizeScalar(input.runtimeDir, '/tmp'),
    log_enabled: normalizeBoolean(input.logEnabled ?? true),
    log_max_lines: normalizeScalar(input.logMaxLines, '300'),
    test_mode: normalizeBoolean(input.testMode),
  };

  return [
    '# SmartWAN configuration managed by SmartWAN Manager.',
    `# Updated at ${generatedAt}.`,
    `enabled=${values.enabled}`,
    `active_preset=${shellConfigValue(values.active_preset)}`,
    `routing_mode=${shellConfigValue(values.routing_mode)}`,
    `orchestration_enabled=${values.orchestration_enabled}`,
    `orchestration_mode=${shellConfigValue(values.orchestration_mode)}`,
    `auto_discover_wans=${values.auto_discover_wans}`,
    `health_probe_strategy=${shellConfigValue(values.health_probe_strategy)}`,
    `health_probe_policy=${shellConfigValue(values.health_probe_policy)}`,
    `failover_action=${shellConfigValue(values.failover_action)}`,
    `restore_action=${shellConfigValue(values.restore_action)}`,
    `suspend_asus_rules_on_failover=${values.suspend_asus_rules_on_failover}`,
    `restore_asus_rules_on_recovery=${values.restore_asus_rules_on_recovery}`,
    `conntrack_on_switch=${shellConfigValue(values.conntrack_on_switch)}`,
    `remembered_dualwan_preset=${shellConfigValue(values.remembered_dualwan_preset)}`,
    `primary_wan=${shellConfigValue(values.primary_wan)}`,
    `failover_wan=${shellConfigValue(values.failover_wan)}`,
    `manage_main_default=${values.manage_main_default}`,
    `wan0_label=${shellConfigValue(values.wan0_label)}`,
    `wan1_label=${shellConfigValue(values.wan1_label)}`,
    `wan0_ifname=${shellConfigValue(values.wan0_ifname)}`,
    `wan1_ifname=${shellConfigValue(values.wan1_ifname)}`,
    `wan0_gateway=${shellConfigValue(values.wan0_gateway)}`,
    `wan1_gateway=${shellConfigValue(values.wan1_gateway)}`,
    `wan0_table=${shellConfigValue(values.wan0_table)}`,
    `wan1_table=${shellConfigValue(values.wan1_table)}`,
    `service_rules=${shellConfigValue(values.service_rules)}`,
    `domain_rules_enabled=${values.domain_rules_enabled}`,
    `domain_rules=${shellConfigValue(values.domain_rules)}`,
    `host_rules=${shellConfigValue(values.host_rules)}`,
    `watchdog_enabled=${values.watchdog_enabled}`,
    `watchdog_targets=${shellConfigValue(values.watchdog_targets)}`,
    `watchdog_interval=${shellConfigValue(values.watchdog_interval)}`,
    `watchdog_fail_count=${shellConfigValue(values.watchdog_fail_count)}`,
    `watchdog_recover_count=${shellConfigValue(values.watchdog_recover_count)}`,
    `vpn_management_enabled=${values.vpn_management_enabled}`,
    `vpn_interface=${shellConfigValue(values.vpn_interface)}`,
    `vpn_subnet=${shellConfigValue(values.vpn_subnet)}`,
    `vpn_additional_profiles=${shellConfigValue(values.vpn_additional_profiles)}`,
    `vpn_lan_subnet=${shellConfigValue(values.vpn_lan_subnet)}`,
    `vpn_policy_mode=${shellConfigValue(values.vpn_policy_mode)}`,
    `vpn_preferred_wan=${shellConfigValue(values.vpn_preferred_wan)}`,
    `vpn_allow_router=${values.vpn_allow_router}`,
    `vpn_allow_lan=${values.vpn_allow_lan}`,
    `vpn_allow_internet=${values.vpn_allow_internet}`,
    `vpn_nat_enabled=${values.vpn_nat_enabled}`,
    `dmz_enabled=${values.dmz_enabled}`,
    `dmz_target_ip=${shellConfigValue(values.dmz_target_ip)}`,
    `dmz_preferred_wan=${shellConfigValue(values.dmz_preferred_wan)}`,
    `dmz_failover_mode=${shellConfigValue(values.dmz_failover_mode)}`,
    `runtime_dir=${shellConfigValue(values.runtime_dir)}`,
    `log_enabled=${values.log_enabled}`,
    `log_max_lines=${shellConfigValue(values.log_max_lines)}`,
    `test_mode=${values.test_mode}`,
    '',
  ].join('\n');
}

export function configValuesToForm(values = {}) {
  const legacyHostRules = (values.rules_hosts || '')
    .split(',')
    .map((entry) => {
      const [host, wan] = entry.split('|');
      return host && wan ? `${host}=${wan}` : '';
    })
    .filter(Boolean)
    .join('\n');
  const legacyServiceRules = (values.rules_services || '')
    .split(',')
    .map((entry) => {
      const [, destination, wan] = entry.split('|');
      return destination && wan ? `${destination}=${wan}` : '';
    })
    .filter(Boolean)
    .join('\n');

  return {
    enabled: values.enabled ? values.enabled !== '0' : values.enable === '1',
    activePreset: values.active_preset || '',
    routingMode: values.routing_mode || 'manual_rules',
    orchestrationEnabled: values.orchestration_enabled === '1',
    orchestrationMode: values.orchestration_mode || 'observe_only',
    autoDiscoverWans: values.auto_discover_wans ? values.auto_discover_wans !== '0' : true,
    healthProbeStrategy: values.health_probe_strategy || 'per_wan_public_ipv4',
    healthProbePolicy: values.health_probe_policy || 'majority',
    failoverAction: values.failover_action || 'runtime_policy_override',
    restoreAction: values.restore_action || 'restore_dualwan_balance',
    suspendAsusRulesOnFailover: values.suspend_asus_rules_on_failover ? values.suspend_asus_rules_on_failover !== '0' : true,
    restoreAsusRulesOnRecovery: values.restore_asus_rules_on_recovery ? values.restore_asus_rules_on_recovery !== '0' : true,
    conntrackOnSwitch: values.conntrack_on_switch || 'failed_wan',
    rememberedDualWanPreset: values.remembered_dualwan_preset || '',
    primaryWan: values.primary_wan || 'wan0',
    failoverWan: values.failover_wan || 'wan1',
    manageMainDefault: values.manage_main_default === '1',
    wan0Label: values.wan0_label || '',
    wan1Label: values.wan1_label || '',
    wan0Ifname: values.wan0_ifname || '',
    wan1Ifname: values.wan1_ifname || '',
    wan0Gateway: values.wan0_gateway || '',
    wan1Gateway: values.wan1_gateway || '',
    wan0Table: values.wan0_table || '100',
    wan1Table: values.wan1_table || '101',
    serviceRules: (values.service_rules || '').split(';').filter(Boolean).join('\n') || legacyServiceRules,
    domainRulesEnabled: values.domain_rules_enabled === '1',
    domainRules: (values.domain_rules || '').split(';').filter(Boolean).join('\n'),
    hostRules: (values.host_rules || '').split(';').filter(Boolean).join('\n') || legacyHostRules,
    watchdogEnabled: values.watchdog_enabled === '1',
    watchdogTargets:
      (values.watchdog_targets || '').split(';').filter(Boolean).join('\n') ||
      [values.health_ping1, values.health_ping2].filter(Boolean).join('\n'),
    watchdogInterval: values.watchdog_interval || '1',
    watchdogFailCount: values.watchdog_fail_count || '2',
    watchdogRecoverCount: values.watchdog_recover_count || '3',
    vpnManagementEnabled: values.vpn_management_enabled === '1',
    vpnInterface: values.vpn_interface || 'tun21',
    vpnSubnet: values.vpn_subnet || '10.8.0.0/24',
    vpnAdditionalProfiles: (values.vpn_additional_profiles || '').split(';').filter(Boolean).join('\n'),
    vpnLanSubnet: values.vpn_lan_subnet || '192.168.1.0/24',
    vpnPolicyMode: values.vpn_policy_mode || 'prefer_wan_with_failover',
    vpnPreferredWan: values.vpn_preferred_wan || 'wan1',
    vpnAllowRouter: values.vpn_allow_router ? values.vpn_allow_router !== '0' : true,
    vpnAllowLan: values.vpn_allow_lan ? values.vpn_allow_lan !== '0' : true,
    vpnAllowInternet: values.vpn_allow_internet ? values.vpn_allow_internet !== '0' : true,
    vpnNatEnabled: values.vpn_nat_enabled ? values.vpn_nat_enabled !== '0' : true,
    dmzEnabled: values.dmz_enabled === '1',
    dmzTargetIp: values.dmz_target_ip || '',
    dmzPreferredWan: values.dmz_preferred_wan || 'wan1',
    dmzFailoverMode: values.dmz_failover_mode === 'preferred_only' ? 'preferred_only' : 'follow_failover',
    runtimeDir: values.runtime_dir || '/tmp',
    logEnabled: values.log_enabled ? values.log_enabled !== '0' : true,
    logMaxLines: values.log_max_lines || '300',
    testMode: values.test_mode === '1',
  };
}
