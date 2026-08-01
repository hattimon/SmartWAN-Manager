import fs from 'node:fs/promises';
import path from 'node:path';
import { KEY_DIR } from './configStore.js';
import { execCommand } from './sshClient.js';
import {
  buildSmartwanConfig,
  configValuesToForm,
  parseSmartwanConfig,
  shellQuote,
  validatePresetName,
} from './smartwanConfig.js';

function remoteDir(settings) {
  return settings.smartwanDir || '/jffs/addons/smartwan.d';
}

function parseSections(output) {
  const sections = {};
  let current = 'root';
  for (const line of output.split(/\r?\n/)) {
    const marker = line.match(/^__SMARTWAN_SECTION__([A-Za-z0-9_-]+)$/);
    if (marker) {
      current = marker[1];
      sections[current] = '';
    } else {
      sections[current] = `${sections[current] || ''}${line}\n`;
    }
  }
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.trim()]));
}

function parseKeyValueBlock(raw = '') {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function parseMeminfo(raw = '') {
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)/);
    if (match) {
      values[match[1]] = Number(match[2]);
    }
  }
  const total = values.MemTotal || 0;
  const available = values.MemAvailable || values.MemFree || 0;
  const used = total && available ? total - available : 0;
  return {
    totalKb: total,
    availableKb: available,
    usedKb: used,
    usedPercent: total ? Math.round((used / total) * 100) : null,
    raw,
  };
}

function parseDf(raw = '') {
  return raw
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('Filesystem'))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        filesystem: parts[0],
        size: parts[1],
        used: parts[2],
        available: parts[3],
        percent: parts[4],
        mount: parts.slice(5).join(' '),
      };
    });
}

function parseSystemMetrics(raw = '') {
  const values = parseKeyValueBlock(raw);
  return {
    processCount: values.process_count ? Number(values.process_count) : null,
    cpuUsagePercent: values.cpu_usage_percent ? Number(values.cpu_usage_percent) : null,
    temperatureC: values.temperature_c ? Number(values.temperature_c) : null,
    loadAverage: values.load_average || '',
    raw,
  };
}

function parseCapabilities(raw = '') {
  return parseKeyValueBlock(raw);
}

export function normalizeDnsServers(...values) {
  const candidates = values.flatMap((value) => (
    Array.isArray(value)
      ? value
      : String(value || '').split(/[\s,;]+/)
  ));
  return [...new Set(candidates
    .map((value) => String(value || '').trim())
    .filter((value) => (
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) ||
      (/^[0-9a-f:]+$/i.test(value) && value.includes(':'))
    )))];
}

export function parseClients(raw = '') {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        ip = '',
        name = '',
        mac = '',
        connectionType = 'unknown',
        active = '0',
        bridgePort = '',
      ] = line.split('|');
      return {
        ip,
        name: name === '*' ? '' : name,
        mac,
        connectionType,
        active: active === '1',
        bridgePort,
      };
    })
    .filter((client) => client.ip);
}

function failedWanFromWatchdog(status = {}) {
  const explicit = String(status.watchdog_state_failed_wan || '').trim().toLowerCase();
  if (/^wan[01]$/.test(explicit)) return explicit;
  const reason = String(status.watchdog_state_last_switch_reason || '').trim().toLowerCase();
  return reason.match(/^(wan[01])_failed_wan[01]_ok$/)?.[1] || '';
}

export function reconcileWanHealthWithWatchdog(wanStatus = [], status = {}) {
  if (status.failover_override_active !== '1') return wanStatus;
  const failedWan = failedWanFromWatchdog(status);
  const recoveryPending = status.watchdog_state_last_switch_reason === 'all_wans_recovering';
  if (!failedWan || recoveryPending) return wanStatus;

  return wanStatus.map((wan) => (
    wan.id === failedWan
      ? {
          ...wan,
          internetStatus: 'failed',
          internetTarget: wan.internetTarget || 'watchdog',
          internetSource: 'watchdog',
          watchdogOverride: true,
        }
      : wan
  ));
}

function parseWanStatus(raw = '') {
  const values = parseKeyValueBlock(raw);
  return ['wan0', 'wan1'].map((wan) => {
    const dnsModeRaw = values[`${wan}.dns_mode`] || '';
    return {
      id: wan,
      label: values[`${wan}.label`] || wan,
      asusUnit: values[`${wan}.asus_unit`] || wan.replace('wan', ''),
      asusPort: values[`${wan}.asus_port`] || '',
      ifname: values[`${wan}.ifname`] || '',
      gateway: values[`${wan}.gateway`] || '',
      table: values[`${wan}.table`] || '',
      tableNumeric: values[`${wan}.table_numeric`] || '',
      nvramUnit: values[`${wan}.nvram_unit`] || '',
      ipaddr: values[`${wan}.ipaddr`] || '',
      publicIp: values[`${wan}.public_ip`] || '',
      publicIpStatus: values[`${wan}.public_ip_status`] || '',
      publicIpSource: values[`${wan}.public_ip_source`] || '',
      dnsServers: normalizeDnsServers(
        values[`${wan}.dns_servers`],
        values[`${wan}.dns_primary`],
        values[`${wan}.dns_secondary`],
        values[`${wan}.dns_learned`],
      ),
      dnsMode: dnsModeRaw === '0' ? 'manual' : dnsModeRaw === '1' ? 'automatic' : 'detected',
      internetStatus: values[`${wan}.internet_status`] || '',
      internetTarget: values[`${wan}.internet_target`] || '',
      internetSource: values[`${wan}.internet_source`] || '',
      operstate: values[`${wan}.operstate`] || '',
      carrier: values[`${wan}.carrier`] || '',
      routeIfname: values[`${wan}.route_ifname`] || '',
      routeGateway: values[`${wan}.route_gateway`] || '',
      defaultRouteMatchesWan: values[`${wan}.default_route_matches_wan`] === '1',
      nvramState: values[`${wan}.nvram_state_t`] || '',
      nvramAuxState: values[`${wan}.nvram_auxstate_t`] || '',
      rxBytes: values[`${wan}.rx_bytes`] ? Number(values[`${wan}.rx_bytes`]) : null,
      txBytes: values[`${wan}.tx_bytes`] ? Number(values[`${wan}.tx_bytes`]) : null,
      defaultRoute: values[`${wan}.default_route`] || '',
    };
  });
}

function withDualWanRoles(wanStatus, dualWan) {
  const pair = String(dualWan?.raw?.wans_dualwan || '').trim().split(/\s+/).filter(Boolean);
  return wanStatus.map((wan) => {
    const unit = String(wan.nvramUnit || wan.asusUnit || wan.id.replace('wan', ''));
    const role = unit === '0' ? 'primary' : unit === '1' ? 'secondary' : '';
    const asusPort = wan.asusPort || (unit === '0' ? pair[0] || dualWan?.primary : unit === '1' ? pair[1] || dualWan?.secondary : '');
    return {
      ...wan,
      role,
      asusPort: asusPort || '',
    };
  });
}

function truthyNvram(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function parseAsusDualWanStatus(raw = '') {
  const values = parseKeyValueBlock(raw);
  const pair = String(values.wans_dualwan || '').trim().split(/\s+/).filter(Boolean);
  const secondary = pair[1] || values.wans_standby || '';
  const enabled =
    truthyNvram(values.wans_dualwan_enable) ||
    truthyNvram(values.wans_enable) ||
    truthyNvram(values.wans_routing_enable) ||
    Boolean(secondary && secondary !== 'none');

  return {
    enabled,
    primary: pair[0] || values.wans_primary || '',
    secondary,
    mode: values.wans_mode || '',
    ratio: values.wans_lb_ratio || '',
    routingEnabled: truthyNvram(values.wans_routing_enable),
    ruleCount: String(values.wans_routing_rulelist || '').split('<').filter(Boolean).length,
    raw: values,
  };
}

const PANEL_PUBLIC_IP_CACHE_MS = 15 * 1000;
let panelPublicIpCache = { checkedAt: 0, value: null };

function isPublicIpv4(ip) {
  const parts = String(ip || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

function extractPublicIpv4(text) {
  const matches = String(text || '').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
  return matches.find(isPublicIpv4) || '';
}

async function fetchPublicIp(url) {
  const controller = new globalThis.AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await globalThis.fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'SmartWAN Manager public IP probe' },
    });
    if (!response.ok) {
      return '';
    }
    return extractPublicIpv4(await response.text());
  } catch (_error) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function firstPanelPublicIp(probes) {
  for (const probe of probes) {
    const ip = await fetchPublicIp(probe.url);
    if (ip) {
      return { ip, source: probe.source };
    }
  }
  return null;
}

async function probePanelPublicIps() {
  const now = Date.now();
  if (panelPublicIpCache.value && now - panelPublicIpCache.checkedAt < PANEL_PUBLIC_IP_CACHE_MS) {
    return panelPublicIpCache.value;
  }

  const [defaultRoute, googlePolicy] = await Promise.all([
    firstPanelPublicIp([
      { url: 'https://api.ipify.org', source: 'panel:default-route' },
      { url: 'https://checkip.amazonaws.com', source: 'panel:default-route' },
      { url: 'http://api.ipify.org', source: 'panel:default-route' },
    ]),
    firstPanelPublicIp([
      { url: 'https://domains.google.com/checkip', source: 'panel:google-policy' },
    ]),
  ]);

  const value = { defaultRoute, googlePolicy };
  panelPublicIpCache = { checkedAt: now, value };
  return value;
}

function inferActiveDefaultWan(routes, wanStatus) {
  const routeMain = String(routes || '').split('--- route-main ---')[1]?.split('--- route-smartwan-100 ---')[0] || routes || '';
  const defaultLines = String(routeMain).split(/\r?\n/).filter((line) => line.startsWith('default') || line.trim().startsWith('nexthop '));
  for (const line of defaultLines) {
    const match = wanStatus.find((wan) => wan.ifname && line.includes(` dev ${wan.ifname}`));
    if (match) {
      return match.id;
    }
  }
  return '';
}

function inferGoogleWan(routes, wanStatus) {
  const googleDestination =
    /\b(?:8\.8\.[48]|34\.(?:102|117|120|160)|64\.(?:18|233)|66\.102|72\.14|74\.125|108\.17[07]|142\.250|172\.(?:217|253)|173\.194|199\.36|208\.(?:65|117)|209\.85|216\.(?:58|239))\./;
  for (const line of String(routes || '').split(/\r?\n/)) {
    if (!googleDestination.test(line) || !/\bto\b/.test(line)) {
      continue;
    }
    const match = wanStatus.find((wan) => line.includes(`lookup ${wan.id}`) || (wan.table && line.includes(`lookup ${wan.table}`)));
    if (match) {
      return match.id;
    }
  }
  return '';
}

async function enrichWanStatusWithPanelPublicIps(wanStatus, status, routes, dualWan = {}) {
  const needsFallback = wanStatus.some((wan) => (
    !wan.publicIp &&
    wan.internetStatus === 'ok' &&
    wan.defaultRouteMatchesWan &&
    ['no_supported_tool', 'probe_failed', 'not_checked', ''].includes(wan.publicIpStatus)
  ));
  if (!needsFallback) {
    return wanStatus;
  }

  const panelProbe = await probePanelPublicIps();
  const activeDefaultWan = status.active_default_wan || inferActiveDefaultWan(routes, wanStatus) || 'wan0';
  const balancedWithBothWansOnline =
    dualWan.mode === 'lb' && wanStatus.filter((wan) => wan.internetStatus === 'ok').length > 1;
  const googleWan = inferGoogleWan(routes, wanStatus);
  const canUseGoogleProbe =
    panelProbe.googlePolicy?.ip && (!panelProbe.defaultRoute?.ip || panelProbe.googlePolicy.ip !== panelProbe.defaultRoute.ip);
  const googleProbeWan = googleWan || (
    canUseGoogleProbe
      ? (dualWan.routingEnabled && dualWan.ruleCount ? 'wan1' : wanStatus.find((wan) => wan.id !== activeDefaultWan)?.id || '')
      : ''
  );

  return wanStatus.map((wan) => {
    if (wan.publicIp) {
      return wan;
    }
    if (wan.internetStatus !== 'ok' || !wan.defaultRouteMatchesWan) {
      return wan;
    }

    let probe = null;
    if (canUseGoogleProbe && googleProbeWan === wan.id) {
      probe = panelProbe.googlePolicy;
    } else if (!balancedWithBothWansOnline && panelProbe.defaultRoute?.ip && activeDefaultWan === wan.id) {
      probe = panelProbe.defaultRoute;
    }

    if (!probe) {
      return wan;
    }

    return {
      ...wan,
      publicIp: probe.ip,
      publicIpStatus: 'panel_probe',
      publicIpSource: probe.source,
    };
  });
}

async function readPanelPublicKeyBlob() {
  try {
    const raw = await fs.readFile(path.join(KEY_DIR, 'smartwan_panel_ed25519.pub'), 'utf8');
    return raw.trim().split(/\s+/)[1] || '';
  } catch (_error) {
    return '';
  }
}

async function readRemoteIfExists(settings, remotePath) {
  const result = await execCommand(settings, `cat ${shellQuote(remotePath)} 2>/dev/null || true`, { timeoutMs: 10000 });
  return result.stdout;
}

export async function testConnection(settings) {
  const result = await execCommand(
    settings,
    "PATH=$PATH:/sbin:/usr/sbin; echo ok; uname -a; nvram get productid 2>/dev/null || true",
    { timeoutMs: 10000 },
  );
  return {
    ok: result.code === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.code,
  };
}

export async function readRouterEventJournal(settings, { maxLines = 200 } = {}) {
  const dir = remoteDir(settings);
  const safeMaxLines = Math.min(500, Math.max(1, Number(maxLines) || 200));
  const result = await execCommand(
    settings,
    `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && ${shellQuote(`${dir}/smartwanctl.sh`)} events ${safeMaxLines} || true`,
    { timeoutMs: 8000 },
  );
  return result.stdout;
}

export async function probeRouter(settings) {
  const dir = remoteDir(settings);
  const panelKeyBlob = await readPanelPublicKeyBlob();
  const keyAuthSelected = settings.authMethod === 'key' ? '1' : '0';
  const script = `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
SWDIR=${shellQuote(dir)}
PANEL_KEY_BLOB=${shellQuote(panelKeyBlob)}
KEY_AUTH_SELECTED=${shellQuote(keyAuthSelected)}
section(){ echo "__SMARTWAN_SECTION__$1"; }

section identity
echo "hostname=$(hostname 2>/dev/null || true)"
echo "model=$(nvram get productid 2>/dev/null || nvram get odmpid 2>/dev/null || true)"
echo "firmware=$(nvram get buildno 2>/dev/null || true)_$(nvram get extendno 2>/dev/null || true)"
echo "kernel=$(uname -sr 2>/dev/null || true)"
echo "uptime=$(uptime 2>/dev/null || true)"

section jffs
echo "jffs2_enable=$(nvram get jffs2_enable 2>/dev/null || true)"
echo "jffs2_scripts=$(nvram get jffs2_scripts 2>/dev/null || true)"
echo "script_usbmount=$(nvram get script_usbmount 2>/dev/null || true)"

section asus_dualwan
for key in \
  wans_dualwan wans_dualwan_enable wans_enable wans_mode wans_lb_ratio \
  wans_routing_enable wans_routing_rulelist wans_primary wans_standby
do
  echo "$key=$(nvram get "$key" 2>/dev/null || true)"
done

section security
echo "key_auth_selected=$KEY_AUTH_SELECTED"
echo "panel_key_expected=$([ -n "$PANEL_KEY_BLOB" ] && echo 1 || echo 0)"
auth_tmp="/tmp/smartwan_authorized_keys.$$"
: > "$auth_tmp"
auth_sources=""
for nv in sshd_authkeys sshd_authorized_keys sshd_auth_key sshd_auth_keys; do
  value="$(nvram get "$nv" 2>/dev/null || true)"
  [ -n "$value" ] || continue
  auth_sources="\${auth_sources:+$auth_sources,}nvram:$nv"
  printf '%s\\n' "$value" >> "$auth_tmp"
done
for auth_path in /root/.ssh/authorized_keys /home/root/.ssh/authorized_keys /tmp/dropbear/authorized_keys /etc/dropbear/authorized_keys /jffs/.ssh/authorized_keys; do
  [ -r "$auth_path" ] || continue
  auth_sources="\${auth_sources:+$auth_sources,}$auth_path"
  cat "$auth_path" >> "$auth_tmp" 2>/dev/null || true
done
if [ -n "$PANEL_KEY_BLOB" ] && awk -v blob="$PANEL_KEY_BLOB" '{ for (i = 1; i <= NF; i++) if ($i == blob) found = 1 } END { exit found ? 0 : 1 }' "$auth_tmp"; then
  echo "panel_key_authorized=1"
else
  echo "panel_key_authorized=0"
fi
echo "authorized_key_sources=$auth_sources"
rm -f "$auth_tmp"

section capabilities
echo "ipset=$(command -v ipset >/dev/null 2>&1 && echo 1 || echo 0)"
echo "iptables=$(command -v iptables >/dev/null 2>&1 && echo 1 || echo 0)"
echo "dnsmasq_add=$([ -d /jffs/configs ] && [ -w /jffs/configs ] && echo 1 || echo 0)"
echo "dnsmasq_restart=$({ command -v service >/dev/null 2>&1 || command -v rc >/dev/null 2>&1 || command -v killall >/dev/null 2>&1; } && echo 1 || echo 0)"

section network_topology
echo "lan_ipaddr=$(nvram get lan_ipaddr 2>/dev/null || true)"
echo "lan_netmask=$(nvram get lan_netmask 2>/dev/null || true)"
echo "lan_subnet=$(ip -4 route show dev br0 proto kernel 2>/dev/null | awk 'NR == 1 {print $1}')"
echo "dhcp_enabled=$(nvram get dhcp_enable_x 2>/dev/null || true)"
echo "dhcp_start=$(nvram get dhcp_start 2>/dev/null || true)"
echo "dhcp_end=$(nvram get dhcp_end 2>/dev/null || true)"
lan_dns_primary="$(nvram get dhcp_dns1_x 2>/dev/null || true)"
lan_dns_secondary="$(nvram get dhcp_dns2_x 2>/dev/null || true)"
[ -n "$lan_dns_primary" ] || lan_dns_primary="$(nvram get lan_ipaddr 2>/dev/null || true)"
router_upstream_dns="$(nvram get lan_dns 2>/dev/null || true)"
[ -n "$router_upstream_dns" ] || router_upstream_dns="$(awk '/^nameserver / && !seen[$2]++ { printf "%s%s", separator, $2; separator=" " }' /tmp/resolv.conf 2>/dev/null || true)"
echo "dns=$lan_dns_primary"
echo "lan_dns_primary=$lan_dns_primary"
echo "lan_dns_secondary=$lan_dns_secondary"
echo "lan_dns_servers=$lan_dns_primary $lan_dns_secondary"
echo "router_upstream_dns=$router_upstream_dns"
echo "nat_enabled=$(nvram get wan_nat_x 2>/dev/null || true)"
echo "nat_rules=$(iptables -t nat -S 2>/dev/null | grep -c 'MASQUERADE\\|SNAT' || true)"
echo "client_count=$(wc -l < /var/lib/misc/dnsmasq.leases 2>/dev/null || echo 0)"

section clients
wifi_ports=""
for wl_idx in 0 1 2 3; do
  wifi_ifname="$(nvram get wl\${wl_idx}_ifname 2>/dev/null || true)"
  [ -n "$wifi_ifname" ] || continue
  port_hex="$(cat "/sys/class/net/br0/brif/$wifi_ifname/port_no" 2>/dev/null || true)"
  [ -n "$port_hex" ] || continue
  wifi_ports="$wifi_ports $((port_hex))"
done
tail -n +2 /proc/net/arp 2>/dev/null | while read -r client_ip _ client_flags client_mac _ client_device; do
  [ "$client_device" = "br0" ] || continue
  [ "$client_flags" = "0x2" ] || continue
  client_mac_lower="$(printf '%s' "$client_mac" | tr 'A-F' 'a-f')"
  client_name="$(awk -v ip="$client_ip" -v mac="$client_mac_lower" '
    tolower($2) == mac || $3 == ip { print $4; exit }
  ' /var/lib/misc/dnsmasq.leases 2>/dev/null || true)"
  if [ -z "$client_name" ] || [ "$client_name" = "*" ]; then
    client_name="$(nslookup "$client_ip" 127.0.0.1 2>/dev/null | awk '
      /name = / { sub(/^.*name = /, ""); sub(/\.$/, ""); print; exit }
    ' || true)"
  fi
  [ -n "$client_name" ] || client_name="*"
  bridge_port="$(brctl showmacs br0 2>/dev/null | awk -v mac="$client_mac_lower" '
    tolower($2) == mac && $3 == "no" { print $1; exit }
  ')"
  connection_type="unknown"
  if [ -n "$bridge_port" ]; then
    connection_type="ethernet"
    for wifi_port in $wifi_ports; do
      if [ "$bridge_port" = "$wifi_port" ]; then
        connection_type="wifi"
        break
      fi
    done
  fi
  echo "$client_ip|$client_name|$client_mac_lower|$connection_type|1|$bridge_port"
done

section wan_status
conf_value(){ sed -n "s/^$1=//p" "$SWDIR/smartwan.conf" 2>/dev/null | tail -n 1 | sed "s/^['\\\"]//;s/['\\\"]$//"; }
[ -x /usr/sbin/curl ] && curl(){ /usr/sbin/curl "$@"; }
[ -x /usr/sbin/wget ] && wget(){ /usr/sbin/wget "$@"; }
[ -x /usr/bin/nslookup ] && nslookup(){ /usr/bin/nslookup "$@"; }
[ -x /bin/busybox ] && busybox(){ /bin/busybox "$@"; }
[ -x /usr/sbin/ip ] && ip(){ /usr/sbin/ip "$@"; }
[ -x /bin/ping ] && ping(){ /bin/ping "$@"; }
nvram_unit_for_path(){
  iface="$1"
  gateway="$2"
  for unit in 0 1; do
    nv_ifname="$(nvram get "wan\${unit}_ifname" 2>/dev/null || true)"
    nv_gateway="$(nvram get "wan\${unit}_gateway" 2>/dev/null || true)"
    if [ -n "$iface" ] && [ "$nv_ifname" = "$iface" ]; then
      echo "$unit"
      return 0
    fi
    if [ -n "$gateway" ] && [ "$nv_gateway" = "$gateway" ]; then
      echo "$unit"
      return 0
    fi
  done
  echo ""
}
public_ip_for_ifname(){
  iface="$1"
  table="$2"
  idx="$3"
  public_ip_status="not_checked"
  public_ip_source=""
  [ -n "$iface" ] || { echo "|no_interface|"; return 0; }
  cache="/tmp/smartwan_public_ip_$iface"
  now="$(date +%s 2>/dev/null || echo 0)"
  if [ -f "$cache" ]; then
    read -r cached_at cached_ip < "$cache"
    age=$((now - cached_at))
    if [ "$age" -ge 0 ] 2>/dev/null && [ "$age" -lt 60 ] && [ -n "$cached_ip" ]; then
      echo "$cached_ip|ok|cache"
      return 0
    fi
  fi
  is_public_ipv4(){
    printf '%s\\n' "$1" | awk -F. '
      NF == 4 {
        for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1
        if ($1 == 0 || $1 == 10 || $1 == 127 || $1 >= 224) exit 1
        if ($1 == 100 && $2 >= 64 && $2 <= 127) exit 1
        if ($1 == 169 && $2 == 254) exit 1
        if ($1 == 172 && $2 >= 16 && $2 <= 31) exit 1
        if ($1 == 192 && $2 == 168) exit 1
        exit 0
      }
      { exit 1 }
    '
  }
  if [ -n "$idx" ]; then
    for nv in wan\${idx}_realip_ip wan\${idx}_external_ip wan\${idx}_xipaddr wan\${idx}_ipaddr; do
      candidate="$(nvram get "$nv" 2>/dev/null || true)"
      if is_public_ipv4 "$candidate"; then
        echo "$candidate|ok|nvram:$nv"
        return 0
      fi
    done
  fi
  source_ip="$(ip -4 addr show dev "$iface" 2>/dev/null | awk '/ inet / {print $2; exit}' | cut -d/ -f1)"
  [ -n "$source_ip" ] || { echo "|no_ip|"; return 0; }
  public_rule_added=0
  cleanup_public_ip_probe(){
    if [ "$public_rule_added" = "1" ]; then
      while ip rule del pref 90 from "$source_ip" table "$table" 2>/dev/null; do :; done
      ip route flush cache 2>/dev/null || true
    fi
  }
  if [ -n "$source_ip" ] && [ -n "$table" ]; then
    ip rule add pref 90 from "$source_ip" table "$table" 2>/dev/null && public_rule_added=1
    ip route flush cache 2>/dev/null || true
    trap cleanup_public_ip_probe EXIT
  fi
  public_ip_status="no_supported_tool"
  route_dev_for_target(){
    target="$1"
    lan_ip="$(nvram get lan_ipaddr 2>/dev/null || ip -4 addr show dev br0 2>/dev/null | awk '/ inet / {print $2; exit}' | cut -d/ -f1)"
    if [ -n "$lan_ip" ]; then
      route_line="$(ip route get "$target" from "$lan_ip" 2>/dev/null || true)"
    fi
    [ -n "$route_line" ] || route_line="$(ip route get "$target" 2>/dev/null || true)"
    echo "$route_line" | awk '{ for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
  }
  dns_public_ip(){
    resolver="$1"
    name="$2"
    if [ -x /usr/bin/nslookup ] || command -v nslookup >/dev/null 2>&1; then
      raw="$(nslookup -type=txt "$name" "$resolver" 2>/dev/null || nslookup "$name" "$resolver" 2>/dev/null || true)"
    elif [ -x /bin/busybox ] || command -v busybox >/dev/null 2>&1; then
      raw="$(busybox nslookup "$name" "$resolver" 2>/dev/null || true)"
    else
      raw=""
    fi
    printf '%s\\n' "$raw" | awk -v resolver="$resolver" '{
      for (i = 1; i <= NF; i++) {
        value = $i
        gsub(/[^0-9.]/, "", value)
        if (value ~ /^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$/ && value != resolver) ip = value
      }
    } END { print ip }'
  }
  if [ -x /usr/sbin/curl ] || command -v curl >/dev/null 2>&1; then
    public_ip_status="probe_failed"
    for endpoint in \
      https://api.ipify.org \
      https://checkip.amazonaws.com \
      http://api.ipify.org
    do
      ip="$(curl -4 --interface "$source_ip" --connect-timeout 1 --max-time 3 -fsSk "$endpoint" 2>/dev/null | tr -d '\\r' | head -n 1 || true)"
      case "$ip" in
        [0-9]*.[0-9]*.[0-9]*.[0-9]*)
          public_ip_status="ok"
          public_ip_source="curl-source:$endpoint"
          echo "$now $ip" > "$cache"
          echo "$ip|$public_ip_status|$public_ip_source"
          return 0
          ;;
      esac
    done
    echo "|$public_ip_status|$public_ip_source"
    return 0
  fi
  if [ -x /usr/sbin/wget ] || command -v wget >/dev/null 2>&1; then
    [ "$public_ip_status" = "no_supported_tool" ] && public_ip_status="probe_failed"
    ip=""
    if [ -n "$source_ip" ]; then
      for endpoint in \
        http://api.ipify.org \
        http://checkip.amazonaws.com
      do
        ip="$(wget -q -T 4 --bind-address="$source_ip" -O - "$endpoint" 2>/dev/null | tr -d '\\r' | head -n 1 || true)"
        case "$ip" in
          [0-9]*.[0-9]*.[0-9]*.[0-9]*)
            public_ip_status="ok"
            public_ip_source="wget-bind:$endpoint"
            echo "$now $ip" > "$cache"
            echo "$ip|$public_ip_status|$public_ip_source"
            return 0
            ;;
        esac
      done
    fi
    if [ -z "$ip" ]; then
      active_dev="$(ip route show default 2>/dev/null | awk '/^default / {for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')"
      if [ "$active_dev" = "$iface" ]; then
        ip="$(wget -q -T 4 -O - http://api.ipify.org 2>/dev/null | tr -d '\\r' | head -n 1 || true)"
      fi
    fi
    case "$ip" in
      [0-9]*.[0-9]*.[0-9]*.[0-9]*)
        public_ip_status="ok"
        public_ip_source="wget-default:http://api.ipify.org"
        echo "$now $ip" > "$cache"
        echo "$ip|$public_ip_status|$public_ip_source"
        return 0
        ;;
    esac
  fi
  if [ -x /usr/bin/nslookup ] || [ -x /bin/busybox ] || command -v nslookup >/dev/null 2>&1 || command -v busybox >/dev/null 2>&1; then
    [ "$public_ip_status" = "no_supported_tool" ] && public_ip_status="probe_failed"
    if [ "$(route_dev_for_target 208.67.222.222)" = "$iface" ]; then
      ip="$(dns_public_ip 208.67.222.222 myip.opendns.com)"
      case "$ip" in
        [0-9]*.[0-9]*.[0-9]*.[0-9]*)
          public_ip_status="ok"
          public_ip_source="nslookup:opendns-default"
          echo "$now $ip" > "$cache"
          echo "$ip|$public_ip_status|$public_ip_source"
          return 0
          ;;
      esac
    fi
    if [ "$(route_dev_for_target 8.8.8.8)" = "$iface" ]; then
      ip="$(dns_public_ip 8.8.8.8 o-o.myaddr.l.google.com)"
      case "$ip" in
        [0-9]*.[0-9]*.[0-9]*.[0-9]*)
          public_ip_status="ok"
          public_ip_source="nslookup:google-dns-policy"
          echo "$now $ip" > "$cache"
          echo "$ip|$public_ip_status|$public_ip_source"
          return 0
          ;;
      esac
    fi
  fi
  echo "|$public_ip_status|$public_ip_source"
}
internet_probe_for_ifname(){
  iface="$1"
  table="$2"
  gateway="$3"
  route_matches="$4"
  [ -n "$iface" ] || { echo "no_interface||"; return 0; }
  source_ip="$(ip -4 addr show dev "$iface" 2>/dev/null | awk '/ inet / {print $2; exit}' | cut -d/ -f1)"
  [ -n "$source_ip" ] || { echo "no_ip||"; return 0; }
  [ "$route_matches" = "1" ] || { echo "overridden||"; return 0; }
  last_target=""
  for target in 1.1.1.1 9.9.9.9; do
    last_target="$target"
    rule_added=0
    route_added=0
    if [ -n "$table" ]; then
      ip rule add pref 90 from "$source_ip" to "$target/32" table "$table" 2>/dev/null && rule_added=1
      if [ -n "$gateway" ]; then
        ip route replace "$target/32" via "$gateway" dev "$iface" table "$table" 2>/dev/null && route_added=1
      else
        ip route replace "$target/32" dev "$iface" table "$table" 2>/dev/null && route_added=1
      fi
    fi
    if ping -I "$source_ip" -c 1 -W 1 "$target" >/dev/null 2>&1; then
      [ "$route_added" = "1" ] && ip route del "$target/32" table "$table" >/dev/null 2>&1 || true
      [ "$rule_added" = "1" ] && ip rule del pref 90 from "$source_ip" to "$target/32" table "$table" >/dev/null 2>&1 || true
      echo "ok|$target|forced"
      return 0
    fi
    [ "$route_added" = "1" ] && ip route del "$target/32" table "$table" >/dev/null 2>&1 || true
    [ "$rule_added" = "1" ] && ip rule del pref 90 from "$source_ip" to "$target/32" table "$table" >/dev/null 2>&1 || true
  done
  echo "failed|$last_target|forced"
}
conf_label_for_path(){
  iface="$1"
  gateway="$2"
  for conf_idx in 0 1; do
    conf_label="$(conf_value wan\${conf_idx}_label)"
    conf_ifname="$(conf_value wan\${conf_idx}_ifname)"
    conf_gateway="$(conf_value wan\${conf_idx}_gateway)"
    if [ -n "$conf_label" ] && [ -n "$iface" ] && [ "$conf_ifname" = "$iface" ]; then
      echo "$conf_label"
      return 0
    fi
    if [ -n "$conf_label" ] && [ -n "$gateway" ] && [ "$conf_gateway" = "$gateway" ]; then
      echo "$conf_label"
      return 0
    fi
  done
  echo ""
}
port_label(){
  port="$1"
  case "$port" in
    lan) echo "Ethernet LAN" ;;
    wan) echo "WAN" ;;
    none|"") echo "WAN unit" ;;
    *) echo "$port" ;;
  esac
}
dual_pair="$(nvram get wans_dualwan 2>/dev/null || true)"
set -- $dual_pair
dual_primary="$1"
dual_secondary="$2"
for idx in 0 1; do
  nvram_idx="$idx"
  asus_port="$([ "$idx" = "0" ] && echo "$dual_primary" || echo "$dual_secondary")"
  ifname="$(nvram get wan\${idx}_ifname 2>/dev/null || true)"
  gateway="$(nvram get wan\${idx}_gateway 2>/dev/null || true)"
  table="wan$idx"
  table_numeric="$((100 + idx))"
  label="$(conf_label_for_path "$ifname" "$gateway")"
  [ -n "$label" ] || label="$(port_label "$asus_port")"
  ipaddr="$(ip -4 addr show dev "$ifname" 2>/dev/null | awk '/ inet / {print $2; exit}')"
  operstate="$(cat "/sys/class/net/$ifname/operstate" 2>/dev/null || true)"
  carrier="$(cat "/sys/class/net/$ifname/carrier" 2>/dev/null || true)"
  nvram_state="$(nvram get wan\${idx}_state_t 2>/dev/null || true)"
  nvram_auxstate="$(nvram get wan\${idx}_auxstate_t 2>/dev/null || true)"
  if [ -n "$ipaddr" ]; then
    carrier="1"
    operstate="up"
  elif [ "$nvram_state" != "2" ]; then
    carrier="0"
    operstate="down"
  fi
  rx_bytes="$(cat "/sys/class/net/$ifname/statistics/rx_bytes" 2>/dev/null || true)"
  tx_bytes="$(cat "/sys/class/net/$ifname/statistics/tx_bytes" 2>/dev/null || true)"
  default_route="$(ip route show table "$table" 2>/dev/null | awk '/^default / {print; exit}')"
  [ -n "$default_route" ] || default_route="$(ip route show table "$table_numeric" 2>/dev/null | awk '/^default / {print; exit}')"
  if [ -z "$default_route" ] && [ -n "$ifname" ]; then
    main_default="$(ip route show table main 2>/dev/null | awk '/^default / {print; exit}')"
    case " $main_default " in
      *" dev $ifname "*) default_route="$main_default" ;;
    esac
  fi
  route_ifname="$(printf '%s\\n' "$default_route" | awk '{ for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }')"
  route_gateway="$(printf '%s\\n' "$default_route" | awk '{ for (i = 1; i <= NF; i++) if ($i == "via") { print $(i + 1); exit } }')"
  route_matches=0
  if [ -n "$ifname" ] && [ "$route_ifname" = "$ifname" ]; then
    if [ -z "$gateway" ] || [ -z "$route_gateway" ] || [ "$route_gateway" = "$gateway" ]; then
      route_matches=1
    fi
  fi
  internet_probe="$(internet_probe_for_ifname "$ifname" "$table" "$gateway" "$route_matches")"
  internet_status="\${internet_probe%%|*}"
  internet_rest="\${internet_probe#*|}"
  internet_target="\${internet_rest%%|*}"
  internet_source="\${internet_rest#*|}"
  [ "$internet_source" = "$internet_target" ] && internet_source=""
  public_ip=""
  public_ip_status="$([ "$internet_status" = "ok" ] && echo "not_checked" || echo "internet_unavailable")"
  public_ip_source=""
  if [ "$internet_status" = "ok" ]; then
    public_ip_probe="$(public_ip_for_ifname "$ifname" "$table" "$nvram_idx")"
    public_ip="\${public_ip_probe%%|*}"
    public_ip_rest="\${public_ip_probe#*|}"
    public_ip_status="\${public_ip_rest%%|*}"
    public_ip_source="\${public_ip_rest#*|}"
  fi
  dns_mode="$(nvram get wan\${nvram_idx}_dnsenable_x 2>/dev/null || true)"
  dns_primary="$(nvram get wan\${nvram_idx}_dns1_x 2>/dev/null || true)"
  dns_secondary="$(nvram get wan\${nvram_idx}_dns2_x 2>/dev/null || true)"
  dns_servers="$(nvram get wan\${nvram_idx}_dns 2>/dev/null || true)"
  dns_learned="$(nvram get wan\${nvram_idx}_xdns 2>/dev/null || true)"
  echo "wan$idx.label=$label"
  echo "wan$idx.asus_unit=$idx"
  echo "wan$idx.asus_port=$asus_port"
  echo "wan$idx.ifname=$ifname"
  echo "wan$idx.gateway=$gateway"
  echo "wan$idx.table=$table"
  echo "wan$idx.table_numeric=$table_numeric"
  echo "wan$idx.nvram_unit=$nvram_idx"
  echo "wan$idx.ipaddr=$ipaddr"
  echo "wan$idx.public_ip=$public_ip"
  echo "wan$idx.public_ip_status=$public_ip_status"
  echo "wan$idx.public_ip_source=$public_ip_source"
  echo "wan$idx.dns_mode=$dns_mode"
  echo "wan$idx.dns_primary=$dns_primary"
  echo "wan$idx.dns_secondary=$dns_secondary"
  echo "wan$idx.dns_servers=$dns_servers"
  echo "wan$idx.dns_learned=$dns_learned"
  echo "wan$idx.internet_status=$internet_status"
  echo "wan$idx.internet_target=$internet_target"
  echo "wan$idx.internet_source=$internet_source"
  echo "wan$idx.operstate=$operstate"
  echo "wan$idx.carrier=$carrier"
  echo "wan$idx.route_ifname=$route_ifname"
  echo "wan$idx.route_gateway=$route_gateway"
  echo "wan$idx.default_route_matches_wan=$route_matches"
  echo "wan$idx.nvram_state_t=$nvram_state"
  echo "wan$idx.nvram_auxstate_t=$nvram_auxstate"
  echo "wan$idx.rx_bytes=$rx_bytes"
  echo "wan$idx.tx_bytes=$tx_bytes"
  echo "wan$idx.default_route=$default_route"
done

section files
echo "smartwan_dir=$([ -d "$SWDIR" ] && echo 1 || echo 0)"
echo "smartwan_conf=$([ -f "$SWDIR/smartwan.conf" ] && echo 1 || echo 0)"
echo "smartwanctl=$([ -x "$SWDIR/smartwanctl.sh" ] && echo 1 || echo 0)"
echo "backend=$([ -f "$SWDIR/backend.sh" ] && echo 1 || echo 0)"
echo "presets_dir=$([ -d "$SWDIR/presets" ] && echo 1 || echo 0)"

section meminfo
cat /proc/meminfo 2>/dev/null | head -n 20

section system_metrics
load_average="$(cat /proc/loadavg 2>/dev/null | awk '{print $1" "$2" "$3}' || true)"
echo "load_average=$load_average"
echo "process_count=$(ls -d /proc/[0-9]* 2>/dev/null | wc -l | tr -d ' ')"
cpu_a="$(grep '^cpu ' /proc/stat 2>/dev/null)"
sleep 1
cpu_b="$(grep '^cpu ' /proc/stat 2>/dev/null)"
set -- $cpu_a
a_user=$2; a_nice=$3; a_system=$4; a_idle=$5; a_iowait=\${6:-0}; a_irq=\${7:-0}; a_softirq=\${8:-0}
set -- $cpu_b
b_user=$2; b_nice=$3; b_system=$4; b_idle=$5; b_iowait=\${6:-0}; b_irq=\${7:-0}; b_softirq=\${8:-0}
a_total=$((a_user + a_nice + a_system + a_idle + a_iowait + a_irq + a_softirq))
b_total=$((b_user + b_nice + b_system + b_idle + b_iowait + b_irq + b_softirq))
a_idle_all=$((a_idle + a_iowait))
b_idle_all=$((b_idle + b_iowait))
total_delta=$((b_total - a_total))
idle_delta=$((b_idle_all - a_idle_all))
if [ "$total_delta" -gt 0 ]; then echo "cpu_usage_percent=$(( (100 * (total_delta - idle_delta)) / total_delta ))"; else echo "cpu_usage_percent="; fi
temp=""
for temp_path in /sys/class/thermal/thermal_zone*/temp /proc/dmu/temperature; do
  [ -r "$temp_path" ] || continue
  raw_temp="$(cat "$temp_path" 2>/dev/null | head -n 1)"
  temp="$(echo "$raw_temp" | sed -n 's/[^0-9.]*\\([0-9][0-9.]*\\).*/\\1/p' | head -n 1)"
  [ -n "$temp" ] && break
done
if [ -z "$temp" ]; then temp="$(nvram get temperature 2>/dev/null || nvram get temp_cpu 2>/dev/null || true)"; fi
case "$temp" in
  ""|*[!0-9.-]*) echo "temperature_c=" ;;
  *) if [ "$temp" -gt 1000 ] 2>/dev/null; then echo "temperature_c=$((temp / 1000))"; else echo "temperature_c=$temp"; fi ;;
esac

section df
df -h /jffs /tmp / 2>/dev/null || df -h 2>/dev/null | head -n 8

section smartwan_status
if [ -x "$SWDIR/smartwanctl.sh" ]; then "$SWDIR/smartwanctl.sh" status 2>&1; else echo "smartwanctl_missing=1"; fi

section smartwan_config
cat "$SWDIR/smartwan.conf" 2>/dev/null || true

section routes
ip rule show 2>/dev/null | head -n 80
echo "--- route-main ---"
ip route show table main 2>/dev/null | head -n 80
echo "--- route-smartwan-100 ---"
ip route show table 100 2>/dev/null | head -n 40
echo "--- route-smartwan-101 ---"
ip route show table 101 2>/dev/null | head -n 40

section logs
tail -n 120 /tmp/smartwan.log 2>/dev/null || true
`;

  // A WAN transition can leave stale addresses/routes until ASUS finishes
  // reconciling Dual WAN. Keep the full state read bounded, but do not mark
  // SSH offline while the two forced Internet probes are completing.
  const result = await execCommand(settings, 'sh -s', { timeoutMs: 30000, stdin: script });
  const sections = parseSections(result.stdout);
  const configValues = parseSmartwanConfig(sections.smartwan_config || '');
  const status = parseKeyValueBlock(sections.smartwan_status);
  const dualWan = parseAsusDualWanStatus(sections.asus_dualwan);
  const probedWanStatus = await enrichWanStatusWithPanelPublicIps(
    withDualWanRoles(parseWanStatus(sections.wan_status), dualWan),
    status,
    sections.routes,
    dualWan,
  );
  // During emergency routing a lower-priority diagnostic probe can itself be
  // carried by the healthy WAN and report a false positive for the failed
  // interface. The lifetime watchdog uses dedicated priority-80 probes and is
  // the authoritative source while its global failover override is active.
  const wanStatus = reconcileWanHealthWithWatchdog(probedWanStatus, status);
  return {
    ok: result.code === 0,
    code: result.code,
    stderr: result.stderr.trim(),
    sections,
    identity: parseKeyValueBlock(sections.identity),
    jffs: parseKeyValueBlock(sections.jffs),
    dualWan,
    security: parseKeyValueBlock(sections.security),
    capabilities: parseCapabilities(sections.capabilities),
    network: parseKeyValueBlock(sections.network_topology),
    clients: parseClients(sections.clients),
    wanStatus,
    files: parseKeyValueBlock(sections.files),
    memory: parseMeminfo(sections.meminfo),
    system: parseSystemMetrics(sections.system_metrics),
    filesystems: parseDf(sections.df),
    config: {
      raw: sections.smartwan_config || '',
      values: configValues,
      form: configValuesToForm(configValues),
    },
    status,
    routes: sections.routes || '',
    logs: sections.logs || '',
  };
}

export async function readSmartwanConfig(settings) {
  const raw = await readRemoteIfExists(settings, `${remoteDir(settings)}/smartwan.conf`);
  const values = parseSmartwanConfig(raw);
  return { raw, values, form: configValuesToForm(values) };
}

async function remoteAtomicWrite(settings, remotePath, content, mode = '600') {
  const tempPath = `${remotePath}.tmp.${Date.now()}`;
  const write = await execCommand(settings, `cat > ${shellQuote(tempPath)}`, {
    timeoutMs: 15000,
    stdin: content,
  });
  if (write.code !== 0) {
    throw new Error(write.stderr || `Failed to write ${tempPath}`);
  }
  const result = await execCommand(
    settings,
    `mv ${shellQuote(tempPath)} ${shellQuote(remotePath)} && chmod ${mode} ${shellQuote(remotePath)}`,
    { timeoutMs: 10000 },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || `Failed to move ${remotePath}`);
  }
  return result;
}

export async function applySmartwanConfig(settings, form) {
  const dir = remoteDir(settings);
  const configText = buildSmartwanConfig(form);
  await execCommand(settings, `mkdir -p ${shellQuote(dir)} ${shellQuote(`${dir}/presets`)}`, { timeoutMs: 10000 });
  await execCommand(
    settings,
    `[ -f ${shellQuote(`${dir}/smartwan.conf`)} ] && cp ${shellQuote(`${dir}/smartwan.conf`)} ${shellQuote(`${dir}/smartwan.conf.rollback`)} || true`,
    { timeoutMs: 10000 },
  );
  await remoteAtomicWrite(settings, `${dir}/smartwan.conf`, configText, '600');
  const result = await execCommand(
    settings,
    `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && { ${shellQuote(`${dir}/smartwanctl.sh`)} apply; ${shellQuote(`${dir}/smartwanctl.sh`)} hooks install >/dev/null 2>&1 || true; } || echo "smartwanctl.sh is not installed yet"`,
    { timeoutMs: 20000 },
  );
  return {
    configText,
    apply: {
      code: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    },
  };
}

export async function rollbackSmartwanConfig(settings) {
  const dir = remoteDir(settings);
  const rollbackPath = `${dir}/smartwan.conf.rollback`;
  const currentPath = `${dir}/smartwan.conf`;
  const exists = await execCommand(
    settings,
    `[ -f ${shellQuote(rollbackPath)} ] && echo yes || echo no`,
    { timeoutMs: 10000 },
  );
  if (exists.stdout.trim() !== 'yes') {
    throw new Error('No previous SmartWAN configuration is available for rollback.');
  }
  const result = await execCommand(
    settings,
    `cp ${shellQuote(currentPath)} ${shellQuote(`${dir}/smartwan.conf.before-rollback`)} 2>/dev/null || true; cp ${shellQuote(rollbackPath)} ${shellQuote(currentPath)}; chmod 600 ${shellQuote(currentPath)}; ${shellQuote(`${dir}/smartwanctl.sh`)} apply`,
    { timeoutMs: 20000 },
  );
  if (result.code !== 0) {
    throw new Error(result.stderr || 'SmartWAN rollback failed.');
  }
  return {
    restored: true,
    config: await readSmartwanConfig(settings),
    stdout: result.stdout.trim(),
  };
}

export async function listPresets(settings) {
  const presetDir = `${remoteDir(settings)}/presets`;
  const result = await execCommand(
    settings,
    `for f in ${shellQuote(presetDir)}/*.conf; do [ -f "$f" ] && basename "$f"; done 2>/dev/null || true`,
    { timeoutMs: 10000 },
  );
  const config = await readSmartwanConfig(settings);
  return {
    activePreset: config.values.active_preset || '',
    presets: result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((filename) => filename.endsWith('.conf'))
      .map((filename) => ({
        name: filename.replace(/\.conf$/, ''),
        filename,
        size: 0,
        modifiedAt: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function savePreset(settings, name, configText) {
  const safeName = validatePresetName(name);
  const dir = remoteDir(settings);
  const text = configText || (await readSmartwanConfig(settings)).raw || buildSmartwanConfig({});
  await execCommand(settings, `mkdir -p ${shellQuote(`${dir}/presets`)}`, { timeoutMs: 10000 });
  await remoteAtomicWrite(settings, `${dir}/presets/${safeName}.conf`, text, '600');
  return { name: safeName };
}

export async function readPreset(settings, name) {
  const safeName = validatePresetName(name);
  const raw = await readRemoteIfExists(settings, `${remoteDir(settings)}/presets/${safeName}.conf`);
  if (!raw) {
    throw new Error(`Preset ${safeName} does not exist on the router.`);
  }
  const values = parseSmartwanConfig(raw);
  return {
    name: safeName,
    raw,
    values,
    form: configValuesToForm(values),
  };
}

export async function deletePreset(settings, name) {
  const safeName = validatePresetName(name);
  await execCommand(settings, `rm -f ${shellQuote(`${remoteDir(settings)}/presets/${safeName}.conf`)}`, { timeoutMs: 10000 });
  return { name: safeName };
}

export async function activatePreset(settings, name) {
  const safeName = validatePresetName(name);
  const dir = remoteDir(settings);
  const presetPath = `${dir}/presets/${safeName}.conf`;
  const content = await readRemoteIfExists(settings, presetPath);
  if (!content) {
    throw new Error(`Preset ${safeName} does not exist on the router.`);
  }
  const parsed = parseSmartwanConfig(content);
  parsed.activePreset = safeName;
  const patched = content.replace(/^active_preset=.*$/m, `active_preset=${JSON.stringify(safeName)}`);
  const finalText = /^active_preset=/m.test(content) ? patched : `${content.trim()}\nactive_preset=${JSON.stringify(safeName)}\n`;
  await remoteAtomicWrite(settings, `${dir}/smartwan.conf`, finalText, '600');
  const result = await execCommand(
    settings,
    `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && { ${shellQuote(`${dir}/smartwanctl.sh`)} apply; ${shellQuote(`${dir}/smartwanctl.sh`)} hooks install >/dev/null 2>&1 || true; } || echo "smartwanctl.sh is not installed yet"`,
    { timeoutMs: 20000 },
  );
  return {
    name: safeName,
    apply: {
      code: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    },
  };
}

export async function installRouterScripts(settings, options = {}) {
  const dir = remoteDir(settings);
  const localDir = path.resolve(process.cwd(), 'router', 'smartwan.d');
  const files = ['backend.sh', 'smartwanctl.sh'];
  const uploaded = [];

  await execCommand(settings, `mkdir -p ${shellQuote(dir)} ${shellQuote(`${dir}/presets`)}`, { timeoutMs: 10000 });

  for (const file of files) {
    const content = await fs.readFile(path.join(localDir, file), 'utf8');
    await remoteAtomicWrite(settings, `${dir}/${file}`, content, file.endsWith('.sh') ? '755' : '600');
    uploaded.push(file);
  }

  if (!options.preserveConfig) {
    const content = await fs.readFile(path.join(localDir, 'smartwan.conf.example'), 'utf8');
    await remoteAtomicWrite(settings, `${dir}/smartwan.conf`, content, '600');
    uploaded.push('smartwan.conf');
  } else {
    const check = await execCommand(
      settings,
      `[ -f ${shellQuote(`${dir}/smartwan.conf`)} ] && echo exists || echo missing`,
      { timeoutMs: 10000 },
    );
    if (check.stdout.trim() === 'missing') {
      const content = await fs.readFile(path.join(localDir, 'smartwan.conf.example'), 'utf8');
      await remoteAtomicWrite(settings, `${dir}/smartwan.conf`, content, '600');
      uploaded.push('smartwan.conf');
    }
  }

  const hooks = await execCommand(
    settings,
    `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && ${shellQuote(`${dir}/smartwanctl.sh`)} hooks install || true`,
    { timeoutMs: 10000 },
  );
  const result = await execCommand(
    settings,
    `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && ${shellQuote(`${dir}/smartwanctl.sh`)} status || true`,
    { timeoutMs: 10000 },
  );

  return {
    uploaded,
    status: result.stdout.trim(),
    hooks: hooks.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}
