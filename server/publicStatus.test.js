import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyActiveOutages,
  buildRoutingSummary,
  buildViewerRouting,
} from './publicStatus.js';

const state = {
  clients: [{ ip: '192.168.1.50', name: 'Living-room device', connectionType: 'wifi' }],
  dualWan: { enabled: true, mode: 'lb', ratio: '9:1', ruleCount: 30 },
  wanStatus: [
    { id: 'wan0', label: 'Fiber', asusPort: 'LAN', internetStatus: 'ok' },
    { id: 'wan1', label: 'LTE', asusPort: 'WAN', internetStatus: 'ok' },
  ],
  status: {
    active_default_wan: 'wan0',
    failover_override_active: '0',
    normal_dualwan_mode: 'lb',
  },
  config: { values: { host_rules: '', service_rules: '8.8.8.0/24=wan1', domain_rules: '' } },
  routes: '',
};

test('builds a friendly viewer routing summary from the shared router state', () => {
  const viewer = buildViewerRouting(state, '192.168.1.50');
  assert.equal(viewer.name, 'Living-room device');
  assert.equal(viewer.routingMode, 'balanced');
  assert.equal(viewer.profile, 'Dual WAN — Load Balance');
  assert.equal(viewer.routeCount, 30);
  assert.equal(viewer.serviceRuleCount, 1);
});

test('detects a complete ASUS Dual WAN full-traffic rule for the current device', () => {
  const pinnedState = {
    ...state,
    dualWan: {
      ...state.dualWan,
      raw: {
        wans_routing_rulelist:
          '<192.168.1.50>0.0.0.0/1>1<192.168.1.50>128.0.0.0/1>1',
      },
    },
  };
  const viewer = buildViewerRouting(pinnedState, '192.168.1.50');
  assert.equal(viewer.routingMode, 'pinned');
  assert.equal(viewer.assignedWan, 'wan1');
  assert.match(viewer.assignedWanLabel, /LTE/);
  assert.equal(viewer.failoverConfigured, false);
});

test('detects subnet-wide routing and reports configured SmartWAN failover', () => {
  const managedState = {
    ...state,
    status: { ...state.status, enabled: '1' },
    config: {
      values: {
        ...state.config.values,
        orchestration_enabled: '1',
      },
    },
    dualWan: {
      ...state.dualWan,
      raw: {
        wans_routing_rulelist:
          '<192.168.1.0/24>0.0.0.0/1>0<192.168.1.0/24>128.0.0.0/1>0',
      },
    },
  };
  const viewer = buildViewerRouting(managedState, '192.168.1.50');
  assert.equal(viewer.routingMode, 'pinned');
  assert.equal(viewer.assignedWan, 'wan0');
  assert.equal(viewer.failoverConfigured, true);
  assert.equal(viewer.profile, 'Dual WAN — Load Balance + SmartWAN Failover');
});

test('does not claim a pinned WAN for mixed or incomplete full-traffic rules', () => {
  const mixedState = {
    ...state,
    dualWan: {
      ...state.dualWan,
      raw: {
        wans_routing_rulelist:
          '<192.168.1.50>0.0.0.0/1>0<192.168.1.50>128.0.0.0/1>1<192.168.1.50>1.0.0.0/1>0',
      },
    },
  };
  const viewer = buildViewerRouting(mixedState, '192.168.1.50');
  assert.equal(viewer.routingMode, 'balanced');
});

test('reports a failed WAN and active failover', () => {
  const failoverState = {
    ...state,
    wanStatus: [
      { ...state.wanStatus[0], internetStatus: 'ok' },
      { ...state.wanStatus[1], internetStatus: 'failed' },
    ],
    status: {
      ...state.status,
      failover_override_active: '1',
      watchdog_state_last_failover_at: '2026-07-28 12:15:08',
    },
  };
  const routing = buildRoutingSummary(failoverState);
  assert.equal(routing.failoverActive, true);
  assert.equal(routing.wanStatus[1].online, false);
});

test('uses watchdog state when a redirected diagnostic probe reports both WANs online', () => {
  const failoverState = {
    ...state,
    status: {
      ...state.status,
      failover_override_active: '1',
      active_default_wan: 'wan1',
      watchdog_state_failed_wan: 'wan0',
      watchdog_state_last_switch_reason: 'wan0_failed_wan1_ok',
    },
  };

  const routing = buildRoutingSummary(failoverState);
  assert.equal(routing.wanStatus[0].online, false);
  assert.equal(routing.wanStatus[0].internetStatus, 'failed');
  assert.equal(routing.wanStatus[1].online, true);
  assert.equal(routing.activeWan, 'wan1');
  assert.equal(routing.recoveryPending, false);
});

test('shows recovery pending only after watchdog confirms both WAN probes', () => {
  const recoveringState = {
    ...state,
    status: {
      ...state.status,
      failover_override_active: '1',
      active_default_wan: 'wan1',
      watchdog_state_failed_wan: 'wan0',
      watchdog_state_last_switch_reason: 'all_wans_recovering',
    },
  };

  const routing = buildRoutingSummary(recoveringState);
  assert.equal(routing.wanStatus[0].online, true);
  assert.equal(routing.recoveryPending, true);
});

test('applies a new outage event immediately to a cached healthy router state', () => {
  const effectiveState = applyActiveOutages(state, [{
    id: 'router-outage-wan1',
    wanId: 'wan1',
    activeWan: 'wan0',
    startedAt: '2026-07-28T11:26:47.000Z',
  }]);

  const viewer = buildViewerRouting(effectiveState, '192.168.1.50');
  const routing = buildRoutingSummary(effectiveState);
  assert.equal(viewer.routingMode, 'failover');
  assert.equal(viewer.assignedWan, 'wan0');
  assert.equal(routing.failoverActive, true);
  assert.equal(routing.wanStatus[1].online, false);
  assert.equal(routing.activeWan, 'wan0');
  assert.equal(routing.outageKind, '');
});

test('an active failover overrides a static device rule pointing at the failed WAN', () => {
  const failoverState = applyActiveOutages({
    ...state,
    status: {
      ...state.status,
      failover_override_active: '1',
      active_default_wan: 'wan0',
      watchdog_state_failed_wan: 'wan1',
    },
    dualWan: {
      ...state.dualWan,
      raw: {
        wans_routing_rulelist:
          '<192.168.1.50>0.0.0.0/1>1<192.168.1.50>128.0.0.0/1>1',
      },
    },
  }, [{
    id: 'router-outage-wan1',
    wanId: 'wan1',
    activeWan: 'wan0',
    startedAt: '2026-08-10T13:57:14.000Z',
    outageKind: 'partial',
    failureReason: 'https_timeout',
    failureDetail: 'ICMP works, but HTTPS probes timed out',
  }]);

  const viewer = buildViewerRouting(failoverState, '192.168.1.50');
  const routing = buildRoutingSummary(failoverState);
  assert.equal(viewer.routingMode, 'failover');
  assert.equal(viewer.routingRuleSource, 'asus-dualwan-full-traffic');
  assert.equal(viewer.assignedWan, 'wan0');
  assert.match(viewer.assignedWanLabel, /Fiber/);
  assert.equal(routing.outageKind, 'partial');
  assert.equal(routing.failureReason, 'https_timeout');
  assert.equal(routing.wanStatus[1].limited, true);
  assert.equal(routing.allWansDown, false);
});

test('confirmed active outage classification overrides a fluctuating later probe', () => {
  const effectiveState = applyActiveOutages({
    ...state,
    status: {
      ...state.status,
      failover_override_active: '1',
      active_default_wan: 'wan0',
      watchdog_state_failed_wan: 'wan1',
      watchdog_state_failure_kind: 'complete',
      watchdog_state_failure_reason: 'internet_unreachable',
      watchdog_state_failure_detail: 'A later ICMP and service probe failed',
    },
  }, [{
    id: 'router-outage-wan1',
    wanId: 'wan1',
    activeWan: 'wan0',
    startedAt: '2026-08-10T13:57:14.000Z',
    outageKind: 'partial',
    failureReason: 'https_timeout',
    failureDetail: 'ICMP works, but Internet service probes failed',
  }]);

  assert.equal(effectiveState.status.watchdog_state_failure_kind, 'partial');
  assert.equal(effectiveState.status.watchdog_state_failure_reason, 'https_timeout');
  assert.match(effectiveState.status.watchdog_state_failure_detail, /ICMP works/);
});

test('publishes partial-failure diagnostics for the login panel and Aurelka', () => {
  const failoverState = {
    ...state,
    status: {
      ...state.status,
      failover_override_active: '1',
      active_default_wan: 'wan0',
      watchdog_state_failed_wan: 'wan1',
      watchdog_state_last_switch_reason: 'wan1_failed_wan0_ok',
      watchdog_state_failure_kind: 'partial',
      watchdog_state_failure_reason: 'https_timeout',
      watchdog_state_failure_detail: 'ICMP works, HTTPS probes timed out',
    },
  };

  const routing = buildRoutingSummary(failoverState);
  assert.equal(routing.outageKind, 'partial');
  assert.equal(routing.failureReason, 'https_timeout');
  assert.match(routing.failureDetail, /HTTPS/);
});

test('does not claim traffic uses a WAN when both connections are down', () => {
  const effectiveState = applyActiveOutages(state, [
    {
      id: 'router-outage-wan0',
      wanId: 'wan0',
      activeWan: '',
      startedAt: '2026-07-28T11:30:00.000Z',
    },
    {
      id: 'router-outage-wan1',
      wanId: 'wan1',
      activeWan: '',
      startedAt: '2026-07-28T11:30:01.000Z',
    },
  ]);

  const viewer = buildViewerRouting(effectiveState, '192.168.1.50');
  const routing = buildRoutingSummary(effectiveState);
  assert.equal(viewer.routingMode, 'offline');
  assert.equal(viewer.assignedWan, '');
  assert.equal(viewer.assignedWanLabel, '');
  assert.equal(routing.activeWan, '');
  assert.equal(routing.allWansDown, true);
  assert.equal(routing.wanStatus.every((wan) => !wan.online), true);
});

test('keeps the watchdog-selected WAN usable when its panel probe is inconclusive', () => {
  const effectiveState = applyActiveOutages({
    ...state,
    wanStatus: [
      { ...state.wanStatus[0], internetStatus: 'failed' },
      { ...state.wanStatus[1], internetStatus: 'failed' },
    ],
    status: {
      ...state.status,
      active_default_wan: '',
      failover_override_active: '1',
      watchdog_state_failed_wan: 'wan1',
      watchdog_state_last_switch_reason: 'wan1_failed_wan0_ok',
      watchdog_state_failure_kind: 'partial',
      watchdog_state_failure_reason: 'dns_resolution_failed',
    },
  }, [{
    id: 'router-outage-wan1',
    wanId: 'wan1',
    activeWan: 'wan0',
    startedAt: '2026-08-20T17:44:13.000Z',
    outageKind: 'partial',
    failureReason: 'dns_resolution_failed',
  }]);

  const viewer = buildViewerRouting(effectiveState, '192.168.1.50');
  const routing = buildRoutingSummary(effectiveState);
  assert.equal(routing.activeWan, 'wan0');
  assert.equal(routing.wanStatus[0].limited, true);
  assert.equal(routing.wanStatus[1].limited, true);
  assert.equal(routing.allWansDown, false);
  assert.equal(viewer.routingMode, 'failover');
  assert.equal(viewer.assignedWan, 'wan0');
});
