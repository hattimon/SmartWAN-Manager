import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AURELKA_AUDIO_FILES,
  AURELKA_MEOW_DECISIVE,
  AURELKA_MEOW_GENTLE,
  AURELKA_PURR_RELAXING,
  selectAurelkaMeowFile,
  shouldPlayAurelkaPurr,
} from '../src/aurelkaAudio.js';

test('Aurelka audio preload includes both meows and the relaxing purr', () => {
  assert.deepEqual(AURELKA_AUDIO_FILES, [
    AURELKA_MEOW_DECISIVE,
    AURELKA_MEOW_GENTLE,
    AURELKA_PURR_RELAXING,
  ]);
});

test('Aurelka purrs only when both WANs are healthy and sound is enabled', () => {
  assert.equal(shouldPlayAurelkaPurr('happy', true), true);
  assert.equal(shouldPlayAurelkaPurr('happy', false), false);
  assert.equal(shouldPlayAurelkaPurr('checking', true), false);
  assert.equal(shouldPlayAurelkaPurr('outage', true), false);
});

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
