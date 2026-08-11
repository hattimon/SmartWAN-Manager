import assert from 'node:assert/strict';
import test from 'node:test';

import { detectedPanelAddress, normalizePanelAddress } from '../src/homePoster.js';

test('normalizes a manually entered local panel address and port', () => {
  assert.deepEqual(normalizePanelAddress('192.168.11.20:8888'), {
    href: 'http://192.168.11.20:8888/',
    display: '192.168.11.20:8888',
  });
});

test('preserves HTTPS paths used by the public demo', () => {
  assert.deepEqual(normalizePanelAddress('https://hattimon.github.io/SmartWAN-Manager/demo/'), {
    href: 'https://hattimon.github.io/SmartWAN-Manager/demo/',
    display: 'hattimon.github.io/SmartWAN-Manager/demo',
  });
});

test('detects the currently opened panel without query parameters or fragments', () => {
  assert.equal(
    detectedPanelAddress({ href: 'http://router-panel.local:8888/?source=poster#login' }),
    'http://router-panel.local:8888/',
  );
});

test('rejects non-web protocols and embedded credentials', () => {
  assert.throws(() => normalizePanelAddress('javascript:alert(1)'), /invalid_panel_address|unsupported_protocol/);
  assert.throws(() => normalizePanelAddress('http://user:secret@panel.local:8888/'), /invalid_panel_address/);
});
