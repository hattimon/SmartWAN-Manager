import { execCommand } from './sshClient.js';

const VPN_POLICY_FIELDS = [
  'vpnManagementEnabled',
  'vpnInterface',
  'vpnSubnet',
  'vpnAdditionalProfiles',
  'vpnLanSubnet',
  'vpnPolicyMode',
  'vpnPreferredWan',
  'vpnAllowRouter',
  'vpnAllowLan',
  'vpnAllowInternet',
  'vpnNatEnabled',
  'orchestrationEnabled',
  'orchestrationMode',
  'primaryWan',
  'failoverWan',
];

export function exportVpnPolicy(input = {}) {
  const policy = Object.fromEntries(VPN_POLICY_FIELDS.map((key) => [key, input[key]]));
  return {
    format: 'smartwan-vpn-policy',
    version: 1,
    exportedAt: new Date().toISOString(),
    policy,
    note: 'This file contains SmartWAN VPN routing policy only. It does not contain OpenVPN certificates, private keys, passwords, or ASUS credentials.',
  };
}

function validServerUnit(value) {
  const unit = Number(value);
  if (!Number.isInteger(unit) || unit < 1 || unit > 2) {
    throw new Error('OpenVPN server unit must be 1 or 2.');
  }
  return unit;
}

export async function readOpenVpnClientProfile(settings, requestedUnit = 1) {
  const unit = validServerUnit(requestedUnit);
  const marker = '__SMARTWAN_OVPN_FILE__';
  const candidates = [
    `/tmp/etc/openvpn/server${unit}/client.ovpn`,
    `/etc/openvpn/server${unit}/client.ovpn`,
    `/jffs/openvpn/server${unit}/client.ovpn`,
    `/tmp/openvpn/server${unit}/client.ovpn`,
  ];
  const script = `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
for file in ${candidates.map((value) => `'${value}'`).join(' ')}; do
  if [ -s "$file" ]; then
    printf '${marker}%s\\n' "$file"
    cat "$file"
    exit 0
  fi
done
for root in /tmp/etc/openvpn /etc/openvpn /jffs/openvpn; do
  [ -d "$root" ] || continue
  file="$(find "$root" -maxdepth 5 -type f -name '*.ovpn' 2>/dev/null | head -n 1)"
  if [ -n "$file" ] && [ -s "$file" ]; then
    printf '${marker}%s\\n' "$file"
    cat "$file"
    exit 0
  fi
done
exit 44
`;
  const result = await execCommand(settings, script, { timeoutMs: 20_000 });
  const output = String(result.stdout || '');
  const markerIndex = output.indexOf(marker);
  if (markerIndex === -1) {
    const error = new Error(
      `ASUS Merlin does not currently expose an exported OpenVPN Server ${unit} client profile on the router filesystem. Generate it once in the ASUS OpenVPN Server page, then retry.`,
    );
    error.statusCode = 404;
    throw error;
  }
  const bodyStart = output.indexOf('\n', markerIndex);
  const sourcePath = output.slice(markerIndex + marker.length, bodyStart).trim();
  const content = output.slice(bodyStart + 1).trim();
  if (!content.includes('<ca>') && !content.includes('ca ')) {
    throw new Error('The detected OpenVPN profile is incomplete and was not exported.');
  }
  return {
    filename: `asus-openvpn-server${unit}-client.ovpn`,
    content: `${content}\n`,
    sourcePath,
  };
}
