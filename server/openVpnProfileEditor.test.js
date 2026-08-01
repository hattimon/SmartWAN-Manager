import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenVpnProfile,
  openVpnDnsPresets,
  readOpenVpnProfileDefaults,
} from '../src/openVpnProfileEditor.js';

const source = `client
dev tun
proto udp
remote 192.168.1.1 1194
auth-user-pass
remote-cert-tls server
<ca>
CERTIFICATE-DATA
</ca>
`;

test('updates server and adds Cloudflare DNS without changing certificates', () => {
  const result = buildOpenVpnProfile({
    source,
    server: 'vpn.example.com',
    port: '443',
    protocol: 'tcp',
    dnsServers: openVpnDnsPresets.cloudflare,
  });

  assert.match(result, /^proto tcp$/m);
  assert.match(result, /^remote vpn\.example\.com 443$/m);
  assert.match(result, /^pull-filter ignore "dhcp-option DNS"$/m);
  assert.match(result, /^dhcp-option DNS 1\.1\.1\.1$/m);
  assert.match(result, /^auth-user-pass$/m);
  assert.match(result, /<ca>\nCERTIFICATE-DATA\n<\/ca>/);
});

test('embeds credentials and removes old authentication directives', () => {
  const result = buildOpenVpnProfile({
    source,
    server: '203.0.113.10',
    username: 'vpn-user',
    password: 'secret-value',
    embedCredentials: true,
  });

  assert.match(result, /<auth-user-pass>\nvpn-user\nsecret-value\n<\/auth-user-pass>/);
  assert.doesNotMatch(result, /^auth-user-pass(?:\s+\S+)?$/m);
  assert.equal((result.match(/^<auth-user-pass>$/gm) || []).length, 1);
});

test('preserves a certificate-only profile without adding username authentication', () => {
  const result = buildOpenVpnProfile({
    source: source.replace(/^auth-user-pass\r?\n/m, ''),
    server: 'vpn.example.com',
    port: '1195',
    protocol: 'udp',
    dnsServers: [],
    authenticationMode: 'none',
  });
  assert.doesNotMatch(result, /auth-user-pass/i);
  assert.match(result, /^remote vpn\.example\.com 1195$/m);
});

test('rebuilding a generated profile is idempotent', () => {
  const options = {
    source,
    server: '192.168.1.1',
    dnsServers: openVpnDnsPresets.google,
    username: 'user',
    password: 'password',
    embedCredentials: true,
  };
  const first = buildOpenVpnProfile(options);
  const second = buildOpenVpnProfile({ ...options, source: first });
  assert.equal(second, first);
});

test('reads server defaults from an imported profile', () => {
  assert.deepEqual(readOpenVpnProfileDefaults(source), {
    server: '192.168.1.1',
    port: '1194',
    protocol: 'udp',
    dnsPreset: 'custom',
    customDns: '',
    username: '',
    password: '',
    embedCredentials: false,
    authenticationMode: 'prompt',
  });
});

test('restores shared DNS and embedded credentials from a panel-saved profile', () => {
  const generated = buildOpenVpnProfile({
    source,
    server: 'vpn.example.com',
    dnsServers: openVpnDnsPresets.cloudflare,
    username: 'shared-user',
    password: 'shared-password',
    embedCredentials: true,
    authenticationMode: 'embedded',
  });

  assert.deepEqual(readOpenVpnProfileDefaults(generated), {
    server: 'vpn.example.com',
    port: '1194',
    protocol: 'udp',
    dnsPreset: 'cloudflare',
    customDns: '',
    username: 'shared-user',
    password: 'shared-password',
    embedCredentials: true,
    authenticationMode: 'embedded',
  });
});
