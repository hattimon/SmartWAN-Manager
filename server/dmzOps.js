import { execCommand } from './sshClient.js';
import { applySmartwanConfig, readSmartwanConfig } from './routerOps.js';
import { shellQuote } from './smartwanConfig.js';

function remoteDir(settings) {
  return settings.smartwanDir || '/jffs/addons/smartwan.d';
}

function parseKeyValueBlock(raw = '') {
  const values = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function isPrivateIpv4(value = '') {
  const parts = String(value).trim().split('.').map(Number);
  if (
    parts.length !== 4
    || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return false;
  const [a, b] = parts;
  return (
    a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  );
}

export function normalizeDmzPolicy(input = {}) {
  const hasManagedFields = Object.prototype.hasOwnProperty.call(input, 'dmzEnabled');
  const preferredWan = String(input.preferredWan || input.dmzPreferredWan || 'wan1')
    .trim()
    .toLowerCase();
  const failoverMode = String(input.failoverMode || input.dmzFailoverMode || 'follow_failover')
    .trim()
    .toLowerCase();
  return {
    enabled: hasManagedFields
      ? (input.dmzEnabled === true || input.dmzEnabled === '1')
      : (input.enabled === true || input.enabled === '1'),
    targetIp: String(input.targetIp || input.dmzTargetIp || '').trim(),
    preferredWan: preferredWan === 'wan0' ? 'wan0' : 'wan1',
    failoverMode: failoverMode === 'preferred_only' ? 'preferred_only' : 'follow_failover',
  };
}

function nativeDmzEnabled(values = {}) {
  return values.native_dmz_enable === '1' || values.native_dmz_enable_x === '1';
}

async function readRuntimeState(settings) {
  const dir = remoteDir(settings);
  const command = [
    'printf "native_dmz_enable=%s\\n" "$(nvram get dmz_enable 2>/dev/null)"',
    'printf "native_dmz_enable_x=%s\\n" "$(nvram get dmz_enable_x 2>/dev/null)"',
    'printf "native_dmz_ip=%s\\n" "$(nvram get dmz_ip 2>/dev/null)"',
    'printf "native_dmz_ipaddr_x=%s\\n" "$(nvram get dmz_ipaddr_x 2>/dev/null)"',
    'printf "lan_ipaddr=%s\\n" "$(nvram get lan_ipaddr 2>/dev/null)"',
    `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && ${shellQuote(`${dir}/smartwanctl.sh`)} status 2>/dev/null | grep '^dmz_' || true`,
  ].join('; ');
  const result = await execCommand(settings, command, { timeoutMs: 15000 });
  if (result.code !== 0) {
    throw new Error(result.stderr || 'Could not read DMZ state from the router.');
  }
  return parseKeyValueBlock(result.stdout);
}

export async function readDmzPolicy(settings) {
  const [config, runtime] = await Promise.all([
    readSmartwanConfig(settings),
    readRuntimeState(settings),
  ]);
  const form = normalizeDmzPolicy(config.form);
  const nativeEnabled = nativeDmzEnabled(runtime);
  const nativeTargetIp = runtime.native_dmz_ip || runtime.native_dmz_ipaddr_x || '';
  return {
    enabled: form.enabled || nativeEnabled,
    targetIp: form.targetIp || nativeTargetIp,
    preferredWan: form.preferredWan,
    failoverMode: form.failoverMode,
    managed: form.enabled,
    native: {
      enabled: nativeEnabled,
      targetIp: nativeTargetIp,
    },
    routerLanIp: runtime.lan_ipaddr || '',
    runtime: {
      wan: runtime.dmz_runtime_wan || '',
      ifname: runtime.dmz_runtime_ifname || '',
      status: runtime.dmz_runtime_status || (nativeEnabled ? 'native_asus' : 'inactive'),
      natChainActive: runtime.dmz_nat_chain_active === '1',
      forwardChainActive: runtime.dmz_forward_chain_active === '1',
      returnRuleActive: runtime.dmz_return_rule_active === '1',
      priority: runtime.dmz_priority || '95',
    },
  };
}

export async function applyDmzPolicy(settings, input = {}) {
  const policy = normalizeDmzPolicy(input);
  if (policy.enabled && !isPrivateIpv4(policy.targetIp)) {
    throw new Error('DMZ target must be one private IPv4 address from the router LAN.');
  }

  const current = await readDmzPolicy(settings);
  if (policy.enabled && policy.targetIp === current.routerLanIp) {
    throw new Error('The ASUS router LAN address cannot be used as the DMZ target.');
  }

  const smartwan = await readSmartwanConfig(settings);
  const form = {
    ...smartwan.form,
    dmzEnabled: policy.enabled,
    dmzTargetIp: policy.targetIp,
    dmzPreferredWan: policy.preferredWan,
    dmzFailoverMode: policy.failoverMode,
  };
  const applied = await applySmartwanConfig(settings, form);
  if (applied.apply.code !== 0) {
    throw new Error(applied.apply.stderr || 'SmartWAN could not apply the managed DMZ policy.');
  }

  // The native ASUS DMZ has no physical-WAN selector. Once the user applies
  // the managed policy, disable the native rule once and rebuild the firewall
  // so it cannot expose the host through both WANs in parallel.
  const nativeResult = await execCommand(
    settings,
    [
      'native_changed=0',
      '[ "$(nvram get dmz_enable 2>/dev/null)" = "1" ] && { nvram set dmz_enable=0; native_changed=1; } || true',
      '[ "$(nvram get dmz_enable_x 2>/dev/null)" = "1" ] && { nvram set dmz_enable_x=0; native_changed=1; } || true',
      '[ "$native_changed" = "1" ] && { nvram commit; service restart_firewall; sleep 2; } || true',
      `${shellQuote(`${remoteDir(settings)}/smartwanctl.sh`)} apply`,
    ].join('; '),
    { timeoutMs: 30000 },
  );
  if (nativeResult.code !== 0) {
    throw new Error(nativeResult.stderr || 'The router firewall could not apply the managed DMZ policy.');
  }

  return {
    applied: true,
    nativeDmzDisabled: current.native.enabled,
    policy: await readDmzPolicy(settings),
    stdout: [applied.apply.stdout, nativeResult.stdout].filter(Boolean).join('\n').trim(),
  };
}
