import assert from 'node:assert/strict';
import test from 'node:test';
import { addAurelkaMessage } from './aurelkaMessageStore.js';

test('Aurelka message validation rejects empty content', async () => {
  await assert.rejects(
    addAurelkaMessage({ nickname: 'Guest', message: '   ', authorIp: '192.168.1.2' }),
    /Wpisz wiadomość/,
  );
});
