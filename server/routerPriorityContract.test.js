import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backend = fs.readFileSync(
  path.resolve(currentDir, '..', 'router', 'smartwan.d', 'backend.sh'),
  'utf8',
);

function priority(name) {
  const match = backend.match(new RegExp(`${name}="\\$\\{${name}:-([0-9]+)\\}"`));
  return Number(match?.[1]);
}

test('managed routing priorities preserve failover before location exceptions and source pins', () => {
  assert.equal(priority('SMARTWAN_PRIORITY_FAILOVER'), 82);
  assert.equal(priority('SMARTWAN_PRIORITY_WAN_SOURCE'), 83);
  assert.equal(priority('SMARTWAN_PRIORITY_ASUS_EXCEPTION'), 94);
  assert.equal(priority('SMARTWAN_PRIORITY_DMZ'), 95);
  assert.equal(priority('SMARTWAN_PRIORITY_ASUS_SOURCE'), 97);
  assert.ok(priority('SMARTWAN_PRIORITY_FAILOVER') < priority('SMARTWAN_PRIORITY_ASUS_EXCEPTION'));
  assert.ok(priority('SMARTWAN_PRIORITY_FAILOVER') < priority('SMARTWAN_PRIORITY_WAN_SOURCE'));
  assert.ok(priority('SMARTWAN_PRIORITY_WAN_SOURCE') < priority('SMARTWAN_PRIORITY_ASUS_EXCEPTION'));
  assert.ok(priority('SMARTWAN_PRIORITY_ASUS_EXCEPTION') < priority('SMARTWAN_PRIORITY_DMZ'));
  assert.ok(priority('SMARTWAN_PRIORITY_DMZ') < priority('SMARTWAN_PRIORITY_ASUS_SOURCE'));
});

test('managed DMZ follows or blocks failover without outranking emergency routing', () => {
  assert.match(
    backend,
    /dmz_runtime_wan\(\)[\s\S]*?dmz_failover_mode" = "preferred_only"[\s\S]*?echo "blocked"/,
  );
  assert.match(
    backend,
    /ip rule add priority "\$SMARTWAN_PRIORITY_DMZ" from "\$dmz_target_ip" lookup "\$runtime_table"/,
  );
  assert.match(
    backend,
    /iptables -t nat -A VSERVER -i "\$runtime_ifname"[\s\S]*?-j "\$SMARTWAN_DMZ_NAT_CHAIN"/,
  );
  assert.match(
    backend,
    /reconcile_default_route\(\)[\s\S]*?reconcile_dmz_rules/,
  );
});

test('router-hosted VPN replies are pinned to the WAN address that received them', () => {
  assert.match(
    backend,
    /ip rule add priority "\$SMARTWAN_PRIORITY_WAN_SOURCE" from "\$source_ip" lookup "\$table"/,
  );
  assert.match(
    backend,
    /clear_vpn_rules\(\)[\s\S]*?delete_priority_exact "\$SMARTWAN_PRIORITY_WAN_SOURCE"/,
  );
});

test('multi-WAN interfaces use loose reverse-path filtering before VPN rules are applied', () => {
  assert.match(
    backend,
    /apply_wan_reverse_path_filter\(\)[\s\S]*?printf '2\\n' > "\$rp_filter_path"/,
  );
  assert.match(
    backend,
    /apply_rules\(\)[\s\S]*?apply_wan_reverse_path_filter[\s\S]*?apply_vpn_rules/,
  );
  assert.match(
    backend,
    /apply_vpn_only\(\)[\s\S]*?apply_wan_reverse_path_filter[\s\S]*?apply_vpn_rules/,
  );
});

test('ASUS destination exceptions are rebuilt before source-wide overrides', () => {
  assert.match(
    backend,
    /apply_rules\(\)[\s\S]*?apply_asus_destination_exceptions\s+apply_asus_source_overrides/,
  );
  assert.match(
    backend,
    /apply_asus_sources_only\(\)[\s\S]*?apply_asus_destination_exceptions\s+apply_asus_source_overrides/,
  );
  assert.match(
    backend,
    /ip rule add priority "\$SMARTWAN_PRIORITY_ASUS_EXCEPTION"[\s\\\n ]+from "\$source" to "\$destination" lookup "\$table"/,
  );
  const exceptionFunction = backend.match(
    /apply_asus_destination_exceptions\(\) \{([\s\S]*?)\n\}/,
  )?.[1] || '';
  assert.doesNotMatch(
    exceptionFunction,
    /\[ "\$source" = "\$vpn_subnet" \] && continue/,
  );
  assert.match(
    exceptionFunction,
    /printf '%s\\n' "\$pinned_sources" \| grep -Fqx "\$source" \|\| continue/,
  );
  assert.doesNotMatch(
    exceptionFunction,
    /grep -Fqx "\$source\|\$unit"/,
  );
});

test('temporary location exceptions never replace the emergency failover rule', () => {
  assert.match(
    backend,
    /ip rule add priority "\$SMARTWAN_PRIORITY_FAILOVER" lookup "\$table"/,
  );
  assert.match(
    backend,
    /delete_priority_exact "\$SMARTWAN_PRIORITY_ASUS_EXCEPTION"/,
  );
});

test('hybrid watchdog detects service failures that ICMP alone cannot see', () => {
  assert.match(backend, /watchdog_service_enabled="\$\{watchdog_service_enabled:-1\}"/);
  assert.match(backend, /curl[\s\S]*?--interface "\$swp_source_ip"[\s\S]*?--max-time "\$swp_timeout"/);
  assert.match(
    backend,
    /WAN_HEALTH_KIND="partial"[\s\S]*?WAN_HEALTH_DETAIL="ICMP works, but Internet service probes failed/,
  );
  assert.match(
    backend,
    /WAN_HEALTH_KIND="complete"[\s\S]*?WAN_HEALTH_REASON="physical_link_down"/,
  );
  assert.match(
    backend,
    /WAN_HEALTH_KIND="complete"[\s\S]*?WAN_HEALTH_REASON="internet_unreachable"/,
  );
  assert.match(backend, /record_wan_event "outage"[\s\S]*?"\$failed_kind" "\$failed_reason" "\$failed_detail"/);
});
