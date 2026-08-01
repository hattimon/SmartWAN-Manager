import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';
import { execCommand } from './sshClient.js';
import { shellQuote } from './smartwanConfig.js';

const HISTORY_FILE = path.join(DATA_DIR, 'wan-quality-history.json');
const HISTORY_LIMIT = 30;

const targetProfiles = {
  default: {
    id: 'default',
    label: 'Default internet',
    routeTarget: '1.1.1.1',
    pingTarget: '1.1.1.1',
    downloadUrl: 'https://speed.cloudflare.com/__down?bytes=2000000',
    uploadUrl: 'https://speed.cloudflare.com/__up',
    throughputCapable: true,
  },
  google: {
    id: 'google',
    label: 'Google / YouTube policy',
    routeTarget: '8.8.8.8',
    pingTarget: '8.8.8.8',
    downloadUrl: 'https://www.google.com/generate_204',
    uploadUrl: '',
    throughputCapable: false,
  },
  quad9: {
    id: 'quad9',
    label: 'Quad9 DNS',
    routeTarget: '9.9.9.9',
    pingTarget: '9.9.9.9',
    downloadUrl: 'https://dns.quad9.net/',
    uploadUrl: '',
    throughputCapable: false,
  },
};

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeMode(value) {
  const mode = String(value || 'auto').toLowerCase();
  if (['wan0', 'wan0_only', 'primary'].includes(mode)) return 'wan0';
  if (['wan1', 'wan1_only', 'secondary'].includes(mode)) return 'wan1';
  if (['combined', 'aggregate', 'aggregated'].includes(mode)) return 'combined';
  return 'auto';
}

function normalizeRequest(input = {}) {
  const profile = targetProfiles[input.targetProfile] || targetProfiles.default;
  return {
    mode: normalizeMode(input.mode),
    targetProfile: profile.id,
    profile,
    sourceHost: String(input.sourceHost || '').trim(),
    pingCount: clampNumber(input.pingCount, 3, 12, 5),
    durationSeconds: clampNumber(input.durationSeconds, 4, 20, 8),
    uploadKb: clampNumber(input.uploadKb, 0, 2048, profile.throughputCapable ? 256 : 0),
    runThroughput: input.runThroughput !== false,
  };
}

function parseKeyValueLines(raw = '') {
  const values = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

export function parsePingOutput(raw = '') {
  const text = String(raw || '');
  const packets =
    text.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets )?received,\s+([0-9.]+)%\s+packet loss/) ||
    text.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+received,\s+([0-9.]+)%\s+packet loss/);
  const rtt =
    text.match(/(?:round-trip|rtt)[^=]*=\s*([0-9.]+)\/([0-9.]+)\/([0-9.]+)(?:\/([0-9.]+))?\s*ms/) ||
    text.match(/min\/avg\/max[^=]*=\s*([0-9.]+)\/([0-9.]+)\/([0-9.]+)(?:\/([0-9.]+))?/);
  const transmitted = packets ? Number(packets[1]) : null;
  const received = packets ? Number(packets[2]) : null;
  let packetLossPercent = packets ? Number(packets[3]) : null;
  if (
    Number.isFinite(transmitted) &&
    Number.isFinite(received) &&
    transmitted > 0 &&
    packetLossPercent === 100 &&
    received > 0
  ) {
    packetLossPercent = Number((((transmitted - received) / transmitted) * 100).toFixed(1));
  }
  const minMs = rtt ? Number(rtt[1]) : null;
  const avgMs = rtt ? Number(rtt[2]) : null;
  const maxMs = rtt ? Number(rtt[3]) : null;
  const jitterMs = rtt?.[4]
    ? Number(rtt[4])
    : (Number.isFinite(minMs) && Number.isFinite(maxMs) ? Number((maxMs - minMs).toFixed(3)) : null);
  return {
    transmitted,
    received,
    packetLossPercent,
    minMs,
    avgMs,
    maxMs,
    jitterMs,
    raw: text.trim(),
  };
}

function parseCurlMetrics(raw = '') {
  const values = parseKeyValueLines(raw);
  const numberValue = (key) => {
    const number = Number(values[key]);
    return Number.isFinite(number) ? number : null;
  };
  const speedDownload = numberValue('speed_download');
  const speedUpload = numberValue('speed_upload');
  return {
    httpCode: values.http_code || '',
    dnsMs: numberValue('time_namelookup') === null ? null : Math.round(numberValue('time_namelookup') * 1000),
    tcpConnectMs: numberValue('time_connect') === null ? null : Math.round(numberValue('time_connect') * 1000),
    tlsMs: numberValue('time_appconnect') === null ? null : Math.round(numberValue('time_appconnect') * 1000),
    ttfbMs: numberValue('time_starttransfer') === null ? null : Math.round(numberValue('time_starttransfer') * 1000),
    totalMs: numberValue('time_total') === null ? null : Math.round(numberValue('time_total') * 1000),
    downloadMbps: speedDownload === null ? null : Number(((speedDownload * 8) / 1_000_000).toFixed(2)),
    uploadMbps: speedUpload === null ? null : Number(((speedUpload * 8) / 1_000_000).toFixed(2)),
    sizeDownload: numberValue('size_download'),
    sizeUpload: numberValue('size_upload'),
    remoteIp: values.remote_ip || '',
    raw: String(raw || '').trim(),
  };
}

function parseRemoteOutput(raw = '') {
  const scenarios = [];
  let current = null;
  let block = '';

  for (const line of String(raw || '').split(/\r?\n/)) {
    const scenarioMatch = line.match(/^__WANQ_SCENARIO__(.+)$/);
    if (scenarioMatch) {
      if (current) scenarios.push(current);
      current = { id: scenarioMatch[1], blocks: {}, values: {} };
      block = '';
      continue;
    }

    const blockMatch = line.match(/^__WANQ_BLOCK__(.+)$/);
    if (blockMatch) {
      block = blockMatch[1];
      if (current) current.blocks[block] = '';
      continue;
    }

    if (line === '__WANQ_END_BLOCK__') {
      block = '';
      continue;
    }

    if (!current) continue;
    if (block) {
      current.blocks[block] += `${line}\n`;
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (kv) current.values[kv[1]] = kv[2];
  }

  if (current) scenarios.push(current);
  return scenarios.map((scenario) => {
    const idle = parsePingOutput(scenario.blocks.ping);
    const loaded = parsePingOutput(scenario.blocks.loaded_ping);
    const http = parseCurlMetrics(scenario.blocks.http);
    const upload = parseCurlMetrics(scenario.blocks.upload);
    const downloadMbps = http.downloadMbps;
    const uploadMbps = upload.uploadMbps;
    const confidence = scenario.values.confidence ||
      (idle.received && scenario.values.route_wan ? 'medium' : 'low');

    return {
      id: scenario.id,
      label: scenario.values.label || scenario.id,
      type: scenario.values.type || 'auto',
      wanId: scenario.values.wan_id || '',
      wanLabel: scenario.values.wan_label || '',
      interface: scenario.values.iface || '',
      sourceIp: scenario.values.source_ip || '',
      gateway: scenario.values.gateway || '',
      table: scenario.values.table || '',
      routeTarget: scenario.values.route_target || '',
      routeLine: scenario.values.route_line || '',
      routeWan: scenario.values.route_wan || '',
      matchedRule: scenario.values.matched_rule || '',
      executionScope: scenario.values.execution_scope || 'router',
      confidence,
      idleLatency: idle,
      loadedDownloadLatency: loaded,
      http,
      upload,
      downloadMbps,
      uploadMbps,
      raw: {
        ping: scenario.blocks.ping?.trim() || '',
        loadedPing: scenario.blocks.loaded_ping?.trim() || '',
        http: scenario.blocks.http?.trim() || '',
        upload: scenario.blocks.upload?.trim() || '',
      },
    };
  });
}

function summarizeCombined(scenarios) {
  const wanResults = scenarios.filter((scenario) => ['wan0', 'wan1'].includes(scenario.id));
  if (wanResults.length < 2) return null;
  const downloads = wanResults.map((scenario) => scenario.downloadMbps).filter((value) => Number.isFinite(value));
  const uploads = wanResults.map((scenario) => scenario.uploadMbps).filter((value) => Number.isFinite(value));
  const latencies = wanResults
    .map((scenario) => scenario.idleLatency?.avgMs)
    .filter((value) => Number.isFinite(value));
  return {
    potentialDownloadMbps: downloads.length ? Number(downloads.reduce((sum, value) => sum + value, 0).toFixed(2)) : null,
    averageDownloadMbps: downloads.length ? Number((downloads.reduce((sum, value) => sum + value, 0) / downloads.length).toFixed(2)) : null,
    potentialUploadMbps: uploads.length ? Number(uploads.reduce((sum, value) => sum + value, 0).toFixed(2)) : null,
    averageUploadMbps: uploads.length ? Number((uploads.reduce((sum, value) => sum + value, 0) / uploads.length).toFixed(2)) : null,
    bestSingleFlowDownloadMbps: downloads.length ? Math.max(...downloads) : null,
    averageIdleLatencyMs: latencies.length ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)) : null,
    interpretation:
      'Combined is an estimated router potential from per-WAN probes. One TCP session, one game, or one video stream usually uses one WAN only.',
  };
}

function scenarioListForMode(mode) {
  if (mode === 'wan0') return [{ id: 'wan0', index: 0, type: 'forced', label: 'WAN0_only' }];
  if (mode === 'wan1') return [{ id: 'wan1', index: 1, type: 'forced', label: 'WAN1_only' }];
  if (mode === 'combined') {
    return [
      { id: 'wan0', index: 0, type: 'forced', label: 'WAN0_part' },
      { id: 'wan1', index: 1, type: 'forced', label: 'WAN1_part' },
    ];
  }
  return [{ id: 'auto', index: -1, type: 'auto', label: 'Auto_current_policy' }];
}

function buildRemoteScript(request, settings, previewOnly = false) {
  const scenarios = scenarioListForMode(request.mode);
  const scenarioLines = scenarios.map((scenario) => `${scenario.id}:${scenario.index}:${scenario.type}:${scenario.label}`).join(' ');
  const smartwanDir = settings.smartwanDir || '/jffs/addons/smartwan.d';
  return `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
SWDIR=${shellQuote(smartwanDir)}
TARGET_PROFILE=${shellQuote(request.targetProfile)}
ROUTE_TARGET=${shellQuote(request.profile.routeTarget)}
PING_TARGET=${shellQuote(request.profile.pingTarget)}
DOWNLOAD_URL=${shellQuote(request.profile.downloadUrl)}
UPLOAD_URL=${shellQuote(request.profile.uploadUrl)}
PING_COUNT=${shellQuote(request.pingCount)}
DURATION=${shellQuote(request.durationSeconds)}
UPLOAD_KB=${shellQuote(request.uploadKb)}
RUN_THROUGHPUT=${request.runThroughput && !previewOnly ? '1' : '0'}
PREVIEW_ONLY=${previewOnly ? '1' : '0'}
SOURCE_HOST=${shellQuote(request.sourceHost)}
SCENARIOS=${shellQuote(scenarioLines)}

[ -x /usr/sbin/curl ] && curl(){ /usr/sbin/curl "$@"; }
[ -x /usr/sbin/wget ] && wget(){ /usr/sbin/wget "$@"; }
[ -x /usr/sbin/ip ] && ip(){ /usr/sbin/ip "$@"; }
[ -x /bin/ping ] && ping(){ /bin/ping "$@"; }

conf_value(){ sed -n "s/^$1=//p" "$SWDIR/smartwan.conf" 2>/dev/null | tail -n 1 | sed "s/^['\\\"]//;s/['\\\"]$//"; }
first_default_dev(){ ip route show default 2>/dev/null | awk '/^default / {for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}'; }
conf_label_for_path(){
  iface="$1"
  gateway="$2"
  for conf_idx in 0 1; do
    conf_label="$(conf_value wan\${conf_idx}_label)"
    conf_ifname="$(conf_value wan\${conf_idx}_ifname)"
    conf_gateway="$(conf_value wan\${conf_idx}_gateway)"
    if [ -n "$conf_label" ] && [ -n "$iface" ] && [ "$conf_ifname" = "$iface" ]; then echo "$conf_label"; return 0; fi
    if [ -n "$conf_label" ] && [ -n "$gateway" ] && [ "$conf_gateway" = "$gateway" ]; then echo "$conf_label"; return 0; fi
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
asus_port_for(){ idx="$1"; set -- $(nvram get wans_dualwan 2>/dev/null || true); [ "$idx" = "0" ] && echo "$1" || echo "$2"; }
wan_ifname(){ idx="$1"; nvram get wan\${idx}_ifname 2>/dev/null || true; }
wan_gateway(){ idx="$1"; nvram get wan\${idx}_gateway 2>/dev/null || true; }
wan_label(){ idx="$1"; iface="$(wan_ifname "$idx")"; gateway="$(wan_gateway "$idx")"; value="$(conf_label_for_path "$iface" "$gateway")"; [ -n "$value" ] || value="$(port_label "$(asus_port_for "$idx")")"; echo "$value"; }
wan_table(){ idx="$1"; echo "wan$idx"; }
source_ip_for(){ iface="$1"; ip -4 addr show dev "$iface" 2>/dev/null | awk '/ inet / {print $2; exit}' | cut -d/ -f1; }
safe_line(){ tr '\\n' ' ' | sed 's/[[:space:]][[:space:]]*/ /g; s/^ //; s/ $//'; }
route_wan_for_line(){
  line="$1"
  iface0="$(wan_ifname 0)"
  iface1="$(wan_ifname 1)"
  table0="$(wan_table 0)"
  table1="$(wan_table 1)"
  case "$line" in
    *" dev $iface0 "*) echo "wan0"; return 0 ;;
    *" dev $iface1 "*) echo "wan1"; return 0 ;;
    *" lookup wan0"*|*" lookup $table0"*) echo "wan0"; return 0 ;;
    *" lookup wan1"*|*" lookup $table1"*) echo "wan1"; return 0 ;;
  esac
  echo ""
}
ping_with_binding(){
  iface="$1"
  source_ip="$2"
  if [ -n "$iface" ]; then
    ping -I "$iface" -c "$PING_COUNT" -W 2 "$PING_TARGET" 2>&1 || ping -I "$source_ip" -c "$PING_COUNT" -W 2 "$PING_TARGET" 2>&1 || true
  else
    ping -c "$PING_COUNT" -W 2 "$PING_TARGET" 2>&1 || true
  fi
}
uptime_ms(){ awk '{printf "%d", $1 * 1000}' /proc/uptime 2>/dev/null || date +%s000; }
curl_download_once(){
  bind="$1"
  url="$2"
  if [ -n "$bind" ]; then
    curl -4 -L -o /dev/null -sS -k --interface "$bind" --max-time "$DURATION" --connect-timeout 4 -w 'http_code=%{http_code}\\ntime_namelookup=%{time_namelookup}\\ntime_connect=%{time_connect}\\ntime_appconnect=%{time_appconnect}\\ntime_starttransfer=%{time_starttransfer}\\ntime_total=%{time_total}\\nspeed_download=%{speed_download}\\nsize_download=%{size_download}\\nremote_ip=%{remote_ip}\\n' "$url" 2>&1 || true
  else
    curl -4 -L -o /dev/null -sS -k --max-time "$DURATION" --connect-timeout 4 -w 'http_code=%{http_code}\\ntime_namelookup=%{time_namelookup}\\ntime_connect=%{time_connect}\\ntime_appconnect=%{time_appconnect}\\ntime_starttransfer=%{time_starttransfer}\\ntime_total=%{time_total}\\nspeed_download=%{speed_download}\\nsize_download=%{size_download}\\nremote_ip=%{remote_ip}\\n' "$url" 2>&1 || true
  fi
}
wget_download_metrics(){
  bind="$1"
  url="$2"
  { [ -x /usr/sbin/wget ] || command -v wget >/dev/null 2>&1; } || { echo "status=no_wget"; return 0; }
  tmp="/tmp/smartwan_wanq_download.$$.$RANDOM"
  start_ms="$(uptime_ms)"
  if [ -n "$bind" ]; then
    wget -4 --bind-address="$bind" -T "$DURATION" -q -O "$tmp" "$url" 2>&1 || true
  else
    wget -4 -T "$DURATION" -q -O "$tmp" "$url" 2>&1 || true
  fi
  end_ms="$(uptime_ms)"
  bytes="$(wc -c < "$tmp" 2>/dev/null || echo 0)"
  rm -f "$tmp"
  elapsed_ms=$((end_ms - start_ms))
  [ "$elapsed_ms" -gt 0 ] 2>/dev/null || elapsed_ms=1
  speed="$(awk -v b="$bytes" -v ms="$elapsed_ms" 'BEGIN { printf "%.0f", (b * 1000) / ms }')"
  echo "http_code=000"
  echo "time_total=$(awk -v ms="$elapsed_ms" 'BEGIN { printf "%.3f", ms / 1000 }')"
  echo "speed_download=$speed"
  echo "size_download=$bytes"
  echo "remote_ip="
  echo "status=wget_fallback"
}
curl_metrics(){
  iface="$1"
  source_ip="$2"
  url="$3"
  [ -n "$url" ] || { echo "status=no_url"; return 0; }
  if [ -x /usr/sbin/curl ] || command -v curl >/dev/null 2>&1; then
    out="$(curl_download_once "$iface" "$url")"
    echo "$out" | grep -q '^speed_download=' && { echo "$out"; return 0; }
    if [ -n "$source_ip" ] && [ "$source_ip" != "$iface" ]; then
      out="$(curl_download_once "$source_ip" "$url")"
      echo "$out" | grep -q '^speed_download=' && { echo "$out"; return 0; }
    fi
  fi
  wget_download_metrics "$source_ip" "$url"
}
curl_upload_metrics(){
  iface="$1"
  source_ip="$2"
  [ "$UPLOAD_KB" -gt 0 ] 2>/dev/null || { echo "status=disabled"; return 0; }
  [ -n "$UPLOAD_URL" ] || { echo "status=no_upload_url"; return 0; }
  { [ -x /usr/sbin/curl ] || command -v curl >/dev/null 2>&1; } || { echo "status=no_curl"; return 0; }
  { [ -x /bin/dd ] || [ -x /usr/bin/dd ] || command -v dd >/dev/null 2>&1; } || { echo "status=no_dd"; return 0; }
  if [ -n "$iface" ]; then
    out="$(dd if=/dev/zero bs=1024 count="$UPLOAD_KB" 2>/dev/null | curl -4 -L -o /dev/null -sS -k --interface "$iface" --max-time "$DURATION" --connect-timeout 4 -X POST --data-binary @- -w 'http_code=%{http_code}\\ntime_total=%{time_total}\\nspeed_upload=%{speed_upload}\\nsize_upload=%{size_upload}\\nremote_ip=%{remote_ip}\\n' "$UPLOAD_URL" 2>&1 || true)"
    echo "$out" | grep -q '^speed_upload=' && { echo "$out"; return 0; }
    if [ -n "$source_ip" ] && [ "$source_ip" != "$iface" ]; then
      dd if=/dev/zero bs=1024 count="$UPLOAD_KB" 2>/dev/null | curl -4 -L -o /dev/null -sS -k --interface "$source_ip" --max-time "$DURATION" --connect-timeout 4 -X POST --data-binary @- -w 'http_code=%{http_code}\\ntime_total=%{time_total}\\nspeed_upload=%{speed_upload}\\nsize_upload=%{size_upload}\\nremote_ip=%{remote_ip}\\n' "$UPLOAD_URL" 2>&1 || true
    else
      echo "$out"
    fi
  else
    dd if=/dev/zero bs=1024 count="$UPLOAD_KB" 2>/dev/null | curl -4 -L -o /dev/null -sS -k --max-time "$DURATION" --connect-timeout 4 -X POST --data-binary @- -w 'http_code=%{http_code}\\ntime_total=%{time_total}\\nspeed_upload=%{speed_upload}\\nsize_upload=%{size_upload}\\nremote_ip=%{remote_ip}\\n' "$UPLOAD_URL" 2>&1 || true
  fi
}

for scenario in $SCENARIOS; do
  id="\${scenario%%:*}"
  rest="\${scenario#*:}"
  idx="\${rest%%:*}"
  rest="\${rest#*:}"
  type="\${rest%%:*}"
  label="\${rest#*:}"
  label="$(printf '%s' "$label" | tr '_' ' ')"
  iface=""
  source_ip=""
  gateway=""
  table=""
  wan_label=""
  route_line=""
  route_wan=""
  matched_rule=""

  if [ "$type" = "forced" ]; then
    iface="$(wan_ifname "$idx")"
    source_ip="$(source_ip_for "$iface")"
    gateway="$(wan_gateway "$idx")"
    table="$(wan_table "$idx")"
    wan_label="$(wan_label "$idx")"
    route_line="$(ip route show table "$table" 2>/dev/null | awk '/^default / {print; exit}' | safe_line)"
    [ -n "$route_line" ] || route_line="$(ip route get "$ROUTE_TARGET" 2>/dev/null | safe_line)"
    route_wan="wan$idx"
    matched_rule="forced interface $iface / table $table"
  else
    if [ -n "$SOURCE_HOST" ]; then
      route_line="$(ip route get "$ROUTE_TARGET" from "$SOURCE_HOST" 2>/dev/null | safe_line)"
      matched_rule="current policy preview for LAN source $SOURCE_HOST"
    else
      route_line="$(ip route get "$ROUTE_TARGET" 2>/dev/null | safe_line)"
      matched_rule="current router policy"
    fi
    route_wan="$(route_wan_for_line "$route_line")"
    case "$route_wan" in
      wan0) idx=0 ;;
      wan1) idx=1 ;;
      *) idx=-1 ;;
    esac
    if [ "$idx" = "0" ] || [ "$idx" = "1" ]; then
      iface="$(wan_ifname "$idx")"
      source_ip="$(source_ip_for "$iface")"
      gateway="$(wan_gateway "$idx")"
      table="$(wan_table "$idx")"
      wan_label="$(wan_label "$idx")"
    else
      iface="$(first_default_dev)"
    fi
  fi

  echo "__WANQ_SCENARIO__$id"
  echo "label=$label"
  echo "type=$type"
  echo "wan_id=$route_wan"
  echo "wan_label=$wan_label"
  echo "iface=$iface"
  echo "source_ip=$source_ip"
  echo "gateway=$gateway"
  echo "table=$table"
  echo "route_target=$ROUTE_TARGET"
  echo "route_line=$route_line"
  echo "route_wan=$route_wan"
  echo "matched_rule=$matched_rule"
  echo "execution_scope=router"
  echo "confidence=$([ -n "$route_wan" ] && echo medium || echo low)"
  if [ "$PREVIEW_ONLY" = "1" ]; then
    continue
  fi
  echo "__WANQ_BLOCK__ping"
  ping_with_binding "$([ "$type" = "forced" ] && echo "$iface" || echo "")" "$source_ip"
  echo "__WANQ_END_BLOCK__"
  if [ "$RUN_THROUGHPUT" = "1" ]; then
    echo "__WANQ_BLOCK__http"
    curl_metrics "$([ "$type" = "forced" ] && echo "$iface" || echo "")" "$source_ip" "$DOWNLOAD_URL"
    echo "__WANQ_END_BLOCK__"
    if [ -x /usr/sbin/curl ] || command -v curl >/dev/null 2>&1; then
      tmp="/tmp/smartwan_wanq_loaded.$$.$id"
      curl_metrics "$([ "$type" = "forced" ] && echo "$iface" || echo "")" "$source_ip" "$DOWNLOAD_URL" > "$tmp" 2>&1 &
      pid="$!"
      sleep 1
      echo "__WANQ_BLOCK__loaded_ping"
      ping_with_binding "$([ "$type" = "forced" ] && echo "$iface" || echo "")" "$source_ip"
      echo "__WANQ_END_BLOCK__"
      wait "$pid" >/dev/null 2>&1 || true
      rm -f "$tmp"
    fi
    echo "__WANQ_BLOCK__upload"
    curl_upload_metrics "$([ "$type" = "forced" ] && echo "$iface" || echo "")" "$source_ip"
    echo "__WANQ_END_BLOCK__"
  fi
done
`;
}

async function readHistoryFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not read WAN quality history: ${error.message}`);
    return [];
  }
}

async function saveHistoryFile(history) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const next = history.slice(0, HISTORY_LIMIT);
  await fs.writeFile(HISTORY_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

export async function listWanQualityHistory() {
  return { history: await readHistoryFile() };
}

export async function previewWanQuality(settings, input = {}) {
  const request = normalizeRequest(input);
  const startedAt = new Date().toISOString();
  const result = await execCommand(settings, 'sh -s', {
    timeoutMs: 20000,
    stdin: buildRemoteScript(request, settings, true),
  });
  const scenarios = parseRemoteOutput(result.stdout);
  return {
    ok: result.code === 0,
    mode: request.mode,
    targetProfile: request.targetProfile,
    targetLabel: request.profile.label,
    routeTarget: request.profile.routeTarget,
    sourceHost: request.sourceHost,
    startedAt,
    scenarios,
    stderr: result.stderr.trim(),
    code: result.code,
  };
}

export async function runWanQualityTest(settings, input = {}) {
  const request = normalizeRequest(input);
  const startedAt = new Date().toISOString();
  const timeoutMs = request.mode === 'combined' ? 90000 : 60000;
  const result = await execCommand(settings, 'sh -s', {
    timeoutMs,
    stdin: buildRemoteScript(request, settings, false),
  });
  const scenarios = parseRemoteOutput(result.stdout);
  const record = {
    id: `wanq-${Date.now()}`,
    ok: result.code === 0,
    mode: request.mode,
    targetProfile: request.targetProfile,
    targetLabel: request.profile.label,
    routeTarget: request.profile.routeTarget,
    sourceHost: request.sourceHost,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationSeconds: request.durationSeconds,
    pingCount: request.pingCount,
    runThroughput: request.runThroughput,
    scenarios,
    combined: request.mode === 'combined' ? summarizeCombined(scenarios) : null,
    stderr: result.stderr.trim(),
    code: result.code,
    limitations: [
      'Router-side probe: it verifies route behavior from the router execution context. A LAN source preview can show policy matching, but the traffic is not generated by that LAN client.',
      'Combined mode is not proof that one TCP flow can use both WANs. It is an estimated multi-flow/router potential from per-WAN probes.',
      request.profile.throughputCapable
        ? 'Throughput uses a small HTTP adapter and should be treated as a quality sample, not a full ISP speed certification.'
        : 'This target is route/latency focused. Download/upload throughput is intentionally not treated as authoritative for this destination.',
    ],
  };
  const history = await readHistoryFile();
  await saveHistoryFile([record, ...history]);
  return record;
}
