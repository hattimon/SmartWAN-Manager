import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAiRoutingPrompt,
  buildWholeTrafficRules,
  compileRoutingGroups,
  migrateFlatRulesToGroups,
  serviceRoutingPresets,
  splitRoutingGroupsBySource,
  validateAiRoutingResponse,
} from '../src/dualWanRoutingGroups.js';
import { googleYoutubeGeminiCidrs } from '../src/dualWanRuleTemplates.js';

test('migrates current ASUS rules into visual groups without changing flat rules', () => {
  const flat = [
    {
      source: '192.168.1.0/24',
      destination: googleYoutubeGeminiCidrs[0],
      unit: '0',
    },
    {
      source: '10.8.0.0/24',
      destination: '203.0.113.25/32',
      unit: '1',
    },
  ];
  const groups = migrateFlatRulesToGroups(flat);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, 'Google / YouTube / Gemini');
  assert.deepEqual(compileRoutingGroups(groups), flat);
});

test('represents all device traffic as two complementary IPv4 rules', () => {
  assert.deepEqual(buildWholeTrafficRules('192.168.1.50', '1'), [
    { source: '192.168.1.50', destination: '1.0.0.0/1', unit: '1' },
    { source: '192.168.1.50', destination: '128.0.0.0/1', unit: '1' },
  ]);
});

test('keeps every source IP or subnet in its own top-level routing group', () => {
  const mixed = [{
    id: 'other',
    name: 'Pozostałe reguły',
    rules: [
      { source: '10.8.0.0/24', destination: '1.0.0.0/1', targetWan: '0' },
      { source: '10.8.0.0/24', destination: '128.0.0.0/1', targetWan: '0' },
      { source: '192.168.1.50', destination: '1.0.0.0/1', targetWan: '1' },
      { source: '192.168.1.50', destination: '128.0.0.0/1', targetWan: '1' },
    ],
  }];
  const result = splitRoutingGroupsBySource(mixed);
  assert.equal(result.changed, true);
  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.groups.map((group) => group.source), ['10.8.0.0/24', '192.168.1.50']);
  assert.ok(result.groups.every((group) => new Set(group.rules.map((rule) => rule.source)).size === 1));
});

test('validates a precise AI JSON response and rejects unsafe destinations', () => {
  const result = validateAiRoutingResponse(JSON.stringify({
    schemaVersion: '1.0',
    serviceName: 'Example service',
    primaryDomain: 'example.com',
    source: '192.168.1.0/24',
    targetWan: 'WAN1',
    protocol: 'all',
    rules: [
      {
        destination: '203.0.113.0/24',
        name: 'public range',
        confidence: 0.9,
        sourceReference: 'https://example.com/network',
        riskLevel: 'low',
        sharedInfrastructure: false,
        autoImport: true,
      },
      {
        destination: '192.168.0.0/16',
        name: 'unsafe local range',
        confidence: 1,
        sourceReference: 'https://example.com/network',
        riskLevel: 'low',
        sharedInfrastructure: false,
        autoImport: true,
      },
    ],
  }));

  assert.equal(result.valid, true);
  assert.equal(result.rules[0].readyToImport, true);
  assert.equal(result.rules[1].readyToImport, false);
  assert.ok(result.rules[1].reasons.includes('private_or_local_destination'));
});

test('does not accept invented or unsupported AI output formats', () => {
  const result = validateAiRoutingResponse('{"serviceName":"Missing schema"}');
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('unsupported_schema'));
});

test('accepts JSON wrapped in an optional markdown fence from an AI provider', () => {
  const result = validateAiRoutingResponse(`\`\`\`json
{
  "schemaVersion": "1.0",
  "serviceName": "Example",
  "primaryDomain": "example.com",
  "source": "192.168.1.0/24",
  "targetWan": "WAN0",
  "protocol": "all",
  "rules": [{
    "destination": "203.0.113.0/24",
    "source": "192.168.1.0/24",
    "targetWan": "WAN0",
    "protocol": "all",
    "riskLevel": "low",
    "sharedInfrastructure": false,
    "autoImportRecommended": true
  }]
}
\`\`\``);
  assert.equal(result.valid, true);
  assert.equal(result.rules[0].readyToImport, true);
});

test('generates the AI routing prompt in the selected panel language', () => {
  const english = buildAiRoutingPrompt({
    language: 'en',
    serviceName: 'Example',
    domain: 'example.com',
  });
  const polish = buildAiRoutingPrompt({
    language: 'pl',
    serviceName: 'Przykład',
    domain: 'example.com',
  });

  assert.match(english, /^Analyze this service and domain:/);
  assert.match(english, /Do not use citation markers/);
  assert.match(polish, /^Przeanalizuj usługę i domenę:/);
  assert.match(polish, /Nie używaj znaczników cytowań/);
});

test('safely ignores citation footnotes appended after a complete AI JSON object', () => {
  const result = validateAiRoutingResponse(`{
    "schemaVersion": "1.0",
    "serviceName": "Prime Video",
    "primaryDomain": "primevideo.com",
    "source": "10.8.0.0/24",
    "targetWan": "WAN0",
    "protocol": "all",
    "rules": []
  }

  [1]: https://example.com/reference`);

  assert.equal(result.valid, true);
  assert.equal(result.rules.length, 0);
  assert.ok(result.warnings.includes('ignored_text_outside_json'));
  assert.ok(result.warnings.includes('no_importable_rules'));
});

test('shows only service presets backed by verified CIDRs', () => {
  assert.ok(serviceRoutingPresets.length > 0);
  assert.ok(serviceRoutingPresets.every((preset) => preset.verifiedDestinations?.length > 0));
});
