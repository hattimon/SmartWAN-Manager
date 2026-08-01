import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  Filter,
  Globe2,
  Plus,
  Route,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { api } from './api.js';
import { countryOptions, findCountry } from './countries.js';
import {
  buildAiRoutingPrompt,
  buildWholeTrafficRules,
  compileRoutingGroups,
  createRoutingGroup,
  dualWanRuleKey,
  groupFromValidatedAi,
  isValidRuleSource,
  parseIpOrCidr,
  serviceRoutingPresets,
  splitRoutingGroupsBySource,
  validateAiRoutingResponse,
} from './dualWanRoutingGroups.js';

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(value) {
  const text = String(value || '');
  if (!text) throw new Error('Nothing to copy.');

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      // Local HTTP panels may not receive Clipboard API permission.
    }
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.inset = '0 auto auto -9999px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.focus();
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Clipboard access was rejected.');
}

function mergeFlatRules(existing = [], additions = []) {
  const result = existing.map((rule) => ({ ...rule }));
  const seen = new Set(result.map(dualWanRuleKey));
  for (const rule of additions) {
    const normalized = {
      source: String(rule.source || '').trim(),
      destination: String(rule.destination || '').trim(),
      unit: String(rule.unit ?? rule.targetWan) === '1' ? '1' : '0',
    };
    const key = dualWanRuleKey(normalized);
    if (!normalized.source || !normalized.destination || seen.has(key) || result.length >= 64) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function ipv4InCidr(ip, cidr) {
  const ipParts = String(ip || '').split('.').map(Number);
  const [network, prefixText = '32'] = String(cidr || '').split('/');
  const networkParts = network.split('.').map(Number);
  const prefix = Number(prefixText);
  if (ipParts.length !== 4 || networkParts.length !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if ([...ipParts, ...networkParts].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const toNumber = (parts) => parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (toNumber(ipParts) & mask) === (toNumber(networkParts) & mask);
}

function groupRouterStatus(group, routerRules = []) {
  const routerKeys = new Set(routerRules.map(dualWanRuleKey));
  const enabledRules = group.rules.filter((rule) => rule.enabled);
  const matches = enabledRules.filter((rule) => routerKeys.has(dualWanRuleKey(rule))).length;
  if (!enabledRules.length) return 'draft';
  if (matches === enabledRules.length) return 'synced';
  if (matches > 0) return 'partial';
  return 'pending';
}

function statusLabel(status, t) {
  return t(`routingGroupStatus_${status}`);
}

function isCatchAllRoutingGroup(group = {}) {
  const name = String(group.name || '').trim().toLowerCase();
  return name.includes('pozostałe reguły')
    || name.includes('pozostale reguly')
    || name === 'other rules';
}

function validationReason(reason, t) {
  return t(`routingValidation_${reason}`);
}

export default function DualWanServiceRouting({
  t,
  language = 'en',
  rules,
  routerRules,
  onRulesChange,
  onApply,
  busy,
  primaryLabel,
  secondaryLabel,
  lanSubnet,
  vpnSubnet,
  vpnInterface = 'tun21',
  vpnAdditionalProfiles = '',
  localClients = [],
  wanStatus = [],
  refreshToken = 0,
}) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('dualwan-routing-groups-expanded') || '{}');
    } catch (_error) {
      return {};
    }
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [targetForSelected, setTargetForSelected] = useState('0');
  const [sourceForSelected, setSourceForSelected] = useState(lanSubnet || '192.168.1.0/24');
  const [bulkActionStatus, setBulkActionStatus] = useState('');
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [generator, setGenerator] = useState({
    presetId: 'custom',
    serviceName: '',
    domain: '',
    targetWan: '1',
    source: lanSubnet || '192.168.1.0/24',
    protocol: 'all',
    ipv4: true,
    ipv6: false,
    includeDependencies: true,
    notes: '',
  });
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [promptCopyStatus, setPromptCopyStatus] = useState('');
  const [aiJson, setAiJson] = useState('');
  const [validation, setValidation] = useState(null);
  const [aiProvider, setAiProvider] = useState({
    provider: 'openai',
    model: 'gpt-5.6-luna',
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    configured: false,
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [policyComposer, setPolicyComposer] = useState({
    sourceMode: 'lan',
    customSource: '',
    serviceId: 'google-current',
    targetWan: '0',
  });
  const [locationPolicy, setLocationPolicy] = useState({
    enabled: false,
    preferredCountryCode: '',
    preferredCountryName: '',
    intervalMinutes: 60,
    preferredWan: 'auto',
    source: lanSubnet || '192.168.1.0/24',
    sources: [lanSubnet || '192.168.1.0/24'],
    apiKey: '',
    configured: false,
    lastResult: null,
    lastKnownLocations: {
      wan0: null,
      wan1: null,
    },
    lastCheckAt: '',
    nextCheckAt: '',
  });
  const [locationCountryQuery, setLocationCountryQuery] = useState(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [manualLocationSource, setManualLocationSource] = useState('');
  const [locationReportCopyStatus, setLocationReportCopyStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/api/router/dualwan/routing-groups')
      .then((result) => {
        if (!cancelled) {
          setGroups(result.groups || []);
          setError('');
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/router/dualwan/google-location-policy')
      .then((result) => {
        if (!cancelled) {
          setLocationPolicy({ ...result, apiKey: '' });
          setLocationCountryQuery(null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    let cancelled = false;
    setLoading(true);
    api.get('/api/router/dualwan/routing-groups?refresh=1')
      .then((result) => {
        if (!cancelled) {
          setGroups(result.groups || []);
          setSelected(new Set());
          setBulkActionStatus('refreshed');
          setError('');
        }
      })
      .catch((refreshError) => {
        if (!cancelled) setError(refreshError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/router/dualwan/ai-provider')
      .then((result) => {
        if (!cancelled) setAiProvider({ ...result, apiKey: '' });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('dualwan-routing-groups-expanded', JSON.stringify(expanded));
  }, [expanded]);

  useEffect(() => {
    if (!generator.source && lanSubnet) {
      setGenerator((current) => ({ ...current, source: lanSubnet }));
    }
    if (lanSubnet) {
      setSourceForSelected((current) => (
        current === '192.168.1.0/24' ? lanSubnet : current
      ));
    }
  }, [generator.source, lanSubnet]);

  const persistGroups = async (nextGroups) => {
    const canonicalGroups = splitRoutingGroupsBySource(nextGroups).groups;
    setGroups(canonicalGroups);
    try {
      const result = await api.put('/api/router/dualwan/routing-groups', { groups: canonicalGroups });
      setGroups(result.groups || canonicalGroups);
      setError('');
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    }
  };

  const managedVpnProfiles = [
    {
      interface: vpnInterface || 'tun21',
      subnet: vpnSubnet || '10.8.0.0/24',
    },
    ...String(vpnAdditionalProfiles || '')
      .split(/\r?\n|;/)
      .map((entry) => {
        const [interfaceName, subnet] = entry.trim().split('|');
        return { interface: interfaceName, subnet };
      })
      .filter((entry) => entry.interface && entry.subnet),
  ].filter((entry, index, all) => all.findIndex((other) => other.subnet === entry.subnet) === index);
  const vpnProfileForSource = (source) => {
    const value = String(source || '').trim();
    return managedVpnProfiles.find((profile) => value === profile.subnet || ipv4InCidr(value, profile.subnet));
  };
  const vpnLabel = (profile) => {
    const number = String(profile?.interface || '').match(/^tun2(\d+)$/)?.[1] || '1';
    return t('routingVpnServer').replace('{number}', number);
  };
  const isVpnSource = (source) => Boolean(vpnProfileForSource(source));

  const sourceDisplayLabel = (source) => {
    const value = String(source || '').trim();
    const lan = lanSubnet || '192.168.1.0/24';
    const client = localClients.find((item) => String(item?.ip || '') === value);
    const clientName = String(client?.name || client?.hostname || '').trim();
    const vpnProfile = vpnProfileForSource(value);
    const vpnSource = Boolean(vpnProfile);
    if (vpnProfile && value === vpnProfile.subnet) return `${vpnLabel(vpnProfile)} — ${value}`;
    if (value === lan) return `${t('routingWholeLan')} — ${value}`;
    if (clientName && vpnSource) return `${clientName} · ${t('routingVpnDevice')} — ${value}`;
    if (clientName) return `${clientName} — ${value}`;
    if (vpnSource) return `${t('routingVpnDevice')} — ${value}`;
    return value || t('routingUnknownDevice');
  };

  const renderSourceOptions = (currentSource, keyPrefix) => {
    const knownSources = [
      lanSubnet || '192.168.1.0/24',
      ...managedVpnProfiles.map((profile) => profile.subnet),
      ...localClients.map((client) => client.ip).filter(Boolean),
    ];
    return (
      <>
        <option value={lanSubnet || '192.168.1.0/24'}>{sourceDisplayLabel(lanSubnet || '192.168.1.0/24')}</option>
        {managedVpnProfiles.map((profile) => (
          <option value={profile.subnet} key={`${keyPrefix}-${profile.interface}-${profile.subnet}`}>
            {sourceDisplayLabel(profile.subnet)}
          </option>
        ))}
        {localClients.filter((client) => client?.ip).map((client) => (
          <option value={client.ip} key={`${keyPrefix}-${client.ip}-${client.mac || ''}`}>
            {sourceDisplayLabel(client.ip)}
          </option>
        ))}
        {!knownSources.includes(currentSource) ? <option value={currentSource}>{sourceDisplayLabel(currentSource)}</option> : null}
      </>
    );
  };

  const locationSourceChoices = [...new Set([
    lanSubnet || '192.168.1.0/24',
    ...managedVpnProfiles.map((profile) => profile.subnet),
    ...localClients.map((client) => client.ip).filter(Boolean),
    ...(locationPolicy.sources || []),
  ])];
  const selectedLocationSources = locationPolicy.sources?.length
    ? locationPolicy.sources
    : [locationPolicy.source || lanSubnet || '192.168.1.0/24'];
  const toggleLocationSource = (source) => {
    const selectedSet = new Set(selectedLocationSources);
    if (selectedSet.has(source)) {
      if (selectedSet.size === 1) return;
      selectedSet.delete(source);
    } else {
      selectedSet.add(source);
    }
    const sources = [...selectedSet];
    setLocationPolicy({
      ...locationPolicy,
      source: sources[0],
      sources,
    });
  };
  const addManualLocationSource = () => {
    const source = manualLocationSource.trim();
    const parsed = parseIpOrCidr(source);
    if (!parsed || parsed.family !== 4 || ['all', '*', 'any'].includes(source.toLowerCase())) {
      setError(t('googleLocationManualSourceInvalid'));
      return;
    }
    const sources = [...new Set([...selectedLocationSources, source])];
    setLocationPolicy({
      ...locationPolicy,
      source: sources[0],
      sources,
    });
    setManualLocationSource('');
    setError('');
  };

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return groups.filter((group) => {
      const sync = groupRouterStatus(group, routerRules);
      const matchesQuery = !query || [
        group.name,
        group.primaryDomain,
        ...group.rules.flatMap((rule) => [rule.source, rule.destination]),
      ].some((value) => String(value || '').toLowerCase().includes(query));
      const matchesFilter = filter === 'all'
        || (filter === 'wan0' && String(group.targetWan) === '0')
        || (filter === 'wan1' && String(group.targetWan) === '1')
        || (filter === 'enabled' && group.enabled)
        || (filter === 'disabled' && !group.enabled)
        || filter === sync;
      return matchesQuery && matchesFilter;
    }).sort((left, right) => Number(isCatchAllRoutingGroup(left)) - Number(isCatchAllRoutingGroup(right)));
  }, [filter, groups, routerRules, search]);

  const presetDisplayName = (preset) => preset.nameKey ? t(preset.nameKey) : preset.name;
  const availableCountries = useMemo(() => countryOptions(language), [language]);
  const selectedCountry = availableCountries.find(
    (country) => country.code === locationPolicy.preferredCountryCode,
  );
  const countryInputValue = locationCountryQuery ?? selectedCountry?.label ?? '';

  const saveLocationPolicy = async (clearApiKey = false) => {
    const country = locationCountryQuery === null
      ? selectedCountry
      : findCountry(locationCountryQuery, availableCountries);
    if (!country) {
      setError(t('googleLocationCountryInvalid'));
      return;
    }
    setLocationBusy(true);
    try {
      const saved = await api.put('/api/router/dualwan/google-location-policy', {
        ...locationPolicy,
        preferredCountryCode: country.code,
        preferredCountryName: country.localName,
        apiKey: locationPolicy.apiKey,
        clearApiKey,
      });
      setLocationPolicy({ ...saved, apiKey: '' });
      setLocationCountryQuery(null);
      setLocationStatus('saved');
      setError('');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setLocationBusy(false);
    }
  };

  const checkLocationPolicy = async () => {
    setLocationBusy(true);
    try {
      const result = await api.post('/api/router/dualwan/google-location-policy/check');
      setLocationPolicy((current) => ({
        ...current,
        lastResult: result,
        lastKnownLocations: result.lastKnownLocations || current.lastKnownLocations,
        lastCheckAt: result.checkedAt,
        nextCheckAt: result.nextCheckAt,
      }));
      setLocationStatus(result.applied ? 'applied' : 'checked');
      setError('');
    } catch (checkError) {
      setError(checkError.message);
    } finally {
      setLocationBusy(false);
    }
  };

  const locationReportItems = ['wan0', 'wan1'].flatMap((wanId) => {
    const currentProbe = (locationPolicy.lastResult?.wans || [])
      .find((wan) => wan.id === wanId);
    const lastKnown = locationPolicy.lastKnownLocations?.[wanId];
    const location = currentProbe?.ok ? currentProbe : lastKnown;
    if (!location?.countryCode
      || !locationPolicy.preferredCountryCode
      || location.countryCode === locationPolicy.preferredCountryCode) return [];
    const liveWan = wanStatus.find((wan) => wan.id === wanId) || {};
    return [{
      wanId,
      wanLabel: liveWan.label || (wanId === 'wan0' ? primaryLabel : secondaryLabel),
      publicIp: liveWan.publicIp || '',
      detectedCountry: location.countryName || location.countryCode,
      expectedCountry: locationPolicy.preferredCountryName || locationPolicy.preferredCountryCode,
    }];
  });

  const copyGoogleLocationReport = async (item) => {
    const report = t('googleLocationReportData')
      .replace('{wan}', item.wanLabel)
      .replace('{ip}', item.publicIp || t('notDetected'))
      .replace('{detected}', item.detectedCountry)
      .replace('{expected}', item.expectedCountry);
    try {
      await copyTextToClipboard(report);
      setLocationReportCopyStatus(item.wanId);
      setError('');
    } catch (copyError) {
      setLocationReportCopyStatus('error');
      setError(copyError.message);
    }
  };

  const selectPreset = (preset) => {
    setGenerator((current) => ({
      ...current,
      presetId: preset.id,
      serviceName: presetDisplayName(preset),
      domain: preset.domain,
      includeDependencies: preset.includeDependencies !== false,
    }));
    setGeneratorOpen(true);
  };

  const addVerifiedPreset = async (preset, sourceOverride, targetWanOverride) => {
    if (!preset.verifiedDestinations?.length) {
      selectPreset(preset);
      return;
    }
    const source = sourceOverride || generator.source || lanSubnet || '192.168.1.0/24';
    const targetWan = targetWanOverride ?? generator.targetWan;
    const existingKeys = new Set(rules.map(dualWanRuleKey));
    const additions = preset.verifiedDestinations.filter((destination) => !existingKeys.has(dualWanRuleKey({
      source,
      destination,
      unit: targetWan,
    })));
    if (!additions.length) {
      setError(t('routingPresetAlreadyPresent'));
      return;
    }
    if (rules.length + additions.length > 64) {
      setError(t('routingRuleLimitExceeded')
        .replace('{current}', String(rules.length))
        .replace('{new}', String(additions.length)));
      return;
    }
    const group = createRoutingGroup({
      name: presetDisplayName(preset),
      primaryDomain: preset.domain,
      source,
      targetWan,
      syncStatus: 'pending',
      rules: additions.map((destination) => ({
        name: destination,
        source,
        destination,
        targetWan,
        protocol: 'all',
        riskLevel: 'low',
        syncStatus: 'pending',
      })),
    });
    const nextGroups = [...groups, group];
    await persistGroups(nextGroups);
    onRulesChange(mergeFlatRules(rules, compileRoutingGroups([group])));
  };

  const toggleSelected = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (id) => setExpanded((current) => ({ ...current, [id]: !current[id] }));

  const changeGroupsWan = async (ids, targetWan) => {
    const normalizedTargetWan = String(targetWan) === '1' ? '1' : '0';
    const idSet = new Set(ids);
    const hasChanges = groups.some((group) => idSet.has(group.id)
      && (String(group.targetWan) !== normalizedTargetWan
        || group.rules.some((rule) => String(rule.targetWan) !== normalizedTargetWan)));
    if (!idSet.size || !hasChanges) return false;
    const changedKeys = new Map();
    const nextGroups = groups.map((group) => {
      if (!idSet.has(group.id)) return group;
      const updatedRules = group.rules.map((rule) => {
        changedKeys.set(dualWanRuleKey(rule), normalizedTargetWan);
        return { ...rule, targetWan: normalizedTargetWan, syncStatus: 'pending' };
      });
      return {
        ...group,
        targetWan: normalizedTargetWan,
        rules: updatedRules,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString(),
      };
    });
    onRulesChange(rules.map((rule) => {
      const target = changedKeys.get(dualWanRuleKey(rule));
      return target === undefined ? rule : { ...rule, unit: target };
    }));
    return persistGroups(nextGroups);
  };

  const changeGroupsSource = async (ids, source) => {
    const normalizedSource = String(source || '').trim();
    if (!isValidRuleSource(normalizedSource)) {
      setError(t('routingDeviceInvalidSource'));
      return false;
    }
    const idSet = new Set(ids);
    const hasChanges = groups.some((group) => idSet.has(group.id)
      && (String(group.source) !== normalizedSource
        || group.rules.some((rule) => String(rule.source) !== normalizedSource)));
    if (!idSet.size || !hasChanges) return false;
    const changedKeys = new Map();
    const nextGroups = groups.map((group) => {
      if (!idSet.has(group.id)) return group;
      const updatedRules = group.rules.map((rule) => {
        changedKeys.set(dualWanRuleKey(rule), normalizedSource);
        return { ...rule, source: normalizedSource, syncStatus: 'pending' };
      });
      return {
        ...group,
        source: normalizedSource,
        rules: updatedRules,
        syncStatus: 'pending',
        updatedAt: new Date().toISOString(),
      };
    });
    onRulesChange(rules.map((rule) => {
      const nextSource = changedKeys.get(dualWanRuleKey(rule));
      return nextSource === undefined ? rule : { ...rule, source: nextSource };
    }));
    return persistGroups(nextGroups);
  };

  const changeRuleDestination = async (groupId, ruleId, destination) => {
    const parsed = parseIpOrCidr(destination);
    const group = groups.find((item) => item.id === groupId);
    const previous = group?.rules.find((rule) => rule.id === ruleId);
    if (!previous || !parsed) {
      setError(t('routingValidation_invalid_destination'));
      return false;
    }
    if (parsed.normalized === previous.destination) return false;
    const previousKey = dualWanRuleKey(previous);
    const nextGroups = groups.map((item) => item.id === groupId
      ? {
          ...item,
          rules: item.rules.map((rule) => rule.id === ruleId
            ? { ...rule, destination: parsed.normalized, destinationType: parsed.type, syncStatus: 'pending' }
            : rule),
          syncStatus: 'pending',
          updatedAt: new Date().toISOString(),
        }
      : item);
    onRulesChange(rules.map((rule) => dualWanRuleKey(rule) === previousKey
      ? { ...rule, destination: parsed.normalized }
      : rule));
    return persistGroups(nextGroups);
  };

  const changeRuleWan = async (groupId, ruleId, targetWan) => {
    const normalizedWan = String(targetWan) === '1' ? '1' : '0';
    const group = groups.find((item) => item.id === groupId);
    const previous = group?.rules.find((rule) => rule.id === ruleId);
    if (!previous || String(previous.targetWan) === normalizedWan) return false;
    const previousKey = dualWanRuleKey(previous);
    const nextGroups = groups.map((item) => item.id === groupId
      ? {
          ...item,
          rules: item.rules.map((rule) => rule.id === ruleId
            ? { ...rule, targetWan: normalizedWan, syncStatus: 'pending' }
            : rule),
          targetWan: item.rules.every((rule) => rule.id === ruleId || String(rule.targetWan) === normalizedWan)
            ? normalizedWan
            : item.targetWan,
          syncStatus: 'pending',
          updatedAt: new Date().toISOString(),
        }
      : item);
    onRulesChange(rules.map((rule) => dualWanRuleKey(rule) === previousKey
      ? { ...rule, unit: normalizedWan }
      : rule));
    return persistGroups(nextGroups);
  };

  const removeGroups = async (ids) => {
    const idSet = new Set(ids);
    const removing = groups.filter((group) => idSet.has(group.id));
    if (!removing.length) return;
    const ruleCount = removing.reduce((total, group) => total + group.rules.length, 0);
    const names = removing.map((group) => group.name).join(', ');
    if (!window.confirm(t('routingGroupDeleteConfirm')
      .replace('{groups}', String(removing.length))
      .replace('{rules}', String(ruleCount))
      .replace('{names}', names))) return;
    const removedKeys = new Set(removing.flatMap((group) => group.rules.map(dualWanRuleKey)));
    onRulesChange(rules.filter((rule) => !removedKeys.has(dualWanRuleKey(rule))));
    await persistGroups(groups.filter((group) => !idSet.has(group.id)));
    setSelected(new Set());
  };

  const removeRule = async (groupId, ruleId) => {
    const group = groups.find((item) => item.id === groupId);
    const removed = group?.rules.find((rule) => rule.id === ruleId);
    if (!removed) return;
    onRulesChange(rules.filter((rule) => dualWanRuleKey(rule) !== dualWanRuleKey(removed)));
    await persistGroups(groups.map((item) => item.id === groupId
      ? {
          ...item,
          rules: item.rules.filter((rule) => rule.id !== ruleId),
          syncStatus: 'pending',
          updatedAt: new Date().toISOString(),
        }
      : item));
  };

  const duplicateGroup = async (group) => {
    const copy = createRoutingGroup({
      ...group,
      id: undefined,
      name: `${group.name} — ${t('copy')}`,
      syncStatus: 'draft',
      rules: group.rules.map((rule) => ({ ...rule, id: undefined, syncStatus: 'draft' })),
    });
    await persistGroups([...groups, copy]);
  };

  const composerSource = () => {
    if (policyComposer.sourceMode === 'lan') return lanSubnet || '192.168.1.0/24';
    if (policyComposer.sourceMode === 'vpn') return vpnSubnet || '10.8.0.0/24';
    if (policyComposer.sourceMode.startsWith('vpn:')) return policyComposer.sourceMode.slice(4);
    if (policyComposer.sourceMode.startsWith('client:')) return policyComposer.sourceMode.slice(7);
    return policyComposer.customSource.trim();
  };

  const addWholeTrafficGroup = async (source, targetWan, name) => {
    const flat = buildWholeTrafficRules(source, targetWan);
    if (!flat.length) {
      setError(t('routingDeviceInvalidSource'));
      return false;
    }
    const group = createRoutingGroup({
      name: name || t('routingWholeDeviceTraffic'),
      primaryDomain: '',
      targetWan,
      source,
      syncStatus: 'pending',
      rules: flat.map((rule, index) => ({
        ...rule,
        name: index === 0 ? '1.0.0.0/1' : '128.0.0.0/1',
        targetWan: rule.unit,
        riskLevel: 'low',
        syncStatus: 'pending',
      })),
    });
    await persistGroups([...groups, group]);
    onRulesChange(mergeFlatRules(rules, flat));
    return true;
  };

  const applyPolicyComposer = async () => {
    const source = composerSource();
    if (!source) {
      setError(t('routingDeviceInvalidSource'));
      return;
    }
    if (policyComposer.serviceId === 'all-traffic') {
      await addWholeTrafficGroup(
        source,
        policyComposer.targetWan,
        `${t('routingWholeDeviceTraffic')} — ${source}`,
      );
      return;
    }
    const preset = serviceRoutingPresets.find((item) => item.id === policyComposer.serviceId);
    if (!preset) return;
    if (preset.verifiedDestinations?.length) {
      await addVerifiedPreset(preset, source, policyComposer.targetWan);
      return;
    }
    setGenerator((current) => ({
      ...current,
      presetId: preset.id,
      serviceName: presetDisplayName(preset),
      domain: preset.domain,
      source,
      targetWan: policyComposer.targetWan,
      includeDependencies: preset.includeDependencies !== false,
    }));
    setGeneratorOpen(true);
  };

  const generatePrompt = () => {
    setGeneratedPrompt(buildAiRoutingPrompt({ ...generator, language }));
    setPromptCopyStatus('');
  };

  const copyPrompt = async () => {
    try {
      await copyTextToClipboard(generatedPrompt);
      setPromptCopyStatus('success');
    } catch (_copyError) {
      setPromptCopyStatus('error');
    }
  };

  const validateImport = () => {
    const report = validateAiRoutingResponse(aiJson, { maxRules: Math.max(1, 64 - rules.length) });
    setValidation(report);
  };

  const providerDefaults = (provider) => {
    if (provider === 'gemini') return { model: 'gemini-3.5-flash', baseUrl: 'https://generativelanguage.googleapis.com' };
    if (provider === 'ollama') return { model: 'llama3.1', baseUrl: 'http://127.0.0.1:11434' };
    if (provider === 'openai_compatible') return { model: '', baseUrl: '' };
    return { model: 'gpt-5.6-luna', baseUrl: 'https://api.openai.com' };
  };

  const aiModelSuggestion = {
    openai: t('routingAiModelHintOpenAi'),
    gemini: t('routingAiModelHintGemini'),
    ollama: t('routingAiModelHintOllama'),
    openai_compatible: t('routingAiModelHintCompatible'),
  }[aiProvider.provider];

  const changeAiProvider = (provider) => {
    const defaults = providerDefaults(provider);
    setAiProvider((current) => ({
      ...current,
      provider,
      ...defaults,
      apiKey: '',
      configured: provider === 'ollama',
    }));
  };

  const saveAiProvider = async (clearApiKey = false) => {
    setAiBusy(true);
    try {
      const saved = await api.put('/api/router/dualwan/ai-provider', {
        provider: aiProvider.provider,
        model: aiProvider.model,
        baseUrl: aiProvider.baseUrl,
        apiKey: aiProvider.apiKey,
        clearApiKey,
      });
      setAiProvider({ ...saved, apiKey: '' });
      setError('');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setAiBusy(false);
    }
  };

  const askConfiguredAi = async () => {
    const prompt = generatedPrompt || buildAiRoutingPrompt({ ...generator, language });
    setGeneratedPrompt(prompt);
    if (!aiProvider.configured) {
      setAiConfigOpen(true);
      return;
    }
    setAiBusy(true);
    try {
      const result = await api.post('/api/router/dualwan/ai-generate', { prompt });
      setAiJson(result.output || '');
      const report = validateAiRoutingResponse(result.output || '', { maxRules: Math.max(1, 64 - rules.length) });
      setValidation(report);
      setImportOpen(true);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAiBusy(false);
    }
  };

  const importValidated = async () => {
    const report = validation || validateAiRoutingResponse(aiJson, { maxRules: Math.max(1, 64 - rules.length) });
    setValidation(report);
    if (!report.valid || !report.rules.some((item) => item.readyToImport)) return;
    const group = groupFromValidatedAi(report);
    await persistGroups([...groups, group]);
    onRulesChange(mergeFlatRules(rules, compileRoutingGroups([group])));
    setImportOpen(false);
  };

  const addAiWholeTrafficFallback = async () => {
    if (!validation?.payload) return;
    const source = String(validation.payload.source || generator.source || '').trim();
    const targetWan = String(validation.payload.targetWan || generator.targetWan).toUpperCase() === 'WAN1' ? '1' : '0';
    const serviceName = String(validation.payload.serviceName || generator.serviceName || '').trim();
    const added = await addWholeTrafficGroup(
      source,
      targetWan,
      `${serviceName || t('routingWholeDeviceTraffic')} — ${t('routingWholeSourceFallback')}`,
    );
    if (added) setImportOpen(false);
  };

  const selectedIds = [...selected];
  const selectedGroups = groups.filter((group) => selected.has(group.id));
  const wanChangeNeeded = selectedGroups.some((group) => String(group.targetWan) !== String(targetForSelected)
    || group.rules.some((rule) => String(rule.targetWan) !== String(targetForSelected)));
  const sourceChangeNeeded = selectedGroups.some((group) => String(group.source) !== String(sourceForSelected)
    || group.rules.some((rule) => String(rule.source) !== String(sourceForSelected)));
  const routerRuleCount = routerRules.length;

  return (
    <section className="service-routing-manager">
      <div className="service-routing-heading">
        <div>
          <span className="eyebrow">{t('routingServicesAndDomains')}</span>
          <h3>{t('routingServicesTitle')}</h3>
          <p>{t('routingServicesCopy')}</p>
        </div>
        <div className="routing-capacity">
          <strong>{rules.length}/64</strong>
          <span>{t('dualWanRoutes')}</span>
        </div>
      </div>

      {error ? <div className="notice error">{error}</div> : null}

      <div className="routing-policy-composer">
        <div className="routing-policy-composer-title">
          <Route size={20} />
          <div>
            <strong>{t('routingPolicyComposer')}</strong>
            <span>{t('routingPolicyComposerCopy')}</span>
          </div>
        </div>
        <label>
          <span>1. {t('routingSource')}</span>
          <select value={policyComposer.sourceMode} onChange={(event) => setPolicyComposer({ ...policyComposer, sourceMode: event.target.value })}>
            <option value="lan">{t('routingWholeLan')} — {lanSubnet || '192.168.1.0/24'}</option>
            {managedVpnProfiles.map((profile) => (
              <option value={`vpn:${profile.subnet}`} key={`composer-${profile.interface}-${profile.subnet}`}>
                {vpnLabel(profile)} — {profile.subnet}
              </option>
            ))}
            {localClients
              .filter((client) => client?.ip)
              .sort((a, b) => String(a.name || a.hostname || a.ip).localeCompare(String(b.name || b.hostname || b.ip)))
              .map((client) => (
                <option value={`client:${client.ip}`} key={`${client.ip}-${client.mac || ''}`}>
                  {client.name || client.hostname || t('routingUnknownDevice')} — {client.ip}
                </option>
              ))}
            <option value="custom">{t('routingDeviceCustom')}</option>
          </select>
        </label>
        {policyComposer.sourceMode === 'custom' ? (
          <label>
            <span>{t('dualWanSourceIp')}</span>
            <input
              value={policyComposer.customSource}
              onChange={(event) => setPolicyComposer({ ...policyComposer, customSource: event.target.value })}
              placeholder="192.168.1.50 lub 10.8.0.0/24"
            />
          </label>
        ) : null}
        <label>
          <span>2. {t('routingTrafficOrService')}</span>
          <select value={policyComposer.serviceId} onChange={(event) => setPolicyComposer({ ...policyComposer, serviceId: event.target.value })}>
            <option value="all-traffic">{t('routingAllTraffic')}</option>
            {serviceRoutingPresets.map((preset) => (
              <option value={preset.id} key={preset.id}>
                {presetDisplayName(preset)}{preset.verifiedDestinations ? ` · ${t('routingVerified')}` : ` · ${t('routingAiRequired')}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>3. {t('routingTargetWan')}</span>
          <select value={policyComposer.targetWan} onChange={(event) => setPolicyComposer({ ...policyComposer, targetWan: event.target.value })}>
            <option value="0">{primaryLabel}</option>
            <option value="1">{secondaryLabel}</option>
          </select>
        </label>
        <button type="button" className="primary-mini-button" onClick={applyPolicyComposer}>
          <Plus size={15} />
          {t('routingAddDraft')}
        </button>
      </div>

      <details className="routing-collapsible service-preset-browser">
        <summary className="service-preset-heading">
          <div>
            <strong>{t('routingServicePresets')}</strong>
            <span>{t('routingServicePresetsCopy')}</span>
          </div>
          <ChevronDown size={18} />
        </summary>
        <div className="routing-collapsible-body">
          <div className="button-row routing-preset-actions">
            <button type="button" onClick={() => setGeneratorOpen(true)}>
              <Sparkles size={15} />
              {t('routingOpenGenerator')}
            </button>
          </div>
        <div className="service-preset-grid">
          {serviceRoutingPresets.map((preset) => (
            <button
              type="button"
              className={`service-preset-card ${preset.verifiedDestinations ? 'verified' : ''}`}
              key={preset.id}
              onClick={() => preset.verifiedDestinations?.length ? void addVerifiedPreset(preset) : selectPreset(preset)}
            >
              <span>{t(`routingPresetCategory_${preset.category}`)}</span>
              <strong>{presetDisplayName(preset)}</strong>
              <small>{preset.domain || t('routingCustomDomain')}</small>
              {preset.verifiedDestinations ? (
                <em>{t('routingVerifiedCurrentPreset').replace('{count}', String(preset.verifiedDestinations.length))}</em>
              ) : <em>{t('routingGeneratorOnly')}</em>}
              {preset.sharedInfrastructure ? <small className="preset-risk-note">{t('routingSharedPresetWarning')}</small> : null}
              {preset.verifiedDestinations ? (
                <span
                  className="preset-direct-action"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    void addVerifiedPreset(preset);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.stopPropagation();
                      void addVerifiedPreset(preset);
                    }
                  }}
                >
                  <Plus size={13} /> {t('routingAddVerifiedRules')}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className={`google-location-policy ${locationPolicy.enabled ? 'active' : ''}`}>
          <div className="google-location-policy-heading">
            <Globe2 size={20} />
            <div>
              <strong>{t('googleLocationPolicyTitle')}</strong>
              <span>{t('googleLocationPolicyCopy')}</span>
            </div>
            <label className="google-location-toggle">
              <input
                type="checkbox"
                checked={locationPolicy.enabled}
                onChange={(event) => setLocationPolicy({
                  ...locationPolicy,
                  enabled: event.target.checked,
                })}
              />
              {locationPolicy.enabled ? t('enabled') : t('disabled')}
            </label>
          </div>

          <div className="google-location-policy-grid">
            <label>
              <span>{t('googleLocationExpectedCountry')}</span>
              <input
                list="google-location-country-list"
                value={countryInputValue}
                onChange={(event) => setLocationCountryQuery(event.target.value)}
                placeholder={t('googleLocationCountryPlaceholder')}
              />
              <datalist id="google-location-country-list">
                {availableCountries.map((country) => (
                  <option value={country.label} key={country.code} />
                ))}
              </datalist>
            </label>
            <label>
              <span>{t('googleLocationPreferredWan')}</span>
              <select
                value={locationPolicy.preferredWan}
                onChange={(event) => setLocationPolicy({
                  ...locationPolicy,
                  preferredWan: event.target.value,
                })}
              >
                <option value="auto">{t('googleLocationAutomaticWan')}</option>
                <option value="wan0">{primaryLabel}</option>
                <option value="wan1">{secondaryLabel}</option>
              </select>
            </label>
            <label>
              <span>{t('googleLocationInterval')}</span>
              <select
                value={locationPolicy.intervalMinutes}
                onChange={(event) => setLocationPolicy({
                  ...locationPolicy,
                  intervalMinutes: Number(event.target.value),
                })}
              >
                <option value="10">{t('googleLocationEvery10Minutes')}</option>
                <option value="60">{t('googleLocationEveryHour')}</option>
                <option value="240">{t('googleLocationEvery4Hours')}</option>
                <option value="480">{t('googleLocationEvery8Hours')}</option>
                <option value="1440">{t('googleLocationEveryDay')}</option>
              </select>
            </label>
            <fieldset className="google-location-source-picker">
              <legend>{t('googleLocationRuleSource')}</legend>
              <small>{t('googleLocationRuleSourceCopy')}</small>
              <div>
                {locationSourceChoices.map((source) => (
                  <label key={`google-location-${source}`}>
                    <input
                      type="checkbox"
                      checked={selectedLocationSources.includes(source)}
                      onChange={() => toggleLocationSource(source)}
                    />
                    <span>{sourceDisplayLabel(source)}</span>
                  </label>
                ))}
              </div>
              <div className="google-location-manual-source">
                <input
                  type="text"
                  value={manualLocationSource}
                  onChange={(event) => setManualLocationSource(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    addManualLocationSource();
                  }}
                  placeholder={t('googleLocationManualSourcePlaceholder')}
                  aria-label={t('googleLocationManualSourceLabel')}
                />
                <button
                  type="button"
                  className="routing-action"
                  disabled={!manualLocationSource.trim()}
                  onClick={addManualLocationSource}
                >
                  <Plus size={14} />{t('googleLocationManualSourceAdd')}
                </button>
              </div>
            </fieldset>
            <label className="google-location-key-field">
              <span>{t('googleLocationApiKey')}</span>
              <input
                type="password"
                value={locationPolicy.apiKey}
                onChange={(event) => setLocationPolicy({
                  ...locationPolicy,
                  apiKey: event.target.value,
                })}
                placeholder={locationPolicy.configured
                  ? t('googleLocationApiKeySaved')
                  : t('googleLocationApiKeyPlaceholder')}
              />
            </label>
          </div>

          <p className="google-location-note">
            <AlertTriangle size={15} />
            {t('googleLocationSafetyNote')}
          </p>
          <p className="google-location-runtime-note">
            <ShieldCheck size={15} />
            {t('googleLocationRuntimeRequirement')}
          </p>
          <p className="google-location-priority-note">
            <ShieldCheck size={15} />
            {t('googleLocationPinnedProtection')}
          </p>
          <details className="google-location-instructions">
            <summary>{t('googleLocationInstructionsTitle')}</summary>
            <ol>
              <li>{t('googleLocationInstructionBilling')}</li>
              <li>
                {t('googleLocationInstructionApis')}{' '}
                <a
                  href="https://console.cloud.google.com/google/maps-apis/api-list"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Maps Platform
                </a>
              </li>
              <li>{t('googleLocationInstructionKey')}</li>
              <li>{t('googleLocationInstructionQuota')}</li>
              <li>{t('googleLocationInstructionSave')}</li>
            </ol>
            <p>{t('googleLocationFreeUsage')}</p>
          </details>

          {locationPolicy.lastResult || Object.values(locationPolicy.lastKnownLocations || {}).some(Boolean) ? (
            <div className="google-location-results">
              {['wan0', 'wan1'].map((wanId) => {
                const currentProbe = (locationPolicy.lastResult?.wans || [])
                  .find((wan) => wan.id === wanId);
                const lastKnown = locationPolicy.lastKnownLocations?.[wanId];
                const location = currentProbe?.ok ? currentProbe : lastKnown;
                return (
                  <div className={currentProbe?.ok === false ? 'warn' : 'ok'} key={wanId}>
                    <span>{wanId === 'wan0' ? primaryLabel : secondaryLabel}</span>
                    <strong>
                      {location
                        ? `${location.countryName || location.countryCode} / ${location.cityName || t('googleLocationCityUnknown')}`
                        : t('googleLocationCheckFailed')}
                    </strong>
                    <small>
                      {currentProbe?.ok === false
                        ? `${t('googleLocationLastKnown')}: ${currentProbe.error}`
                        : location
                          ? t('googleLocationDetectedAt').replace(
                            '{date}',
                            new Date(location.detectedAt || locationPolicy.lastCheckAt).toLocaleString(),
                          )
                          : t('noData')}
                    </small>
                    {location?.accuracyMeters ? (
                      <small>
                        {t('googleLocationAccuracy').replace(
                          '{meters}',
                          Math.round(location.accuracyMeters).toLocaleString(),
                        )}
                      </small>
                    ) : null}
                  </div>
                );
              })}
              <div>
                <span>{t('googleLocationLastCheck')}</span>
                <strong>{locationPolicy.lastCheckAt ? new Date(locationPolicy.lastCheckAt).toLocaleString() : t('noData')}</strong>
                <small>
                  {locationPolicy.lastResult?.outcome
                    ? t(`googleLocationOutcome_${locationPolicy.lastResult.outcome}`)
                    : t('noData')}
                </small>
              </div>
            </div>
          ) : null}

          {locationReportItems.length ? (
            <div className="google-location-report">
              <div className="google-location-report-heading">
                <AlertTriangle size={17} />
                <div>
                  <strong>{t('googleLocationReportTitle')}</strong>
                  <p>{t('googleLocationReportCopy')}</p>
                </div>
              </div>
              {locationReportItems.map((item) => (
                <div className="google-location-report-row" key={`google-report-${item.wanId}`}>
                  <div>
                    <strong>{item.wanLabel}</strong>
                    <span>
                      {t('googleLocationReportMismatch')
                        .replace('{detected}', item.detectedCountry)
                        .replace('{expected}', item.expectedCountry)}
                    </span>
                    <small>
                      {t('googleLocationReportPublicIp').replace(
                        '{ip}',
                        item.publicIp || t('notDetected'),
                      )}
                    </small>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="routing-action"
                      onClick={() => copyGoogleLocationReport(item)}
                    >
                      <Copy size={14} />
                      {locationReportCopyStatus === item.wanId
                        ? t('googleLocationReportCopied')
                        : t('googleLocationReportCopyData')}
                    </button>
                    <a
                      className="routing-action primary"
                      href="https://support.google.com/websearch/workflow/9308722"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
                      {t('googleLocationReportOpen')}
                    </a>
                  </div>
                </div>
              ))}
              <small>{t('googleLocationReportManualOnly')}</small>
            </div>
          ) : null}

          <div className="button-row">
            <button
              type="button"
              className="routing-action primary"
              disabled={locationBusy}
              onClick={() => saveLocationPolicy(false)}
            >
              <Save size={15} />{t('save')}
            </button>
            <button
              type="button"
              className="routing-action"
              disabled={locationBusy || !locationPolicy.configured}
              onClick={checkLocationPolicy}
            >
              <Search size={15} />{t('googleLocationCheckNow')}
            </button>
            {locationPolicy.configured ? (
              <button
                type="button"
                className="routing-action danger"
                disabled={locationBusy}
                onClick={() => saveLocationPolicy(true)}
              >
                <Trash2 size={15} />{t('googleLocationRemoveKey')}
              </button>
            ) : null}
            {locationStatus ? <span className="google-location-save-status">{t(`googleLocationStatus_${locationStatus}`)}</span> : null}
          </div>
        </div>
        </div>
      </details>

      {generatorOpen ? (
        <div className="routing-generator-panel">
          <div className="routing-subpanel-heading">
            <div>
              <Sparkles size={18} />
              <strong>{t('routingAiGenerator')}</strong>
            </div>
            <button type="button" onClick={() => setGeneratorOpen(false)} aria-label={t('close')}><X size={17} /></button>
          </div>
          <div className="routing-generator-grid">
            <label>{t('routingServiceName')}<input value={generator.serviceName} onChange={(event) => setGenerator({ ...generator, serviceName: event.target.value })} /></label>
            <label>{t('routingPrimaryDomain')}<input value={generator.domain} onChange={(event) => setGenerator({ ...generator, domain: event.target.value })} /></label>
            <label>{t('routingTargetWan')}
              <select value={generator.targetWan} onChange={(event) => setGenerator({ ...generator, targetWan: event.target.value })}>
                <option value="0">{primaryLabel}</option>
                <option value="1">{secondaryLabel}</option>
              </select>
            </label>
            <label>{t('dualWanSourceIp')}<input value={generator.source} onChange={(event) => setGenerator({ ...generator, source: event.target.value })} /></label>
            <label>{t('routingProtocol')}
              <select value={generator.protocol} onChange={(event) => setGenerator({ ...generator, protocol: event.target.value })}>
                <option value="all">{t('routingProtocolAll')}</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="tcp_udp">TCP + UDP</option>
              </select>
            </label>
            <label className="routing-wide-field">{t('routingAdditionalNotes')}<textarea rows={3} value={generator.notes} onChange={(event) => setGenerator({ ...generator, notes: event.target.value })} /></label>
          </div>
          <div className="routing-checkbox-row">
            <label><input type="checkbox" checked={generator.ipv4} onChange={(event) => setGenerator({ ...generator, ipv4: event.target.checked })} /> IPv4</label>
            <label><input type="checkbox" checked={generator.ipv6} onChange={(event) => setGenerator({ ...generator, ipv6: event.target.checked })} /> IPv6</label>
            <label><input type="checkbox" checked={generator.includeDependencies} onChange={(event) => setGenerator({ ...generator, includeDependencies: event.target.checked })} /> {t('routingIncludeDependencies')}</label>
          </div>
          <div className="routing-ai-provider-bar">
            <div>
              <strong>{t('routingAiProvider')}</strong>
              <span className={aiProvider.configured ? 'ok' : 'muted'}>
                {aiProvider.configured
                  ? t('routingAiConfigured').replace('{provider}', aiProvider.provider).replace('{model}', aiProvider.model)
                  : t('routingAiNotConfigured')}
              </span>
            </div>
            <button type="button" onClick={() => setAiConfigOpen((current) => !current)}>
              {aiConfigOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {t('routingAiSettings')}
            </button>
          </div>
          {aiConfigOpen ? (
            <div className="routing-ai-config">
              <label>{t('routingAiProvider')}
                <select value={aiProvider.provider} onChange={(event) => changeAiProvider(event.target.value)}>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openai_compatible">{t('routingAiOpenAiCompatible')}</option>
                  <option value="ollama">Ollama / lokalny LLM</option>
                </select>
              </label>
              <label>{t('routingAiModel')}<input value={aiProvider.model} onChange={(event) => setAiProvider({ ...aiProvider, model: event.target.value })} />
                <small className="field-hint">{aiModelSuggestion}</small>
              </label>
              <label>{t('routingAiEndpoint')}<input value={aiProvider.baseUrl} onChange={(event) => setAiProvider({ ...aiProvider, baseUrl: event.target.value })} /></label>
              {aiProvider.provider !== 'ollama' ? (
                <label>{t('routingAiApiKey')}<input type="password" value={aiProvider.apiKey} onChange={(event) => setAiProvider({ ...aiProvider, apiKey: event.target.value })} placeholder={aiProvider.configured ? t('routingAiKeySaved') : 'sk-…'} /></label>
              ) : null}
              <div className="routing-ai-security-note">{t('routingAiSecurityNote')}</div>
              <div className="button-row">
                <button type="button" className="routing-action primary" disabled={aiBusy} onClick={() => saveAiProvider(false)}><Save size={15} />{t('save')}</button>
                {aiProvider.configured && aiProvider.provider !== 'ollama' ? (
                  <button type="button" className="routing-action danger" disabled={aiBusy} onClick={() => saveAiProvider(true)}><Trash2 size={15} />{t('routingAiRemoveKey')}</button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="button-row">
            <button type="button" className="routing-action primary" onClick={generatePrompt}><Sparkles size={15} />{t('routingGeneratePrompt')}</button>
            <button type="button" className="routing-action primary" disabled={aiBusy} onClick={askConfiguredAi}><Sparkles size={15} />{aiProvider.configured ? t('routingAskAi') : t('routingConfigureAi')}</button>
            <button type="button" className="routing-action" onClick={() => setImportOpen(true)}><UploadCloud size={15} />{t('routingOpenAiImport')}</button>
          </div>
          {generatedPrompt ? (
            <div className="generated-prompt">
              <textarea rows={16} value={generatedPrompt} onChange={(event) => setGeneratedPrompt(event.target.value)} />
              <div className="button-row">
                <button type="button" className="routing-action" onClick={copyPrompt}>
                  {promptCopyStatus === 'success' ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
                  {promptCopyStatus === 'success'
                    ? t('routingPromptCopied')
                    : promptCopyStatus === 'error'
                      ? t('routingPromptCopyFailed')
                      : t('routingCopyPrompt')}
                </button>
                <button type="button" className="routing-action" onClick={() => setGeneratedPrompt('')}><Trash2 size={15} />{t('clear')}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {importOpen ? (
        <div className="routing-generator-panel">
          <div className="routing-subpanel-heading">
            <div><FileJson size={18} /><strong>{t('routingAiImport')}</strong></div>
            <button type="button" onClick={() => setImportOpen(false)} aria-label={t('close')}><X size={17} /></button>
          </div>
          <textarea rows={12} value={aiJson} onChange={(event) => { setAiJson(event.target.value); setValidation(null); }} placeholder='{"schemaVersion":"1.0", ...}' />
          <div className="button-row">
            <button type="button" className="routing-action" onClick={validateImport}><CheckCircle2 size={15} />{t('routingValidate')}</button>
            <button type="button" className="routing-action primary" disabled={!validation?.valid || !validation.rules.some((item) => item.readyToImport)} onClick={importValidated}><Plus size={15} />{t('routingImportNewGroup')}</button>
            <button type="button" className="routing-action" onClick={() => { setAiJson(''); setValidation(null); }}><Trash2 size={15} />{t('clear')}</button>
          </div>
          {validation ? (
            <div className={`routing-validation-report ${validation.valid ? 'ok' : 'error'}`}>
              <strong>{validation.valid ? t('routingValidationPassed') : t('routingValidationFailed')}</strong>
              {[...validation.errors, ...validation.warnings].map((reason) => <span key={reason}>{validationReason(reason, t)}</span>)}
              {validation.valid && validation.rules.length === 0 ? (
                <div className="routing-empty-ai-result">
                  <div>
                    <strong>{t('routingEmptyAiRulesTitle')}</strong>
                    <span>{t('routingEmptyAiRulesCopy')}</span>
                  </div>
                  <button type="button" className="routing-action" onClick={addAiWholeTrafficFallback}>
                    <Route size={15} />
                    {t('routingAddWholeSourceFallback')}
                  </button>
                </div>
              ) : null}
              <div className="routing-validation-rules">
                {validation.rules.map((item) => (
                  <div className={item.status} key={`${item.index}-${item.rule.destination}`}>
                    <code>{item.rule.destination || '—'}</code>
                    <strong>{t(`routingRuleStatus_${item.status}`)}</strong>
                    <small>{item.reasons.map((reason) => validationReason(reason, t)).join(' · ') || t('routingReadyToImport')}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="routing-group-toolbar">
        <label className="routing-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('routingSearchPlaceholder')} /></label>
        <label className="routing-filter"><Filter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">{t('all')}</option>
          <option value="wan0">{primaryLabel}</option>
          <option value="wan1">{secondaryLabel}</option>
          <option value="enabled">{t('enabled')}</option>
          <option value="disabled">{t('disabled')}</option>
          <option value="synced">{t('routingGroupStatus_synced')}</option>
          <option value="pending">{t('routingGroupStatus_pending')}</option>
          <option value="partial">{t('routingGroupStatus_partial')}</option>
        </select></label>
        <button type="button" onClick={() => setExpanded(Object.fromEntries(groups.map((group) => [group.id, true])))}><ChevronDown size={15} />{t('expandAll')}</button>
        <button type="button" onClick={() => setExpanded({})}><ChevronUp size={15} />{t('collapseAll')}</button>
      </div>

      <div className="routing-bulk-toolbar">
        <label><input type="checkbox" checked={groups.length > 0 && selected.size === groups.length} onChange={(event) => setSelected(event.target.checked ? new Set(groups.map((group) => group.id)) : new Set())} /> {t('selectAll')}</label>
        <span>{t('routingSelectedGroups').replace('{count}', String(selected.size))}</span>
        <select value={targetForSelected} onChange={(event) => setTargetForSelected(event.target.value)}>
          <option value="0">{primaryLabel}</option>
          <option value="1">{secondaryLabel}</option>
        </select>
        <button
          type="button"
          disabled={!selected.size || !wanChangeNeeded}
          title={selected.size && !wanChangeNeeded ? t('routingBulkAlreadySet') : ''}
          onClick={async () => {
            setBulkActionStatus('');
            if (await changeGroupsWan(selectedIds, targetForSelected)) setBulkActionStatus('wan');
          }}
        >
          <Route size={15} />{t('routingChangeWan')}
        </button>
        <select value={sourceForSelected} onChange={(event) => setSourceForSelected(event.target.value)}>
          <option value={lanSubnet || '192.168.1.0/24'}>{t('routingWholeLan')} — {lanSubnet || '192.168.1.0/24'}</option>
          {managedVpnProfiles.map((profile) => (
            <option value={profile.subnet} key={`bulk-${profile.interface}-${profile.subnet}`}>
              {vpnLabel(profile)} — {profile.subnet}
            </option>
          ))}
          {localClients.filter((client) => client?.ip).map((client) => (
            <option value={client.ip} key={`bulk-${client.ip}-${client.mac || ''}`}>
              {client.name || client.hostname || t('routingUnknownDevice')} — {client.ip}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected.size || !sourceChangeNeeded}
          title={selected.size && !sourceChangeNeeded ? t('routingBulkAlreadySet') : ''}
          onClick={async () => {
            setBulkActionStatus('');
            if (await changeGroupsSource(selectedIds, sourceForSelected)) setBulkActionStatus('source');
          }}
        >
          <Route size={15} />{t('routingChangeSource')}
        </button>
        <button type="button" disabled={!selected.size} onClick={() => downloadJson('dualwan-routing-groups.json', groups.filter((group) => selected.has(group.id)))}><Download size={15} />{t('exportJson')}</button>
        <button type="button" className="danger" disabled={!selected.size} onClick={() => removeGroups(selectedIds)}><Trash2 size={15} />{t('delete')}</button>
      </div>
      {bulkActionStatus ? (
        <div className="routing-bulk-feedback" role="status">
          <CheckCircle2 size={16} />
          <span>{bulkActionStatus === 'wan'
            ? t('routingBulkWanUpdated')
            : bulkActionStatus === 'source'
              ? t('routingBulkSourceUpdated')
              : t('routingGroupsRefreshed')}</span>
        </div>
      ) : null}

      {loading ? <p className="empty">{t('loading')}</p> : null}
      {!loading && !visibleGroups.length ? <p className="empty">{t('routingNoGroups')}</p> : null}
      <div className="routing-group-list">
        {visibleGroups.map((group) => {
          const sync = groupRouterStatus(group, routerRules);
          const isExpanded = expanded[group.id] === true;
          const sourceGroups = [...group.rules.reduce((result, rule) => {
            const source = String(rule.source || group.source || 'all');
            if (!result.has(source)) result.set(source, []);
            result.get(source).push(rule);
            return result;
          }, new Map()).entries()].map(([source, sourceRules]) => ({
            source,
            rules: sourceRules,
            wans: [...new Set(sourceRules.map((rule) => String(rule.targetWan)))],
          }));
          const sourceGroup = sourceGroups[0] || {
            source: group.source,
            rules: group.rules,
            wans: [...new Set(group.rules.map((rule) => String(rule.targetWan)))],
          };
          const displayedName = sourceDisplayLabel(sourceGroup.source);
          const recognizedPresets = serviceRoutingPresets.filter((preset) => (
            preset.verifiedDestinations?.every((destination) => (
              group.rules.some((rule) => rule.destination === destination)
            ))
          ));
          const groupWanLabel = sourceGroup.wans.length === 1
            ? (sourceGroup.wans[0] === '1' ? secondaryLabel : primaryLabel)
            : t('routingMixedWans');
          const renderRulesTable = (displayRules, tableKey) => (
            <div className="routing-group-rule-table" key={tableKey}>
              <div className="routing-group-rule-head">
                <span>{t('dualWanDestinationIp')}</span>
                <span>{t('routingTargetWan')}</span>
                <span>{t('state')}</span>
                <span>{t('actions')}</span>
              </div>
              {displayRules.map((rule) => {
                const onRouter = new Set(routerRules.map(dualWanRuleKey)).has(dualWanRuleKey(rule));
                return (
                  <div className="routing-group-rule-row" key={rule.id}>
                    <span data-label={t('dualWanDestinationIp')}>
                      <input
                        className="routing-rule-destination-input"
                        defaultValue={rule.destination}
                        aria-label={t('dualWanDestinationIp')}
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (!parseIpOrCidr(value)) {
                            event.target.value = rule.destination;
                            setError(t('routingValidation_invalid_destination'));
                            return;
                          }
                          changeRuleDestination(group.id, rule.id, value);
                        }}
                      />
                    </span>
                    <span data-label={t('routingTargetWan')}>
                      <select
                        className="routing-rule-wan-select"
                        value={String(rule.targetWan)}
                        aria-label={t('routingTargetWan')}
                        onChange={(event) => changeRuleWan(group.id, rule.id, event.target.value)}
                      >
                        <option value="0">{primaryLabel}</option>
                        <option value="1">{secondaryLabel}</option>
                      </select>
                    </span>
                    <span data-label={t('state')} className={onRouter ? 'ok' : 'warn'}>{onRouter ? t('routingGroupStatus_synced') : t('routingGroupStatus_pending')}</span>
                    <button type="button" onClick={() => removeRule(group.id, rule.id)} aria-label={t('delete')}><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
          );
          return (
            <article className={`routing-group-card ${sync}`} key={group.id}>
              <div className="routing-group-header">
                <input type="checkbox" checked={selected.has(group.id)} onChange={() => toggleSelected(group.id)} aria-label={t('select')} />
                <button type="button" className="routing-group-toggle" onClick={() => toggleExpanded(group.id)}>
                  <div>
                    <strong>{displayedName}</strong>
                    <span>
                      {recognizedPresets.length
                        ? recognizedPresets.map(presetDisplayName).join(' · ')
                        : group.primaryDomain
                          ? `${group.name} · ${group.primaryDomain}`
                          : t('routingWholeDeviceTraffic')}
                    </span>
                  </div>
                  <div className="routing-group-meta">
                    <span>{groupWanLabel}</span>
                    <span>{group.rules.length} {t('dualWanRoutes')}</span>
                    <span className={`sync-badge ${sync}`}>{statusLabel(sync, t)}</span>
                    <small>{new Date(group.updatedAt).toLocaleString()}</small>
                  </div>
                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                <details className="routing-group-menu">
                  <summary aria-label={t('actions')}>•••</summary>
                  <div>
                    <button type="button" onClick={() => changeGroupsWan([group.id], group.targetWan === '1' ? '0' : '1')}><Route size={14} />{t('routingChangeWan')}</button>
                    <button type="button" onClick={() => duplicateGroup(group)}><Copy size={14} />{t('duplicate')}</button>
                    <button type="button" onClick={() => downloadJson(`${group.name.replace(/[^a-z0-9_-]+/gi, '-')}.json`, group)}><Download size={14} />{t('exportJson')}</button>
                    <button type="button" className="danger" onClick={() => removeGroups([group.id])}><Trash2 size={14} />{t('delete')}</button>
                  </div>
                </details>
              </div>
              {isExpanded ? (
                <div className="routing-group-body">
                  <div className="routing-group-summary">
                    <label>
                      <span>{isVpnSource(sourceGroup.source) ? t('routingVpnSource') : t('routingDeviceSource')}</span>
                      <select value={sourceGroup.source} onChange={(event) => changeGroupsSource([group.id], event.target.value)}>
                        {renderSourceOptions(sourceGroup.source, `group-${group.id}`)}
                      </select>
                    </label>
                    <label>
                      <span>{t('routingWholeGroupWan')}</span>
                      <select value={sourceGroup.wans.length === 1 ? sourceGroup.wans[0] : ''} onChange={(event) => changeGroupsWan([group.id], event.target.value)}>
                        {sourceGroup.wans.length > 1 ? <option value="" disabled>{t('routingMixedWans')}</option> : null}
                        <option value="0">{primaryLabel}</option>
                        <option value="1">{secondaryLabel}</option>
                      </select>
                    </label>
                    <span>{t('routingProtocol')}: {group.protocol}</span>
                    <span>{t('router')}: {routerRuleCount} {t('dualWanRoutes')}</span>
                  </div>
                  {renderRulesTable(group.rules, `${group.id}-table`)}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="routing-draft-footer">
        <AlertTriangle size={18} />
        <div>
          <strong>{t('routingDraftOnlyTitle')}</strong>
          <span>{t('routingDraftOnlyCopy')}</span>
        </div>
        <button type="button" className="routing-action primary" disabled={busy === 'dualwan-apply'} onClick={onApply}>
          <Save size={15} />
          {t('dualWanApplyAsus')}
        </button>
      </div>
    </section>
  );
}
