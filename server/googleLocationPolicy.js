import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';
import { applyDualWan, readDualWan } from './dualWanOps.js';
import { execCommand } from './sshClient.js';
import { shellQuote } from './smartwanConfig.js';
import { googleYoutubeGeminiCidrs } from '../src/dualWanRuleTemplates.js';
import { resetRoutingGroups } from './routingGroupStore.js';
import { recordManualEvent } from './wanEventStore.js';

const POLICY_FILE = path.join(DATA_DIR, 'google-location-policy.json');
const ALLOWED_INTERVALS = new Set([10, 60, 240, 480, 1440]);
const GOOGLE_DESTINATIONS = new Set(googleYoutubeGeminiCidrs);
const AUTOMATIC_SWITCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const defaults = {
  version: 1,
  enabled: false,
  preferredCountryCode: '',
  preferredCountryName: '',
  intervalMinutes: 60,
  preferredWan: 'auto',
  source: '192.168.1.0/24',
  sources: ['192.168.1.0/24'],
  lastManagedSources: [],
  baselineGoogleRules: [],
  temporaryRoutingActive: false,
  apiKey: '',
  lastCheckAt: '',
  nextCheckAt: '',
  lastAppliedWan: '',
  lastAutomaticSwitchAt: '',
  lastOutcomeSignature: '',
  lastKnownLocations: {
    wan0: null,
    wan1: null,
  },
  lastResult: null,
};

function normalizeWan(value) {
  return ['wan0', '0'].includes(String(value || '').toLowerCase())
    ? 'wan0'
    : ['wan1', '1'].includes(String(value || '').toLowerCase())
      ? 'wan1'
      : 'auto';
}

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function normalizeStoredText(value, fallback = '') {
  return String(value ?? fallback).replace(/[\r\n]/g, ' ').trim();
}

function isValidIpv4Source(value) {
  const [address, prefixText] = String(value || '').trim().split('/');
  const octets = address.split('.');
  if (octets.length !== 4 || octets.some((part) => (
    !/^\d{1,3}$/.test(part) || Number(part) < 0 || Number(part) > 255
  ))) return false;
  if (prefixText === undefined) return true;
  return /^(?:[0-9]|[12][0-9]|3[0-2])$/.test(prefixText);
}

function normalizeSources(input = {}, current = defaults) {
  const requested = Array.isArray(input.sources)
    ? input.sources
    : input.source !== undefined
      ? [input.source]
      : Array.isArray(current.sources)
        ? current.sources
        : [current.source];
  const sources = [...new Set(requested
    .map((source) => String(source || '').trim())
    .filter(isValidIpv4Source))]
    .slice(0, 16);
  return sources.length ? sources : [defaults.source];
}

export function normalizePolicy(input = {}, current = defaults) {
  const interval = Number(input.intervalMinutes ?? current.intervalMinutes);
  const sources = normalizeSources(input, current);
  const preferredCountryCode = normalizeCountryCode(
    input.preferredCountryCode ?? current.preferredCountryCode,
  );
  return {
    ...defaults,
    ...current,
    enabled: input.enabled === undefined ? Boolean(current.enabled) : input.enabled === true,
    preferredCountryCode,
    preferredCountryName: String(
      input.preferredCountryName ?? current.preferredCountryName ?? '',
    ).trim().slice(0, 100),
    intervalMinutes: ALLOWED_INTERVALS.has(interval) ? interval : 60,
    preferredWan: normalizeWan(input.preferredWan ?? current.preferredWan),
    source: sources[0],
    sources,
    lastManagedSources: [...new Set(
      (Array.isArray(input.lastManagedSources)
        ? input.lastManagedSources
        : Array.isArray(current.lastManagedSources)
          ? current.lastManagedSources
          : [])
        .map((source) => String(source || '').trim())
        .filter(Boolean),
    )].slice(0, 16),
    baselineGoogleRules: (
      Array.isArray(input.baselineGoogleRules)
        ? input.baselineGoogleRules
        : Array.isArray(current.baselineGoogleRules)
          ? current.baselineGoogleRules
          : []
    ).map((rule) => ({
      source: String(rule?.source || '').trim(),
      destination: String(rule?.destination || '').trim(),
      unit: String(rule?.unit) === '1' ? '1' : '0',
    })).filter((rule) => (
      isValidIpv4Source(rule.source) && GOOGLE_DESTINATIONS.has(rule.destination)
    )).slice(0, 64),
    temporaryRoutingActive: input.temporaryRoutingActive === undefined
      ? current.temporaryRoutingActive === true
      : input.temporaryRoutingActive === true,
    apiKey: String(input.apiKey ?? current.apiKey ?? '').trim(),
    lastCheckAt: normalizeStoredText(input.lastCheckAt ?? current.lastCheckAt),
    nextCheckAt: normalizeStoredText(input.nextCheckAt ?? current.nextCheckAt),
    lastAppliedWan: ['wan0', 'wan1'].includes(input.lastAppliedWan ?? current.lastAppliedWan)
      ? (input.lastAppliedWan ?? current.lastAppliedWan)
      : '',
    lastAutomaticSwitchAt: normalizeStoredText(
      input.lastAutomaticSwitchAt ?? current.lastAutomaticSwitchAt,
    ),
    lastOutcomeSignature: String(
      input.lastOutcomeSignature ?? current.lastOutcomeSignature ?? '',
    ),
    lastResult: input.lastResult && typeof input.lastResult === 'object'
      ? input.lastResult
      : current.lastResult && typeof current.lastResult === 'object'
        ? current.lastResult
        : null,
    lastKnownLocations: {
      ...defaults.lastKnownLocations,
      ...(current.lastKnownLocations || {}),
      ...(input.lastKnownLocations || {}),
    },
  };
}

async function writePolicy(policy) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${POLICY_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, POLICY_FILE);
  return policy;
}

export async function loadGoogleLocationPolicy({ includeSecret = false } = {}) {
  let stored = defaults;
  try {
    stored = normalizePolicy(JSON.parse(await fs.readFile(POLICY_FILE, 'utf8')), defaults);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not load Google location policy: ${error.message}`);
    }
  }
  if (includeSecret) return stored;
  return {
    ...stored,
    apiKey: '',
    configured: Boolean(stored.apiKey),
  };
}

export async function saveGoogleLocationPolicy(input = {}) {
  const current = await loadGoogleLocationPolicy({ includeSecret: true });
  const clearApiKey = input.clearApiKey === true;
  const next = normalizePolicy({
    ...input,
    enabled: clearApiKey ? false : input.enabled,
    apiKey: clearApiKey
      ? ''
      : String(input.apiKey || '').trim() || current.apiKey,
  }, current);
  if (next.enabled && !next.apiKey) {
    throw new Error('Google Maps Platform API key is required before enabling location routing.');
  }
  if (next.enabled && !next.preferredCountryCode) {
    throw new Error('Select the expected country before enabling location routing.');
  }
  if (next.enabled && (
    input.enabled === true && current.enabled !== true
    || Number(next.intervalMinutes) !== Number(current.intervalMinutes)
  )) {
    next.nextCheckAt = new Date().toISOString();
  }
  if (JSON.stringify(next.sources) !== JSON.stringify(current.sources)) {
    next.lastManagedSources = [...new Set([
      ...(current.lastManagedSources || []),
      ...(current.sources || [current.source]),
    ])];
  }
  const saved = await writePolicy(next);
  return {
    ...saved,
    apiKey: '',
    configured: Boolean(saved.apiKey),
  };
}

async function routerFetch(settings, ifname, url, { method = 'GET', body = '' } = {}) {
  const request = method === 'POST'
    ? `"$CURL_BIN" --silent --show-error --max-time 15 --interface ${shellQuote(ifname)} -H 'Content-Type: application/json' --data ${shellQuote(body)} --write-out '\n__SMARTWAN_HTTP_STATUS__:%{http_code}' ${shellQuote(url)}`
    : `"$CURL_BIN" --silent --show-error --max-time 15 --interface ${shellQuote(ifname)} --write-out '\n__SMARTWAN_HTTP_STATUS__:%{http_code}' ${shellQuote(url)}`;
  const script = `
PATH=$PATH:/opt/bin:/usr/sbin:/usr/bin:/sbin:/bin
CURL_BIN="$(which curl 2>/dev/null)"
[ -n "$CURL_BIN" ] || { echo "curl_missing" >&2; exit 127; }
${request}
`;
  const result = await execCommand(settings, 'sh -s', { timeoutMs: 22000, stdin: script });
  if (result.code !== 0) {
    const error = new Error(result.stderr.trim() || `Google location request failed through ${ifname}.`);
    error.category = 'transport';
    throw error;
  }
  const statusMarker = '\n__SMARTWAN_HTTP_STATUS__:';
  const markerIndex = result.stdout.lastIndexOf(statusMarker);
  const responseBody = markerIndex >= 0 ? result.stdout.slice(0, markerIndex) : result.stdout;
  const httpStatus = markerIndex >= 0
    ? Number(result.stdout.slice(markerIndex + statusMarker.length).trim())
    : 0;
  try {
    const parsed = JSON.parse(responseBody);
    if (httpStatus >= 400) {
      const apiReason = (parsed?.error?.errors || [])
        .map((item) => item?.reason || '')
        .filter(Boolean)
        .join(' ');
      const error = new Error(
        parsed?.error?.message || `Google API returned HTTP ${httpStatus} through ${ifname}.`,
      );
      error.category = httpStatus === 429
        || /quota|rate.?limit|daily.?limit|limit exceeded|resource.?exhausted/i.test(`${error.message} ${apiReason}`)
        ? 'api_quota'
        : 'api_error';
      error.httpStatus = httpStatus;
      throw error;
    }
    return parsed;
  } catch (_error) {
    if (_error?.category) throw _error;
    throw new Error(`Google location response through ${ifname} was not valid JSON.`);
  }
}

function googleApiResultError(payload = {}, fallback) {
  const status = String(payload?.status || '').toUpperCase();
  const message = String(payload?.error_message || fallback || '').trim();
  const error = new Error(message || `Google API status: ${status || 'unknown'}.`);
  error.category = status === 'OVER_QUERY_LIMIT'
    || /quota|rate.?limit|daily.?limit|limit exceeded|resource.?exhausted/i.test(message)
    ? 'api_quota'
    : 'api_error';
  return error;
}

export function parseGoogleReverseGeocode(geocode = {}) {
  const components = (geocode.results || [])
    .flatMap((result) => result.address_components || []);
  const country = components.find((item) => item.types?.includes('country'));
  const findPlace = (...types) => components.find(
    (item) => types.some((type) => item.types?.includes(type)),
  );
  const city = findPlace(
    'locality',
    'postal_town',
    'administrative_area_level_3',
    'sublocality',
    'administrative_area_level_2',
    'administrative_area_level_1',
  );
  return {
    countryCode: normalizeCountryCode(country?.short_name),
    countryName: String(country?.long_name || ''),
    cityName: String(city?.long_name || ''),
  };
}

async function probeWanCountry(settings, apiKey, wan) {
  if (!wan.ifname) {
    return { ...wan, ok: false, error: 'WAN interface was not detected.' };
  }
  try {
    const geolocation = await routerFetch(
      settings,
      wan.ifname,
      `https://www.googleapis.com/geolocation/v1/geolocate?key=${encodeURIComponent(apiKey)}`,
      { method: 'POST', body: '{"considerIp":true}' },
    );
    if (geolocation?.error || geolocation?.status === 'OVER_QUERY_LIMIT') {
      throw googleApiResultError(geolocation, 'Google Geolocation API rejected the request.');
    }
    const lat = Number(geolocation?.location?.lat);
    const lng = Number(geolocation?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Google did not return coordinates for this WAN.');
    }
    const geocode = await routerFetch(
      settings,
      wan.ifname,
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(apiKey)}`,
    );
    if (geocode?.status && geocode.status !== 'OK') {
      throw googleApiResultError(geocode, `Google geocoding status: ${geocode.status}.`);
    }
    const location = parseGoogleReverseGeocode(geocode);
    const countryCode = location.countryCode;
    if (!countryCode) {
      throw new Error(geocode?.error_message || `Google geocoding status: ${geocode?.status || 'unknown'}.`);
    }
    return {
      ...wan,
      ok: true,
      countryCode,
      countryName: location.countryName || countryCode,
      cityName: location.cityName,
      latitude: lat,
      longitude: lng,
      accuracyMeters: Number(geolocation?.accuracy || 0),
    };
  } catch (error) {
    return {
      ...wan,
      ok: false,
      error: error.message,
      errorCategory: error.category || 'transport',
    };
  }
}

function existingGoogleWan(rules, sources) {
  const sourceSet = new Set(sources);
  const matching = rules.filter((rule) => (
    sourceSet.has(rule.source) && GOOGLE_DESTINATIONS.has(rule.destination)
  ));
  if (!matching.length) return '';
  const units = new Set(matching.map((rule) => String(rule.unit)));
  return units.size === 1 ? `wan${[...units][0]}` : '';
}

export function googleRoutingMatches(rules, sources, targetWan) {
  const unit = targetWan === 'wan1' ? '1' : '0';
  return sources.every((source) => {
    const matching = rules.filter((rule) => (
      rule.source === source && GOOGLE_DESTINATIONS.has(rule.destination)
    ));
    return matching.length === GOOGLE_DESTINATIONS.size
      && matching.every((rule) => String(rule.unit) === unit);
  });
}

export function googleRoutingAction({
  enabled,
  measurementComplete = true,
  allWansMatchExpectedCountry,
  temporaryRoutingActive,
  routingMatchesTarget,
  hasTargetWan,
}) {
  if (!enabled) return 'none';
  if (!measurementComplete) return 'none';
  if (allWansMatchExpectedCountry) {
    return temporaryRoutingActive ? 'restore' : 'none';
  }
  return hasTargetWan && !routingMatchesTarget ? 'apply' : 'none';
}

export function restoreGoogleBaselineRules(currentRules, cleanupSources, baselineRules = []) {
  const sourceSet = cleanupSources instanceof Set
    ? cleanupSources
    : new Set(cleanupSources || []);
  const retained = currentRules.filter((rule) => !(
    sourceSet.has(rule.source) && GOOGLE_DESTINATIONS.has(rule.destination)
  ));
  const seen = new Set(retained.map((rule) => `${rule.source}|${rule.destination}|${rule.unit}`));
  for (const rule of baselineRules) {
    const key = `${rule.source}|${rule.destination}|${rule.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    retained.push({ ...rule });
  }
  return retained;
}

export function chooseTargetWan(policy, probes, currentWan) {
  const matching = probes.filter((probe) => (
    probe.ok && probe.countryCode === policy.preferredCountryCode
  ));
  if (!matching.length) return { targetWan: '', reason: 'no_matching_wan' };
  if (matching.length === 1) return { targetWan: matching[0].id, reason: 'single_matching_wan' };
  if (policy.preferredWan !== 'auto' && matching.some((probe) => probe.id === policy.preferredWan)) {
    return { targetWan: policy.preferredWan, reason: 'preferred_matching_wan' };
  }
  if (currentWan && matching.some((probe) => probe.id === currentWan)) {
    return { targetWan: currentWan, reason: 'current_wan_still_matches' };
  }
  return { targetWan: matching[0].id, reason: 'first_matching_wan' };
}

export function buildLocationDecisionProbes(probes = [], lastKnownLocations = {}) {
  return probes.map((probe) => {
    const cached = lastKnownLocations?.[probe.id];
    if (probe.ok || probe.errorCategory !== 'api_quota' || !cached?.countryCode) return probe;
    return {
      ...probe,
      ok: true,
      countryCode: cached.countryCode,
      countryName: cached.countryName || cached.countryCode,
      cityName: cached.cityName || '',
      latitude: cached.latitude,
      longitude: cached.longitude,
      accuracyMeters: cached.accuracyMeters,
      reusedLastKnown: true,
      detectedAt: cached.detectedAt || '',
    };
  });
}

export function buildLastConfirmedLocationProbes(probes = [], lastKnownLocations = {}) {
  return probes.map((probe) => {
    const cached = lastKnownLocations?.[probe.id];
    if (probe.ok || !cached?.countryCode) return probe;
    return {
      ...probe,
      ok: true,
      countryCode: cached.countryCode,
      countryName: cached.countryName || cached.countryCode,
      cityName: cached.cityName || '',
      latitude: cached.latitude,
      longitude: cached.longitude,
      accuracyMeters: cached.accuracyMeters,
      reusedLastKnown: true,
      detectedAt: cached.detectedAt || '',
    };
  });
}

export function automaticSwitchAllowed(lastAutomaticSwitchAt, now = Date.now()) {
  const lastSwitch = new Date(lastAutomaticSwitchAt || '').getTime();
  if (!Number.isFinite(lastSwitch)) {
    return { allowed: true, nextAllowedAt: '' };
  }
  const nextAllowed = lastSwitch + AUTOMATIC_SWITCH_COOLDOWN_MS;
  return {
    allowed: now >= nextAllowed,
    nextAllowedAt: now >= nextAllowed ? '' : new Date(nextAllowed).toISOString(),
  };
}

export function googleLocationEventSignature(result) {
  return JSON.stringify({
    outcome: result.outcome,
    targetWan: result.targetWan,
    sources: result.sources || [],
    rateLimitUntil: result.rateLimitUntil || '',
    countries: result.wans.map((wan) => [
      wan.id,
      wan.ok ? wan.countryCode : 'error',
    ]),
  });
}

export function detectedCountryChanges(previousLocations = {}, probes = []) {
  return probes.flatMap((wan) => {
    if (!wan?.ok || !wan.countryCode) return [];
    const previous = previousLocations?.[wan.id];
    const previousCountryCode = normalizeCountryCode(previous?.countryCode);
    if (!previousCountryCode || previousCountryCode === wan.countryCode) return [];
    return [{
      wanId: wan.id,
      fromCountryCode: previousCountryCode,
      fromCountryName: String(previous?.countryName || previousCountryCode),
      toCountryCode: wan.countryCode,
      toCountryName: String(wan.countryName || wan.countryCode),
    }];
  });
}

export function shouldRecordGoogleLocationEvent({
  outcome,
  applied = false,
  countryChanges = [],
  previousSignature = '',
  signature = '',
} = {}) {
  if (applied || ['routing_changed', 'routing_restored'].includes(outcome)) return true;
  if (countryChanges.length > 0) return true;
  return outcome === 'daily_switch_limit'
    && Boolean(previousSignature)
    && previousSignature !== signature;
}

export function buildGoogleLocationPublicStatus(
  policy = {},
  viewer = {},
  routing = {},
  wanStatus = [],
) {
  if (!policy.enabled || !policy.configured) return { visible: false };
  const result = policy.lastResult || {};
  // A full-WAN emergency override has higher priority than device and Google
  // policy rules. Report the effective path, not the normally assigned WAN.
  const failoverActive = routing.failoverActive === true;
  const alternativeRoutingActive = !failoverActive && policy.temporaryRoutingActive === true;
  const routingWan = failoverActive
    ? routing.activeWan || viewer.assignedWan || ''
    : alternativeRoutingActive
      ? policy.lastAppliedWan || result.routingWan || result.targetWan || ''
      : viewer.assignedWan || routing.activeWan || result.previousWan || result.targetWan || '';
  const liveWan = wanStatus.find((wan) => wan.id === routingWan) || {};
  const location = policy.lastKnownLocations?.[routingWan] || null;
  const countryName = location?.countryCode
    && location.countryCode === policy.preferredCountryCode
    ? policy.preferredCountryName || location.countryName || location.countryCode
    : location?.countryName || location?.countryCode || '';
  return {
    visible: true,
    enabled: true,
    expectedCountryCode: policy.preferredCountryCode || '',
    expectedCountryName: policy.preferredCountryName || policy.preferredCountryCode || '',
    wan: routingWan,
    wanLabel: liveWan.label || routingWan.toUpperCase(),
    countryCode: location?.countryCode || '',
    countryName,
    cityName: location?.cityName || '',
    checkedAt: location?.detectedAt || policy.lastCheckAt || '',
    alternativeRoutingActive,
  };
}

async function recordLocationEvent(result, policy, { testMode = false } = {}) {
  const countries = Object.fromEntries(result.wans.map((wan) => [
    wan.id,
    {
      label: wan.label,
      countryCode: wan.countryCode || '',
      countryName: wan.countryName || '',
      cityName: wan.cityName || '',
      ok: wan.ok,
      error: wan.error || '',
    },
  ]));
  const changedRouting = ['routing_changed', 'routing_restored'].includes(result.outcome);
  const rateLimited = result.outcome === 'daily_switch_limit';
  const hasMismatch = result.wans.some((wan) => (
    wan.ok && wan.countryCode !== policy.preferredCountryCode
  ));
  await recordManualEvent({
    type: 'google-location-routing',
    source: testMode ? 'google-location-manual-check' : 'google-location-monitor',
    severity: result.outcome === 'routing_restored'
      ? 'success'
      : changedRouting || rateLimited || hasMismatch
        ? 'warning'
        : 'info',
    testMode,
    action: result.outcome === 'routing_restored'
      ? 'Temporary Google service routing was removed after both WAN locations recovered.'
      : changedRouting
        ? 'Google service routing was moved to the WAN matching the expected country.'
      : rateLimited
        ? 'A routing change was required, but the daily automatic switch limit prevented it.'
        : 'Google WAN location status changed; routing was not modified.',
    profile: 'Google / YouTube / Gemini',
    summary: changedRouting
      ? result.outcome === 'routing_restored'
        ? 'Google location policy restored normal Dual WAN routing.'
        : 'Google location policy automatically changed Dual WAN routing.'
      : 'Google location policy detected a new WAN country status.',
    username: 'SmartWAN',
    change: {
      kind: 'googleLocationRouting',
      outcome: result.outcome,
      preferredCountryCode: policy.preferredCountryCode,
      preferredCountryName: policy.preferredCountryName,
      source: policy.sources.join(', '),
      sources: policy.sources,
      from: result.previousWan,
      to: result.targetWan,
      reason: result.reason,
      rateLimitUntil: result.rateLimitUntil || '',
      temporaryRoutingActive: result.temporaryRoutingActive === true,
      routingWan: result.routingWan || '',
      countryChanges: result.countryChanges || [],
      countries,
    },
  });
}

export async function runGoogleLocationPolicy(settings, { force = false } = {}) {
  const policy = await loadGoogleLocationPolicy({ includeSecret: true });
  if (!policy.apiKey) throw new Error('Google Maps Platform API key is not configured.');
  if (!policy.enabled && !force) return { skipped: true, reason: 'disabled' };
  if (!force && policy.nextCheckAt && new Date(policy.nextCheckAt).getTime() > Date.now()) {
    return { skipped: true, reason: 'not_due', nextCheckAt: policy.nextCheckAt };
  }

  const current = await readDualWan(settings);
  const wanDefinitions = ['wan0', 'wan1'].map((id, index) => ({
    id,
    unit: String(index),
    label: id.toUpperCase(),
    ifname: current.nvram[`${id}_ifname`] || '',
  }));
  const probes = [];
  for (const wan of wanDefinitions) {
    probes.push(await probeWanCountry(settings, policy.apiKey, wan));
  }

  // A transport failure is an incomplete measurement, never evidence that a
  // WAN is in the wrong country. Quota exhaustion reuses the last successful
  // location for display/continuity, but cannot initiate a new routing change.
  const decisionProbes = buildLocationDecisionProbes(probes, policy.lastKnownLocations);
  const lastConfirmedProbes = buildLastConfirmedLocationProbes(
    probes,
    policy.lastKnownLocations,
  );
  const measurementComplete = probes.every((probe) => probe.ok);
  const quotaFallbackActive = probes.some((probe) => (
    probe.errorCategory === 'api_quota'
    && decisionProbes.find((candidate) => candidate.id === probe.id)?.reusedLastKnown
  ));
  const incompleteTransportProbe = probes.some((probe) => (
    !probe.ok && probe.errorCategory !== 'api_quota'
  ));

  const sources = policy.sources;
  const cleanupSources = new Set([...sources, ...(policy.lastManagedSources || [])]);
  const previousWan = existingGoogleWan(current.form.rules, sources);
  const decision = chooseTargetWan(policy, decisionProbes, previousWan);
  const liveWansMatchExpectedCountry = decisionProbes.length === 2 && decisionProbes.every((probe) => (
    probe.ok && probe.countryCode === policy.preferredCountryCode
  ));
  const lastConfirmedWansMatchExpectedCountry = lastConfirmedProbes.length === 2
    && lastConfirmedProbes.every((probe) => (
      probe.ok && probe.countryCode === policy.preferredCountryCode
    ));
  // Last confirmed locations may only remove an existing temporary routing
  // layer. They can never create or move Google routes after an incomplete
  // measurement.
  const restoreFromLastConfirmed = policy.temporaryRoutingActive
    && !measurementComplete
    && lastConfirmedWansMatchExpectedCountry;
  const allWansMatchExpectedCountry = liveWansMatchExpectedCountry || restoreFromLastConfirmed;
  const routingAction = googleRoutingAction({
    enabled: policy.enabled,
    measurementComplete: measurementComplete || restoreFromLastConfirmed,
    allWansMatchExpectedCountry,
    temporaryRoutingActive: policy.temporaryRoutingActive,
    routingMatchesTarget: decision.targetWan
      ? googleRoutingMatches(current.form.rules, sources, decision.targetWan)
      : false,
    hasTargetWan: Boolean(decision.targetWan),
  });
  let outcome = incompleteTransportProbe
    ? 'location_check_failed'
    : quotaFallbackActive
      ? 'location_cached_due_to_api_limit'
      : decision.targetWan
        ? 'location_ok'
        : 'no_matching_wan';
  let reason = incompleteTransportProbe
    ? 'wan_location_probe_failed'
    : quotaFallbackActive
      ? 'google_api_limit_last_known_location_used'
      : decision.reason;
  let applied = false;
  let automaticSwitchApplied = false;
  let ruleCount = current.form.rules.length;
  let rateLimitUntil = '';
  let baselineGoogleRules = policy.baselineGoogleRules || [];

  if (routingAction === 'restore') {
    reason = restoreFromLastConfirmed
      ? 'last_confirmed_wans_match_expected_country'
      : 'all_wans_match_expected_country';
    if (current.form.mode !== 'lb' || !current.form.routingEnabled) {
      outcome = 'routing_not_available';
    } else {
      const restoredRules = restoreGoogleBaselineRules(
        current.form.rules,
        cleanupSources,
        baselineGoogleRules,
      );
      await applyDualWan(settings, { ...current.form, rules: restoredRules });
      await resetRoutingGroups(restoredRules);
      outcome = 'routing_restored';
      applied = true;
      ruleCount = restoredRules.length;
    }
  } else if (policy.enabled && allWansMatchExpectedCountry && measurementComplete) {
    reason = 'all_wans_match_expected_country';
    outcome = 'location_ok';
  } else if (routingAction === 'apply') {
    if (current.form.mode !== 'lb' || !current.form.routingEnabled) {
      outcome = 'routing_not_available';
    } else {
      const switchGuard = automaticSwitchAllowed(policy.lastAutomaticSwitchAt);
      if (!switchGuard.allowed) {
        outcome = 'daily_switch_limit';
        rateLimitUntil = switchGuard.nextAllowedAt;
      }
      const unit = decision.targetWan === 'wan1' ? '1' : '0';
      if (!policy.temporaryRoutingActive) {
        baselineGoogleRules = current.form.rules.filter((rule) => (
          cleanupSources.has(rule.source) && GOOGLE_DESTINATIONS.has(rule.destination)
        )).map((rule) => ({ ...rule }));
      }
      const retained = current.form.rules.filter((rule) => !(
        cleanupSources.has(rule.source) && GOOGLE_DESTINATIONS.has(rule.destination)
      ));
      const googleRules = sources.flatMap((source) => googleYoutubeGeminiCidrs.map((destination) => ({
        source,
        destination,
        unit,
      })));
      const nextRules = [...retained, ...googleRules];
      if (outcome === 'daily_switch_limit') {
        // The status is still stored and reported, but the router is not modified.
      } else if (nextRules.length > 64) {
        outcome = 'rule_limit';
      } else {
        await applyDualWan(settings, { ...current.form, rules: nextRules });
        await resetRoutingGroups(nextRules);
        outcome = 'routing_changed';
        applied = true;
        automaticSwitchApplied = true;
        ruleCount = nextRules.length;
      }
    }
  }

  const checkedAt = new Date();
  const temporaryRoutingActive = outcome === 'routing_restored'
    ? false
    : automaticSwitchApplied
      ? true
      : policy.temporaryRoutingActive;
  const routingWan = temporaryRoutingActive
    ? automaticSwitchApplied
      ? decision.targetWan
      : policy.lastAppliedWan || decision.targetWan
    : previousWan;
  const countryChanges = detectedCountryChanges(policy.lastKnownLocations, probes);
  const result = {
    checkedAt: checkedAt.toISOString(),
    outcome,
    reason,
    preferredCountryCode: policy.preferredCountryCode,
    preferredCountryName: policy.preferredCountryName,
    previousWan,
    targetWan: decision.targetWan,
    sources,
    rateLimitUntil,
    applied,
    ruleCount,
    temporaryRoutingActive,
    routingWan,
    countryChanges,
    // Quota exhaustion keeps the last confirmed location authoritative until
    // Google accepts another request. Transport/API failures remain explicit
    // failures and therefore cannot be mistaken for a country mismatch.
    wans: decisionProbes,
  };
  const signature = googleLocationEventSignature(result);
  if (shouldRecordGoogleLocationEvent({
    outcome,
    applied,
    countryChanges,
    previousSignature: policy.lastOutcomeSignature,
    signature,
  })) {
    await recordLocationEvent(result, policy, { testMode: force });
  }
  const lastKnownLocations = {
    ...policy.lastKnownLocations,
  };
  for (const wan of probes) {
    if (!wan.ok) continue;
    lastKnownLocations[wan.id] = {
      wanId: wan.id,
      ifname: wan.ifname,
      countryCode: wan.countryCode,
      countryName: wan.countryName,
      cityName: wan.cityName || '',
      latitude: wan.latitude,
      longitude: wan.longitude,
      accuracyMeters: wan.accuracyMeters,
      detectedAt: result.checkedAt,
    };
  }
  const next = {
    ...policy,
    lastCheckAt: result.checkedAt,
    nextCheckAt: new Date(
      checkedAt.getTime() + policy.intervalMinutes * 60 * 1000,
    ).toISOString(),
    lastAppliedWan: outcome === 'routing_restored'
      ? ''
      : automaticSwitchApplied
        ? decision.targetWan
        : policy.lastAppliedWan,
    lastManagedSources: outcome === 'routing_restored'
      ? []
      : applied
        ? sources
        : policy.lastManagedSources,
    baselineGoogleRules: outcome === 'routing_restored'
      ? []
      : applied
        ? baselineGoogleRules
        : policy.baselineGoogleRules,
    temporaryRoutingActive,
    lastAutomaticSwitchAt: automaticSwitchApplied
      ? result.checkedAt
      : policy.lastAutomaticSwitchAt,
    lastOutcomeSignature: signature,
    lastKnownLocations,
    lastResult: result,
  };
  await writePolicy(next);
  return {
    ...result,
    nextCheckAt: next.nextCheckAt,
    lastKnownLocations,
    configured: true,
    enabled: next.enabled,
  };
}
