const DEMO_RESET_COMMAND = "Demo mode: use demo / demo";

const configForm = {
  enabled: true,
  activePreset: 'global-balanced',
  routingMode: 'manual_rules',
  orchestrationEnabled: true,
  orchestrationMode: 'dualwan_balanced_managed',
  autoDiscoverWans: true,
  healthProbeStrategy: 'per_wan_public_ipv4',
  healthProbePolicy: 'majority',
  failoverAction: 'runtime_policy_override',
  restoreAction: 'restore_dualwan_balance',
  suspendAsusRulesOnFailover: true,
  restoreAsusRulesOnRecovery: true,
  conntrackOnSwitch: 'failed_wan',
  rememberedDualWanPreset: 'global-balanced',
  primaryWan: 'wan0',
  failoverWan: 'wan1',
  manageMainDefault: false,
  wan0Label: 'Starlink',
  wan1Label: 'Orange Fiber',
  wan0Ifname: 'eth0',
  wan1Ifname: 'vlan4',
  wan0Gateway: '100.64.42.1',
  wan1Gateway: '10.24.0.1',
  wan0Table: '100',
  wan1Table: '101',
  serviceRules: '8.8.8.0/24=wan1\n1.1.1.1/32=wan0',
  domainRulesEnabled: false,
  domainRules: '',
  hostRules: '192.168.11.20=wan0',
  watchdogEnabled: true,
  watchdogTargets: '1.1.1.1\n8.8.8.8\n9.9.9.9',
  watchdogInterval: '1',
  watchdogFailCount: '2',
  watchdogRecoverCount: '3',
  vpnManagementEnabled: true,
  vpnInterface: 'tun21',
  vpnSubnet: '10.8.0.0/24',
  vpnAdditionalProfiles: 'tun22|10.16.0.0/24|wan0',
  vpnLanSubnet: '192.168.11.0/24',
  vpnPolicyMode: 'prefer_wan_with_failover',
  vpnPreferredWan: 'wan1',
  vpnAllowRouter: true,
  vpnAllowLan: true,
  vpnAllowInternet: true,
  vpnNatEnabled: true,
  dmzEnabled: false,
  dmzTargetIp: '',
  dmzPreferredWan: 'wan1',
  dmzFailoverMode: 'follow_failover',
  runtimeDir: '/tmp',
  logEnabled: true,
  logMaxLines: '300',
  testMode: false,
};

const dualWanForm = {
  enabled: true,
  primary: 'wan',
  secondary: 'lan',
  mode: 'lb',
  ratioPrimary: '7',
  ratioSecondary: '3',
  routingEnabled: true,
  lanPort: '4',
  rules: [
    { source: '192.168.11.20', destination: '1.0.0.0/1', unit: '0' },
    { source: '192.168.11.20', destination: '128.0.0.0/1', unit: '0' },
    { source: '192.168.11.0/24', destination: '8.8.8.0/24', unit: '1' },
    { source: '10.8.0.0/24', destination: '0.0.0.0/0', unit: '1' },
  ],
  rulesSource: 'router',
  rawRuleList: '<192.168.11.20>1.0.0.0/1>0<192.168.11.20>128.0.0.0/1>0<192.168.11.0/24>8.8.8.0/24>1',
};

const demoStore = {
  authenticated: false,
  language: new URLSearchParams(window.location.search).get('lang') === 'pl' ? 'pl' : 'en',
  phase: 'healthy',
  scenario: '',
  failed: [],
  failedWan: '',
  recoveryPending: false,
  timers: [],
  listeners: new Set(),
  messages: [
    {
      id: 'demo-welcome',
      nickname: 'SmartWAN Demo',
      authorIp: '192.0.2.25',
      message: 'Aurelka is watching both demo links.',
      createdAt: '2026-08-02T08:15:00.000Z',
    },
  ],
  settings: {
    router: {
      host: '192.168.11.1',
      port: 22,
      username: 'demo-router',
      authMethod: 'key',
      privateKeyPath: '/app/data/ssh/smartwan_panel_ed25519',
      remoteDir: '/jffs/scripts',
    },
    ui: {
      language: 'en',
      firmwareCompatibilityExpanded: false,
    },
  },
  configForm: { ...configForm },
  dualWanForm: { ...dualWanForm, rules: dualWanForm.rules.map((rule) => ({ ...rule })) },
};

demoStore.language = demoStore.language === 'pl' ? 'pl' : 'en';
demoStore.settings.ui.language = demoStore.language;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function notify(kind = 'state') {
  const snapshot = getSnapshot();
  demoStore.listeners.forEach((listener) => listener(snapshot, kind));
}

function getSnapshot() {
  return {
    authenticated: demoStore.authenticated,
    language: demoStore.language,
    phase: demoStore.phase,
    scenario: demoStore.scenario,
    failed: [...demoStore.failed],
    recoveryPending: demoStore.recoveryPending,
  };
}

function baseWanStatus() {
  return [
    {
      id: 'wan0',
      label: 'Starlink',
      operator: 'Starlink',
      asusPort: 'WAN',
      role: 'primary',
      ifname: 'eth0',
      table: '100',
      ipaddr: '100.64.42.18',
      gateway: '100.64.42.1',
      publicIp: '192.0.2.44',
      publicIpStatus: 'ok',
      publicIpSource: 'panel:default-route',
      dnsServers: ['1.1.1.1', '1.0.0.1'],
      dnsMode: 'manual',
      carrier: '1',
      operstate: 'up',
      linkStatus: 'up',
      dhcpStatus: 'bound',
      internetStatus: 'ok',
      internetTarget: '1.1.1.1',
      rxBytes: 9865421812,
      txBytes: 1824201120,
      defaultRoute: 'default via 100.64.42.1 dev eth0 table 100 metric 10',
    },
    {
      id: 'wan1',
      label: 'Orange Fiber',
      operator: 'Orange Fiber',
      asusPort: 'Ethernet LAN 4',
      role: 'secondary',
      ifname: 'vlan4',
      table: '101',
      ipaddr: '10.24.0.8',
      gateway: '10.24.0.1',
      publicIp: '198.51.100.88',
      publicIpStatus: 'ok',
      publicIpSource: 'curl:ifconfig.me',
      dnsServers: ['8.8.8.8', '8.8.4.4'],
      dnsMode: 'automatic',
      carrier: '1',
      operstate: 'up',
      linkStatus: 'up',
      dhcpStatus: 'bound',
      internetStatus: 'ok',
      internetTarget: '8.8.8.8',
      rxBytes: 18362440112,
      txBytes: 4524135421,
      defaultRoute: 'default via 10.24.0.1 dev vlan4 table 101 metric 20',
    },
  ];
}

function currentWanStatus() {
  return baseWanStatus().map((wan) => {
    if (!demoStore.failed.includes(wan.id)) return wan;
    return {
      ...wan,
      internetStatus: 'failed',
      internetTarget: wan.id === 'wan0' ? '1.1.1.1' : '8.8.8.8',
      rxBytes: wan.rxBytes,
      txBytes: wan.txBytes,
    };
  });
}

function statusForPhase() {
  const failed = demoStore.failed;
  const activeWan = failed.length === 0
    ? 'wan0'
    : failed.length === 1
      ? (failed[0] === 'wan0' ? 'wan1' : 'wan0')
      : '';
  return {
    enabled: '1',
    active_preset: 'global-balanced',
    active_default_wan: activeWan,
    effective_mode: 'dualwan_balanced_managed',
    orchestration_enabled: '1',
    orchestration_mode: 'dualwan_balanced_managed',
    failover_override_active: failed.length || demoStore.recoveryPending ? '1' : '0',
    watchdog_running: '1',
    watchdog_pid: '856',
    watchdog_interval: '1',
    watchdog_fail_count: '2',
    watchdog_recover_count: '3',
    watchdog_state_failed_wan: demoStore.failedWan,
    watchdog_state_last_switch_reason: demoStore.recoveryPending
      ? 'all_wans_recovering'
      : failed.length
        ? `${failed.join('_')}_failed`
        : 'all_wans_healthy',
    watchdog_state_last_failover_at: failed.length ? new Date().toISOString() : '',
    watchdog_state_last_recovery_at: demoStore.phase === 'healthy' ? new Date().toISOString() : '',
    normal_dualwan_mode: 'lb',
    wan0_label: 'Starlink',
    wan1_label: 'Orange Fiber',
    wan0_ifname: 'eth0',
    wan1_ifname: 'vlan4',
    vpn_interface_up: '1',
    vpn_interface_ip: '10.8.0.1',
    vpn_interface: 'tun21',
    vpn_subnet: '10.8.0.0/24',
    vpn_lan_subnet: '192.168.11.0/24',
    vpn_additional_profiles: 'tun22|10.16.0.0/24|wan0',
    hooks_installed: '1',
    runtime_dir: '/tmp',
    log_enabled: '1',
  };
}

const clients = [
  { name: 'Demo workstation', hostname: 'demo-pc', ip: '192.168.11.20', mac: '02:00:00:00:00:20', connectionType: 'ethernet', active: true },
  { name: 'Living room TV', hostname: 'demo-tv', ip: '192.168.11.51', mac: '02:00:00:00:00:51', connectionType: 'wifi', active: true },
  { name: 'Family phone', hostname: 'demo-phone', ip: '192.168.11.52', mac: '02:00:00:00:00:52', connectionType: 'wifi', active: true },
  { name: 'Home server', hostname: 'demo-server', ip: '192.168.11.60', mac: '02:00:00:00:00:60', connectionType: 'ethernet', active: true },
];

function configValues() {
  return {
    enabled: '1',
    active_preset: demoStore.configForm.activePreset,
    orchestration_enabled: '1',
    orchestration_mode: 'dualwan_balanced_managed',
    primary_wan: 'wan0',
    failover_wan: 'wan1',
    wan0_label: 'Starlink',
    wan1_label: 'Orange Fiber',
    wan0_ifname: 'eth0',
    wan1_ifname: 'vlan4',
    wan0_gateway: '100.64.42.1',
    wan1_gateway: '10.24.0.1',
    wan0_table: '100',
    wan1_table: '101',
    service_rules: demoStore.configForm.serviceRules,
    host_rules: demoStore.configForm.hostRules,
    watchdog_enabled: '1',
    watchdog_targets: demoStore.configForm.watchdogTargets,
    watchdog_interval: '1',
    watchdog_fail_count: '2',
    watchdog_recover_count: '3',
    vpn_management_enabled: '1',
    vpn_interface: 'tun21',
    vpn_subnet: '10.8.0.0/24',
    vpn_lan_subnet: '192.168.11.0/24',
    runtime_dir: '/tmp',
    log_enabled: '1',
  };
}

function routerState() {
  const status = statusForPhase();
  const wanStatus = currentWanStatus();
  const logState = demoStore.phase === 'healthy'
    ? '[info] SmartWAN watchdog: both links healthy\n[info] Dual WAN load balance restored (7:3)\n[info] apply complete'
    : demoStore.phase === 'checking'
      ? '[info] SmartWAN watchdog: checking WAN probes\n[info] waiting for majority result'
      : demoStore.recoveryPending
        ? `[info] ${demoStore.failedWan} probe restored\n[info] waiting for 3 successful recovery checks`
        : `[warn] ${demoStore.failed.join(' + ')} Internet probe failed\n[info] emergency routing override active`;
  return {
    ok: true,
    code: 0,
    stderr: '',
    identity: { model: 'RT-N18U', firmware: '386.3_3', uptime: '4 days, 1:55', hostname: 'demo-router' },
    jffs: { jffs2_scripts: '1' },
    dualWan: {
      enabled: true,
      mode: 'lb',
      ratio: '7:3',
      ruleCount: demoStore.dualWanForm.rules.length,
      primary: 'wan',
      secondary: 'lan',
      raw: { wans_routing_rulelist: demoStore.dualWanForm.rawRuleList },
    },
    security: { key_auth_selected: '1', panel_key_authorized: '1', panel_key_expected: '1' },
    capabilities: { curl: true, ip: true, nvram: true },
    network: {
      lan_ipaddr: '192.168.11.1',
      lan_netmask: '255.255.255.0',
      lan_subnet: '192.168.11.0/24',
      dhcp_start: '192.168.11.50',
      dhcp_end: '192.168.11.200',
      dns: '192.168.11.1',
      lan_dns_primary: '192.168.11.1',
      lan_dns_secondary: '1.1.1.1',
      lan_dns_servers: ['192.168.11.1', '1.1.1.1'],
      router_upstream_dns: ['1.1.1.1', '8.8.8.8'],
      nat_enabled: '1',
      nat_rules: '34',
      client_count: String(clients.length),
    },
    clients: clone(clients),
    wanStatus,
    files: { smartwanctl: '1', smartwan_conf: '1', backend: '1', wan_event: '1', services_start: '1' },
    memory: { totalKb: 262144, usedKb: 153600, availableKb: 108544, usedPercent: 59 },
    system: { loadAverage: '0.19 0.14 0.09', cpuUsagePercent: 18, processCount: 87, temperatureC: 52 },
    filesystems: [{ filesystem: '/dev/mtdblock9', size: '64.0M', used: '18.4M', available: '45.6M', percent: '29%', mount: '/jffs' }],
    config: {
      raw: Object.entries(configValues()).map(([key, value]) => `${key}=${value}`).join('\n'),
      values: configValues(),
      form: clone(demoStore.configForm),
    },
    status,
    routes: [
      '--- ip rules ---',
      '100: from all lookup main',
      '150: from all fwmark 0x100 lookup 100',
      '160: from 192.168.11.0/24 to 1.1.1.1 lookup 100',
      '170: from 192.168.11.0/24 to 8.8.8.0/24 lookup 101',
      '--- route-main ---',
      'default scope global nexthop via 100.64.42.1 dev eth0 weight 7 nexthop via 10.24.0.1 dev vlan4 weight 3',
      '--- route-smartwan-100 ---',
      'default via 100.64.42.1 dev eth0',
      '--- route-smartwan-101 ---',
      'default via 10.24.0.1 dev vlan4',
    ].join('\n'),
    logs: logState,
    sections: { smartwan_status: Object.entries(status).map(([key, value]) => `${key}=${value}`).join('\n') },
  };
}

function publicWanStatus() {
  return currentWanStatus().map((wan) => ({
    id: wan.id,
    label: wan.label,
    operator: wan.operator,
    asusPort: wan.asusPort,
    internetStatus: wan.internetStatus,
    online: wan.internetStatus === 'ok',
  }));
}

function demoEvents() {
  return [
    {
      id: 'demo-recovery-1',
      type: 'recovery',
      severity: 'recovery',
      wanId: 'wan1',
      wanLabel: 'Orange Fiber',
      operator: 'Orange Fiber',
      source: 'router-watchdog',
      profile: 'global-balanced',
      device: 'Demo workstation',
      startedAt: '2026-08-01T18:12:20.000Z',
      endedAt: '2026-08-01T18:12:32.000Z',
      durationSeconds: 12,
      summary: 'WAN1 recovered after a short demonstration outage.',
      action: 'Dual WAN load balancing was restored.',
    },
    {
      id: 'demo-config-1',
      type: 'dualwan-config',
      severity: 'info',
      source: 'manual',
      profile: 'global-balanced',
      device: 'Demo workstation',
      startedAt: '2026-08-01T17:40:00.000Z',
      endedAt: '2026-08-01T17:40:00.000Z',
      summary: 'Dual WAN routing configuration updated.',
      action: 'Load balance ratio set to 7:3.',
    },
  ];
}

function publicNetworkMap() {
  const state = routerState();
  const wanStatus = publicWanStatus();
  const online = wanStatus.filter((wan) => wan.online);
  const activeWan = online.find((wan) => wan.id === state.status.active_default_wan) || online[0] || {};
  return {
    ok: true,
    identity: clone(state.identity),
    dualWan: clone(state.dualWan),
    wanStatus: clone(state.wanStatus),
    status: clone(state.status),
    network: {
      ...clone(state.network),
      wifi_client_count: 2,
      ethernet_client_count: 2,
      unknown_client_count: 0,
      active_client_count: 4,
    },
    clients: clone(clients),
    viewer: {
      ip: '192.168.11.20',
      name: 'Demo workstation',
      connectionType: 'ethernet',
      routingMode: demoStore.failed.length ? 'failover' : 'balanced',
      profile: demoStore.failed.length ? 'SmartWAN Failover' : 'Dual WAN — Load Balance + SmartWAN Failover',
      assignedWan: activeWan.id || '',
      assignedWanLabel: activeWan.label || '',
      routeCount: demoStore.dualWanForm.rules.length,
      serviceRuleCount: 2,
      description: demoStore.failed.length
        ? `Emergency routing is active through ${activeWan.label || 'the available WAN'}.`
        : 'Traffic is balanced between Starlink and Orange Fiber with automatic failover.',
    },
    routing: {
      profile: demoStore.failed.length ? 'SmartWAN Failover' : 'Dual WAN — Load Balance + SmartWAN Failover',
      failoverActive: demoStore.failed.length > 0 || demoStore.recoveryPending,
      failoverSince: demoStore.failed.length ? new Date().toISOString() : '',
      failedWan: demoStore.failedWan,
      recoveryPending: demoStore.recoveryPending,
      activeWan: activeWan.id || '',
      activeWanLabel: activeWan.label || '',
      routeCount: demoStore.dualWanForm.rules.length,
      wanStatus,
    },
    googleLocation: { visible: false },
    vpn: {
      interfaceUp: true,
      interface: 'tun21',
      subnet: '10.8.0.0/24',
      downloadAvailable: true,
      serverUnit: 1,
      filename: 'smartwan-demo-client.ovpn',
    },
    events: demoEvents(),
    eventStorage: { persistent: true, location: 'panel' },
    readOnly: true,
    stale: demoStore.phase === 'checking',
    lastSuccessfulAt: new Date().toISOString(),
    observedAt: new Date().toISOString(),
  };
}

function eventResponse() {
  const publicState = publicNetworkMap();
  return {
    events: demoEvents(),
    activeOutages: [],
    viewer: publicState.viewer,
    routing: publicState.routing,
    stale: publicState.stale,
    lastSuccessfulAt: publicState.lastSuccessfulAt,
    eventStorage: { persistent: true, location: 'panel', routerBuffer: 'ram', syncIntervalSeconds: 15 },
    monitoring: { failThreshold: 2, recoveryThreshold: 3, intervalSeconds: 1 },
  };
}

function response(data, status = 200, headers = {}) {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function readBody(init = {}) {
  if (!init.body) return {};
  if (typeof init.body === 'string') {
    try { return JSON.parse(init.body); } catch { return {}; }
  }
  return {};
}

function mergeSettings(patch = {}) {
  demoStore.settings = {
    ...demoStore.settings,
    ...patch,
    router: { ...demoStore.settings.router, ...(patch.router || {}) },
    ui: { ...demoStore.settings.ui, ...(patch.ui || {}) },
  };
  if (patch.ui?.language) {
    demoStore.language = patch.ui.language;
  }
  return clone(demoStore.settings);
}

function clearScenarioTimers() {
  demoStore.timers.forEach((timer) => window.clearTimeout(timer));
  demoStore.timers = [];
}

function setPhase(phase, failed = [], failedWan = '', recoveryPending = false) {
  demoStore.phase = phase;
  demoStore.failed = failed;
  demoStore.failedWan = failedWan;
  demoStore.recoveryPending = recoveryPending;
  notify('scenario');
}

function schedule(callback, delay) {
  const timer = window.setTimeout(callback, delay);
  demoStore.timers.push(timer);
}

function runScenario(target) {
  clearScenarioTimers();
  const failed = target === 'both' ? ['wan0', 'wan1'] : [target];
  demoStore.scenario = target;
  setPhase('checking', [], target === 'both' ? '' : target, false);
  schedule(() => setPhase('outage', failed, target === 'both' ? '' : target, false), 1400);
  schedule(() => setPhase('recovering', [], target === 'both' ? '' : target, true), 5200);
  schedule(() => {
    demoStore.scenario = '';
    setPhase('healthy', [], '', false);
  }, 8200);
}

function resetScenario() {
  clearScenarioTimers();
  demoStore.scenario = '';
  setPhase('healthy', [], '', false);
}

function fakeRouterSetup() {
  return {
    current: {
      identity: routerState().identity,
      dualWan: clone(demoStore.dualWanForm),
      smartwan: clone(demoStore.configForm),
      runtime: { files: routerState().files, status: routerState().status },
    },
    profiles: [{ name: 'global-balanced', savedAt: '2026-08-01T17:40:00.000Z' }],
  };
}

async function handleApi(path, method, init) {
  const body = await readBody(init);

  if (path === '/api/public/ui-language') {
    if (method === 'POST') {
      demoStore.language = ['pl', 'en'].includes(body.language) ? body.language : 'en';
      demoStore.settings.ui.language = demoStore.language;
      notify('language');
    }
    return response({ language: demoStore.language });
  }
  if (path === '/api/public/network-map') return response(publicNetworkMap());
  if (path === '/api/public/events') return response(eventResponse());
  if (path === '/api/public/aurelka-messages') {
    if (method === 'POST') {
      const message = {
        id: `demo-message-${Date.now()}`,
        nickname: String(body.nickname || 'Demo guest').slice(0, 24),
        authorIp: '192.0.2.25',
        message: String(body.message || '').slice(0, 180),
        createdAt: new Date().toISOString(),
      };
      demoStore.messages.unshift(message);
      demoStore.messages = demoStore.messages.slice(0, 5);
      return response({ message }, 201);
    }
    return response({ clientIp: '192.0.2.25', messages: clone(demoStore.messages) });
  }
  if (path === '/api/public/aurelka-preferences') {
    return response(method === 'POST'
      ? { saved: true, soundEnabled: body.soundEnabled !== false, animationEnabled: body.animationEnabled !== false, nickname: body.nickname || '' }
      : { soundEnabled: true, animationEnabled: true, nickname: '' });
  }
  if (path === '/api/public/vpn-profile') {
    return response('client\ndev tun\nremote demo.smartwan.invalid 1194\n# Demonstration profile only\n', 200, {
      'Content-Type': 'application/x-openvpn-profile',
      'Content-Disposition': 'attachment; filename="smartwan-demo-client.ovpn"',
    });
  }
  if (path === '/api/auth/status') {
    return response({
      configured: true,
      authenticated: demoStore.authenticated,
      username: 'demo',
      resetCommand: DEMO_RESET_COMMAND,
    });
  }
  if (path === '/api/auth/login') {
    if (body.username !== 'demo' || body.password !== 'demo') {
      return response({ error: 'Demo credentials are demo / demo.' }, 401);
    }
    demoStore.authenticated = true;
    notify('auth');
    return response({ authenticated: true, username: 'demo', configured: true });
  }
  if (path === '/api/auth/logout') {
    demoStore.authenticated = false;
    notify('auth');
    return response({ authenticated: false });
  }
  if (path === '/api/settings') {
    return response(method === 'POST' ? mergeSettings(body) : clone(demoStore.settings));
  }
  if (path === '/api/ssh/test') return response({ ok: true, code: 0, stdout: 'SmartWAN demo router reachable', stderr: '' });
  if (path === '/api/ssh/panel-key') {
    return response({
      exists: true,
      privateKeyPath: '/app/data/ssh/smartwan_panel_ed25519',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoOnlyKeyMaterialNeverUsedOnARealRouter smartwan-demo',
      fingerprint: 'SHA256:DEMOkeyFingerprintForInterfacePreviewOnly',
    });
  }
  if (path === '/api/ssh/host-key') {
    return response({ code: 0, stderr: '', keys: [{
      line: '192.168.11.1 ssh-ed25519 AAAAC3NzaDemoRouterHostKey',
      fingerprint: 'SHA256:DemoRouterHostFingerprint',
    }] });
  }
  if (path === '/api/router/state') return response(routerState());
  if (path === '/api/router/config') return response(routerState().config);
  if (path === '/api/router/config/apply') {
    demoStore.configForm = { ...demoStore.configForm, ...body };
    return response({ ok: true, form: clone(demoStore.configForm) });
  }
  if (path === '/api/router/presets') {
    return response({ presets: [{ name: 'global-balanced', size: 1248 }, { name: 'starlink-priority', size: 1176 }], activePreset: 'global-balanced' });
  }
  if (/^\/api\/router\/presets\/[^/]+$/.test(path)) {
    const name = decodeURIComponent(path.split('/').pop());
    return response({ ok: true, name, form: { ...clone(demoStore.configForm), activePreset: name } });
  }
  if (path === '/api/router/dualwan') return response({ form: clone(demoStore.dualWanForm), raw: {}, status: routerState().dualWan });
  if (path === '/api/router/dualwan/apply') {
    demoStore.dualWanForm = { ...demoStore.dualWanForm, ...body, rules: clone(body.rules || demoStore.dualWanForm.rules) };
    return response({ ok: true, form: clone(demoStore.dualWanForm) });
  }
  if (path === '/api/router/dualwan/presets') {
    return response({
      activePreset: 'global-balanced',
      activePresetMatchType: 'exact',
      additionalRuleCount: 0,
      presets: [
        { name: 'global-balanced', active: true, matchType: 'exact', additionalRuleCount: 0, ruleCount: 4, config: clone(demoStore.dualWanForm) },
        { name: 'streaming-on-fiber', active: false, matchType: '', additionalRuleCount: 0, ruleCount: 6, config: clone(demoStore.dualWanForm) },
      ],
    });
  }
  if (/^\/api\/router\/dualwan\/presets\//.test(path)) return response({ ok: true });
  if (path === '/api/router/dualwan/routing-groups') {
    return response({ groups: [{
      id: 'demo-google',
      name: 'Google / YouTube / Gemini',
      primaryDomain: 'google.com',
      targetWan: '1',
      enabled: true,
      rules: [{ source: '192.168.11.0/24', destination: '8.8.8.0/24', targetWan: '1', unit: '1', enabled: true }],
    }] });
  }
  if (path === '/api/router/dualwan/google-location-policy') {
    return response({
      enabled: false,
      preferredCountryCode: 'PL',
      preferredCountryName: 'Poland',
      intervalMinutes: 60,
      preferredWan: 'auto',
      source: '192.168.11.0/24',
      sources: ['192.168.11.0/24'],
      configured: false,
      lastResult: null,
      lastKnownLocations: { wan0: null, wan1: null },
      lastCheckAt: '',
      nextCheckAt: '',
    });
  }
  if (path === '/api/router/dualwan/google-location-policy/check') {
    return response({ applied: false, checkedAt: new Date().toISOString(), nextCheckAt: new Date(Date.now() + 3600000).toISOString(), wans: [] });
  }
  if (path === '/api/router/dualwan/ai-provider') return response({ provider: 'openai', model: 'gpt-5.6-luna', baseUrl: 'https://api.openai.com', configured: false });
  if (path === '/api/router/dualwan/ai-generate') return response({ json: '{"groups":[]}', groups: [] });
  if (path === '/api/router/dmz') {
    return response({ enabled: false, targetIp: '', preferredWan: 'wan1', failoverMode: 'follow_failover', managed: true, native: { enabled: false, targetIp: '' }, runtime: { status: 'inactive', priority: '95' } });
  }
  if (path === '/api/router/setup-wizard') return response(fakeRouterSetup());
  if (path === '/api/router/setup-wizard/preview') return response({ changes: ['Dual WAN 7:3', 'SmartWAN watchdog 1s / 2 / 3'], commands: ['nvram set wans_mode=lb'], warnings: [] });
  if (path.startsWith('/api/router/setup-wizard/')) return response({ ...fakeRouterSetup(), backupFile: '/jffs/smartwan-demo-backup.json' });
  if (path === '/api/router/vpn/tailscale') return response({ enabled: true, running: true, connected: true, hostname: 'smartwan-demo', tailnet: 'demo.ts.net', addresses: ['100.100.0.20'], exitNode: true });
  if (path === '/api/router/vpn/cloudflare-ddns') return response({ enabled: false, configured: false, zoneName: 'demo.invalid', recordName: 'vpn.demo.invalid', preferredWan: 'wan1', serverUnit: 1, ttl: 120, proxied: false, lastSync: null });
  if (path.startsWith('/api/router/vpn/client-profile')) return response({ available: true, filename: 'smartwan-demo-client.ovpn', serverUnit: 1, content: '# Demonstration profile only' });
  if (path === '/api/router/vpn/export-policy') return response({ demo: true, policy: clone(demoStore.configForm) });
  if (path === '/api/router/scripts/install') return response({ ok: true, installed: true });
  if (path.startsWith('/api/backups/')) return response({ demo: true, createdAt: new Date().toISOString(), kind: body.kind || 'full', router: { model: 'RT-N18U' } });
  if (path === '/api/events') return response(eventResponse());
  if (path === '/api/tools/wan-quality/history') {
    return response({ history: [{ id: 'demo-quality-1', startedAt: '2026-08-01T16:30:00.000Z', targetLabel: 'Both WANs', mode: 'parallel', scenarios: [{ wanId: 'wan0', wanLabel: 'Starlink', idleLatency: { avgMs: 31 }, downloadMbps: 187 }] }] });
  }
  if (path.startsWith('/api/tools/wan-quality/')) {
    return response({
      mode: body.mode || 'auto',
      targetLabel: 'Both WANs',
      scenarios: [
        { id: 'wan0', wanId: 'wan0', wanLabel: 'Starlink', interface: 'eth0', sourceIp: '100.64.42.18', gateway: '100.64.42.1', table: '100', idleLatency: { avgMs: 31, jitterMs: 4, lossPercent: 0 }, downloadMbps: 187, uploadMbps: 24 },
        { id: 'wan1', wanId: 'wan1', wanLabel: 'Orange Fiber', interface: 'vlan4', sourceIp: '10.24.0.8', gateway: '10.24.0.1', table: '101', idleLatency: { avgMs: 8, jitterMs: 1, lossPercent: 0 }, downloadMbps: 612, uploadMbps: 118 },
      ],
      combined: { potentialDownloadMbps: 799, bestSingleFlowDownloadMbps: 612 },
    });
  }
  return response({ ok: true, demo: true });
}

class DemoEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url) {
    this.url = String(url);
    this.readyState = DemoEventSource.OPEN;
    this.listeners = new Map();
    queueMicrotask(() => this.dispatch('open', { data: '' }));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
    const handler = this[`on${type}`];
    if (typeof handler === 'function') handler(event);
  }

  close() {
    this.readyState = DemoEventSource.CLOSED;
    this.listeners.clear();
  }
}

function installAudioPathAdapter() {
  const NativeAudio = window.Audio;
  if (!NativeAudio || NativeAudio.__smartWanDemoAdapter) return;
  function DemoAudio(source) {
    const value = typeof source === 'string' && source.startsWith('/audio/')
      ? `${import.meta.env.BASE_URL}${source.slice(1)}`
      : source;
    return new NativeAudio(value);
  }
  DemoAudio.prototype = NativeAudio.prototype;
  DemoAudio.__smartWanDemoAdapter = true;
  window.Audio = DemoAudio;
}

export function installDemoBackend() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    return handleApi(url.pathname, String(init.method || 'GET').toUpperCase(), init);
  };
  window.EventSource = DemoEventSource;
  installAudioPathAdapter();
  return demoBackend;
}

export const demoBackend = {
  getSnapshot,
  subscribe(listener) {
    demoStore.listeners.add(listener);
    return () => demoStore.listeners.delete(listener);
  },
  runScenario,
  resetScenario,
};
