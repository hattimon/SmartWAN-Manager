import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReadyOpenVpnProfile } from './vpnProfileStore.js';

test('validates and normalizes a ready OpenVPN client profile', () => {
  const profile = validateReadyOpenVpnProfile({
    filename: 'ASUS profile 1',
    content: 'client\nremote vpn.example.com 1194\n<ca>\ncertificate\n</ca>',
  });
  assert.equal(profile.filename, 'ASUS-profile-1.ovpn');
  assert.match(profile.content, /remote vpn\.example\.com 1194/);
  assert.equal(profile.credentialsEmbedded, false);
  assert.equal(profile.authenticationMode, 'none');
  assert.equal(profile.remoteAddress, 'vpn.example.com');
  assert.equal(profile.accessScope, 'hostname');
});

test('rejects a profile without certificate configuration', () => {
  assert.throws(
    () => validateReadyOpenVpnProfile({ content: 'client\nremote vpn.example.com 1194' }),
    /CA certificate/,
  );
});

test('detects credentials embedded in a shared ready profile', () => {
  const profile = validateReadyOpenVpnProfile({
    filename: 'shared.ovpn',
    content: [
      'client',
      'remote vpn.example.com 1194',
      '<auth-user-pass>',
      'shared-user',
      'shared-password',
      '</auth-user-pass>',
      '<ca>',
      'certificate',
      '</ca>',
    ].join('\n'),
  });

  assert.equal(profile.credentialsEmbedded, true);
});

test('detects a certificate-only profile that does not require username and password', () => {
  const profile = validateReadyOpenVpnProfile({
    filename: 'certificate-only.ovpn',
    content: [
      'client',
      'remote vpn.example.com 1195',
      '<ca>',
      'certificate',
      '</ca>',
    ].join('\n'),
  });
  assert.equal(profile.credentialsEmbedded, false);
  assert.equal(profile.authenticationMode, 'none');
});

test('uses a Server 2 filename when no filename was supplied', () => {
  const profile = validateReadyOpenVpnProfile({
    content: 'client\nremote vpn.example.com 1195\n<ca>\ncertificate\n</ca>',
  });
  assert.equal(profile.filename, 'asus-openvpn-server1-client.ovpn');
});

test('detects local and public OpenVPN server addresses', () => {
  const local = validateReadyOpenVpnProfile({
    content: 'client\nremote 192.168.1.1 1194\n<ca>\ncertificate\n</ca>',
  });
  const publicProfile = validateReadyOpenVpnProfile({
    content: 'client\nremote 203.0.113.20 1194\n<ca>\ncertificate\n</ca>',
  });

  assert.equal(local.accessScope, 'local');
  assert.equal(publicProfile.accessScope, 'public');
});
