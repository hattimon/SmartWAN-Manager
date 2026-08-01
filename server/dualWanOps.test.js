import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAsusRuleList, matchDualWanPreset, parseAsusRuleList } from './dualWanOps.js';
import { buildGoogleYoutubeGeminiDualWanRules, googleYoutubeGeminiCidrs } from '../src/dualWanRuleTemplates.js';

test('builds Google/YouTube/Gemini ASUS Dual WAN template rules', () => {
  const rules = buildGoogleYoutubeGeminiDualWanRules('192.168.1.0/24', '1');

  assert.equal(rules.length, 26);
  assert.deepEqual(rules.map((rule) => rule.destination), googleYoutubeGeminiCidrs);
  assert.equal(rules[0].source, '192.168.1.0/24');
  assert.equal(rules[0].unit, '1');
  assert.ok(rules.some((rule) => rule.destination === '34.160.0.0/13'));

  const raw = buildAsusRuleList(rules);
  assert.ok(raw.startsWith('<192.168.1.0/24>8.8.4.0/24>1'));
  assert.ok(raw.includes('<192.168.1.0/24>34.160.0.0/13>1'));
  assert.deepEqual(parseAsusRuleList(raw), rules);
});

test('detects the largest matching Dual WAN base preset when router has extra rules', () => {
  const googleRules = buildGoogleYoutubeGeminiDualWanRules('192.168.1.0/24', '0');
  const base = {
    enabled: true,
    primary: 'lan',
    secondary: 'wan',
    mode: 'lb',
    ratioPrimary: '1',
    ratioSecondary: '9',
    routingEnabled: true,
    lanPort: '1',
  };
  const current = {
    ...base,
    rules: [
      ...googleRules,
      { source: '192.168.1.50', destination: '1.0.0.0/1', unit: '0' },
      { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '0' },
      { source: '10.8.0.0/24', destination: '1.0.0.0/1', unit: '1' },
    ],
  };
  const match = matchDualWanPreset(current, [
    { name: 'google-only', config: { ...base, rules: googleRules } },
    {
      name: 'google-and-device',
      config: {
        ...base,
        rules: [
          ...googleRules,
          { source: '192.168.1.50', destination: '1.0.0.0/1', unit: '0' },
          { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '0' },
        ],
      },
    },
  ]);

  assert.deepEqual(match, {
    name: 'google-and-device',
    matchType: 'base',
    matchQuality: 2,
    ruleCount: 28,
    additionalRuleCount: 1,
    ignoredPresetRuleCount: 0,
  });
});

test('prefers an exact Dual WAN preset over a base preset', () => {
  const current = {
    enabled: true,
    primary: 'lan',
    secondary: 'wan',
    mode: 'lb',
    ratioPrimary: '1',
    ratioSecondary: '9',
    routingEnabled: true,
    rules: [
      { source: '192.168.1.0/24', destination: '8.8.8.0/24', unit: '0' },
      { source: '10.8.0.0/24', destination: '1.0.0.0/1', unit: '1' },
    ],
  };
  const match = matchDualWanPreset(current, [
    { name: 'base', config: { ...current, rules: current.rules.slice(0, 1) } },
    { name: 'exact', config: current },
  ]);

  assert.equal(match?.name, 'exact');
  assert.equal(match?.matchType, 'exact');
  assert.equal(match?.additionalRuleCount, 0);
});

test('recognizes a Dual WAN base profile when its dominant CIDR block is active', () => {
  const googleRules = buildGoogleYoutubeGeminiDualWanRules('192.168.1.0/24', '0');
  const base = {
    enabled: true,
    primary: 'lan',
    secondary: 'wan',
    mode: 'lb',
    ratioPrimary: '1',
    ratioSecondary: '9',
    routingEnabled: true,
  };
  const current = {
    ...base,
    rules: [
      ...googleRules,
      { source: '10.8.0.0/24', destination: '1.0.0.0/1', unit: '1' },
      { source: '10.8.0.0/24', destination: '128.0.0.0/1', unit: '1' },
    ],
  };
  const match = matchDualWanPreset(current, [{
    name: 'google-with-old-device-override',
    config: {
      ...base,
      rules: [
        ...googleRules,
        { source: '192.168.1.20', destination: '1.0.0.0/1', unit: '1' },
        { source: '192.168.1.20', destination: '128.0.0.0/1', unit: '1' },
      ],
    },
  }]);

  assert.equal(match?.name, 'google-with-old-device-override');
  assert.equal(match?.matchType, 'base');
  assert.equal(match?.ruleCount, 26);
  assert.equal(match?.additionalRuleCount, 2);
  assert.equal(match?.ignoredPresetRuleCount, 2);
});
