import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDnsServers,
  parseClients,
  reconcileWanHealthWithWatchdog,
} from './routerOps.js';

test('normalizeDnsServers keeps ordered unique primary and secondary resolvers', () => {
  assert.deepEqual(
    normalizeDnsServers('1.1.1.1 8.8.8.8', '1.1.1.1', '', ['8.8.8.8']),
    ['1.1.1.1', '8.8.8.8'],
  );
});

test('parseClients preserves active Wi-Fi and Ethernet classification', () => {
  const clients = parseClients([
    '192.168.1.20|server|02:00:00:00:00:01|ethernet|1|1',
    '192.168.1.50|phone|02:00:00:00:00:02|wifi|1|2',
  ].join('\n'));

  assert.equal(clients.length, 2);
  assert.equal(clients[0].connectionType, 'ethernet');
  assert.equal(clients[0].active, true);
  assert.equal(clients[1].connectionType, 'wifi');
  assert.equal(clients[1].bridgePort, '2');
});

test('watchdog failover overrides a false-positive diagnostic WAN probe', () => {
  const reconciled = reconcileWanHealthWithWatchdog(
    [
      { id: 'wan0', internetStatus: 'ok' },
      { id: 'wan1', internetStatus: 'ok' },
    ],
    {
      failover_override_active: '1',
      watchdog_state_failed_wan: 'wan0',
      watchdog_state_last_switch_reason: 'wan0_failed_wan1_ok',
    },
  );

  assert.equal(reconciled[0].internetStatus, 'failed');
  assert.equal(reconciled[0].internetSource, 'watchdog');
  assert.equal(reconciled[1].internetStatus, 'ok');
});

test('watchdog recovery keeps the recovering WAN visible as online', () => {
  const wanStatus = [
    { id: 'wan0', internetStatus: 'ok' },
    { id: 'wan1', internetStatus: 'ok' },
  ];
  const reconciled = reconcileWanHealthWithWatchdog(wanStatus, {
    failover_override_active: '1',
    watchdog_state_failed_wan: 'wan0',
    watchdog_state_last_switch_reason: 'all_wans_recovering',
  });

  assert.deepEqual(reconciled, wanStatus);
});

test('classified health probes expose simultaneous WAN failures even without an override route', () => {
  const reconciled = reconcileWanHealthWithWatchdog(
    [
      { id: 'wan0', internetStatus: 'ok' },
      { id: 'wan1', internetStatus: 'ok' },
    ],
    {
      enabled: '1',
      watchdog_enabled: '1',
      wan0_health_result: 'complete_failure',
      wan1_health_result: 'partial_failure',
      failover_override_active: '0',
    },
  );

  assert.equal(reconciled[0].internetStatus, 'failed');
  assert.equal(reconciled[1].internetStatus, 'limited');
  assert.equal(reconciled[0].internetSource, 'watchdog-health');
  assert.equal(reconciled[1].internetSource, 'watchdog-health');
});

test('a partial failure remains diagnostic-only when full-WAN partial failover is disabled', () => {
  const wanStatus = [{ id: 'wan0', internetStatus: 'ok' }];
  const reconciled = reconcileWanHealthWithWatchdog(wanStatus, {
    enabled: '1',
    watchdog_enabled: '1',
    watchdog_partial_failover_enabled: '0',
    wan0_health_result: 'partial_failure',
    failover_override_active: '0',
  });

  assert.equal(reconciled[0].internetStatus, 'limited');
  assert.equal(reconciled[0].internetSource, 'watchdog-health');
});

test('a healthy watchdog result overrides an inconclusive panel ICMP probe', () => {
  const reconciled = reconcileWanHealthWithWatchdog(
    [{ id: 'wan0', internetStatus: 'failed', internetSource: 'forced' }],
    {
      enabled: '1',
      watchdog_enabled: '1',
      wan0_health_result: 'ok',
    },
  );

  assert.equal(reconciled[0].internetStatus, 'ok');
  assert.equal(reconciled[0].internetSource, 'watchdog-health');
});

test('partial watchdog diagnostics preserve the reason for the limited state', () => {
  const reconciled = reconcileWanHealthWithWatchdog(
    [{ id: 'wan1', internetStatus: 'failed' }],
    {
      enabled: '1',
      watchdog_enabled: '1',
      wan1_health_result: 'partial_failure',
      wan1_health_outage_kind: 'partial',
      wan1_health_failure_reason: 'dns_resolution_failed',
      wan1_health_failure_detail: 'ICMP works, DNS failed',
    },
  );

  assert.equal(reconciled[0].internetStatus, 'limited');
  assert.equal(reconciled[0].failureReason, 'dns_resolution_failed');
  assert.match(reconciled[0].failureDetail, /DNS/);
});
