import assert from 'node:assert/strict';
import test from 'node:test';
import { inferActiveWanRecovery, parseRouterJournal } from './wanEventStore.js';

test('parses bounded router transition journal records', () => {
  const entries = parseRouterJournal([
    '1|1753693200-outage-wan0|1753693200|2025-07-28 11:00:00|outage|wan0|primary_failed_failover_ok|wan1|3|dualwan_balanced_managed',
    '1|1753693260-recovery-wan0|1753693260|2025-07-28 11:01:00|recovery|wan0|primary_recovered|wan0|0|global_failover_active',
    'unsupported record',
  ].join('\n'));

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'router-1753693200-outage-wan0');
  assert.equal(entries[0].type, 'outage');
  assert.equal(entries[0].activeWan, 'wan1');
  assert.equal(entries[0].failures, 3);
  assert.equal(entries[1].type, 'recovery');
  assert.match(entries[1].at, /^2025-07-28T/);
});

test('infers recovery of the newly active WAN when failures swap between links', () => {
  const store = {
    activeOutages: {
      wan0: {
        id: 'router-outage-wan0',
        wanId: 'wan0',
        wanLabel: 'LTE / lan',
        operator: 'LTE',
        startedAt: '2026-07-28T10:05:23.000Z',
        profileBefore: 'Dual WAN — Load Balance',
        failoverProfile: 'SmartWAN Failover',
      },
    },
  };
  const inferred = inferActiveWanRecovery(store, {
    id: 'router-outage-wan1',
    type: 'outage',
    wanId: 'wan1',
    activeWan: 'wan0',
    at: '2026-07-28T10:08:12.000Z',
    routerTime: '2026-07-28 12:08:12',
  });

  assert.equal(inferred.type, 'recovery');
  assert.equal(inferred.wanId, 'wan0');
  assert.equal(inferred.activeWan, 'wan0');
  assert.equal(inferred.durationSeconds, 169);
  assert.equal(inferred.reason, 'active_wan_confirmed_recovered');
});

test('parses classified partial-outage diagnostics from journal version 2', () => {
  const [entry] = parseRouterJournal(
    '2|partial-wan1|1786350000|2026-08-10 15:00:00|outage|wan1|wan1_failed_wan0_ok|wan0|2|global_failover_active|partial|https_timeout|ICMP works, but HTTPS timed out',
  );

  assert.equal(entry.outageKind, 'partial');
  assert.equal(entry.failureReason, 'https_timeout');
  assert.match(entry.failureDetail, /ICMP works/);
});
