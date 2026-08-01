import {
  cloudflareNetworkCidrs,
  googleYoutubeGeminiCidrs,
  microsoftOfficeOnlineCidrs,
  microsoftTeamsCidrs,
  sharePointOneDriveCidrs,
} from './dualWanRuleTemplates.js';

export const DUALWAN_RULE_LIMIT = 64;

export const serviceRoutingPresets = [
  {
    id: 'google-current',
    name: 'Google / YouTube / Gemini',
    nameKey: 'routingPresetGoogle',
    domain: 'google.com',
    category: 'google',
    verifiedDestinations: googleYoutubeGeminiCidrs,
    includeDependencies: true,
    sourceUrl: 'https://www.gstatic.com/ipranges/goog.json',
  },
  {
    id: 'microsoft-teams-current',
    name: 'Microsoft Teams',
    nameKey: 'routingPresetTeams',
    domain: 'teams.microsoft.com',
    category: 'microsoft',
    verifiedDestinations: microsoftTeamsCidrs,
    includeDependencies: true,
    sourceUrl: 'https://endpoints.office.com/endpoints/worldwide',
  },
  {
    id: 'sharepoint-onedrive-current',
    name: 'SharePoint / OneDrive',
    nameKey: 'routingPresetSharePointOneDrive',
    domain: 'sharepoint.com',
    category: 'microsoft',
    verifiedDestinations: sharePointOneDriveCidrs,
    includeDependencies: true,
    sourceUrl: 'https://endpoints.office.com/endpoints/worldwide',
  },
  {
    id: 'office-online-current',
    name: 'Microsoft 365 / Office Online',
    nameKey: 'routingPresetOfficeOnline',
    domain: 'office.com',
    category: 'microsoft',
    verifiedDestinations: microsoftOfficeOnlineCidrs,
    includeDependencies: true,
    sourceUrl: 'https://endpoints.office.com/endpoints/worldwide',
  },
  {
    id: 'cloudflare-network-current',
    name: 'Cloudflare network',
    nameKey: 'routingPresetCloudflare',
    domain: 'cloudflare.com',
    category: 'network',
    verifiedDestinations: cloudflareNetworkCidrs,
    includeDependencies: true,
    sharedInfrastructure: true,
    sourceUrl: 'https://www.cloudflare.com/ips-v4',
  },
];

function createId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeWan(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['1', 'wan1', 'secondary', 'additional'].includes(text)) return '1';
  return '0';
}

function normalizeProtocol(value) {
  const text = String(value || 'all').trim().toLowerCase().replace(/[+\s]+/g, '_');
  if (['tcp', 'udp', 'tcp_udp'].includes(text)) return text;
  return 'all';
}

export function ipv4ToNumber(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part < 0 || part > 255)) return null;
  return numbers.reduce((total, part) => ((total << 8) | part) >>> 0, 0);
}

export function isValidIpv4(value) {
  return ipv4ToNumber(value) !== null;
}

export function isValidIpv6(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || !text.includes(':') || text.includes(':::')) return false;
  if ((text.match(/::/g) || []).length > 1) return false;
  const [left = '', right = ''] = text.split('::');
  const leftParts = left ? left.split(':') : [];
  const rightParts = right ? right.split(':') : [];
  const validPart = (part) => /^[0-9a-f]{1,4}$/.test(part);
  if (![...leftParts, ...rightParts].every(validPart)) return false;
  const count = leftParts.length + rightParts.length;
  return text.includes('::') ? count < 8 : count === 8;
}

export function parseIpOrCidr(value) {
  const text = String(value || '').trim();
  const [address, prefixRaw] = text.split('/');
  const hasPrefix = prefixRaw !== undefined;
  if (isValidIpv4(address)) {
    const prefix = hasPrefix ? Number(prefixRaw) : 32;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    return { address, prefix, type: hasPrefix ? 'cidr' : 'ipv4', family: 4, normalized: hasPrefix ? `${address}/${prefix}` : address };
  }
  if (isValidIpv6(address)) {
    const prefix = hasPrefix ? Number(prefixRaw) : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
    return { address, prefix, type: hasPrefix ? 'ipv6' : 'ipv6', family: 6, normalized: hasPrefix ? `${address}/${prefix}` : address };
  }
  return null;
}

export function isPrivateOrLocalDestination(parsed) {
  if (!parsed) return true;
  if (parsed.family === 6) {
    const value = parsed.address.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }
  const number = ipv4ToNumber(parsed.address);
  const inRange = (network, prefix) => {
    const base = ipv4ToNumber(network);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (number & mask) === (base & mask);
  };
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['224.0.0.0', 4],
  ].some(([network, prefix]) => inRange(network, prefix));
}

export function isValidRuleSource(value) {
  const text = String(value || '').trim().toLowerCase();
  return ['all', '*', 'any'].includes(text) || Boolean(parseIpOrCidr(text));
}

export function dualWanRuleKey(rule = {}) {
  return [
    String(rule.source || '').trim().toLowerCase(),
    String(rule.destination || '').trim().toLowerCase(),
    normalizeWan(rule.targetWan ?? rule.unit),
  ].join('|');
}

export function normalizeRoutingRule(rule = {}, groupId = '') {
  const parsed = parseIpOrCidr(rule.destination);
  return {
    id: String(rule.id || createId('rule')),
    groupId: String(groupId || rule.groupId || ''),
    name: String(rule.name || '').trim(),
    description: String(rule.description || '').trim(),
    source: String(rule.source || 'all').trim() || 'all',
    destination: parsed?.normalized || String(rule.destination || '').trim(),
    destinationType: parsed?.type || String(rule.destinationType || 'cidr'),
    protocol: normalizeProtocol(rule.protocol),
    targetWan: normalizeWan(rule.targetWan ?? rule.unit),
    priority: Math.max(1, Number(rule.priority || 100)),
    enabled: rule.enabled !== false,
    required: rule.required !== false,
    sharedInfrastructure: rule.sharedInfrastructure === true,
    riskLevel: ['low', 'medium', 'high'].includes(rule.riskLevel) ? rule.riskLevel : 'medium',
    autoImportRecommended: rule.autoImportRecommended !== false,
    syncStatus: String(rule.syncStatus || 'draft'),
    notes: String(rule.notes || '').trim(),
  };
}

export function normalizeRoutingGroup(group = {}) {
  const id = String(group.id || createId('group'));
  return {
    id,
    name: String(group.name || 'Pozostałe reguły').trim() || 'Pozostałe reguły',
    primaryDomain: String(group.primaryDomain || '').trim(),
    targetWan: normalizeWan(group.targetWan),
    source: String(group.source || 'all').trim() || 'all',
    protocol: normalizeProtocol(group.protocol),
    enabled: group.enabled !== false,
    collapsed: group.collapsed !== false,
    syncStatus: String(group.syncStatus || 'draft'),
    createdAt: String(group.createdAt || new Date().toISOString()),
    updatedAt: String(group.updatedAt || new Date().toISOString()),
    lastSyncedAt: String(group.lastSyncedAt || ''),
    generatorSettings: group.generatorSettings && typeof group.generatorSettings === 'object' ? group.generatorSettings : undefined,
    coverage: group.coverage && typeof group.coverage === 'object' ? group.coverage : undefined,
    rules: (Array.isArray(group.rules) ? group.rules : []).map((rule) => normalizeRoutingRule(rule, id)),
  };
}

export function createRoutingGroup(input = {}) {
  return normalizeRoutingGroup({
    ...input,
    id: input.id || createId('group'),
    collapsed: true,
    syncStatus: input.syncStatus || 'draft',
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function splitRoutingGroupsBySource(groups = []) {
  let changed = false;
  const splitGroups = groups.flatMap((inputGroup) => {
    const group = normalizeRoutingGroup(inputGroup);
    const rulesBySource = group.rules.reduce((result, rule) => {
      const source = String(rule.source || group.source || 'all').trim() || 'all';
      if (!result.has(source)) result.set(source, []);
      result.get(source).push(rule);
      return result;
    }, new Map());
    if (rulesBySource.size <= 1) return [group];
    changed = true;
    return [...rulesBySource.entries()].map(([source, sourceRules]) => {
      const sourceSuffix = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
      const id = `${group.id}-source-${sourceSuffix}`;
      return normalizeRoutingGroup({
        ...group,
        id,
        source,
        targetWan: sourceRules[0]?.targetWan ?? group.targetWan,
        rules: sourceRules.map((rule) => ({ ...rule, groupId: id })),
      });
    });
  });
  const groupsBySource = new Map();
  for (const group of splitGroups) {
    const source = String(group.rules[0]?.source || group.source || 'all').trim() || 'all';
    const existing = groupsBySource.get(source);
    if (!existing) {
      groupsBySource.set(source, { ...group, source });
      continue;
    }
    changed = true;
    const knownRules = new Set(existing.rules.map(dualWanRuleKey));
    const additionalRules = group.rules.filter((rule) => !knownRules.has(dualWanRuleKey(rule)));
    const combinedRules = [...existing.rules, ...additionalRules]
      .map((rule) => normalizeRoutingRule(rule, existing.id));
    groupsBySource.set(source, {
      ...existing,
      name: existing.name || group.name,
      primaryDomain: existing.primaryDomain === group.primaryDomain ? existing.primaryDomain : '',
      targetWan: combinedRules[0]?.targetWan ?? existing.targetWan,
      syncStatus: existing.syncStatus === 'synced' && group.syncStatus === 'synced' ? 'synced' : 'pending',
      updatedAt: [existing.updatedAt, group.updatedAt].sort().at(-1),
      rules: combinedRules,
    });
  }
  return { groups: [...groupsBySource.values()], changed };
}

export function buildAiRoutingPrompt(settings = {}) {
  const language = settings.language === 'en' ? 'en' : 'pl';
  const serviceName = String(settings.serviceName || (language === 'en' ? 'Service' : 'Usługa')).trim();
  const domain = String(settings.domain || '').trim();
  const targetWan = normalizeWan(settings.targetWan) === '1' ? 'WAN1' : 'WAN0';
  const source = String(settings.source || 'all').trim() || 'all';
  const protocol = normalizeProtocol(settings.protocol);
  const ipv4 = settings.ipv4 !== false;
  const ipv6 = settings.ipv6 === true;
  const dependencies = settings.includeDependencies !== false;
  const notes = String(settings.notes || '').trim();
  if (language === 'en') {
    return `Analyze this service and domain: ${domain}.

Prepare Policy Rules for an ASUS router with Asuswrt or Asuswrt-Merlin and Dual WAN.

Service name: ${serviceName}
Target interface: ${targetWan}
Source LAN IP address or subnet: ${source}
Traffic type: ${protocol}
IPv4: ${ipv4 ? 'yes' : 'no'}
IPv6: ${ipv6 ? 'yes' : 'no'}
Include dependent domains, CDNs and external endpoints: ${dependencies ? 'yes' : 'no'}
Additional notes: ${notes || 'none'}

Find only current, publicly verified IP address ranges and CIDRs used by this service. Include the primary domain, required subdomains, APIs, authentication, media, static assets and dependent services only when they can be reliably confirmed.

Do not add ranges that cannot be reliably associated with the service. Mark shared CDNs as risky and set autoImportRecommended to false. Explain the limitations of dynamic DNS, Anycast, CDNs and shared hosting. ASUS routing is IP-based, so it cannot guarantee complete domain coverage.

Do not use citation markers such as [1], Markdown links or footnotes outside the JSON. Put a direct plain HTTPS URL only in sourceReference. The response must start with { and end with }.

Return valid JSON only, without Markdown or any text outside the JSON:
{
  "schemaVersion": "1.0",
  "serviceName": ${JSON.stringify(serviceName)},
  "primaryDomain": ${JSON.stringify(domain)},
  "targetWan": ${JSON.stringify(targetWan)},
  "source": ${JSON.stringify(source)},
  "protocol": ${JSON.stringify(protocol)},
  "generatedAt": "ISO-8601",
  "coverage": {
    "estimatedPercent": 0,
    "confidence": "low|medium|high",
    "complete": false,
    "limitations": []
  },
  "dynamicAddresses": true,
  "rules": [{
    "name": "",
    "description": "",
    "destination": "",
    "destinationType": "ipv4|cidr|ipv6",
    "source": ${JSON.stringify(source)},
    "protocol": ${JSON.stringify(protocol)},
    "targetWan": ${JSON.stringify(targetWan)},
    "priority": 100,
    "required": true,
    "sharedInfrastructure": false,
    "riskLevel": "low|medium|high",
    "autoImportRecommended": true,
    "sourceReference": "",
    "notes": ""
  }],
  "excludedRanges": [{"destination": "", "reason": ""}],
  "notes": []
}

Every destination must contain one valid IP address or CIDR. Remove duplicates and order ranges from most specific to least specific. Do not return domain names in destination. If a reliable list cannot be built, return an empty rules array and explain the limitations in coverage.limitations.`;
  }
  return `Przeanalizuj usługę i domenę: ${domain}.

Przygotuj reguły Policy Rules dla routera ASUS z Asuswrt lub Asuswrt-Merlin oraz funkcją Dual WAN.

Nazwa usługi: ${serviceName}
Docelowy interfejs: ${targetWan}
Źródłowy adres IP lub sieć LAN: ${source}
Typ ruchu: ${protocol}
IPv4: ${ipv4 ? 'tak' : 'nie'}
IPv6: ${ipv6 ? 'tak' : 'nie'}
Uwzględnij domeny zależne, CDN i zewnętrzne endpointy: ${dependencies ? 'tak' : 'nie'}
Dodatkowe uwagi: ${notes || 'brak'}

Znajdź wyłącznie aktualne, publicznie potwierdzone zakresy adresów IP i CIDR używane przez tę usługę. Uwzględnij domenę główną, wymagane subdomeny, API, logowanie, multimedia, zasoby statyczne oraz zależne usługi tylko wtedy, gdy można je wiarygodnie potwierdzić.

Nie dodawaj zakresów, których nie można wiarygodnie powiązać z usługą. Współdzielone CDN oznacz jako ryzykowne i ustaw autoImportRecommended na false. Wyjaśnij ograniczenia dynamicznego DNS, Anycast, CDN i współdzielonego hostingu. Routing ASUS jest oparty na adresach IP, więc nie gwarantuje pełnego pokrycia domeny.

Nie używaj znaczników cytowań typu [1], linków Markdown ani przypisów poza JSON-em. W sourceReference umieszczaj wyłącznie bezpośredni, zwykły adres HTTPS. Odpowiedź musi zaczynać się znakiem { i kończyć znakiem }.

Zwróć wyłącznie poprawny JSON, bez Markdownu i tekstu poza JSON-em:
{
  "schemaVersion": "1.0",
  "serviceName": ${JSON.stringify(serviceName)},
  "primaryDomain": ${JSON.stringify(domain)},
  "targetWan": ${JSON.stringify(targetWan)},
  "source": ${JSON.stringify(source)},
  "protocol": ${JSON.stringify(protocol)},
  "generatedAt": "ISO-8601",
  "coverage": {
    "estimatedPercent": 0,
    "confidence": "low|medium|high",
    "complete": false,
    "limitations": []
  },
  "dynamicAddresses": true,
  "rules": [{
    "name": "",
    "description": "",
    "destination": "",
    "destinationType": "ipv4|cidr|ipv6",
    "source": ${JSON.stringify(source)},
    "protocol": ${JSON.stringify(protocol)},
    "targetWan": ${JSON.stringify(targetWan)},
    "priority": 100,
    "required": true,
    "sharedInfrastructure": false,
    "riskLevel": "low|medium|high",
    "autoImportRecommended": true,
    "sourceReference": "",
    "notes": ""
  }],
  "excludedRanges": [{"destination": "", "reason": ""}],
  "notes": []
}

Każde destination musi zawierać jeden poprawny adres IP albo CIDR. Usuń duplikaty i uporządkuj zakresy od najbardziej precyzyjnych. Nie zwracaj nazw domen w destination. Jeżeli nie da się zbudować wiarygodnej listy, zwróć pustą tablicę rules i opisz ograniczenia w coverage.limitations.`;
}

function firstJsonObject(input) {
  const value = String(input || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = value.indexOf('{');
  if (start < 0) return { text: value, ignoredOutsideText: false };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        const end = index + 1;
        return {
          text: value.slice(start, end),
          ignoredOutsideText: value.slice(0, start).trim().length > 0 || value.slice(end).trim().length > 0,
        };
      }
    }
  }
  return { text: value, ignoredOutsideText: false };
}

export function validateAiRoutingResponse(input, options = {}) {
  const errors = [];
  const warnings = [];
  let payload;
  try {
    const extracted = typeof input === 'string' ? firstJsonObject(input) : { text: input, ignoredOutsideText: false };
    const jsonText = extracted.text;
    payload = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
    if (extracted.ignoredOutsideText) warnings.push('ignored_text_outside_json');
  } catch (_error) {
    return { valid: false, errors: ['invalid_json'], warnings, payload: null, rules: [] };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['invalid_payload'], warnings, payload: null, rules: [] };
  }
  if (payload.schemaVersion !== '1.0') errors.push('unsupported_schema');
  if (!String(payload.serviceName || '').trim()) errors.push('missing_service_name');
  if (!String(payload.primaryDomain || '').trim()) errors.push('missing_primary_domain');
  if (!Array.isArray(payload.rules)) errors.push('rules_not_array');
  const maxRules = Math.min(DUALWAN_RULE_LIMIT, Math.max(1, Number(options.maxRules || DUALWAN_RULE_LIMIT)));
  const seen = new Set();
  const validated = [];
  for (const [index, rawRule] of (Array.isArray(payload.rules) ? payload.rules : []).entries()) {
    const reasons = [];
    const parsed = parseIpOrCidr(rawRule?.destination);
    const source = String(rawRule?.source || payload.source || 'all').trim() || 'all';
    const targetWan = normalizeWan(rawRule?.targetWan ?? payload.targetWan);
    const protocol = normalizeProtocol(rawRule?.protocol || payload.protocol);
    if (!parsed) reasons.push('invalid_destination');
    if (!isValidRuleSource(source)) reasons.push('invalid_source');
    if (parsed?.family === 6) reasons.push('ipv6_not_supported_by_asus_rulelist');
    if (parsed && isPrivateOrLocalDestination(parsed)) reasons.push('private_or_local_destination');
    if (parsed?.family === 4 && parsed.prefix < 12) reasons.push('range_too_broad');
    if (protocol !== 'all') reasons.push('protocol_not_supported_by_asus_rulelist');
    if (rawRule?.riskLevel === 'high') reasons.push('high_risk');
    if (rawRule?.sharedInfrastructure === true) reasons.push('shared_infrastructure');
    if (rawRule?.autoImportRecommended === false) reasons.push('auto_import_not_recommended');
    const normalized = normalizeRoutingRule({
      ...rawRule,
      source,
      destination: parsed?.normalized || rawRule?.destination,
      targetWan,
      protocol,
    });
    const key = dualWanRuleKey(normalized);
    if (seen.has(key)) reasons.push('duplicate');
    seen.add(key);
    const hardError = reasons.some((reason) => [
      'invalid_destination',
      'invalid_source',
      'ipv6_not_supported_by_asus_rulelist',
      'private_or_local_destination',
      'range_too_broad',
      'protocol_not_supported_by_asus_rulelist',
    ].includes(reason));
    const skipped = hardError || reasons.includes('high_risk') || reasons.includes('shared_infrastructure') || reasons.includes('auto_import_not_recommended') || reasons.includes('duplicate');
    validated.push({
      index,
      rule: normalized,
      reasons,
      status: hardError ? 'error' : skipped ? 'skipped' : reasons.length ? 'warning' : 'ready',
      readyToImport: !skipped,
    });
  }
  if (validated.length > maxRules) {
    errors.push('rule_limit_exceeded');
    validated.slice(maxRules).forEach((item) => {
      item.status = 'skipped';
      item.readyToImport = false;
      item.reasons.push('rule_limit_exceeded');
    });
  }
  if (!validated.some((item) => item.readyToImport)) warnings.push('no_importable_rules');
  return { valid: errors.length === 0, errors, warnings, payload, rules: validated };
}

export function groupFromValidatedAi(validation) {
  if (!validation?.payload) throw new Error('Missing validated AI payload.');
  const importable = validation.rules.filter((item) => item.readyToImport).map((item) => item.rule);
  return createRoutingGroup({
    name: validation.payload.serviceName,
    primaryDomain: validation.payload.primaryDomain,
    targetWan: normalizeWan(validation.payload.targetWan),
    source: validation.payload.source || 'all',
    protocol: normalizeProtocol(validation.payload.protocol),
    coverage: validation.payload.coverage,
    syncStatus: 'pending',
    rules: importable.map((rule) => ({ ...rule, syncStatus: 'pending' })),
  });
}

export function buildWholeTrafficRules(source, targetWan = '0') {
  const normalizedSource = String(source || '').trim();
  if (!isValidRuleSource(normalizedSource) || ['all', '*', 'any'].includes(normalizedSource.toLowerCase())) return [];
  const unit = normalizeWan(targetWan);
  return [
    { source: normalizedSource, destination: '1.0.0.0/1', unit },
    { source: normalizedSource, destination: '128.0.0.0/1', unit },
  ];
}

export function compileRoutingGroups(groups = []) {
  const rules = [];
  const seen = new Set();
  for (const group of groups.map(normalizeRoutingGroup)) {
    if (!group.enabled) continue;
    for (const rule of group.rules) {
      const parsed = parseIpOrCidr(rule.destination);
      if (!rule.enabled || !parsed || parsed.family !== 4 || rule.protocol !== 'all') continue;
      if (isPrivateOrLocalDestination(parsed) || parsed.prefix < 12 || rule.riskLevel === 'high' || !rule.autoImportRecommended) continue;
      const flat = {
        source: ['all', '*', 'any'].includes(rule.source.toLowerCase()) ? 'all' : rule.source,
        destination: parsed.normalized,
        unit: normalizeWan(rule.targetWan ?? group.targetWan),
      };
      const key = dualWanRuleKey(flat);
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(flat);
    }
  }
  return rules.slice(0, DUALWAN_RULE_LIMIT);
}

export function migrateFlatRulesToGroups(flatRules = []) {
  const normalized = flatRules.map((rule) => ({
    source: String(rule.source || '').trim(),
    destination: String(rule.destination || '').trim(),
    unit: normalizeWan(rule.unit),
  })).filter((rule) => rule.source && rule.destination);
  if (!normalized.length) return [];
  const known = new Set(googleYoutubeGeminiCidrs);
  const googleRules = normalized.filter((rule) => known.has(rule.destination));
  const otherRules = normalized.filter((rule) => !known.has(rule.destination));
  const groups = [];
  if (googleRules.length) {
    const unit = googleRules[0].unit;
    groups.push(createRoutingGroup({
      name: 'Google / YouTube / Gemini',
      primaryDomain: 'google.com',
      targetWan: unit,
      source: googleRules[0].source,
      syncStatus: 'synced',
      lastSyncedAt: new Date().toISOString(),
      rules: googleRules.map((rule) => ({
        ...rule,
        targetWan: rule.unit,
        name: rule.destination,
        riskLevel: 'low',
        syncStatus: 'synced',
      })),
    }));
  }
  if (otherRules.length) {
    groups.push(createRoutingGroup({
      name: 'Pozostałe reguły',
      targetWan: otherRules[0].unit,
      source: otherRules[0].source,
      syncStatus: 'synced',
      lastSyncedAt: new Date().toISOString(),
      rules: otherRules.map((rule) => ({
        ...rule,
        targetWan: rule.unit,
        name: rule.destination,
        riskLevel: 'low',
        syncStatus: 'synced',
      })),
    }));
  }
  return splitRoutingGroupsBySource(groups).groups;
}

export function reconcileRoutingGroupsWithFlatRules(groups = [], flatRules = []) {
  const split = splitRoutingGroupsBySource(groups);
  const normalizedGroups = split.groups;
  const knownKeys = new Set(normalizedGroups.flatMap((group) => group.rules.map(dualWanRuleKey)));
  const missing = flatRules
    .map((rule) => ({
      source: String(rule.source || '').trim(),
      destination: String(rule.destination || '').trim(),
      unit: normalizeWan(rule.unit),
    }))
    .filter((rule) => rule.source && rule.destination && !knownKeys.has(dualWanRuleKey(rule)));
  if (!missing.length) return { groups: normalizedGroups, changed: split.changed };
  const missingBySource = missing.reduce((result, rule) => {
    if (!result.has(rule.source)) result.set(rule.source, []);
    result.get(rule.source).push(rule);
    return result;
  }, new Map());
  for (const [source, sourceRules] of missingBySource) {
    let other = normalizedGroups.find((group) => (
      !group.primaryDomain
      && group.rules.length > 0
      && group.rules.every((rule) => rule.source === source)
    ));
    if (!other) {
      other = createRoutingGroup({
        name: 'Pozostałe reguły',
        targetWan: sourceRules[0].unit,
        source,
        syncStatus: 'synced',
        lastSyncedAt: new Date().toISOString(),
        rules: [],
      });
      normalizedGroups.push(other);
    }
    other.rules.push(...sourceRules.map((rule) => normalizeRoutingRule({
      ...rule,
      targetWan: rule.unit,
      name: rule.destination,
      riskLevel: 'low',
      syncStatus: 'synced',
    }, other.id)));
    other.updatedAt = new Date().toISOString();
  }
  return { groups: normalizedGroups, changed: true };
}
