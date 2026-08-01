import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDualWanChange } from './dualWanChangeSummary.js';

test('describes a whole-traffic source moving between WANs', () => {
  const before = { rules: [
    { source: '192.168.1.50', destination: '1.0.0.0/1', unit: '0' },
    { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '0' },
  ] };
  const after = { rules: [
    { source: '192.168.1.50', destination: '1.0.0.0/1', unit: '1' },
    { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '1' },
  ] };
  assert.deepEqual(summarizeDualWanChange(before, after), {
    kind: 'wholeTrafficWan',
    source: '192.168.1.50',
    from: 'wan0',
    to: 'wan1',
  });
});

test('describes an individual target WAN change', () => {
  const before = { rules: [{ source: '10.8.0.0/24', destination: '8.8.8.0/24', unit: '0' }] };
  const after = { rules: [{ source: '10.8.0.0/24', destination: '8.8.8.0/24', unit: '1' }] };
  assert.deepEqual(summarizeDualWanChange(before, after), {
    kind: 'ruleWan',
    source: '10.8.0.0/24',
    destination: '8.8.8.0/24',
    from: 'wan0',
    to: 'wan1',
  });
});
