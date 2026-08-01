import assert from 'node:assert/strict';
import test from 'node:test';
import { inlinePrivateKeyStatus } from './sshClient.js';

test('accepts a complete OpenSSH private key block', () => {
  const key = [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU=',
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n');

  const status = inlinePrivateKeyStatus(key);
  assert.equal(status.usable, true);
  assert.equal(status.text, key);
});

test('rejects incomplete OpenSSH private key text', () => {
  const status = inlinePrivateKeyStatus('-----BEGIN OPENSSH PRIVATE KEY-----');

  assert.equal(status.usable, false);
  assert.match(status.error, /Incomplete private key/);
});

test('reports PuTTY keys as unsupported inline format', () => {
  const status = inlinePrivateKeyStatus('PuTTY-User-Key-File-3: ssh-ed25519');

  assert.equal(status.usable, false);
  assert.match(status.error, /PuTTY \.ppk/);
});
