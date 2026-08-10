import test from 'node:test';
import assert from 'node:assert/strict';
import {
  automaticSwitchAllowed,
  buildLocationDecisionProbes,
  buildLastConfirmedLocationProbes,
  buildGoogleLocationPublicStatus,
  chooseTargetWan,
  detectedCountryChanges,
  googleLocationEventSignature,
  googleRoutingAction,
  googleRoutingMatches,
  normalizePolicy,
  parseGoogleReverseGeocode,
  restoreGoogleBaselineRules,
  shouldRecordGoogleLocationEvent,
} from './googleLocationPolicy.js';
import { googleYoutubeGeminiCidrs } from '../src/dualWanRuleTemplates.js';

test('parses the country and city from a Google reverse-geocoding response', () => {
  const location = parseGoogleReverseGeocode({
    results: [{
      address_components: [
        { long_name: 'Example City', short_name: 'Example City', types: ['locality', 'political'] },
        { long_name: 'Polska', short_name: 'PL', types: ['country', 'political'] },
      ],
    }],
  });

  assert.deepEqual(location, {
    countryCode: 'PL',
    countryName: 'Polska',
    cityName: 'Example City',
  });
});

test('keeps the last location check and restoration outcome after reloading policy state', () => {
  const restoredAt = '2026-08-10T16:20:00.000Z';
  const policy = normalizePolicy({
    enabled: true,
    preferredCountryCode: 'PL',
    lastCheckAt: restoredAt,
    nextCheckAt: '2026-08-10T17:20:00.000Z',
    lastAppliedWan: '',
    lastOutcomeSignature: 'restored-signature',
    lastResult: {
      checkedAt: restoredAt,
      outcome: 'routing_restored',
      reason: 'last_confirmed_wans_match_expected_country',
    },
  });

  assert.equal(policy.lastCheckAt, restoredAt);
  assert.equal(policy.lastResult.outcome, 'routing_restored');
  assert.equal(policy.lastOutcomeSignature, 'restored-signature');
});

test('uses a regional fallback when Google does not return a locality', () => {
  const location = parseGoogleReverseGeocode({
    results: [{
      address_components: [
        {
          long_name: 'Example County',
          short_name: 'Example County',
          types: ['administrative_area_level_2', 'political'],
        },
        { long_name: 'Polska', short_name: 'PL', types: ['country', 'political'] },
      ],
    }],
  });

  assert.equal(location.cityName, 'Example County');
  assert.equal(location.countryCode, 'PL');
});

test('selects the only WAN matching the expected country', () => {
  const decision = chooseTargetWan(
    { preferredCountryCode: 'PL', preferredWan: 'auto' },
    [
      { id: 'wan0', ok: true, countryCode: 'PL' },
      { id: 'wan1', ok: true, countryCode: 'RU' },
    ],
    'wan1',
  );

  assert.deepEqual(decision, {
    targetWan: 'wan0',
    reason: 'single_matching_wan',
  });
});

test('allows no more than one automatic routing switch per 24 hours', () => {
  const lastSwitch = Date.parse('2026-07-30T08:00:00.000Z');
  const blocked = automaticSwitchAllowed(
    new Date(lastSwitch).toISOString(),
    lastSwitch + 23 * 60 * 60 * 1000,
  );
  const allowed = automaticSwitchAllowed(
    new Date(lastSwitch).toISOString(),
    lastSwitch + 24 * 60 * 60 * 1000,
  );

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.nextAllowedAt, '2026-07-31T08:00:00.000Z');
  assert.equal(allowed.allowed, true);
});

test('requires a complete Google rule set for every explicitly selected source', () => {
  const sources = ['192.168.1.0/24', '192.168.1.60'];
  const rules = sources.flatMap((source) => googleYoutubeGeminiCidrs.map((destination) => ({
    source,
    destination,
    unit: '0',
  })));

  assert.equal(googleRoutingMatches(rules, sources, 'wan0'), true);
  assert.equal(
    googleRoutingMatches(
      rules.filter((rule) => rule.source !== '192.168.1.60'),
      sources,
      'wan0',
    ),
    false,
    'a missing explicitly selected source must never be treated as complete',
  );
});

test('never adds temporary Google rules when both WANs match the expected country', () => {
  assert.equal(googleRoutingAction({
    enabled: true,
    allWansMatchExpectedCountry: true,
    temporaryRoutingActive: false,
    routingMatchesTarget: false,
    hasTargetWan: true,
  }), 'none');
  assert.equal(googleRoutingAction({
    enabled: true,
    allWansMatchExpectedCountry: true,
    temporaryRoutingActive: true,
    routingMatchesTarget: true,
    hasTargetWan: true,
  }), 'restore');
});

test('does not reroute Google when one WAN location measurement timed out', () => {
  const probes = [
    { id: 'wan0', ok: true, countryCode: 'PL' },
    { id: 'wan1', ok: false, errorCategory: 'transport', error: 'curl: (28) timeout' },
  ];
  const decision = chooseTargetWan(
    { preferredCountryCode: 'PL', preferredWan: 'auto' },
    probes,
    'wan1',
  );

  assert.equal(decision.targetWan, 'wan0', 'a partial result alone would otherwise select WAN0');
  assert.equal(googleRoutingAction({
    enabled: true,
    measurementComplete: false,
    allWansMatchExpectedCountry: false,
    temporaryRoutingActive: false,
    routingMatchesTarget: false,
    hasTargetWan: true,
  }), 'none');
});

test('uses the last successful location for API quota exhaustion but not for a transport failure', () => {
  const cached = {
    wan0: { countryCode: 'PL', countryName: 'Poland', cityName: 'Warsaw' },
    wan1: { countryCode: 'PL', countryName: 'Poland', cityName: 'Sycow' },
  };
  const probes = buildLocationDecisionProbes([
    { id: 'wan0', ok: false, errorCategory: 'api_quota', error: 'OVER_QUERY_LIMIT' },
    { id: 'wan1', ok: false, errorCategory: 'transport', error: 'timeout' },
  ], cached);

  assert.equal(probes[0].ok, true);
  assert.equal(probes[0].countryCode, 'PL');
  assert.equal(probes[0].reusedLastKnown, true);
  assert.equal(probes[1].ok, false);
  assert.equal(probes[1].countryCode, undefined);
});

test('last confirmed matching locations may restore but never create temporary Google routing', () => {
  const cached = {
    wan0: { countryCode: 'PL', countryName: 'Poland' },
    wan1: { countryCode: 'PL', countryName: 'Poland' },
  };
  const lastConfirmed = buildLastConfirmedLocationProbes([
    { id: 'wan0', ok: true, countryCode: 'PL' },
    { id: 'wan1', ok: false, errorCategory: 'transport', error: 'timeout' },
  ], cached);
  const allMatch = lastConfirmed.every((probe) => probe.ok && probe.countryCode === 'PL');

  assert.equal(allMatch, true);
  assert.equal(lastConfirmed[1].reusedLastKnown, true);
  assert.equal(googleRoutingAction({
    enabled: true,
    measurementComplete: true,
    allWansMatchExpectedCountry: allMatch,
    temporaryRoutingActive: true,
    routingMatchesTarget: true,
    hasTargetWan: true,
  }), 'restore');
  assert.equal(googleRoutingAction({
    enabled: true,
    measurementComplete: false,
    allWansMatchExpectedCountry: false,
    temporaryRoutingActive: false,
    routingMatchesTarget: false,
    hasTargetWan: true,
  }), 'none');
});

test('restores the exact pre-automation Google rules instead of deleting them', () => {
  const source = '192.168.1.50';
  const staticRule = {
    source,
    destination: googleYoutubeGeminiCidrs[0],
    unit: '1',
  };
  const temporaryRules = googleYoutubeGeminiCidrs.map((destination) => ({
    source,
    destination,
    unit: '0',
  }));
  const unrelatedRule = {
    source: '10.8.0.0/24',
    destination: '1.0.0.0/1',
    unit: '0',
  };

  assert.deepEqual(
    restoreGoogleBaselineRules(
      [...temporaryRules, unrelatedRule],
      new Set([source]),
      [staticRule],
    ),
    [unrelatedRule, staticRule],
  );
});

test('does not remove static Google rules when no temporary layer is active', () => {
  assert.equal(googleRoutingAction({
    enabled: true,
    allWansMatchExpectedCountry: true,
    temporaryRoutingActive: false,
    routingMatchesTarget: true,
    hasTargetWan: true,
  }), 'none');
});

test('does not create another event when only the detected city changes', () => {
  const first = googleLocationEventSignature({
    outcome: 'location_ok',
    targetWan: 'wan0',
    sources: ['192.168.1.0/24'],
    wans: [
      { id: 'wan0', ok: true, countryCode: 'PL', cityName: 'City A' },
      { id: 'wan1', ok: true, countryCode: 'PL', cityName: 'City B' },
    ],
  });
  const second = googleLocationEventSignature({
    outcome: 'location_ok',
    targetWan: 'wan0',
    sources: ['192.168.1.0/24'],
    wans: [
      { id: 'wan0', ok: true, countryCode: 'PL', cityName: 'City C' },
      { id: 'wan1', ok: true, countryCode: 'PL', cityName: 'City B' },
    ],
  });

  assert.equal(first, second);
  assert.equal(shouldRecordGoogleLocationEvent({
    outcome: 'location_ok',
    previousSignature: first,
    signature: second,
  }), false);
});

test('records a real WAN country change but not the first stable baseline', () => {
  const changes = detectedCountryChanges({
    wan0: { countryCode: 'PL', countryName: 'Poland' },
    wan1: { countryCode: 'PL', countryName: 'Poland' },
  }, [
    { id: 'wan0', ok: true, countryCode: 'PL', countryName: 'Poland' },
    { id: 'wan1', ok: true, countryCode: 'RU', countryName: 'Russia' },
  ]);

  assert.deepEqual(changes, [{
    wanId: 'wan1',
    fromCountryCode: 'PL',
    fromCountryName: 'Poland',
    toCountryCode: 'RU',
    toCountryName: 'Russia',
  }]);
  assert.equal(shouldRecordGoogleLocationEvent({
    outcome: 'location_ok',
    countryChanges: changes,
  }), true);
  assert.equal(shouldRecordGoogleLocationEvent({
    outcome: 'location_ok',
    countryChanges: detectedCountryChanges({}, [
      { id: 'wan0', ok: true, countryCode: 'PL' },
    ]),
  }), false);
});

test('public Google location status is hidden until monitoring is enabled', () => {
  assert.deepEqual(buildGoogleLocationPublicStatus({ enabled: false, configured: true }), {
    visible: false,
  });

  const visible = buildGoogleLocationPublicStatus({
    enabled: true,
    configured: true,
    preferredCountryCode: 'PL',
    preferredCountryName: 'Polska',
    temporaryRoutingActive: true,
    lastAppliedWan: 'wan0',
    lastKnownLocations: {
      wan0: { countryCode: 'PL', countryName: 'Poland', cityName: 'Warsaw' },
    },
  }, { assignedWan: 'wan1' }, { activeWan: 'wan1' }, [
    { id: 'wan0', label: 'Fiber' },
    { id: 'wan1', label: 'LTE' },
  ]);

  assert.equal(visible.wan, 'wan0');
  assert.equal(visible.wanLabel, 'Fiber');
  assert.equal(visible.countryName, 'Polska');
  assert.equal(visible.alternativeRoutingActive, true);
});
