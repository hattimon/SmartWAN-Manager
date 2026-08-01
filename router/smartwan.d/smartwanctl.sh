#!/bin/sh

SMARTWAN_DIR="${SMARTWAN_DIR:-/jffs/addons/smartwan.d}"
SMARTWAN_CONF="${SMARTWAN_CONF:-$SMARTWAN_DIR/smartwan.conf}"
SMARTWAN_BACKEND="$SMARTWAN_DIR/backend.sh"
PRESET_DIR="$SMARTWAN_DIR/presets"

ensure_dirs() {
  mkdir -p "$SMARTWAN_DIR" "$PRESET_DIR"
}

usage() {
  cat <<'EOF'
Usage: smartwanctl.sh <command>

Commands:
  status                 Show current SmartWAN state
  apply                  Apply current smartwan.conf
  vpn apply              Apply only the managed OpenVPN policy
  asus sources apply     Normalize ASUS full-device WAN rules
  clear                  Remove SmartWAN-managed route rules
  enable                 Set enabled=1 and apply
  disable                Set enabled=0 and clear rules
  hooks install          Install Merlin event hooks that re-apply SmartWAN after WAN/firewall changes
  events [limit]         Read confirmed WAN transitions kept in router RAM
  preset list            List router-side presets
  preset save <name>     Save current config as preset
  preset load <name>     Activate preset and apply
  preset delete <name>   Delete preset
EOF
}

safe_name() {
  case "$1" in
    *[!A-Za-z0-9._-]*|"") return 1 ;;
    *) return 0 ;;
  esac
}

set_config_value() {
  key="$1"
  value="$2"
  tmp="$SMARTWAN_CONF.tmp.$$"
  if [ -f "$SMARTWAN_CONF" ] && grep -q "^$key=" "$SMARTWAN_CONF"; then
    sed "s/^$key=.*/$key=$value/" "$SMARTWAN_CONF" > "$tmp"
  else
    cat "$SMARTWAN_CONF" 2>/dev/null > "$tmp"
    echo "$key=$value" >> "$tmp"
  fi
  mv "$tmp" "$SMARTWAN_CONF"
  chmod 600 "$SMARTWAN_CONF" 2>/dev/null || true
}

apply_backend() {
  if [ ! -x "$SMARTWAN_BACKEND" ]; then
    echo "backend_missing=1"
    exit 1
  fi
  "$SMARTWAN_BACKEND" "$@"
}

ensure_dirs

case "$1" in
  status)
    apply_backend status
    ;;
  apply)
    apply_backend apply
    ;;
  vpn)
    case "$2" in
      apply)
        apply_backend vpn-apply
        ;;
      *)
        usage
        exit 2
        ;;
    esac
    ;;
  asus)
    case "$2:$3" in
      sources:apply)
        apply_backend asus-sources-apply
        ;;
      *)
        usage
        exit 2
        ;;
    esac
    ;;
  clear)
    apply_backend clear
    ;;
  enable)
    set_config_value enabled 1
    apply_backend apply
    ;;
  disable)
    set_config_value enabled 0
    apply_backend clear
    ;;
  hooks)
    case "$2" in
      install)
        apply_backend install-hooks
        ;;
      *)
        usage
        exit 2
        ;;
    esac
    ;;
  events)
    apply_backend events "${2:-200}"
    ;;
  preset)
    case "$2" in
      list)
        find "$PRESET_DIR" -maxdepth 1 -type f -name '*.conf' -exec basename {} .conf \; 2>/dev/null | sort
        ;;
      save)
        safe_name "$3" || { echo "invalid preset name" >&2; exit 2; }
        cp "$SMARTWAN_CONF" "$PRESET_DIR/$3.conf"
        chmod 600 "$PRESET_DIR/$3.conf" 2>/dev/null || true
        ;;
      load)
        safe_name "$3" || { echo "invalid preset name" >&2; exit 2; }
        [ -f "$PRESET_DIR/$3.conf" ] || { echo "preset not found" >&2; exit 1; }
        cp "$PRESET_DIR/$3.conf" "$SMARTWAN_CONF"
        set_config_value active_preset "'$3'"
        apply_backend apply
        ;;
      delete)
        safe_name "$3" || { echo "invalid preset name" >&2; exit 2; }
        rm -f "$PRESET_DIR/$3.conf"
        ;;
      *)
        usage
        exit 2
        ;;
    esac
    ;;
  *)
    usage
    exit 2
    ;;
esac
