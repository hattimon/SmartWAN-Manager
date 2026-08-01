import { loadSettings } from '../server/configStore.js';
import { execCommand } from '../server/sshClient.js';

const checks = [
  ['serverState', 'nvram get vpn_server2_state'],
  ['serverPort', 'nvram get vpn_server2_port'],
  ['serverProtocol', 'nvram get vpn_server2_proto'],
  ['serverSubnet', 'nvram get vpn_server2_sn'],
  ['serverNetmask', 'nvram get vpn_server2_nm'],
  ['announceDns', 'nvram get vpn_server2_dns'],
  ['pushDns', 'nvram get vpn_server2_pdns'],
  ['respondToDns', 'nvram get vpn_server2_rgw'],
  ['wan1Address', 'nvram get wan1_ipaddr'],
  ['wan1PublicAddress', 'nvram get wan1_realip_ip'],
  ['listener', "netstat -lnup 2>/dev/null | grep ':1195 '"],
  ['tunnel', "ip addr show tun22 2>/dev/null | sed -n '1,5p'"],
  ['policyRule', "ip rule show | grep '10.16.0.0/24'"],
  ['wanReplyRule', "ip rule show | grep -E '192\\.168\\.55\\.3|lookup wan1'"],
  ['sourceReplyPolicy', "ip rule show | grep '^83:'"],
  ['natRule', "iptables -t nat -S 2>/dev/null | grep '10.16.0.0/24'"],
  ['firewallRule', "iptables -S INPUT 2>/dev/null | grep -E '1195|vpnserver2|OVPN' | tail -n 20"],
  ['firewallCounters', "iptables -L INPUT -vn --line-numbers 2>/dev/null | grep 'dpt:1195'"],
  ['openVpnChain', "iptables -L OVPN -vn --line-numbers 2>/dev/null | head -n 30"],
  ['reversePathFilter', "for item in all default vlan2 vlan3; do printf '%s=' \"$item\"; cat \"/proc/sys/net/ipv4/conf/$item/rp_filter\" 2>/dev/null || echo missing; done"],
  ['serverConfig', "grep -E '^(dev|proto|port|local|server|topology|push|route|client-to-client|duplicate-cn|user|group)[[:space:]]' /etc/openvpn/server2/config.ovpn /tmp/etc/openvpn/server2/config.ovpn 2>/dev/null | head -n 60"],
  ['serverProcess', "ps w 2>/dev/null | grep '[v]pnserver2'"],
  ['wan1RouteCheck', "ip route get 1.1.1.1 from 192.168.55.3 2>/dev/null"],
  ['recentLog', "grep -Ei 'vpnserver2|server2|1195' /tmp/syslog.log 2>/dev/null | tail -n 30"],
  ['upstreamGateway', "wget -T 3 -qO- http://192.168.55.1/ 2>/dev/null | grep -Eio '<title>[^<]+' | head -n 1"],
];

const settings = (await loadSettings()).router;
const result = {};

for (const [name, command] of checks) {
  try {
    const response = await execCommand(settings, command, { timeoutMs: 10_000 });
    result[name] = {
      ok: response.code === 0,
      value: response.stdout.trim(),
      error: response.stderr.trim(),
    };
  } catch (error) {
    result[name] = { ok: false, value: '', error: error.message };
  }
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
