#!/bin/sh

# Merlin event hooks run with a minimal environment. Keep system networking
# tools reachable when SmartWAN is started outside an interactive SSH shell.
PATH="/sbin:/usr/sbin:/bin:/usr/bin${PATH:+:$PATH}"
export PATH

SMARTWAN_DIR="${SMARTWAN_DIR:-/jffs/addons/smartwan.d}"
SMARTWAN_CONF="${SMARTWAN_CONF:-$SMARTWAN_DIR/smartwan.conf}"
SMARTWAN_RUNTIME_DIR="${SMARTWAN_RUNTIME_DIR:-/tmp}"
SMARTWAN_LOG="${SMARTWAN_LOG:-$SMARTWAN_RUNTIME_DIR/smartwan.log}"
SMARTWAN_PID="${SMARTWAN_PID:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.pid}"
SMARTWAN_MONITOR_LOCK="${SMARTWAN_MONITOR_LOCK:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.lock}"
SMARTWAN_MONITOR_ACTIVE_LOCK="${SMARTWAN_MONITOR_ACTIVE_LOCK:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.active}"
SMARTWAN_APPLY_LOCK="${SMARTWAN_APPLY_LOCK:-$SMARTWAN_RUNTIME_DIR/smartwan-apply.lock}"
SMARTWAN_SCRIPTS_DIR="${SMARTWAN_SCRIPTS_DIR:-/jffs/scripts}"
SMARTWAN_DNSMASQ_ADD="${SMARTWAN_DNSMASQ_ADD:-/jffs/configs/dnsmasq.conf.add}"
SMARTWAN_CHAIN="${SMARTWAN_CHAIN:-SMARTWAN_MANGLE}"
SMARTWAN_IPSET_PREFIX="${SMARTWAN_IPSET_PREFIX:-smartwan}"
SMARTWAN_PRIORITY_MARK="${SMARTWAN_PRIORITY_MARK:-150}"
SMARTWAN_PRIORITY_SERVICE_START="${SMARTWAN_PRIORITY_SERVICE_START:-160}"
SMARTWAN_PRIORITY_HOST_START="${SMARTWAN_PRIORITY_HOST_START:-200}"
SMARTWAN_PRIORITY_END="${SMARTWAN_PRIORITY_END:-499}"
SMARTWAN_LEGACY_PRIORITY_START="${SMARTWAN_LEGACY_PRIORITY_START:-31000}"
SMARTWAN_LEGACY_PRIORITY_END="${SMARTWAN_LEGACY_PRIORITY_END:-31099}"
SMARTWAN_MARK_MASK="${SMARTWAN_MARK_MASK:-0xf0000000}"
# Health probes have the highest managed priority so each probe keeps testing
# its own WAN even while the global emergency override is active.
SMARTWAN_PRIORITY_HEALTH="${SMARTWAN_PRIORITY_HEALTH:-80}"
# Internal LAN/VPN destinations must return through main/tun/br0 and must never
# be captured by a WAN default route during failover.
SMARTWAN_PRIORITY_INTERNAL="${SMARTWAN_PRIORITY_INTERNAL:-81}"
# Emergency failover precedes every Internet policy, including a forced VPN WAN,
# while remaining below health probes and internal-destination protection.
SMARTWAN_PRIORITY_FAILOVER="${SMARTWAN_PRIORITY_FAILOVER:-82}"
# Router-hosted services (including OpenVPN servers) must answer through the
# WAN address that received the connection. This keeps UDP sessions symmetric
# when native ASUS Dual WAN load balancing is active.
SMARTWAN_PRIORITY_WAN_SOURCE="${SMARTWAN_PRIORITY_WAN_SOURCE:-83}"
SMARTWAN_PRIORITY_VPN_FORCE="${SMARTWAN_PRIORITY_VPN_FORCE:-85}"
# A preferred VPN WAN is evaluated after the emergency override.
SMARTWAN_PRIORITY_VPN_PREFER="${SMARTWAN_PRIORITY_VPN_PREFER:-96}"
# A managed DMZ host must answer through the WAN that accepted the inbound
# connection. Emergency failover (82) and location exceptions (94) remain
# authoritative; normal ASUS whole-device rules (97) remain below it.
SMARTWAN_PRIORITY_DMZ="${SMARTWAN_PRIORITY_DMZ:-95}"
# Destination-specific ASUS rules for a source pinned to one WAN must be
# evaluated before the source-only normalization below. Failover (82) and a
# forced VPN WAN (85) still remain authoritative.
SMARTWAN_PRIORITY_ASUS_EXCEPTION="${SMARTWAN_PRIORITY_ASUS_EXCEPTION:-94}"
# Correct native ASUS full-device rules before its priority-100 rules. The
# emergency priority-82 override still wins and sends every client to the
# healthy ISP during failover.
SMARTWAN_PRIORITY_ASUS_SOURCE="${SMARTWAN_PRIORITY_ASUS_SOURCE:-97}"
SMARTWAN_HEALTH_TABLE_WAN0="${SMARTWAN_HEALTH_TABLE_WAN0:-120}"
SMARTWAN_HEALTH_TABLE_WAN1="${SMARTWAN_HEALTH_TABLE_WAN1:-121}"
SMARTWAN_HEALTH_STATE="${SMARTWAN_HEALTH_STATE:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.state}"
SMARTWAN_EVENT_JOURNAL="${SMARTWAN_EVENT_JOURNAL:-$SMARTWAN_RUNTIME_DIR/smartwan-events.log}"
SMARTWAN_VPN_INPUT_CHAIN="${SMARTWAN_VPN_INPUT_CHAIN:-SMARTWAN_VPN_IN}"
SMARTWAN_VPN_FORWARD_CHAIN="${SMARTWAN_VPN_FORWARD_CHAIN:-SMARTWAN_VPN_FWD}"
SMARTWAN_VPN_NAT_CHAIN="${SMARTWAN_VPN_NAT_CHAIN:-SMARTWAN_VPN_NAT}"
SMARTWAN_DMZ_NAT_CHAIN="${SMARTWAN_DMZ_NAT_CHAIN:-SMARTWAN_DMZ_NAT}"
SMARTWAN_DMZ_FORWARD_CHAIN="${SMARTWAN_DMZ_FORWARD_CHAIN:-SMARTWAN_DMZ_FWD}"
SMARTWAN_DMZ_STATE="${SMARTWAN_DMZ_STATE:-$SMARTWAN_RUNTIME_DIR/smartwan-dmz.state}"

[ -x /usr/sbin/curl ] && curl() { /usr/sbin/curl "$@"; }
[ -x /usr/sbin/wget ] && wget() { /usr/sbin/wget "$@"; }
[ -x /usr/bin/nslookup ] && nslookup() { /usr/bin/nslookup "$@"; }
[ -x /bin/busybox ] && busybox() { /bin/busybox "$@"; }
[ -x /usr/sbin/ip ] && ip() { /usr/sbin/ip "$@"; }
[ -x /usr/sbin/iptables ] && iptables() { /usr/sbin/iptables "$@"; }
[ -x /bin/ping ] && ping() { /bin/ping "$@"; }

log_msg() {
  [ "${log_enabled:-1}" = "1" ] || return 0
  mkdir -p "$(dirname "$SMARTWAN_LOG")" 2>/dev/null
  echo "$(date '+%Y-%m-%d %H:%M:%S') smartwan: $*" >> "$SMARTWAN_LOG"
  max_lines="${log_max_lines:-300}"
  case "$max_lines" in
    ""|*[!0-9]*|0) return 0 ;;
  esac
  line_count="$(wc -l < "$SMARTWAN_LOG" 2>/dev/null || echo 0)"
  if [ "$line_count" -gt $((max_lines + 50)) ] 2>/dev/null; then
    tail -n "$max_lines" "$SMARTWAN_LOG" > "$SMARTWAN_LOG.tmp.$$" 2>/dev/null && mv "$SMARTWAN_LOG.tmp.$$" "$SMARTWAN_LOG"
  fi
}

record_wan_event() {
  event_type="$1"
  event_wan="$2"
  event_reason="$3"
  event_active="$4"
  event_failures="${5:-0}"
  event_epoch="$(date '+%s' 2>/dev/null || echo 0)"
  event_time="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
  event_id="${event_epoch}-${event_type}-${event_wan}"
  mkdir -p "$(dirname "$SMARTWAN_EVENT_JOURNAL")" 2>/dev/null
  if printf '1|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
    "$event_id" "$event_epoch" "$event_time" "$event_type" "$event_wan" \
    "$event_reason" "$event_active" "$event_failures" "${state_mode:-}" \
    >> "$SMARTWAN_EVENT_JOURNAL"; then
    log_msg "WAN event journal appended type=$event_type wan=$event_wan active=$event_active id=$event_id"
  else
    log_msg "WAN event journal write failed path=$SMARTWAN_EVENT_JOURNAL type=$event_type wan=$event_wan"
    return 1
  fi

  # This short journal stays in RAM. The panel copies confirmed transitions to
  # its persistent data volume, avoiding periodic writes to router flash.
  event_lines="$(wc -l < "$SMARTWAN_EVENT_JOURNAL" 2>/dev/null || echo 0)"
  if [ "$event_lines" -gt 240 ] 2>/dev/null; then
    tail -n 200 "$SMARTWAN_EVENT_JOURNAL" > "$SMARTWAN_EVENT_JOURNAL.tmp.$$" 2>/dev/null \
      && mv "$SMARTWAN_EVENT_JOURNAL.tmp.$$" "$SMARTWAN_EVENT_JOURNAL"
  fi
}

command_exists() {
  for candidate in "/usr/sbin/$1" "/usr/bin/$1" "/sbin/$1" "/bin/$1"; do
    [ -x "$candidate" ] && return 0
  done
  command -v "$1" >/dev/null 2>&1
}

acquire_apply_lock() {
  apply_owner="$$"
  apply_waited=0
  while ! mkdir "$SMARTWAN_APPLY_LOCK" 2>/dev/null; do
    existing_owner="$(cat "$SMARTWAN_APPLY_LOCK/pid" 2>/dev/null || true)"
    if [ -n "$existing_owner" ] && kill -0 "$existing_owner" 2>/dev/null; then
      apply_waited=$((apply_waited + 1))
      if [ "$apply_waited" -ge 20 ]; then
        log_msg "managed rule update skipped after waiting for active apply pid=$existing_owner"
        return 1
      fi
      sleep 1
      continue
    fi
    rm -f "$SMARTWAN_APPLY_LOCK/pid" 2>/dev/null || true
    rmdir "$SMARTWAN_APPLY_LOCK" 2>/dev/null || true
  done
  echo "$apply_owner" > "$SMARTWAN_APPLY_LOCK/pid"
}

release_apply_lock() {
  lock_owner="$(cat "$SMARTWAN_APPLY_LOCK/pid" 2>/dev/null || true)"
  if [ "$lock_owner" = "$$" ]; then
    rm -f "$SMARTWAN_APPLY_LOCK/pid" 2>/dev/null || true
    rmdir "$SMARTWAN_APPLY_LOCK" 2>/dev/null || true
  fi
}

run_with_apply_lock() {
  acquire_apply_lock || return 0
  trap 'release_apply_lock; exit 0' HUP INT TERM
  "$@"
  result=$?
  release_apply_lock
  trap - HUP INT TERM
  return "$result"
}

legacy_hosts_to_rules() {
  input="$1"
  result=""
  old_ifs="$IFS"
  IFS=','
  for entry in $input; do
    host="${entry%%|*}"
    rest="${entry#*|}"
    wan="${rest%%|*}"
    [ -n "$host" ] && [ -n "$wan" ] && [ "$host" != "$entry" ] || continue
    result="${result:+$result;}$host=$wan"
  done
  IFS="$old_ifs"
  echo "$result"
}

legacy_services_to_rules() {
  input="$1"
  result=""
  old_ifs="$IFS"
  IFS=','
  for entry in $input; do
    rest="${entry#*|}"
    dest="${rest%%|*}"
    rest="${rest#*|}"
    wan="${rest%%|*}"
    [ -n "$dest" ] && [ -n "$wan" ] && [ "$dest" != "$rest" ] || continue
    result="${result:+$result;}$dest=$wan"
  done
  IFS="$old_ifs"
  echo "$result"
}

table_for_wan() {
  case "$1" in
    wan0|0|"$wan0_label") echo "$wan0_table" ;;
    wan1|1|"$wan1_label") echo "$wan1_table" ;;
    *) echo "" ;;
  esac
}

canonical_wan() {
  case "$1" in
    wan0|0|"$wan0_label") echo "wan0" ;;
    wan1|1|"$wan1_label") echo "wan1" ;;
    *) echo "" ;;
  esac
}

ifname_for_wan() {
  case "$(canonical_wan "$1")" in
    wan0) echo "$wan0_ifname" ;;
    wan1) echo "$wan1_ifname" ;;
    *) echo "" ;;
  esac
}

gateway_for_wan() {
  case "$(canonical_wan "$1")" in
    wan0) echo "$wan0_gateway" ;;
    wan1) echo "$wan1_gateway" ;;
    *) echo "" ;;
  esac
}

mark_for_wan() {
  case "$(canonical_wan "$1")" in
    wan0) echo "0x80000000" ;;
    wan1) echo "0x90000000" ;;
    *) echo "" ;;
  esac
}

ipset_for_wan() {
  wan="$(canonical_wan "$1")"
  [ -n "$wan" ] && echo "${SMARTWAN_IPSET_PREFIX}_${wan}"
}

route_field_from_stdin() {
  field="$1"
  awk -v field="$field" '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == field && (i + 1) <= NF) {
          print $(i + 1)
          exit
        }
      }
    }
  '
}

default_nexthop_field() {
  index="$1"
  field="$2"
  ip route show default 2>/dev/null | awk -v n="$index" -v field="$field" '
    function has_route_field() {
      for (i = 1; i <= NF; i++) {
        if ($i == "via" || $i == "dev") return 1
      }
      return 0
    }
    function emit() {
      for (i = 1; i <= NF; i++) {
        if ($i == field && (i + 1) <= NF) {
          print $(i + 1)
          exit
        }
      }
    }
    /^default/ && has_route_field() {
      count++
      if (count == n) emit()
    }
    $1 == "nexthop" {
      count++
      if (count == n) emit()
    }
  '
}

table_default_field() {
  table="$1"
  field="$2"
  ip route show table "$table" default 2>/dev/null | route_field_from_stdin "$field"
}

discover_wan_defaults() {
  [ -n "$wan0_ifname" ] || wan0_ifname="$(table_default_field "$wan0_table" dev)"
  [ -n "$wan0_gateway" ] || wan0_gateway="$(table_default_field "$wan0_table" via)"
  [ -n "$wan1_ifname" ] || wan1_ifname="$(table_default_field "$wan1_table" dev)"
  [ -n "$wan1_gateway" ] || wan1_gateway="$(table_default_field "$wan1_table" via)"

  [ -n "$wan0_ifname" ] || wan0_ifname="$(default_nexthop_field 1 dev)"
  [ -n "$wan0_gateway" ] || wan0_gateway="$(default_nexthop_field 1 via)"
  [ -n "$wan1_ifname" ] || wan1_ifname="$(default_nexthop_field 2 dev)"
  [ -n "$wan1_gateway" ] || wan1_gateway="$(default_nexthop_field 2 via)"
}

load_config() {
  enabled=""
  enable=""
  active_preset=""
  routing_mode=""
  orchestration_enabled=""
  orchestration_mode=""
  auto_discover_wans=""
  health_probe_strategy=""
  health_probe_policy=""
  failover_action=""
  restore_action=""
  suspend_asus_rules_on_failover=""
  restore_asus_rules_on_recovery=""
  conntrack_on_switch=""
  remembered_dualwan_preset=""
  primary_wan=""
  failover_wan=""
  manage_main_default=""
  wan0_label=""
  wan1_label=""
  wan0_ifname=""
  wan1_ifname=""
  wan0_gateway=""
  wan1_gateway=""
  wan0_table=""
  wan1_table=""
  host_rules=""
  service_rules=""
  domain_rules_enabled=""
  domain_rules=""
  rules_hosts=""
  rules_services=""
  watchdog_enabled=""
  watchdog_targets=""
  watchdog_interval=""
  watchdog_fail_count=""
  watchdog_recover_count=""
  vpn_management_enabled=""
  vpn_interface=""
  vpn_subnet=""
  vpn_additional_profiles=""
  vpn_lan_subnet=""
  vpn_policy_mode=""
  vpn_preferred_wan=""
  vpn_allow_router=""
  vpn_allow_lan=""
  vpn_allow_internet=""
  vpn_nat_enabled=""
  dmz_enabled=""
  dmz_target_ip=""
  dmz_preferred_wan=""
  dmz_failover_mode=""
  runtime_dir=""
  log_enabled=""
  log_max_lines=""
  test_mode=""

  if [ -f "$SMARTWAN_CONF" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        ""|\#*) continue ;;
      esac
      case "$line" in
        *=*) ;;
        *) continue ;;
      esac
      key="${line%%=*}"
      value="${line#*=}"
      case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
      esac
      case "$key" in
        enabled) enabled="$value" ;;
        enable) enable="$value" ;;
        active_preset) active_preset="$value" ;;
        routing_mode) routing_mode="$value" ;;
        orchestration_enabled) orchestration_enabled="$value" ;;
        orchestration_mode) orchestration_mode="$value" ;;
        auto_discover_wans) auto_discover_wans="$value" ;;
        health_probe_strategy) health_probe_strategy="$value" ;;
        health_probe_policy) health_probe_policy="$value" ;;
        failover_action) failover_action="$value" ;;
        restore_action) restore_action="$value" ;;
        suspend_asus_rules_on_failover) suspend_asus_rules_on_failover="$value" ;;
        restore_asus_rules_on_recovery) restore_asus_rules_on_recovery="$value" ;;
        conntrack_on_switch) conntrack_on_switch="$value" ;;
        remembered_dualwan_preset) remembered_dualwan_preset="$value" ;;
        primary_wan) primary_wan="$value" ;;
        failover_wan) failover_wan="$value" ;;
        manage_main_default) manage_main_default="$value" ;;
        wan0_label) wan0_label="$value" ;;
        wan1_label) wan1_label="$value" ;;
        wan0_ifname) wan0_ifname="$value" ;;
        wan1_ifname) wan1_ifname="$value" ;;
        wan0_gateway) wan0_gateway="$value" ;;
        wan1_gateway) wan1_gateway="$value" ;;
        wan0_table) wan0_table="$value" ;;
        wan1_table) wan1_table="$value" ;;
        host_rules) host_rules="$value" ;;
        service_rules) service_rules="$value" ;;
        domain_rules_enabled) domain_rules_enabled="$value" ;;
        domain_rules) domain_rules="$value" ;;
        rules_hosts) rules_hosts="$value" ;;
        rules_services) rules_services="$value" ;;
        watchdog_enabled) watchdog_enabled="$value" ;;
        watchdog_targets) watchdog_targets="$value" ;;
        watchdog_interval) watchdog_interval="$value" ;;
        watchdog_fail_count) watchdog_fail_count="$value" ;;
        watchdog_recover_count) watchdog_recover_count="$value" ;;
        vpn_management_enabled) vpn_management_enabled="$value" ;;
        vpn_interface) vpn_interface="$value" ;;
        vpn_subnet) vpn_subnet="$value" ;;
        vpn_additional_profiles) vpn_additional_profiles="$value" ;;
        vpn_lan_subnet) vpn_lan_subnet="$value" ;;
        vpn_policy_mode) vpn_policy_mode="$value" ;;
        vpn_preferred_wan) vpn_preferred_wan="$value" ;;
        vpn_allow_router) vpn_allow_router="$value" ;;
        vpn_allow_lan) vpn_allow_lan="$value" ;;
        vpn_allow_internet) vpn_allow_internet="$value" ;;
        vpn_nat_enabled) vpn_nat_enabled="$value" ;;
        dmz_enabled) dmz_enabled="$value" ;;
        dmz_target_ip) dmz_target_ip="$value" ;;
        dmz_preferred_wan) dmz_preferred_wan="$value" ;;
        dmz_failover_mode) dmz_failover_mode="$value" ;;
        runtime_dir) runtime_dir="$value" ;;
        log_enabled) log_enabled="$value" ;;
        log_max_lines) log_max_lines="$value" ;;
        test_mode) test_mode="$value" ;;
      esac
    done < "$SMARTWAN_CONF"
  fi

  configured_wan0_ifname="$wan0_ifname"
  configured_wan1_ifname="$wan1_ifname"
  configured_wan0_label="$wan0_label"
  configured_wan1_label="$wan1_label"
  configured_primary_wan="$primary_wan"
  configured_failover_wan="$failover_wan"
  configured_vpn_preferred_wan="$vpn_preferred_wan"
  configured_dmz_preferred_wan="$dmz_preferred_wan"

  enabled="${enabled:-${enable:-0}}"
  routing_mode="${routing_mode:-manual_rules}"
  orchestration_enabled="${orchestration_enabled:-0}"
  orchestration_mode="${orchestration_mode:-observe_only}"
  auto_discover_wans="${auto_discover_wans:-1}"
  health_probe_strategy="${health_probe_strategy:-per_wan_public_ipv4}"
  health_probe_policy="${health_probe_policy:-majority}"
  failover_action="${failover_action:-runtime_policy_override}"
  restore_action="${restore_action:-restore_dualwan_balance}"
  suspend_asus_rules_on_failover="${suspend_asus_rules_on_failover:-1}"
  restore_asus_rules_on_recovery="${restore_asus_rules_on_recovery:-1}"
  conntrack_on_switch="${conntrack_on_switch:-failed_wan}"
  primary_wan="${primary_wan:-wan0}"
  failover_wan="${failover_wan:-wan1}"
  manage_main_default="${manage_main_default:-0}"
  wan0_label="${wan0_label:-wan0}"
  wan1_label="${wan1_label:-wan1}"
  wan0_table="${wan0_table:-100}"
  wan1_table="${wan1_table:-101}"
  host_rules="${host_rules:-$(legacy_hosts_to_rules "$rules_hosts")}"
  service_rules="${service_rules:-$(legacy_services_to_rules "$rules_services")}"
  domain_rules_enabled="${domain_rules_enabled:-0}"
  watchdog_enabled="${watchdog_enabled:-0}"
  watchdog_interval="${watchdog_interval:-1}"
  watchdog_fail_count="${watchdog_fail_count:-2}"
  watchdog_recover_count="${watchdog_recover_count:-3}"
  vpn_management_enabled="${vpn_management_enabled:-0}"
  vpn_interface="${vpn_interface:-tun21}"
  vpn_subnet="${vpn_subnet:-10.8.0.0/24}"
  vpn_additional_profiles="${vpn_additional_profiles:-}"
  vpn_lan_subnet="${vpn_lan_subnet:-192.168.1.0/24}"
  vpn_policy_mode="${vpn_policy_mode:-prefer_wan_with_failover}"
  vpn_preferred_wan="${vpn_preferred_wan:-wan1}"
  vpn_allow_router="${vpn_allow_router:-1}"
  vpn_allow_lan="${vpn_allow_lan:-1}"
  vpn_allow_internet="${vpn_allow_internet:-1}"
  vpn_nat_enabled="${vpn_nat_enabled:-1}"
  dmz_enabled="${dmz_enabled:-0}"
  dmz_target_ip="${dmz_target_ip:-}"
  dmz_preferred_wan="${dmz_preferred_wan:-wan1}"
  case "$dmz_failover_mode" in
    preferred_only) ;;
    *) dmz_failover_mode="follow_failover" ;;
  esac
  runtime_dir="${runtime_dir:-/tmp}"
  log_enabled="${log_enabled:-1}"
  log_max_lines="${log_max_lines:-300}"
  test_mode="${test_mode:-0}"

  SMARTWAN_RUNTIME_DIR="$runtime_dir"
  SMARTWAN_LOG="${SMARTWAN_LOG_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan.log}"
  SMARTWAN_PID="${SMARTWAN_PID_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.pid}"
  SMARTWAN_MONITOR_LOCK="${SMARTWAN_MONITOR_LOCK_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.lock}"
  SMARTWAN_MONITOR_ACTIVE_LOCK="${SMARTWAN_MONITOR_ACTIVE_LOCK_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.active}"
  SMARTWAN_HEALTH_STATE="${SMARTWAN_HEALTH_STATE_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan-watchdog.state}"
  SMARTWAN_EVENT_JOURNAL="${SMARTWAN_EVENT_JOURNAL_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan-events.log}"
  SMARTWAN_DMZ_STATE="${SMARTWAN_DMZ_STATE_OVERRIDE:-$SMARTWAN_RUNTIME_DIR/smartwan-dmz.state}"

  live_wan0_ifname="$(nvram get wan0_ifname 2>/dev/null || true)"
  live_wan1_ifname="$(nvram get wan1_ifname 2>/dev/null || true)"
  live_wan0_gateway="$(nvram get wan0_gateway 2>/dev/null || true)"
  live_wan1_gateway="$(nvram get wan1_gateway 2>/dev/null || true)"

  if [ "$auto_discover_wans" = "1" ] && [ -n "$live_wan0_ifname" ] && [ -n "$live_wan1_ifname" ]; then
    configured_primary_ifname=""
    configured_failover_ifname=""
    configured_vpn_ifname=""
    configured_dmz_ifname=""
    case "$configured_primary_wan" in
      wan0|0) configured_primary_ifname="$configured_wan0_ifname" ;;
      wan1|1) configured_primary_ifname="$configured_wan1_ifname" ;;
    esac
    case "$configured_failover_wan" in
      wan0|0) configured_failover_ifname="$configured_wan0_ifname" ;;
      wan1|1) configured_failover_ifname="$configured_wan1_ifname" ;;
    esac
    case "$configured_vpn_preferred_wan" in
      wan0|0) configured_vpn_ifname="$configured_wan0_ifname" ;;
      wan1|1) configured_vpn_ifname="$configured_wan1_ifname" ;;
    esac
    case "$configured_dmz_preferred_wan" in
      wan0|0) configured_dmz_ifname="$configured_wan0_ifname" ;;
      wan1|1) configured_dmz_ifname="$configured_wan1_ifname" ;;
    esac

    if [ "$live_wan0_ifname" = "$configured_wan1_ifname" ]; then
      wan0_label="${configured_wan1_label:-wan0}"
    elif [ "$live_wan0_ifname" = "$configured_wan0_ifname" ]; then
      wan0_label="${configured_wan0_label:-wan0}"
    fi
    if [ "$live_wan1_ifname" = "$configured_wan0_ifname" ]; then
      wan1_label="${configured_wan0_label:-wan1}"
    elif [ "$live_wan1_ifname" = "$configured_wan1_ifname" ]; then
      wan1_label="${configured_wan1_label:-wan1}"
    fi

    [ "$configured_primary_ifname" = "$live_wan0_ifname" ] && primary_wan="wan0"
    [ "$configured_primary_ifname" = "$live_wan1_ifname" ] && primary_wan="wan1"
    [ "$configured_failover_ifname" = "$live_wan0_ifname" ] && failover_wan="wan0"
    [ "$configured_failover_ifname" = "$live_wan1_ifname" ] && failover_wan="wan1"
    if [ -n "$configured_vpn_preferred_wan" ]; then
      [ "$configured_vpn_ifname" = "$live_wan0_ifname" ] && vpn_preferred_wan="wan0"
      [ "$configured_vpn_ifname" = "$live_wan1_ifname" ] && vpn_preferred_wan="wan1"
    fi
    if [ -n "$configured_dmz_preferred_wan" ]; then
      [ "$configured_dmz_ifname" = "$live_wan0_ifname" ] && dmz_preferred_wan="wan0"
      [ "$configured_dmz_ifname" = "$live_wan1_ifname" ] && dmz_preferred_wan="wan1"
    fi

    wan0_ifname="$live_wan0_ifname"
    wan1_ifname="$live_wan1_ifname"
    wan0_gateway="$live_wan0_gateway"
    wan1_gateway="$live_wan1_gateway"
    wan0_table="wan0"
    wan1_table="wan1"
    wan_mapping_source="nvram"
  else
    [ -n "$wan0_ifname" ] || wan0_ifname="$live_wan0_ifname"
    [ -n "$wan1_ifname" ] || wan1_ifname="$live_wan1_ifname"
    [ -n "$wan0_gateway" ] || wan0_gateway="$live_wan0_gateway"
    [ -n "$wan1_gateway" ] || wan1_gateway="$live_wan1_gateway"
    wan_mapping_source="config"
  fi
  discover_wan_defaults
}

vpn_profiles() {
  printf '%s|%s|%s\n' "$vpn_interface" "$vpn_subnet" "$vpn_preferred_wan"
  old_ifs="$IFS"
  IFS=';'
  for profile in $vpn_additional_profiles; do
    interface="${profile%%|*}"
    remainder="${profile#*|}"
    subnet="${remainder%%|*}"
    profile_preferred="${remainder#*|}"
    [ "$profile_preferred" != "$remainder" ] || profile_preferred="$vpn_preferred_wan"
    [ "$interface" != "$profile" ] || continue
    [ -n "$interface" ] && [ -n "$subnet" ] || continue
    [ "$interface" = "$vpn_interface" ] && [ "$subnet" = "$vpn_subnet" ] && continue
    printf '%s|%s|%s\n' "$interface" "$subnet" "$profile_preferred"
  done
  IFS="$old_ifs"
}

vpn_profile_interface() {
  printf '%s' "${1%%|*}"
}

vpn_profile_subnet() {
  remainder="${1#*|}"
  printf '%s' "${remainder%%|*}"
}

vpn_profile_preferred_wan() {
  remainder="${1#*|}"
  preferred="${remainder#*|}"
  [ "$preferred" != "$remainder" ] || preferred="$vpn_preferred_wan"
  printf '%s' "$preferred"
}

is_managed_vpn_subnet() {
  candidate="$1"
  old_ifs="$IFS"
  IFS='
'
  for profile in $(vpn_profiles); do
    subnet="$(vpn_profile_subnet "$profile")"
    if [ "$candidate" = "$subnet" ]; then
      IFS="$old_ifs"
      return 0
    fi
  done
  IFS="$old_ifs"
  return 1
}

delete_priority_range() {
  priority="$1"
  end="$2"
  while [ "$priority" -le "$end" ]; do
    while ip rule del priority "$priority" 2>/dev/null; do :; done
    priority=$((priority + 1))
  done
}

delete_priority_exact() {
  priority="$1"
  while ip rule del priority "$priority" 2>/dev/null; do :; done
}

delete_managed_rules() {
  # Remove priorities used by releases before the ordered health/internal/
  # emergency policy chain was introduced.
  delete_priority_exact 90
  delete_priority_exact "$SMARTWAN_PRIORITY_ASUS_EXCEPTION"
  delete_priority_exact 95
  delete_priority_exact "$SMARTWAN_PRIORITY_HEALTH"
  delete_priority_exact "$SMARTWAN_PRIORITY_INTERNAL"
  delete_priority_exact "$SMARTWAN_PRIORITY_FAILOVER"
  delete_priority_exact "$SMARTWAN_PRIORITY_ASUS_SOURCE"
  delete_priority_range "$SMARTWAN_PRIORITY_MARK" "$SMARTWAN_PRIORITY_END"
  delete_priority_range "$SMARTWAN_LEGACY_PRIORITY_START" "$SMARTWAN_LEGACY_PRIORITY_END"
}

apply_asus_source_overrides() {
  delete_priority_exact "$SMARTWAN_PRIORITY_ASUS_SOURCE"
  [ "$enabled" = "1" ] || return 0
  [ "$orchestration_enabled" = "1" ] || return 0
  [ "$(nvram get wans_mode 2>/dev/null || true)" = "lb" ] || return 0
  [ "$(nvram get wans_routing_enable 2>/dev/null || true)" = "1" ] || return 0

  raw_rules="$(nvram get wans_routing_rulelist 2>/dev/null || true)"
  [ -n "$raw_rules" ] || return 0
  pairs="$(
    printf '%s' "$raw_rules" | tr '<' '\n' | awk -F '>' '
      NF >= 3 && ($2 == "1.0.0.0/1" || $2 == "0.0.0.0/1" || $2 == "128.0.0.0/1") {
        key = $1 "|" $3
        if ($2 == "1.0.0.0/1" || $2 == "0.0.0.0/1") lower[key] = 1
        if ($2 == "128.0.0.0/1") upper[key] = 1
      }
      END {
        for (key in lower) if (upper[key]) print key
      }
    '
  )"

  old_ifs="$IFS"
  IFS='
'
  for pair in $pairs; do
    source="${pair%|*}"
    unit="${pair##*|}"
    case "$unit" in
      0) table="$wan0_table" ;;
      1) table="$wan1_table" ;;
      *) continue ;;
    esac
    [ -n "$source" ] && [ -n "$table" ] || continue
    is_managed_vpn_subnet "$source" && continue
    ip rule add priority "$SMARTWAN_PRIORITY_ASUS_SOURCE" from "$source" lookup "$table" 2>/dev/null || true
    log_msg "ASUS full-device rule normalized source=$source unit=$unit table=$table priority=$SMARTWAN_PRIORITY_ASUS_SOURCE"
  done
  IFS="$old_ifs"
  ip route flush cache 2>/dev/null || true
}

apply_asus_destination_exceptions() {
  delete_priority_exact "$SMARTWAN_PRIORITY_ASUS_EXCEPTION"
  [ "$enabled" = "1" ] || return 0
  [ "$orchestration_enabled" = "1" ] || return 0
  [ "$(nvram get wans_mode 2>/dev/null || true)" = "lb" ] || return 0
  [ "$(nvram get wans_routing_enable 2>/dev/null || true)" = "1" ] || return 0

  raw_rules="$(nvram get wans_routing_rulelist 2>/dev/null || true)"
  [ -n "$raw_rules" ] || return 0

  # A source is pinned to a WAN only when ASUS contains the complementary
  # lower/upper IPv4 pair for the same source and unit.
  pinned_sources="$(
    printf '%s' "$raw_rules" | tr '<' '\n' | awk -F '>' '
      NF >= 3 && ($2 == "1.0.0.0/1" || $2 == "0.0.0.0/1" || $2 == "128.0.0.0/1") {
        key = $1 "|" $3
        source[key] = $1
        if ($2 == "1.0.0.0/1" || $2 == "0.0.0.0/1") lower[key] = 1
        if ($2 == "128.0.0.0/1") upper[key] = 1
      }
      END {
        for (key in lower) if (upper[key]) print source[key]
      }
    ' | sort -u
  )"
  [ -n "$pinned_sources" ] || return 0

  old_ifs="$IFS"
  IFS='
'
  for entry in $(printf '%s' "$raw_rules" | tr '<' '\n'); do
    [ -n "$entry" ] || continue
    source="$(printf '%s' "$entry" | awk -F '>' '{ print $1 }')"
    destination="$(printf '%s' "$entry" | awk -F '>' '{ print $2 }')"
    unit="$(printf '%s' "$entry" | awk -F '>' '{ print $3 }')"
    [ -n "$source" ] && [ -n "$destination" ] || continue
    case "$destination" in
      0.0.0.0/1|1.0.0.0/1|128.0.0.0/1) continue ;;
      */*|[0-9]*.[0-9]*.[0-9]*.[0-9]*) ;;
      *) continue ;;
    esac
    printf '%s\n' "$pinned_sources" | grep -Fqx "$source" || continue
    case "$unit" in
      0) table="$wan0_table" ;;
      1) table="$wan1_table" ;;
      *) continue ;;
    esac
    [ -n "$table" ] || continue
    ip rule add priority "$SMARTWAN_PRIORITY_ASUS_EXCEPTION" \
      from "$source" to "$destination" lookup "$table" 2>/dev/null || \
      log_msg "failed ASUS destination exception source=$source destination=$destination unit=$unit table=$table priority=$SMARTWAN_PRIORITY_ASUS_EXCEPTION"
  done
  IFS="$old_ifs"
  ip route flush cache 2>/dev/null || true
}

delete_vpn_policy_rule() {
  priority="$1"
  subnet="$2"
  for table in wan0 wan1 "$wan0_table" "$wan1_table" 100 101; do
    [ -n "$table" ] || continue
    while ip rule del priority "$priority" from "$subnet" lookup "$table" 2>/dev/null; do :; done
    while ip rule del pref "$priority" from "$subnet" table "$table" 2>/dev/null; do :; done
  done
}

copy_connected_routes_to_table() {
  table="$1"
  ip route show table main 2>/dev/null | while IFS= read -r route_line; do
    case "$route_line" in
      ""|default*|nexthop*) continue ;;
    esac
    ip route add $route_line table "$table" 2>/dev/null || true
  done
}

replace_table_default_for_wan() {
  table_wan="$1"
  route_wan="$2"
  table="$(table_for_wan "$table_wan")"
  ifname="$(ifname_for_wan "$route_wan")"
  gateway="$(gateway_for_wan "$route_wan")"

  [ -n "$table" ] && [ -n "$ifname" ] || return 1

  if [ "$test_mode" = "1" ]; then
    log_msg "test mode: table $table default via=${gateway:-direct} dev=$ifname route_wan=$route_wan"
    return 0
  fi

  if [ -n "$gateway" ]; then
    ip route replace default via "$gateway" dev "$ifname" table "$table" 2>/dev/null || {
      ip route del default table "$table" 2>/dev/null || true
      ip route add default via "$gateway" dev "$ifname" table "$table" 2>/dev/null
    }
  else
    ip route replace default dev "$ifname" table "$table" 2>/dev/null || {
      ip route del default table "$table" 2>/dev/null || true
      ip route add default dev "$ifname" table "$table" 2>/dev/null
    }
  fi
}

prepare_table() {
  wan="$1"
  table="$(table_for_wan "$wan")"

  [ -n "$table" ] || return 0
  # Native ASUS tables are rebuilt by rc/dual-WAN. SmartWAN consumes them but
  # never flushes them, which keeps the ASUS rule owner and rollback intact.
  case "$table" in
    wan0|wan1) return 0 ;;
  esac
  ip route flush table "$table" 2>/dev/null || true
  copy_connected_routes_to_table "$table"

  replace_table_default_for_wan "$wan" "$wan" || \
    log_msg "routing table $table for $wan not prepared: interface/gateway unknown"
}

add_mark_rules() {
  for wan in wan0 wan1; do
    table="$(table_for_wan "$wan")"
    mark="$(mark_for_wan "$wan")"
    [ -n "$table" ] && [ -n "$mark" ] || continue
    if [ "$test_mode" = "1" ]; then
      log_msg "test mode: ip rule add fwmark $mark/$SMARTWAN_MARK_MASK table $table priority $SMARTWAN_PRIORITY_MARK"
    else
      ip rule add fwmark "$mark/$SMARTWAN_MARK_MASK" table "$table" priority "$SMARTWAN_PRIORITY_MARK" 2>/dev/null || \
        log_msg "failed mark rule: mark=$mark table=$table priority=$SMARTWAN_PRIORITY_MARK"
    fi
  done
}

add_host_rule() {
  entry="$1"
  priority="$2"
  host="${entry%%=*}"
  wan="${entry#*=}"
  table="$(table_for_wan "$wan")"

  [ -n "$host" ] && [ -n "$table" ] || {
    log_msg "skip invalid host rule: $entry"
    return 0
  }

  if [ "$test_mode" = "1" ]; then
    log_msg "test mode: ip rule add from $host table $table priority $priority"
  else
    ip rule add from "$host" table "$table" priority "$priority" 2>/dev/null || \
      log_msg "failed host rule: from=$host table=$table priority=$priority"
  fi
}

add_service_rule() {
  entry="$1"
  priority="$2"
  destination="${entry%%=*}"
  wan="${entry#*=}"
  table="$(table_for_wan "$wan")"

  [ -n "$destination" ] && [ -n "$table" ] || {
    log_msg "skip invalid service rule: $entry"
    return 0
  }

  case "$destination" in
    */*|[0-9]*.[0-9]*.[0-9]*.[0-9]*)
      if [ "$test_mode" = "1" ]; then
        log_msg "test mode: ip rule add to $destination table $table priority $priority"
      else
        ip rule add to "$destination" table "$table" priority "$priority" 2>/dev/null || \
          log_msg "failed service route: to=$destination table=$table priority=$priority"
      fi
      ;;
    *)
      log_msg "service rule '$entry' is not CIDR/IP; put domains in domain_rules"
      ;;
  esac
}

valid_dmz_target() {
  printf '%s\n' "$1" | awk -F. '
    NF == 4 {
      for (i = 1; i <= 4; i++) {
        if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1
      }
      if ($1 == 10) exit 0
      if ($1 == 172 && $2 >= 16 && $2 <= 31) exit 0
      if ($1 == 192 && $2 == 168) exit 0
      exit 1
    }
    { exit 1 }
  '
}

clear_dmz_rules() {
  delete_priority_exact "$SMARTWAN_PRIORITY_DMZ"
  command_exists iptables || {
    rm -f "$SMARTWAN_DMZ_STATE"
    return 0
  }

  for parent_chain in VSERVER PREROUTING; do
    while :; do
      jump_rule="$(iptables -t nat -S "$parent_chain" 2>/dev/null | grep -- "-j $SMARTWAN_DMZ_NAT_CHAIN" | head -n 1)"
      [ -n "$jump_rule" ] || break
      jump_args="${jump_rule#-A $parent_chain }"
      iptables -t nat -D "$parent_chain" $jump_args 2>/dev/null || break
    done
  done
  while :; do
    jump_rule="$(iptables -S FORWARD 2>/dev/null | grep -- "-j $SMARTWAN_DMZ_FORWARD_CHAIN" | head -n 1)"
    [ -n "$jump_rule" ] || break
    jump_args="${jump_rule#-A FORWARD }"
    iptables -D FORWARD $jump_args 2>/dev/null || break
  done
  iptables -t nat -F "$SMARTWAN_DMZ_NAT_CHAIN" 2>/dev/null || true
  iptables -t nat -X "$SMARTWAN_DMZ_NAT_CHAIN" 2>/dev/null || true
  iptables -F "$SMARTWAN_DMZ_FORWARD_CHAIN" 2>/dev/null || true
  iptables -X "$SMARTWAN_DMZ_FORWARD_CHAIN" 2>/dev/null || true
  rm -f "$SMARTWAN_DMZ_STATE"
}

dmz_runtime_wan() {
  preferred="$(canonical_wan "$dmz_preferred_wan")"
  [ -n "$preferred" ] || preferred="wan1"
  load_watchdog_state
  if [ "$state_mode" = "global_failover_active" ] && [ -n "$state_active" ] && [ "$state_active" != "$preferred" ]; then
    if [ "$dmz_failover_mode" = "preferred_only" ]; then
      echo "blocked"
    else
      canonical_wan "$state_active"
    fi
    return 0
  fi
  echo "$preferred"
}

write_dmz_state() {
  runtime_wan="$1"
  runtime_ifname="$2"
  runtime_status="$3"
  {
    echo "runtime_wan=$runtime_wan"
    echo "runtime_ifname=$runtime_ifname"
    echo "runtime_status=$runtime_status"
    echo "target_ip=$dmz_target_ip"
    echo "preferred_wan=$(canonical_wan "$dmz_preferred_wan")"
    echo "failover_mode=$dmz_failover_mode"
  } > "$SMARTWAN_DMZ_STATE"
}

apply_dmz_rules() {
  clear_dmz_rules
  [ "$enabled" = "1" ] || return 0
  [ "$dmz_enabled" = "1" ] || return 0
  valid_dmz_target "$dmz_target_ip" || {
    write_dmz_state "" "" "invalid_target"
    log_msg "managed DMZ skipped: invalid private target IP '$dmz_target_ip'"
    return 1
  }

  runtime_wan="$(dmz_runtime_wan)"
  if [ "$runtime_wan" = "blocked" ]; then
    write_dmz_state "blocked" "" "blocked_by_preferred_only"
    log_msg "managed DMZ blocked because preferred WAN is unavailable and failover mode is preferred_only"
    return 0
  fi
  runtime_ifname="$(ifname_for_wan "$runtime_wan")"
  runtime_table="$(table_for_wan "$runtime_wan")"
  runtime_unit="${runtime_wan#wan}"
  runtime_ip="$(nvram get "wan${runtime_unit}_ipaddr" 2>/dev/null || true)"
  [ -n "$runtime_ifname" ] && [ -n "$runtime_table" ] || {
    write_dmz_state "$runtime_wan" "$runtime_ifname" "wan_unresolved"
    log_msg "managed DMZ skipped: WAN mapping incomplete runtime_wan=$runtime_wan ifname=$runtime_ifname table=$runtime_table"
    return 1
  }

  if [ "$test_mode" = "1" ]; then
    write_dmz_state "$runtime_wan" "$runtime_ifname" "test_mode"
    log_msg "test mode: DMZ target=$dmz_target_ip runtime_wan=$runtime_wan ifname=$runtime_ifname table=$runtime_table"
    return 0
  fi

  command_exists iptables || {
    write_dmz_state "$runtime_wan" "$runtime_ifname" "iptables_missing"
    return 1
  }

  iptables -t nat -N "$SMARTWAN_DMZ_NAT_CHAIN" 2>/dev/null || true
  iptables -t nat -F "$SMARTWAN_DMZ_NAT_CHAIN" 2>/dev/null || true
  iptables -t nat -A "$SMARTWAN_DMZ_NAT_CHAIN" -j DNAT --to-destination "$dmz_target_ip"

  # ASUS sends WAN-destined traffic through VSERVER. Append after explicit
  # port-forwards and match the current WAN address so already-DNATed packets
  # are not captured again. Fall back to PREROUTING only on unusual firmware.
  if iptables -t nat -S VSERVER >/dev/null 2>&1; then
    if [ -n "$runtime_ip" ]; then
      iptables -t nat -A VSERVER -i "$runtime_ifname" -d "$runtime_ip" -j "$SMARTWAN_DMZ_NAT_CHAIN"
    else
      iptables -t nat -A VSERVER -i "$runtime_ifname" -j "$SMARTWAN_DMZ_NAT_CHAIN"
    fi
  else
    if [ -n "$runtime_ip" ]; then
      iptables -t nat -A PREROUTING -i "$runtime_ifname" -d "$runtime_ip" -j "$SMARTWAN_DMZ_NAT_CHAIN"
    else
      iptables -t nat -A PREROUTING -i "$runtime_ifname" -j "$SMARTWAN_DMZ_NAT_CHAIN"
    fi
  fi

  iptables -N "$SMARTWAN_DMZ_FORWARD_CHAIN" 2>/dev/null || true
  iptables -F "$SMARTWAN_DMZ_FORWARD_CHAIN" 2>/dev/null || true
  iptables -A "$SMARTWAN_DMZ_FORWARD_CHAIN" -d "$dmz_target_ip" -j ACCEPT
  iptables -I FORWARD 1 -i "$runtime_ifname" -j "$SMARTWAN_DMZ_FORWARD_CHAIN"

  ip rule add priority "$SMARTWAN_PRIORITY_DMZ" from "$dmz_target_ip" lookup "$runtime_table" 2>/dev/null || \
    log_msg "managed DMZ return rule could not be added target=$dmz_target_ip table=$runtime_table priority=$SMARTWAN_PRIORITY_DMZ"
  ip route flush cache 2>/dev/null || true
  write_dmz_state "$runtime_wan" "$runtime_ifname" "active"
  log_msg "managed DMZ active target=$dmz_target_ip runtime_wan=$runtime_wan ifname=$runtime_ifname failover_mode=$dmz_failover_mode"
}

reconcile_dmz_rules() {
  desired="$(dmz_runtime_wan)"
  current="$(sed -n 's/^runtime_wan=//p' "$SMARTWAN_DMZ_STATE" 2>/dev/null | tail -n 1)"
  status="$(sed -n 's/^runtime_status=//p' "$SMARTWAN_DMZ_STATE" 2>/dev/null | tail -n 1)"
  if [ "$dmz_enabled" != "1" ]; then
    [ -z "$current" ] && return 0
    clear_dmz_rules
    return 0
  fi
  if [ "$desired" = "blocked" ] &&
    [ "$current" = "blocked" ] &&
    [ "$status" = "blocked_by_preferred_only" ]; then
    return 0
  fi
  if [ "$current" = "$desired" ] && [ "$status" = "active" ]; then
    command_exists iptables || return 0
    iptables -t nat -S "$SMARTWAN_DMZ_NAT_CHAIN" >/dev/null 2>&1 && return 0
  fi
  apply_dmz_rules
}

clear_mangle_chain() {
  command_exists iptables || return 0
  while iptables -t mangle -D PREROUTING -j "$SMARTWAN_CHAIN" 2>/dev/null; do :; done
  while iptables -t mangle -D OUTPUT -j "$SMARTWAN_CHAIN" 2>/dev/null; do :; done
  iptables -t mangle -F "$SMARTWAN_CHAIN" 2>/dev/null || true
  iptables -t mangle -X "$SMARTWAN_CHAIN" 2>/dev/null || true
}

destroy_managed_ipsets() {
  command_exists ipset || return 0
  ipset list -n 2>/dev/null | grep "^${SMARTWAN_IPSET_PREFIX}_" | while IFS= read -r set_name; do
    ipset flush "$set_name" 2>/dev/null || true
    ipset destroy "$set_name" 2>/dev/null || true
  done
}

remove_dnsmasq_block() {
  tmp="$SMARTWAN_DNSMASQ_ADD.tmp.$$"
  mkdir -p "$(dirname "$SMARTWAN_DNSMASQ_ADD")" 2>/dev/null
  if [ -f "$SMARTWAN_DNSMASQ_ADD" ]; then
    awk '
      /^# SMARTWAN MANAGED BEGIN$/ { skip = 1; next }
      /^# SMARTWAN MANAGED END$/ { skip = 0; next }
      skip != 1 { print }
    ' "$SMARTWAN_DNSMASQ_ADD" > "$tmp"
  else
    : > "$tmp"
  fi
  mv "$tmp" "$SMARTWAN_DNSMASQ_ADD"
}

restart_dnsmasq() {
  [ "$test_mode" = "1" ] && {
    log_msg "test mode: dnsmasq restart requested"
    return 0
  }
  service restart_dnsmasq 2>/dev/null || rc restart_dnsmasq 2>/dev/null || killall -HUP dnsmasq 2>/dev/null || true
}

normalize_domain() {
  echo "$1" | sed 's#^[Hh][Tt][Tt][Pp][Ss]*://##; s#/.*$##; s#^\*\.##; s#^\.##'
}

setup_domain_routing() {
  clear_mangle_chain

  if [ "$domain_rules_enabled" != "1" ] || [ -z "$domain_rules" ]; then
    remove_dnsmasq_block
    destroy_managed_ipsets
    restart_dnsmasq
    [ "$domain_rules_enabled" = "1" ] || log_msg "domain_rules disabled; managed dnsmasq/ipset rules removed"
    return 0
  fi

  command_exists ipset || {
    log_msg "ipset not available; domain_rules cannot be applied"
    remove_dnsmasq_block
    destroy_managed_ipsets
    restart_dnsmasq
    return 0
  }
  command_exists iptables || {
    log_msg "iptables not available; domain_rules cannot be applied"
    remove_dnsmasq_block
    destroy_managed_ipsets
    restart_dnsmasq
    return 0
  }

  iptables -t mangle -N "$SMARTWAN_CHAIN" 2>/dev/null || true
  iptables -t mangle -F "$SMARTWAN_CHAIN" 2>/dev/null || true
  iptables -t mangle -C PREROUTING -j "$SMARTWAN_CHAIN" 2>/dev/null || \
    iptables -t mangle -A PREROUTING -j "$SMARTWAN_CHAIN" 2>/dev/null || true
  iptables -t mangle -C OUTPUT -j "$SMARTWAN_CHAIN" 2>/dev/null || \
    iptables -t mangle -A OUTPUT -j "$SMARTWAN_CHAIN" 2>/dev/null || true

  tmp="$SMARTWAN_DNSMASQ_ADD.tmp.$$"
  remove_dnsmasq_block
  cp "$SMARTWAN_DNSMASQ_ADD" "$tmp" 2>/dev/null || : > "$tmp"
  {
    echo "# SMARTWAN MANAGED BEGIN"
    old_ifs="$IFS"
    IFS=';'
    for entry in $domain_rules; do
      [ -n "$entry" ] || continue
      domain="$(normalize_domain "${entry%%=*}")"
      wan="${entry#*=}"
      set_name="$(ipset_for_wan "$wan")"
      mark="$(mark_for_wan "$wan")"
      [ -n "$domain" ] && [ -n "$set_name" ] && [ -n "$mark" ] || {
        log_msg "skip invalid domain rule: $entry"
        continue
      }
      ipset create "$set_name" hash:ip family inet maxelem 65536 -exist 2>/dev/null || \
        log_msg "failed creating ipset $set_name"
      ipset flush "$set_name" 2>/dev/null || true
      iptables -t mangle -A "$SMARTWAN_CHAIN" -m set --match-set "$set_name" dst \
        -j MARK --set-xmark "$mark/$SMARTWAN_MARK_MASK" 2>/dev/null || \
        log_msg "failed mangle mark for ipset $set_name"
      echo "ipset=/$domain/$set_name"
    done
    IFS="$old_ifs"
    echo "# SMARTWAN MANAGED END"
  } >> "$tmp"
  mv "$tmp" "$SMARTWAN_DNSMASQ_ADD"
  restart_dnsmasq
}

clear_legacy_vpn_runtime_rules() {
  command_exists iptables || return 0
  old_ifs="$IFS"
  IFS='
'
  for profile in $(vpn_profiles); do
    interface="$(vpn_profile_interface "$profile")"
    subnet="$(vpn_profile_subnet "$profile")"
    delete_vpn_policy_rule 90 "$subnet"
    for ifname in "$wan0_ifname" "$wan1_ifname" vlan2 vlan3; do
      [ -n "$ifname" ] || continue
      while iptables -t nat -D POSTROUTING -s "$subnet" -o "$ifname" -j MASQUERADE 2>/dev/null; do :; done
      while iptables -D FORWARD -i "$interface" -s "$subnet" -o "$ifname" -j ACCEPT 2>/dev/null; do :; done
      while iptables -D FORWARD -i "$ifname" -o "$interface" -d "$subnet" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; do :; done
    done
    while iptables -D INPUT -i "$interface" -s "$subnet" -j ACCEPT 2>/dev/null; do :; done
    while iptables -D FORWARD -i "$interface" -s "$subnet" -o br0 -d "$vpn_lan_subnet" -j ACCEPT 2>/dev/null; do :; done
    while iptables -D FORWARD -i br0 -s "$vpn_lan_subnet" -o "$interface" -d "$subnet" -j ACCEPT 2>/dev/null; do :; done
  done
  IFS="$old_ifs"
}

remove_chain_jumps() {
  table="$1"
  builtin_chain="$2"
  target_chain="$3"
  if [ "$table" = "filter" ]; then
    iptables -S "$builtin_chain" 2>/dev/null
  else
    iptables -t "$table" -S "$builtin_chain" 2>/dev/null
  fi | grep -- "-j $target_chain" | while IFS= read -r rule; do
    rule="${rule#-A $builtin_chain }"
    if [ "$table" = "filter" ]; then
      iptables -D "$builtin_chain" $rule 2>/dev/null || true
    else
      iptables -t "$table" -D "$builtin_chain" $rule 2>/dev/null || true
    fi
  done
}

clear_vpn_rules() {
  delete_priority_exact "$SMARTWAN_PRIORITY_INTERNAL"
  delete_priority_exact "$SMARTWAN_PRIORITY_WAN_SOURCE"
  delete_priority_exact "$SMARTWAN_PRIORITY_VPN_FORCE"
  delete_priority_exact "$SMARTWAN_PRIORITY_VPN_PREFER"
  command_exists iptables || return 0

  remove_chain_jumps filter INPUT "$SMARTWAN_VPN_INPUT_CHAIN"
  remove_chain_jumps filter FORWARD "$SMARTWAN_VPN_FORWARD_CHAIN"
  remove_chain_jumps nat POSTROUTING "$SMARTWAN_VPN_NAT_CHAIN"

  iptables -F "$SMARTWAN_VPN_INPUT_CHAIN" 2>/dev/null || true
  iptables -X "$SMARTWAN_VPN_INPUT_CHAIN" 2>/dev/null || true
  iptables -F "$SMARTWAN_VPN_FORWARD_CHAIN" 2>/dev/null || true
  iptables -X "$SMARTWAN_VPN_FORWARD_CHAIN" 2>/dev/null || true
  iptables -t nat -F "$SMARTWAN_VPN_NAT_CHAIN" 2>/dev/null || true
  iptables -t nat -X "$SMARTWAN_VPN_NAT_CHAIN" 2>/dev/null || true
}

apply_vpn_rules() {
  clear_legacy_vpn_runtime_rules
  clear_vpn_rules
  [ "$vpn_management_enabled" = "1" ] || {
    log_msg "managed OpenVPN policy disabled; SmartWAN VPN chains removed"
    return 0
  }
  command_exists iptables || {
    log_msg "managed OpenVPN policy skipped: iptables unavailable"
    return 1
  }

  iptables -N "$SMARTWAN_VPN_INPUT_CHAIN" 2>/dev/null || true
  iptables -F "$SMARTWAN_VPN_INPUT_CHAIN" 2>/dev/null || true
  iptables -N "$SMARTWAN_VPN_FORWARD_CHAIN" 2>/dev/null || true
  iptables -F "$SMARTWAN_VPN_FORWARD_CHAIN" 2>/dev/null || true
  iptables -t nat -N "$SMARTWAN_VPN_NAT_CHAIN" 2>/dev/null || true
  iptables -t nat -F "$SMARTWAN_VPN_NAT_CHAIN" 2>/dev/null || true

  profiles="$(vpn_profiles)"
  old_ifs="$IFS"
  IFS='
'
  for profile in $profiles; do
    interface="$(vpn_profile_interface "$profile")"
    subnet="$(vpn_profile_subnet "$profile")"
    iptables -I INPUT 1 -i "$interface" -s "$subnet" -j "$SMARTWAN_VPN_INPUT_CHAIN" 2>/dev/null || true
    iptables -I FORWARD 1 -i "$interface" -s "$subnet" -j "$SMARTWAN_VPN_FORWARD_CHAIN" 2>/dev/null || true
    iptables -I FORWARD 1 -o "$interface" -d "$subnet" -j "$SMARTWAN_VPN_FORWARD_CHAIN" 2>/dev/null || true
    iptables -t nat -I POSTROUTING 1 -s "$subnet" -j "$SMARTWAN_VPN_NAT_CHAIN" 2>/dev/null || true
  done

  [ "$vpn_allow_router" = "1" ] && \
    iptables -A "$SMARTWAN_VPN_INPUT_CHAIN" -j ACCEPT 2>/dev/null || true
  iptables -A "$SMARTWAN_VPN_INPUT_CHAIN" -j RETURN 2>/dev/null || true

  if [ "$vpn_allow_lan" = "1" ]; then
    for profile in $profiles; do
      interface="$(vpn_profile_interface "$profile")"
      iptables -A "$SMARTWAN_VPN_FORWARD_CHAIN" -i "$interface" -o br0 -d "$vpn_lan_subnet" -j ACCEPT 2>/dev/null || true
      iptables -A "$SMARTWAN_VPN_FORWARD_CHAIN" -i br0 -o "$interface" -s "$vpn_lan_subnet" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
    done
  fi
  if [ "$vpn_allow_internet" = "1" ]; then
    for profile in $profiles; do
      interface="$(vpn_profile_interface "$profile")"
      for ifname in "$wan0_ifname" "$wan1_ifname"; do
        [ -n "$ifname" ] || continue
        iptables -A "$SMARTWAN_VPN_FORWARD_CHAIN" -i "$interface" -o "$ifname" -j ACCEPT 2>/dev/null || true
        iptables -A "$SMARTWAN_VPN_FORWARD_CHAIN" -i "$ifname" -o "$interface" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
      done
    done
  fi
  iptables -A "$SMARTWAN_VPN_FORWARD_CHAIN" -j RETURN 2>/dev/null || true

  if [ "$vpn_nat_enabled" = "1" ] && [ "$vpn_allow_internet" = "1" ]; then
    for ifname in "$wan0_ifname" "$wan1_ifname"; do
      [ -n "$ifname" ] || continue
      iptables -t nat -A "$SMARTWAN_VPN_NAT_CHAIN" -o "$ifname" -j MASQUERADE 2>/dev/null || true
    done
  fi
  iptables -t nat -A "$SMARTWAN_VPN_NAT_CHAIN" -j RETURN 2>/dev/null || true

  # These destination rules protect the return path to VPN clients and local
  # LAN access from global WAN defaults. Internet-bound VPN packets do not
  # match them and continue through failover/preference policy below.
  for profile in $profiles; do
    subnet="$(vpn_profile_subnet "$profile")"
    ip rule add priority "$SMARTWAN_PRIORITY_INTERNAL" to "$subnet" lookup main 2>/dev/null || true
  done
  if [ "$vpn_allow_lan" = "1" ] && [ -n "$vpn_lan_subnet" ]; then
    ip rule add priority "$SMARTWAN_PRIORITY_INTERNAL" to "$vpn_lan_subnet" lookup main 2>/dev/null || true
  fi

  # Replies from services listening on the router inherit the destination WAN
  # address as their source. Pin each address back to its own table so a native
  # load-balance decision cannot send an OpenVPN UDP reply through the other ISP.
  for wan in wan0 wan1; do
    source_ip="$(wan_source_ip "$wan")"
    table="$(table_for_wan "$wan")"
    [ -n "$source_ip" ] && [ -n "$table" ] || continue
    ip rule add priority "$SMARTWAN_PRIORITY_WAN_SOURCE" from "$source_ip" lookup "$table" 2>/dev/null || true
  done

  if [ "$vpn_allow_internet" = "1" ]; then
    for profile in $profiles; do
      subnet="$(vpn_profile_subnet "$profile")"
      preferred="$(canonical_wan "$(vpn_profile_preferred_wan "$profile")")"
      table="$(table_for_wan "$preferred")"
      [ -n "$table" ] || continue
      case "$vpn_policy_mode" in
        force_wan)
          ip rule add priority "$SMARTWAN_PRIORITY_VPN_FORCE" from "$subnet" lookup "$table" 2>/dev/null || true
          ;;
        prefer_wan_with_failover)
          ip rule add priority "$SMARTWAN_PRIORITY_VPN_PREFER" from "$subnet" lookup "$table" 2>/dev/null || true
          ;;
      esac
    done
  fi
  IFS="$old_ifs"
  ip route flush cache 2>/dev/null || true
  log_msg "managed OpenVPN policy applied profiles=$(printf '%s' "$profiles" | tr '\n' ';') mode=$vpn_policy_mode NAT=$vpn_nat_enabled"
}

wan_link_ok() {
  ifname="$(ifname_for_wan "$1")"
  [ -n "$ifname" ] || return 1
  [ -d "/sys/class/net/$ifname" ] || return 1
  if [ -r "/sys/class/net/$ifname/carrier" ]; then
    [ "$(cat "/sys/class/net/$ifname/carrier" 2>/dev/null)" = "1" ] || return 1
  fi
  ip -4 addr show dev "$ifname" 2>/dev/null | grep -q ' inet ' || return 1
  return 0
}

wan_source_ip() {
  ifname="$(ifname_for_wan "$1")"
  [ -n "$ifname" ] || return 1
  ip -4 addr show dev "$ifname" 2>/dev/null | awk '/ inet / {print $2; exit}' | cut -d/ -f1
}

apply_wan_reverse_path_filter() {
  # Strict reverse-path filtering is unsafe on a multi-homed router: Linux can
  # validate an incoming packet against the other WAN selected by the normal
  # load-balance FIB and drop it before the INPUT chain. Loose mode still
  # rejects sources that are not reachable through any route, while allowing
  # router-hosted services such as OpenVPN to receive traffic on either WAN.
  for ifname in "$wan0_ifname" "$wan1_ifname"; do
    [ -n "$ifname" ] || continue
    rp_filter_path="/proc/sys/net/ipv4/conf/$ifname/rp_filter"
    [ -w "$rp_filter_path" ] || continue
    printf '2\n' > "$rp_filter_path"
  done
}

is_ipv4_target() {
  target="${1%%/*}"
  case "$target" in
    ""|*[!0-9.]*) return 1 ;;
  esac
  echo "$target" | awk -F. 'NF == 4 { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1; exit 0 } { exit 1 }'
}

probe_target_via_wan() {
  wan="$1"
  target_raw="$2"
  target_ip="${target_raw%%/*}"
  target_cidr="$target_ip/32"
  ifname="$(ifname_for_wan "$wan")"
  gateway="$(gateway_for_wan "$wan")"
  case "$(canonical_wan "$wan")" in
    wan0) table="$SMARTWAN_HEALTH_TABLE_WAN0" ;;
    wan1) table="$SMARTWAN_HEALTH_TABLE_WAN1" ;;
    *) table="" ;;
  esac
  source_ip="$(wan_source_ip "$wan")"

  [ -n "$ifname" ] && [ -n "$table" ] && [ -n "$source_ip" ] || return 1
  is_ipv4_target "$target_ip" || return 1

  if [ "$test_mode" = "1" ]; then
    if [ "$(canonical_wan "${SMARTWAN_TEST_DOWN_WAN:-}")" = "$(canonical_wan "$wan")" ]; then
      save_wan_probe_state "$wan" 0 1 1 "test_forced_down"
      return 1
    fi
    log_msg "test mode: health probe wan=$wan source=$source_ip target=$target_ip table=$table dev=$ifname gateway=${gateway:-direct}"
    return 0
  fi

  # A monitor restart can interrupt a probe between rule creation and cleanup.
  # Health checks are sequential, so clearing the dedicated priority here
  # safely prevents a stale probe rule from surviving a WAN transition.
  delete_priority_exact "$SMARTWAN_PRIORITY_HEALTH"
  ip route flush table "$table" 2>/dev/null || true
  copy_connected_routes_to_table "$table"
  if [ -n "$gateway" ]; then
    ip route replace "$target_cidr" via "$gateway" dev "$ifname" table "$table" 2>/dev/null || return 1
  else
    ip route replace "$target_cidr" dev "$ifname" table "$table" 2>/dev/null || return 1
  fi
  ip rule add priority "$SMARTWAN_PRIORITY_HEALTH" from "$source_ip" to "$target_cidr" lookup "$table" 2>/dev/null || \
    ip rule add pref "$SMARTWAN_PRIORITY_HEALTH" from "$source_ip" to "$target_cidr" table "$table" 2>/dev/null || true
  ip route flush cache 2>/dev/null || true

  # A single source-bound probe is enough because the dedicated policy rule
  # already pins it to the selected WAN. Avoiding a second fallback probe keeps
  # confirmed failover inside the short interruption budget.
  ping -I "$source_ip" -c 1 -W 1 "$target_ip" >/dev/null 2>&1
  result=$?

  delete_priority_exact "$SMARTWAN_PRIORITY_HEALTH"
  ip route flush table "$table" 2>/dev/null || true
  ip route flush cache 2>/dev/null || true
  return "$result"
}

save_wan_probe_state() {
  wan="$1"
  successes="$2"
  attempts="$3"
  required="$4"
  result="$5"
  state_file="$SMARTWAN_RUNTIME_DIR/smartwan-health-$wan.state"
  last_success=""
  [ -f "$state_file" ] && last_success="$(sed -n 's/^last_success=//p' "$state_file" 2>/dev/null | head -n 1)"
  now="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
  [ "$result" = "ok" ] && last_success="$now"
  {
    echo "result=$result"
    echo "successes=$successes"
    echo "attempts=$attempts"
    echo "required=$required"
    echo "last_checked=$now"
    echo "last_success=$last_success"
  } > "$state_file"
}

wan_health_ok() {
  wan="$1"
  ifname="$(ifname_for_wan "$wan")"
  if ! wan_link_ok "$wan"; then
    save_wan_probe_state "$wan" 0 0 1 "link_down"
    return 1
  fi

  targets="$watchdog_targets"
  [ -n "$targets" ] || targets="1.1.1.1;8.8.8.8;9.9.9.9"
  total_targets=0
  old_ifs="$IFS"
  IFS=';'
  for target in $targets; do
    [ -n "$target" ] && total_targets=$((total_targets + 1))
  done
  IFS="$old_ifs"
  case "$health_probe_policy" in
    all) required="$total_targets" ;;
    any) required=1 ;;
    *) required=$((total_targets / 2 + 1)) ;;
  esac
  [ "$total_targets" -gt 0 ] || required=1

  attempts=0
  successes=0
  IFS=';'
  for target in $targets; do
    [ -n "$target" ] || continue
    attempts=$((attempts + 1))
    probe_target_via_wan "$wan" "$target" && successes=$((successes + 1))
    [ "$successes" -ge "$required" ] && break
    remaining=$((total_targets - attempts))
    [ $((successes + remaining)) -lt "$required" ] && break
  done
  IFS="$old_ifs"

  if [ "$successes" -ge "$required" ]; then
    save_wan_probe_state "$wan" "$successes" "$attempts" "$required" "ok"
    return 0
  fi
  save_wan_probe_state "$wan" "$successes" "$attempts" "$required" "internet_failed"
  return 1
}

active_default_wan() {
  dev="$(default_nexthop_field 1 dev)"
  gw="$(default_nexthop_field 1 via)"
  for wan in wan0 wan1; do
    ifname="$(ifname_for_wan "$wan")"
    gateway="$(gateway_for_wan "$wan")"
    [ -n "$ifname" ] || continue
    if [ "$dev" = "$ifname" ] && { [ -z "$gateway" ] || [ -z "$gw" ] || [ "$gw" = "$gateway" ]; }; then
      echo "$wan"
      return 0
    fi
  done
  echo ""
}

watchdog_number() {
  value="$1"
  fallback="$2"
  case "$value" in
    ""|*[!0-9]*) echo "$fallback" ;;
    *) echo "$value" ;;
  esac
}

watchdog_limit() {
  value="$(watchdog_number "$1" "$2")"
  [ "$value" -gt 0 ] 2>/dev/null && echo "$value" || echo 1
}

load_watchdog_state() {
  state_active=""
  state_failures=0
  state_recoveries=0
  state_mode="observe_only"
  state_last_switch_reason=""
  state_last_failover_at=""
  state_last_recovery_at=""
  state_failed_wan=""
  state_normal_wans_mode=""
  state_normal_wans_lb_ratio=""
  state_normal_wans_routing_enable=""
  state_normal_wans_routing_rulelist=""
  state_normal_wans_dualwan=""
  [ -f "$SMARTWAN_HEALTH_STATE" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      active=*) state_active="${line#active=}" ;;
      failures=*) state_failures="${line#failures=}" ;;
      recoveries=*) state_recoveries="${line#recoveries=}" ;;
      mode=*) state_mode="${line#mode=}" ;;
      last_switch_reason=*) state_last_switch_reason="${line#last_switch_reason=}" ;;
      last_failover_at=*) state_last_failover_at="${line#last_failover_at=}" ;;
      last_recovery_at=*) state_last_recovery_at="${line#last_recovery_at=}" ;;
      failed_wan=*) state_failed_wan="${line#failed_wan=}" ;;
      normal_wans_mode=*) state_normal_wans_mode="${line#normal_wans_mode=}" ;;
      normal_wans_lb_ratio=*) state_normal_wans_lb_ratio="${line#normal_wans_lb_ratio=}" ;;
      normal_wans_routing_enable=*) state_normal_wans_routing_enable="${line#normal_wans_routing_enable=}" ;;
      normal_wans_routing_rulelist=*) state_normal_wans_routing_rulelist="${line#normal_wans_routing_rulelist=}" ;;
      normal_wans_dualwan=*) state_normal_wans_dualwan="${line#normal_wans_dualwan=}" ;;
    esac
  done < "$SMARTWAN_HEALTH_STATE"
  state_failures="$(watchdog_number "$state_failures" 0)"
  state_recoveries="$(watchdog_number "$state_recoveries" 0)"
}

save_watchdog_state() {
  state_active="$1"
  state_failures="$2"
  state_recoveries="$3"
  state_mode="${4:-$state_mode}"
  state_last_switch_reason="${5:-$state_last_switch_reason}"
  if [ "$#" -ge 6 ]; then
    state_failed_wan="$6"
  fi
  mkdir -p "$(dirname "$SMARTWAN_HEALTH_STATE")" 2>/dev/null
  {
    echo "active=$state_active"
    echo "failures=$state_failures"
    echo "recoveries=$state_recoveries"
    echo "mode=$state_mode"
    echo "last_switch_reason=$state_last_switch_reason"
    echo "last_failover_at=$state_last_failover_at"
    echo "last_recovery_at=$state_last_recovery_at"
    echo "failed_wan=$state_failed_wan"
    echo "normal_wans_mode=$state_normal_wans_mode"
    echo "normal_wans_lb_ratio=$state_normal_wans_lb_ratio"
    echo "normal_wans_routing_enable=$state_normal_wans_routing_enable"
    echo "normal_wans_routing_rulelist=$state_normal_wans_routing_rulelist"
    echo "normal_wans_dualwan=$state_normal_wans_dualwan"
  } > "$SMARTWAN_HEALTH_STATE"
}

capture_normal_dualwan_state() {
  load_watchdog_state
  [ -n "$state_normal_wans_mode" ] || state_normal_wans_mode="$(nvram get wans_mode 2>/dev/null || true)"
  [ -n "$state_normal_wans_lb_ratio" ] || state_normal_wans_lb_ratio="$(nvram get wans_lb_ratio 2>/dev/null || true)"
  [ -n "$state_normal_wans_routing_enable" ] || state_normal_wans_routing_enable="$(nvram get wans_routing_enable 2>/dev/null || true)"
  [ -n "$state_normal_wans_routing_rulelist" ] || state_normal_wans_routing_rulelist="$(nvram get wans_routing_rulelist 2>/dev/null || true)"
  [ -n "$state_normal_wans_dualwan" ] || state_normal_wans_dualwan="$(nvram get wans_dualwan 2>/dev/null || true)"
}

persist_watchdog_snapshot() {
  save_watchdog_state \
    "${state_active:-}" \
    "${state_failures:-0}" \
    "${state_recoveries:-0}" \
    "${state_mode:-observe_only}" \
    "${state_last_switch_reason:-}"
}

choose_policy_wan() {
  primary="$(canonical_wan "$primary_wan")"
  failover="$(canonical_wan "$failover_wan")"
  [ -n "$primary" ] || primary="wan0"
  [ -n "$failover" ] || failover="wan1"
  fail_limit="$(watchdog_limit "$watchdog_fail_count" 2)"
  recover_limit="$(watchdog_limit "$watchdog_recover_count" 3)"
  load_watchdog_state
  current="${state_active:-$(active_default_wan)}"
  [ -n "$current" ] || current="$primary"

  primary_ok=0
  failover_ok=0
  wan_health_ok "$primary" && primary_ok=1
  wan_health_ok "$failover" && failover_ok=1

  if [ "$primary_ok" = "1" ] && [ "$failover_ok" = "1" ]; then
    if [ "$state_mode" = "global_failover_active" ]; then
      recoveries=$((state_recoveries + 1))
      if [ "$recoveries" -lt "$recover_limit" ]; then
        save_watchdog_state "$current" 0 "$recoveries" "global_failover_active" "all_wans_recovering" "$state_failed_wan"
        log_msg "all WANs recovering $recoveries/$recover_limit; keeping emergency active=$current"
        echo "$current"
        return 0
      fi
      recovered_wan="$state_failed_wan"
      log_msg "all WANs healthy; restoring ASUS Dual WAN load balance"
      state_last_recovery_at="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
      [ -n "$recovered_wan" ] && record_wan_event "recovery" "$recovered_wan" "wan_recovered" "$primary" 0
    fi
    save_watchdog_state "$primary" 0 0 "dualwan_balanced_managed" "all_wans_healthy" ""
    echo "$primary"
    return 0
  fi

  if [ "$primary_ok" = "1" ] || [ "$failover_ok" = "1" ]; then
    if [ "$primary_ok" = "1" ]; then
      healthy="$primary"
      failed="$failover"
    else
      healthy="$failover"
      failed="$primary"
    fi

    if [ "$state_mode" = "global_failover_active" ] \
      && [ "$current" = "$healthy" ] \
      && [ "$state_failed_wan" = "$failed" ]; then
      save_watchdog_state "$healthy" "$state_failures" 0 "global_failover_active" "${failed}_failed_${healthy}_ok" "$failed"
      echo "$healthy"
      return 0
    fi

    if [ "$state_failed_wan" = "$failed" ]; then
      failures=$((state_failures + 1))
    else
      failures=1
    fi
    if [ "$failures" -lt "$fail_limit" ]; then
      save_watchdog_state "$current" "$failures" 0 "dualwan_balanced_managed" "${failed}_probe_failed" "$failed"
      log_msg "$failed health failed $failures/$fail_limit; keeping ASUS Dual WAN rules"
      echo "$current"
      return 0
    fi

    if [ "$state_mode" != "global_failover_active" ] \
      || [ "$current" != "$healthy" ] \
      || [ "$state_failed_wan" != "$failed" ]; then
      if [ "$state_mode" = "global_failover_active" ] \
        && [ -n "$state_failed_wan" ] \
        && [ "$state_failed_wan" != "$failed" ]; then
        recovered_wan="$state_failed_wan"
        state_last_recovery_at="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
        record_wan_event "recovery" "$recovered_wan" "wan_recovered" "$healthy" 0
        log_msg "$recovered_wan recovered while $failed remains unavailable"
      fi
      log_msg "$failed health failed; forcing all traffic to healthy=$healthy"
      state_last_failover_at="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || true)"
      state_mode="global_failover_active"
      state_failed_wan="$failed"
      record_wan_event "outage" "$failed" "${failed}_failed_${healthy}_ok" "$healthy" "$failures"
    fi
    save_watchdog_state "$healthy" "$failures" 0 "global_failover_active" "${failed}_failed_${healthy}_ok" "$failed"
    echo "$healthy"
    return 0
  fi

  failures=$((state_failures + 1))
  save_watchdog_state "$current" "$failures" 0 "${state_mode:-dualwan_balanced_managed}" "all_wans_failed_or_unreachable" "$state_failed_wan"
  echo "$current"
}

replace_main_default_for_wan() {
  wan="$1"
  ifname="$(ifname_for_wan "$wan")"
  gateway="$(gateway_for_wan "$wan")"
  [ -n "$ifname" ] || return 1

  if [ "$test_mode" = "1" ]; then
    log_msg "test mode: main default via=${gateway:-direct} dev=$ifname active_wan=$wan"
    return 0
  fi

  current="$(ip route show default 2>/dev/null | tr '\n' ' ')"
  case "$current" in
    *"nexthop"*) ;;
    *" dev $ifname "*) [ -z "$gateway" ] || echo "$current" | grep -q " via $gateway " && return 0 ;;
  esac

  if [ -n "$gateway" ]; then
    ip route replace default via "$gateway" dev "$ifname" 2>/dev/null || {
      ip route del default 2>/dev/null || true
      ip route add default via "$gateway" dev "$ifname" 2>/dev/null
    }
  else
    ip route replace default dev "$ifname" 2>/dev/null || {
      ip route del default 2>/dev/null || true
      ip route add default dev "$ifname" 2>/dev/null
    }
  fi
  log_msg "main default route set to $wan dev=$ifname gateway=${gateway:-direct}"
}

replace_main_default_balance() {
  if0="$(ifname_for_wan wan0)"
  if1="$(ifname_for_wan wan1)"
  gw0="$(gateway_for_wan wan0)"
  gw1="$(gateway_for_wan wan1)"
  ratio="${state_normal_wans_lb_ratio:-$(nvram get wans_lb_ratio 2>/dev/null || true)}"
  weight0="${ratio%%:*}"
  weight1="${ratio#*:}"
  case "$weight0" in ""|*[!0-9]*) weight0=9 ;; esac
  case "$weight1" in ""|*[!0-9]*) weight1=1 ;; esac
  [ -n "$if0" ] && [ -n "$if1" ] || return 1

  if [ "$test_mode" = "1" ]; then
    log_msg "test mode: main default restored to dualwan balance $weight0:$weight1"
    return 0
  fi

  if [ -n "$gw0" ] && [ -n "$gw1" ]; then
    ip route replace default \
      nexthop via "$gw0" dev "$if0" weight "$weight0" \
      nexthop via "$gw1" dev "$if1" weight "$weight1" 2>/dev/null || return 1
  elif [ -n "$gw0" ]; then
    ip route replace default \
      nexthop via "$gw0" dev "$if0" weight "$weight0" \
      nexthop dev "$if1" weight "$weight1" 2>/dev/null || return 1
  elif [ -n "$gw1" ]; then
    ip route replace default \
      nexthop dev "$if0" weight "$weight0" \
      nexthop via "$gw1" dev "$if1" weight "$weight1" 2>/dev/null || return 1
  else
    ip route replace default \
      nexthop dev "$if0" weight "$weight0" \
      nexthop dev "$if1" weight "$weight1" 2>/dev/null || return 1
  fi
  log_msg "main default route restored to ASUS Dual WAN balance $weight0:$weight1"
}

flush_switch_connections() {
  switched_wan="$1"
  [ "$conntrack_on_switch" != "none" ] || return 0
  command_exists conntrack || {
    log_msg "conntrack cleanup skipped: command unavailable"
    return 0
  }
  if [ "$conntrack_on_switch" = "all" ]; then
    conntrack -F >/dev/null 2>&1 || true
    log_msg "conntrack table flushed after WAN transition"
    return 0
  fi
  mark="$(mark_for_wan "$switched_wan")"
  [ -n "$mark" ] || return 0
  conntrack -D -m mark --mark "$mark/$SMARTWAN_MARK_MASK" >/dev/null 2>&1 || true
  log_msg "conntrack entries for switched WAN were requested for cleanup"
}

apply_global_failover_override() {
  active="$1"
  table="$(table_for_wan "$active")"
  [ -n "$table" ] || {
    log_msg "global failover override skipped: unknown table for active=$active"
    return 1
  }
  if ip rule show 2>/dev/null | grep -Eq "^${SMARTWAN_PRIORITY_FAILOVER}:.*lookup[[:space:]]+$table([[:space:]]|$)"; then
    return 0
  fi
  capture_normal_dualwan_state
  persist_watchdog_snapshot
  if [ "$test_mode" = "1" ]; then
    log_msg "test mode: ip rule add priority $SMARTWAN_PRIORITY_FAILOVER lookup $table"
    return 0
  else
    delete_priority_exact "$SMARTWAN_PRIORITY_FAILOVER"
    ip rule add priority "$SMARTWAN_PRIORITY_FAILOVER" lookup "$table" 2>/dev/null || \
      log_msg "emergency override could not add priority $SMARTWAN_PRIORITY_FAILOVER lookup $table"
  fi
  ip route flush cache 2>/dev/null || true
  flush_switch_connections "${state_failed_wan:-$primary_wan}"
  log_msg "global failover override active: priority $SMARTWAN_PRIORITY_FAILOVER supersedes ASUS policy and sends all IPv4 traffic to $active table=$table; NVRAM and native ASUS rules unchanged"
}

restore_dualwan_balanced_state() {
  load_watchdog_state
  ip rule show 2>/dev/null | grep -q "^${SMARTWAN_PRIORITY_FAILOVER}:" || return 0
  delete_priority_exact "$SMARTWAN_PRIORITY_FAILOVER"
  ip route flush cache 2>/dev/null || true
  flush_switch_connections "${state_failed_wan:-$failover_wan}"
  log_msg "global failover override cleared: native ASUS Dual WAN load balance and its exact rule list are visible again"
}

reconcile_default_route() {
  load_config
  [ "$enabled" = "1" ] || return 0
  if [ "$orchestration_enabled" = "1" ]; then
    [ "$watchdog_enabled" = "1" ] || return 0
    active="$(choose_policy_wan)"
    primary="$(canonical_wan "$primary_wan")"
    failover="$(canonical_wan "$failover_wan")"
    [ -n "$primary" ] || primary="wan0"
    [ -n "$failover" ] || failover="wan1"
    load_watchdog_state
    case "$state_mode" in
      global_failover_active) apply_global_failover_override "$active" ;;
      *) restore_dualwan_balanced_state ;;
    esac
    reconcile_dmz_rules
    return 0
  fi

  [ "$manage_main_default" = "1" ] || return 0
  [ "$routing_mode" = "primary_failover" ] || return 0

  active="$(choose_policy_wan)"
  primary="$(canonical_wan "$primary_wan")"
  [ -n "$primary" ] || primary="wan0"

  replace_main_default_for_wan "$active" || log_msg "could not update main default route active=$active"
  replace_table_default_for_wan "$primary" "$active" || log_msg "could not update primary table failover primary=$primary active=$active"
  ip route flush cache 2>/dev/null || true
  reconcile_dmz_rules
}

pid_is_running() {
  [ -f "$SMARTWAN_PID" ] || return 1
  pid="$(cat "$SMARTWAN_PID" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps w 2>/dev/null | awk -v pid="$pid" -v script="$SMARTWAN_DIR/backend.sh" '
    $1 == pid && index($0, script " monitor") { found = 1 }
    END { exit(found ? 0 : 1) }
  '
}

stop_monitor() {
  owner="$(cat "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid" 2>/dev/null || true)"
  pid="$(cat "$SMARTWAN_PID" 2>/dev/null || true)"
  [ -n "$owner" ] && kill "$owner" 2>/dev/null || true
  [ -n "$pid" ] && [ "$pid" != "$owner" ] && kill "$pid" 2>/dev/null || true
  rm -f "$SMARTWAN_PID"
  rmdir "$SMARTWAN_MONITOR_LOCK" 2>/dev/null || true
  rm -f "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid" 2>/dev/null || true
  rmdir "$SMARTWAN_MONITOR_ACTIVE_LOCK" 2>/dev/null || true
}

start_monitor() {
  [ "$watchdog_enabled" = "1" ] || {
    stop_monitor
    return 0
  }
  if [ "$orchestration_enabled" != "1" ] && [ "$manage_main_default" != "1" ]; then
    stop_monitor
    return 0
  fi
  if [ "$orchestration_enabled" != "1" ] && [ "$routing_mode" != "primary_failover" ]; then
    stop_monitor
    return 0
  fi
  if ! mkdir "$SMARTWAN_MONITOR_LOCK" 2>/dev/null; then
    pid_is_running && return 0
    rmdir "$SMARTWAN_MONITOR_LOCK" 2>/dev/null || true
    mkdir "$SMARTWAN_MONITOR_LOCK" 2>/dev/null || return 0
  fi
  if pid_is_running; then
    rmdir "$SMARTWAN_MONITOR_LOCK" 2>/dev/null || true
    return 0
  fi
  rm -f "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid" 2>/dev/null || true
  rmdir "$SMARTWAN_MONITOR_ACTIVE_LOCK" 2>/dev/null || true
  "$0" monitor >/dev/null 2>&1 &
  echo $! > "$SMARTWAN_PID"
  rmdir "$SMARTWAN_MONITOR_LOCK" 2>/dev/null || true
  log_msg "watchdog monitor started interval=${watchdog_interval}s"
}

monitor_loop() {
  load_config
  monitor_pid="$$"
  if ! mkdir "$SMARTWAN_MONITOR_ACTIVE_LOCK" 2>/dev/null; then
    active_owner="$(cat "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid" 2>/dev/null || true)"
    if [ -n "$active_owner" ] && kill -0 "$active_owner" 2>/dev/null; then
      log_msg "duplicate watchdog monitor refused pid=$monitor_pid active_pid=$active_owner"
      return 0
    fi
    if [ -z "$active_owner" ]; then
      log_msg "duplicate watchdog monitor refused pid=$monitor_pid active lock is initializing"
      return 0
    fi
    rm -f "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid" 2>/dev/null || true
    rmdir "$SMARTWAN_MONITOR_ACTIVE_LOCK" 2>/dev/null || true
    mkdir "$SMARTWAN_MONITOR_ACTIVE_LOCK" 2>/dev/null || {
      log_msg "watchdog monitor could not acquire lifetime lock pid=$monitor_pid"
      return 0
    }
  fi
  echo "$monitor_pid" > "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid"
  echo "$monitor_pid" > "$SMARTWAN_PID"
  monitor_cleanup() {
    active_owner="$(cat "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid" 2>/dev/null || true)"
    if [ "$active_owner" = "$monitor_pid" ]; then
      rm -f "$SMARTWAN_MONITOR_ACTIVE_LOCK/pid"
      rmdir "$SMARTWAN_MONITOR_ACTIVE_LOCK" 2>/dev/null || true
    fi
    if [ "$(cat "$SMARTWAN_PID" 2>/dev/null)" = "$monitor_pid" ]; then
      rm -f "$SMARTWAN_PID"
    fi
  }
  trap 'monitor_cleanup; exit 0' HUP INT TERM
  trap 'monitor_cleanup' EXIT
  while :; do
    load_config
    [ "$enabled" = "1" ] || break
    [ "$watchdog_enabled" = "1" ] || break
    if [ "$orchestration_enabled" != "1" ]; then
      [ "$manage_main_default" = "1" ] || break
      [ "$routing_mode" = "primary_failover" ] || break
    fi
    reconcile_default_route
    sleep "${watchdog_interval:-1}"
  done
  monitor_cleanup
  trap - EXIT HUP INT TERM
}

apply_rules() {
  load_config
  # A manual apply or a Merlin event can otherwise race the health loop while
  # priorities and VPN chains are being rebuilt. Stop it under the apply lock;
  # the final start_monitor call creates one fresh lifetime-locked owner.
  stop_monitor
  apply_wan_reverse_path_filter
  delete_managed_rules
  clear_dmz_rules
  apply_vpn_rules
  apply_asus_destination_exceptions
  apply_asus_source_overrides

  if [ "$enabled" != "1" ]; then
    clear_mangle_chain
    remove_dnsmasq_block
    stop_monitor
    ip route flush cache 2>/dev/null || true
    log_msg "SmartWAN disabled; managed rules removed"
    return 0
  fi

  apply_dmz_rules

  if [ "$orchestration_enabled" = "1" ]; then
    # ASUS Dual WAN remains the sole owner of normal policy routes. SmartWAN
    # only adds the reversible emergency priority override after a real
    # internet failure, so native load-balance CIDR rules are never duplicated.
    clear_mangle_chain
    remove_dnsmasq_block
    log_msg "orchestration ownership active: native ASUS Dual WAN owns normal rules; stored SmartWAN host/service rules are not applied"
  else
    prepare_table wan0
    prepare_table wan1
    add_mark_rules

    priority="$SMARTWAN_PRIORITY_SERVICE_START"
    old_ifs="$IFS"
    IFS=';'
    for entry in $service_rules; do
      [ -n "$entry" ] || continue
      add_service_rule "$entry" "$priority"
      priority=$((priority + 1))
    done

    priority="$SMARTWAN_PRIORITY_HOST_START"
    for entry in $host_rules; do
      [ -n "$entry" ] || continue
      add_host_rule "$entry" "$priority"
      priority=$((priority + 1))
    done
    IFS="$old_ifs"

    setup_domain_routing
  fi
  reconcile_default_route
  start_monitor
  ip route flush cache 2>/dev/null || true
  log_msg "SmartWAN apply complete enabled=$enabled mode=$routing_mode manage_main_default=$manage_main_default host_rules='$host_rules' service_rules='$service_rules' domain_rules_enabled=$domain_rules_enabled domain_rules='$domain_rules'"
}

apply_vpn_only() {
  load_config
  apply_wan_reverse_path_filter
  apply_vpn_rules
}

apply_asus_sources_only() {
  load_config
  apply_wan_reverse_path_filter
  apply_asus_destination_exceptions
  apply_asus_source_overrides
}

print_status() {
  load_config
  reported_active_wan="$(active_default_wan)"
  if [ "$enabled" = "1" ] && [ "$orchestration_enabled" = "1" ]; then
    load_watchdog_state
    if ip rule show 2>/dev/null | grep -q "^$SMARTWAN_PRIORITY_FAILOVER:" \
      && [ -n "$state_active" ]; then
      reported_active_wan="$state_active"
    fi
  fi
  echo "enabled=$enabled"
  echo "active_preset=${active_preset:-}"
  echo "routing_mode=$routing_mode"
  echo "orchestration_enabled=$orchestration_enabled"
  echo "orchestration_mode=$orchestration_mode"
  echo "auto_discover_wans=$auto_discover_wans"
  echo "wan_mapping_source=$wan_mapping_source"
  echo "health_probe_strategy=$health_probe_strategy"
  echo "health_probe_policy=$health_probe_policy"
  echo "failover_action=$failover_action"
  echo "restore_action=$restore_action"
  echo "suspend_asus_rules_on_failover=$suspend_asus_rules_on_failover"
  echo "restore_asus_rules_on_recovery=$restore_asus_rules_on_recovery"
  echo "conntrack_on_switch=$conntrack_on_switch"
  echo "remembered_dualwan_preset=$remembered_dualwan_preset"
  echo "primary_wan=$primary_wan"
  echo "failover_wan=$failover_wan"
  echo "manage_main_default=$manage_main_default"
  echo "active_default_wan=$reported_active_wan"
  echo "wan0_label=$wan0_label"
  echo "wan1_label=$wan1_label"
  echo "wan0_ifname=$wan0_ifname"
  echo "wan1_ifname=$wan1_ifname"
  echo "wan0_rp_filter=$(cat "/proc/sys/net/ipv4/conf/$wan0_ifname/rp_filter" 2>/dev/null || true)"
  echo "wan1_rp_filter=$(cat "/proc/sys/net/ipv4/conf/$wan1_ifname/rp_filter" 2>/dev/null || true)"
  echo "wan0_gateway=$wan0_gateway"
  echo "wan1_gateway=$wan1_gateway"
  echo "wan0_table=$wan0_table"
  echo "wan1_table=$wan1_table"
  echo "domain_rules_enabled=$domain_rules_enabled"
  echo "domain_routing_supported=$([ "$domain_rules_enabled" = "1" ] && command_exists ipset && command_exists iptables && echo 1 || echo 0)"
  echo "domain_ipset_available=$(command_exists ipset && echo 1 || echo 0)"
  echo "domain_iptables_available=$(command_exists iptables && echo 1 || echo 0)"
  echo "watchdog_enabled=$watchdog_enabled"
  echo "watchdog_interval=$watchdog_interval"
  echo "watchdog_fail_count=$watchdog_fail_count"
  echo "watchdog_recover_count=$watchdog_recover_count"
  echo "watchdog_probe_timeout=1"
  echo "failover_target_seconds=5"
  echo "watchdog_health_priority=$SMARTWAN_PRIORITY_HEALTH"
  echo "internal_route_priority=$SMARTWAN_PRIORITY_INTERNAL"
  echo "watchdog_failover_priority=$SMARTWAN_PRIORITY_FAILOVER"
  echo "failover_rule_active=$(ip rule show 2>/dev/null | grep -q "^$SMARTWAN_PRIORITY_FAILOVER:" && echo 1 || echo 0)"
  echo "apply_lock_active=$([ -d "$SMARTWAN_APPLY_LOCK" ] && echo 1 || echo 0)"
  echo "runtime_dir=$runtime_dir"
  echo "log_enabled=$log_enabled"
  echo "log_max_lines=$log_max_lines"
  echo "log_path=$SMARTWAN_LOG"
  echo "state_path=$SMARTWAN_HEALTH_STATE"
  echo "event_journal_path=$SMARTWAN_EVENT_JOURNAL"
  echo "event_journal_lines=$([ -f "$SMARTWAN_EVENT_JOURNAL" ] && wc -l < "$SMARTWAN_EVENT_JOURNAL" 2>/dev/null || echo 0)"
  for wan in wan0 wan1; do
    health_file="$SMARTWAN_RUNTIME_DIR/smartwan-health-$wan.state"
    if [ -f "$health_file" ]; then
      sed "s/^/${wan}_health_/" "$health_file" 2>/dev/null
    else
      echo "${wan}_health_result=not_checked"
      echo "${wan}_health_successes=0"
      echo "${wan}_health_attempts=0"
      echo "${wan}_health_required=0"
      echo "${wan}_health_last_checked="
      echo "${wan}_health_last_success="
    fi
  done
  if [ -f "$SMARTWAN_HEALTH_STATE" ]; then
    sed 's/^/watchdog_state_/' "$SMARTWAN_HEALTH_STATE" 2>/dev/null
  else
    echo "watchdog_state_mode=$([ "$orchestration_enabled" = "1" ] && echo dualwan_balanced_managed || echo observe_only)"
    echo "watchdog_state_failures=0"
    echo "watchdog_state_recoveries=0"
    echo "watchdog_state_last_switch_reason="
    echo "watchdog_state_last_failover_at="
    echo "watchdog_state_last_recovery_at="
  fi
  if [ "$enabled" = "1" ] && [ "$orchestration_enabled" = "1" ]; then
    load_watchdog_state
    effective_mode="${state_mode:-dualwan_balanced_managed}"
    primary="$(canonical_wan "$primary_wan")"
    failover="$(canonical_wan "$failover_wan")"
    [ -n "$primary" ] || primary="wan0"
    [ -n "$failover" ] || failover="wan1"
    ip rule show 2>/dev/null | grep -q "^$SMARTWAN_PRIORITY_FAILOVER:" && override=1 || override=0
    echo "effective_mode=$effective_mode"
    echo "failover_override_active=$override"
    echo "normal_dualwan_mode=${state_normal_wans_mode:-$(nvram get wans_mode 2>/dev/null || true)}"
    echo "normal_dualwan_ratio=${state_normal_wans_lb_ratio:-$(nvram get wans_lb_ratio 2>/dev/null || true)}"
  else
    echo "effective_mode=observe_only"
    echo "failover_override_active=0"
  fi
  echo "vpn_management_enabled=$vpn_management_enabled"
  echo "vpn_interface=$vpn_interface"
  echo "vpn_subnet=$vpn_subnet"
  echo "vpn_additional_profiles=$vpn_additional_profiles"
  echo "vpn_profiles=$(vpn_profiles | tr '\n' ';' | sed 's/;$//')"
  echo "vpn_lan_subnet=$vpn_lan_subnet"
  echo "vpn_policy_mode=$vpn_policy_mode"
  echo "vpn_preferred_wan=$vpn_preferred_wan"
  echo "vpn_allow_router=$vpn_allow_router"
  echo "vpn_allow_lan=$vpn_allow_lan"
  echo "vpn_allow_internet=$vpn_allow_internet"
  echo "vpn_nat_enabled=$vpn_nat_enabled"
  echo "vpn_interface_up=$([ -d "/sys/class/net/$vpn_interface" ] && echo 1 || echo 0)"
  echo "vpn_interface_ip=$(ip -4 addr show dev "$vpn_interface" 2>/dev/null | awk '/ inet / {print $2; exit}')"
  echo "vpn_profiles_up=$(
    old_ifs="$IFS"
    IFS='
'
    for profile in $(vpn_profiles); do
      interface="$(vpn_profile_interface "$profile")"
      subnet="$(vpn_profile_subnet "$profile")"
      if [ -d "/sys/class/net/$interface" ]; then
        state=1
      else
        state=0
      fi
      printf '%s|%s|%s;' "$interface" "$subnet" "$state"
    done
    IFS="$old_ifs"
  )"
  echo "vpn_input_chain_active=$(iptables -S INPUT 2>/dev/null | grep -q -- "-j $SMARTWAN_VPN_INPUT_CHAIN" && echo 1 || echo 0)"
  echo "vpn_forward_chain_active=$(iptables -S FORWARD 2>/dev/null | grep -q -- "-j $SMARTWAN_VPN_FORWARD_CHAIN" && echo 1 || echo 0)"
  echo "vpn_nat_chain_active=$(iptables -t nat -S POSTROUTING 2>/dev/null | grep -q -- "-j $SMARTWAN_VPN_NAT_CHAIN" && echo 1 || echo 0)"
  vpn_policy_rules_ok=1
  vpn_internal_routes_ok=1
  old_ifs="$IFS"
  IFS='
'
  for profile in $(vpn_profiles); do
    subnet="$(vpn_profile_subnet "$profile")"
    ip rule show 2>/dev/null | grep -Eq "^(${SMARTWAN_PRIORITY_VPN_FORCE}|${SMARTWAN_PRIORITY_VPN_PREFER}):.*from[[:space:]]+$subnet" || vpn_policy_rules_ok=0
    ip rule show 2>/dev/null | grep -Eq "^${SMARTWAN_PRIORITY_INTERNAL}:.*to[[:space:]]+$subnet.*lookup[[:space:]]+main" || vpn_internal_routes_ok=0
  done
  IFS="$old_ifs"
  echo "vpn_policy_rule_active=$vpn_policy_rules_ok"
  echo "vpn_internal_route_active=$vpn_internal_routes_ok"
  echo "dmz_enabled=$dmz_enabled"
  echo "dmz_target_ip=$dmz_target_ip"
  echo "dmz_preferred_wan=$(canonical_wan "$dmz_preferred_wan")"
  echo "dmz_failover_mode=$dmz_failover_mode"
  echo "dmz_priority=$SMARTWAN_PRIORITY_DMZ"
  echo "dmz_runtime_wan=$(sed -n 's/^runtime_wan=//p' "$SMARTWAN_DMZ_STATE" 2>/dev/null | tail -n 1)"
  echo "dmz_runtime_ifname=$(sed -n 's/^runtime_ifname=//p' "$SMARTWAN_DMZ_STATE" 2>/dev/null | tail -n 1)"
  echo "dmz_runtime_status=$(sed -n 's/^runtime_status=//p' "$SMARTWAN_DMZ_STATE" 2>/dev/null | tail -n 1)"
  echo "dmz_nat_chain_active=$(iptables -t nat -S "$SMARTWAN_DMZ_NAT_CHAIN" >/dev/null 2>&1 && echo 1 || echo 0)"
  echo "dmz_forward_chain_active=$(iptables -S "$SMARTWAN_DMZ_FORWARD_CHAIN" >/dev/null 2>&1 && echo 1 || echo 0)"
  echo "dmz_return_rule_active=$(ip rule show 2>/dev/null | grep -Eq "^${SMARTWAN_PRIORITY_DMZ}:.*from[[:space:]]+$dmz_target_ip" && echo 1 || echo 0)"
  echo "watchdog_pid=$([ -f "$SMARTWAN_PID" ] && cat "$SMARTWAN_PID" 2>/dev/null || true)"
  echo "watchdog_running=$([ -f "$SMARTWAN_PID" ] && pid_is_running && echo 1 || echo 0)"
  hooks_ok=1
  for hook in services-start firewall-start nat-start wan-event; do
    hook_installed "$hook" || hooks_ok=0
  done
  echo "hooks_installed=$hooks_ok"
  echo "test_mode=$test_mode"
  echo "managed_priority_mark=$SMARTWAN_PRIORITY_MARK"
  echo "managed_priority_asus_exception=$SMARTWAN_PRIORITY_ASUS_EXCEPTION"
  echo "managed_priority_asus_source=$SMARTWAN_PRIORITY_ASUS_SOURCE"
  echo "managed_priority_service_start=$SMARTWAN_PRIORITY_SERVICE_START"
  echo "managed_priority_host_start=$SMARTWAN_PRIORITY_HOST_START"
}

clear_rules() {
  stop_monitor
  delete_managed_rules
  clear_dmz_rules
  clear_vpn_rules
  clear_mangle_chain
  remove_dnsmasq_block
  destroy_managed_ipsets
  restart_dnsmasq
  ip route flush cache 2>/dev/null || true
  log_msg "managed rules cleared"
}

hook_installed() {
  file="$SMARTWAN_SCRIPTS_DIR/$1"
  [ -f "$file" ] && grep -q "^# SMARTWAN MANAGED BEGIN$" "$file" 2>/dev/null
}

install_hook_file() {
  hook="$1"
  file="$SMARTWAN_SCRIPTS_DIR/$hook"
  tmp="$file.tmp.$$"

  mkdir -p "$SMARTWAN_SCRIPTS_DIR" 2>/dev/null
  if [ -f "$file" ]; then
    awk '
      /^# SMARTWAN MANAGED BEGIN$/ { skip = 1; next }
      /^# SMARTWAN MANAGED END$/ { skip = 0; next }
      skip != 1 { print }
    ' "$file" > "$tmp"
  else
    echo "#!/bin/sh" > "$tmp"
  fi

  {
    echo "# SMARTWAN MANAGED BEGIN"
    echo "if [ -x \"$SMARTWAN_DIR/smartwanctl.sh\" ]; then"
    echo "  if mkdir /tmp/smartwan-hook.pending 2>/dev/null; then"
    echo "    ("
    echo "      trap 'rmdir /tmp/smartwan-hook.pending 2>/dev/null || true' EXIT HUP INT TERM"
    echo "      sleep 5"
    echo "      SMARTWAN_DIR=\"$SMARTWAN_DIR\" \"$SMARTWAN_DIR/smartwanctl.sh\" apply >/tmp/smartwan-hook.log 2>&1"
    echo "      rmdir /tmp/smartwan-hook.pending 2>/dev/null || true"
    echo "      trap - EXIT HUP INT TERM"
    echo "    ) &"
    echo "  fi"
    echo "fi"
    echo "# SMARTWAN MANAGED END"
  } >> "$tmp"

  mv "$tmp" "$file"
  chmod 755 "$file" 2>/dev/null || true
  log_msg "installed Merlin hook $file"
}

install_hooks() {
  install_hook_file services-start
  install_hook_file firewall-start
  install_hook_file nat-start
  install_hook_file wan-event
  echo "hooks_installed=1"
}

case "$1" in
  apply) run_with_apply_lock apply_rules ;;
  vpn-apply) run_with_apply_lock apply_vpn_only ;;
  asus-sources-apply) run_with_apply_lock apply_asus_sources_only ;;
  clear) run_with_apply_lock clear_rules ;;
  install-hooks) install_hooks ;;
  reconcile) reconcile_default_route ;;
  monitor) monitor_loop ;;
  events) load_config; tail -n "${2:-200}" "$SMARTWAN_EVENT_JOURNAL" 2>/dev/null || true ;;
  status|"") print_status ;;
  *) echo "Usage: $0 {status|apply|vpn-apply|asus-sources-apply|clear|reconcile|monitor|events}" >&2; exit 2 ;;
esac
