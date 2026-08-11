import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AURELKA_MEOW_DECISIVE,
  AURELKA_MEOW_GENTLE,
  selectAurelkaMeowFile,
} from '../src/aurelkaAudio.js';

test('Aurelka uses the decisive meow whenever both WAN links are down', () => {
  assert.equal(selectAurelkaMeowFile(2, 0.99), AURELKA_MEOW_DECISIVE);
  assert.equal(selectAurelkaMeowFile(3, 0.99), AURELKA_MEOW_DECISIVE);
});

test('Aurelka randomly selects either approved meow when one WAN link is down', () => {
  assert.equal(selectAurelkaMeowFile(1, 0.1), AURELKA_MEOW_DECISIVE);
  assert.equal(selectAurelkaMeowFile(1, 0.9), AURELKA_MEOW_GENTLE);
});

test('Aurelka uses the gentle meow for deliberate interaction while WANs are healthy', () => {
  assert.equal(selectAurelkaMeowFile(0, 0.1), AURELKA_MEOW_GENTLE);
});
