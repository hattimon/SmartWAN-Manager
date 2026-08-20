import { parseAsusRuleList } from './dualWanOps.js';

function online(wan) {
  return ['ok', 'reachable'].includes(String(wan?.internetStatus || '').toLowerCase());
}

function limited(wan) {
  return String(wan?.internetStatus || '').toLowerCase() === 'limited';
}

function usable(wan) {
  return online(wan) || limited(wan);
}

function wanName(wan = {}) {
  const label = wan.label || wan.id?.toUpperCase() || 'WAN';
  const port = wan.asusPort || wan.id?.toUpperCase() || 'WAN';
  return `${label} / ${port}`;
}

function parseRules(value = '') {
  return String(value)
    .split(/[;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [match, wan] = item.split('=').map((part) => part?.trim());
      return { match, wan };
    })
    .filter((item) => item.match && item.wan);
}

function clientRuleForIp(state, clientIp) {
  const hostRules = parseRules(state?.config?.values?.host_rules);
  const direct = hostRules.find((rule) => rule.match === clientIp || rule.match === `${clientIp}/32`);
  if (direct) return direct;
  const routeLine = String(state?.routes || '')
    .split(/\r?\n/)
    .find((line) => line.includes(`from ${clientIp}`));
  if (!routeLine) return null;
  const wan = (state?.wanStatus || []).find((item) => (
    routeLine.includes(`lookup ${item.id}`)
    || (item.table && routeLine.includes(`lookup ${item.table}`))
  ));
  return wan ? { match: clientIp, wan: wan.id } : null;
}

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

function sourceSpecificity(source, clientIp) {
  const client = ipv4ToNumber(clientIp);
  const [address, prefixText = '32'] = String(source || '').split('/');
  const network = ipv4ToNumber(address);
  const prefix = Number(prefixText);
  if (client === null || network === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return -1;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (client & mask) === (network & mask) ? prefix : -1;
}

function asusFullTrafficRuleForIp(state, clientIp) {
  const rules = parseAsusRuleList(state?.dualWan?.raw?.wans_routing_rulelist || '');
  const matching = rules
    .map((rule) => ({ ...rule, specificity: sourceSpecificity(rule.source, clientIp) }))
    .filter((rule) => rule.specificity >= 0);
  if (!matching.length) return null;
  const mostSpecific = Math.max(...matching.map((rule) => rule.specificity));
  const relevant = matching.filter((rule) => rule.specificity === mostSpecific);
  const lowerHalfDestinations = new Set(['1.0.0.0/1', '0.0.0.0/1']);
  const completeUnits = ['0', '1'].filter((unit) => (
    relevant.some((rule) => rule.unit === unit && lowerHalfDestinations.has(rule.destination))
    && relevant.some((rule) => rule.unit === unit && rule.destination === '128.0.0.0/1')
  ));
  if (completeUnits.length !== 1) return null;
  return {
    match: relevant[0].source,
    wan: `wan${completeUnits[0]}`,
    source: 'asus-dualwan-full-traffic',
  };
}

function smartWanFailoverConfigured(state) {
  const status = state?.status || {};
  const config = state?.config?.values || {};
  return String(status.enabled ?? config.enabled ?? '0') === '1'
    && String(config.orchestration_enabled ?? status.orchestration_enabled ?? '1') !== '0';
}

function currentProfile(state) {
  const status = state?.status || {};
  const dualWan = state?.dualWan || {};
  if (status.failover_override_active === '1') return 'SmartWAN Failover';
  if (dualWan.enabled && dualWan.mode === 'lb' && smartWanFailoverConfigured(state)) {
    return 'Dual WAN — Load Balance + SmartWAN Failover';
  }
  if (dualWan.enabled && dualWan.mode === 'lb') return 'Dual WAN — Load Balance';
  if (dualWan.enabled) return 'Dual WAN — Failover';
  if (status.active_preset) return status.active_preset;
  return status.enabled === '1' ? 'SmartWAN' : 'Router default';
}

export function applyActiveOutages(state, activeOutages = []) {
  if (!state || !Array.isArray(activeOutages) || activeOutages.length === 0) return state;

  const outageByWan = new Map(
    activeOutages
      .filter((outage) => outage?.wanId)
      .map((outage) => [outage.wanId, outage]),
  );
  if (outageByWan.size === 0) return state;

  let wanStatus = (state.wanStatus || []).map((wan) => {
    const outage = outageByWan.get(wan.id);
    if (!outage) return wan;
    return {
      ...wan,
      internetStatus: outage.outageKind === 'partial' ? 'limited' : 'failed',
      outageKind: outage.outageKind || wan.outageKind || '',
      failureReason: outage.failureReason || wan.failureReason || '',
      failureDetail: outage.failureDetail || wan.failureDetail || '',
      internetSource: 'router-event-journal',
    };
  });
  const watchdogActiveWan = activeOutages
    .map((outage) => outage?.activeWan)
    .find((wanId) => (
      wanId
      && !outageByWan.has(wanId)
      && state?.status?.watchdog_state_last_switch_reason === `${failedWanFromOutages(activeOutages)}_failed_${wanId}_ok`
    ));
  if (watchdogActiveWan && !wanStatus.some((wan) => wan.id === watchdogActiveWan && usable(wan))) {
    // A per-WAN diagnostic may become inconclusive after the global override
    // is installed. The watchdog decision still proves which WAN accepted the
    // emergency route, so expose it as limited rather than claiming both links
    // are completely offline.
    wanStatus = wanStatus.map((wan) => (
      wan.id === watchdogActiveWan
        ? {
            ...wan,
            internetStatus: 'limited',
            outageKind: wan.outageKind || 'partial',
            failureReason: wan.failureReason || 'service_quorum_failed',
            internetSource: 'watchdog-active-fallback',
          }
        : wan
    ));
  }
  const usableWans = wanStatus.filter((wan) => usable(wan));
  const eventActiveWan = activeOutages
    .map((outage) => outage?.activeWan)
    .find((wanId) => usableWans.some((wan) => wan.id === wanId));
  const activeWan = eventActiveWan
    || usableWans.find((wan) => wan.id === state?.status?.active_default_wan)?.id
    || usableWans[0]?.id
    || '';
  const latestOutage = [...activeOutages]
    .filter((outage) => outage?.startedAt)
    .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt))[0];
  const failedWan = outageByWan.size === 1
    ? outageByWan.keys().next().value
    : state?.status?.watchdog_state_failed_wan || '';

  return {
    ...state,
    wanStatus,
    status: {
      ...(state.status || {}),
      failover_override_active: '1',
      active_default_wan: activeWan,
      watchdog_state_failed_wan: failedWan,
      watchdog_state_last_failover_at:
        latestOutage?.startedAt || state?.status?.watchdog_state_last_failover_at || '',
      watchdog_state_failure_kind:
        latestOutage?.outageKind || state?.status?.watchdog_state_failure_kind || '',
      watchdog_state_failure_reason:
        latestOutage?.failureReason || state?.status?.watchdog_state_failure_reason || '',
      watchdog_state_failure_detail:
        latestOutage?.failureDetail || state?.status?.watchdog_state_failure_detail || '',
    },
  };
}

function failedWanFromOutages(activeOutages = []) {
  return activeOutages.find((outage) => outage?.wanId)?.wanId || '';
}

export function buildViewerRouting(state, clientIp) {
  const clients = state?.clients || [];
  const client = clients.find((item) => item.ip === clientIp) || {};
  const wanStatus = state?.wanStatus || [];
  const status = state?.status || {};
  const dualWan = state?.dualWan || {};
  const failoverActive = status.failover_override_active === '1';
  const usableWans = wanStatus.filter((wan) => usable(wan));
  const noInternet = wanStatus.length > 0 && usableWans.length === 0;
  const activeWan = usableWans.find((wan) => wan.id === status.active_default_wan)
    || usableWans[0]
    || {};
  const explicitRule = asusFullTrafficRuleForIp(state, clientIp) || clientRuleForIp(state, clientIp);
  const ruleWan = explicitRule ? wanStatus.find((wan) => wan.id === explicitRule.wan) : null;
  const failoverConfigured = smartWanFailoverConfigured(state);
  const serviceRules = parseRules(state?.config?.values?.service_rules);
  const domainRules = parseRules(state?.config?.values?.domain_rules);

  let routingMode = 'default';
  let description = `Your device uses ${currentProfile(state)}.`;
  if (noInternet) {
    routingMode = 'offline';
    description = 'Neither WAN currently has Internet access. Emergency routing is waiting for either connection to recover.';
  } else if (failoverActive) {
    routingMode = 'failover';
    description = `Emergency routing is active. Available traffic is currently sent through ${wanName(activeWan)} until the failed connection is stable again.`;
  } else if (ruleWan) {
    routingMode = 'pinned';
    description = failoverConfigured
      ? `All traffic from your device is routed through ${wanName(ruleWan)}. SmartWAN monitors both links and can temporarily move it to the available WAN after a confirmed failure.`
      : `All traffic from your device is routed through ${wanName(ruleWan)}. Managed SmartWAN failover is not enabled.`;
  } else if (dualWan.enabled && dualWan.mode === 'lb') {
    routingMode = 'balanced';
    description = `Your device uses the Dual WAN load-balancing profile. Traffic is shared between the available connections and automatically redirected if one WAN fails.`;
  }
  if (!failoverActive && (serviceRules.length || domainRules.length)) {
    description += ' Selected services and domains use dedicated policy routes.';
  }

  return {
    ip: clientIp,
    name: client.name || client.hostname || '',
    mac: client.mac || '',
    connectionType: client.connectionType || '',
    profile: currentProfile(state),
    routingMode,
    failoverConfigured,
    routingRuleSource: explicitRule?.source || '',
    assignedWan: noInternet ? '' : failoverActive ? activeWan?.id || '' : ruleWan?.id || activeWan?.id || '',
    assignedWanLabel: noInternet
      ? ''
      : failoverActive
        ? activeWan?.id
          ? wanName(activeWan)
          : ''
        : ruleWan
        ? wanName(ruleWan)
        : activeWan?.id
          ? wanName(activeWan)
          : '',
    description,
    limited: limited(activeWan),
    routeCount: Number(dualWan.ruleCount || 0),
    serviceRuleCount: serviceRules.length,
    domainRuleCount: domainRules.length,
  };
}

export function buildRoutingSummary(state) {
  const status = state?.status || {};
  const dualWan = state?.dualWan || {};
  const failoverActive = status.failover_override_active === '1';
  const failedWan = status.watchdog_state_failed_wan
    || String(status.watchdog_state_last_switch_reason || '').match(/^(wan[01])_failed_wan[01]_ok$/)?.[1]
    || '';
  const recoveryPending = failoverActive
    && status.watchdog_state_last_switch_reason === 'all_wans_recovering';
  const partialFailedWan = status.watchdog_state_failure_kind === 'partial';
  const wanStatus = (state?.wanStatus || []).map((wan) => {
    const forcedStatus = failoverActive && failedWan === wan.id && !recoveryPending
      ? (partialFailedWan ? 'limited' : 'failed')
      : wan.internetStatus || 'unknown';
    return {
      id: wan.id,
      label: wanName(wan),
      operator: wan.label || '',
      port: wan.asusPort || '',
      online: ['ok', 'reachable'].includes(String(forcedStatus).toLowerCase()),
      limited: String(forcedStatus).toLowerCase() === 'limited',
      usable: ['ok', 'reachable', 'limited'].includes(String(forcedStatus).toLowerCase()),
      internetStatus: forcedStatus,
      outageKind: wan.outageKind || (failedWan === wan.id ? status.watchdog_state_failure_kind : '') || '',
      failureReason: wan.failureReason || (failedWan === wan.id ? status.watchdog_state_failure_reason : '') || '',
      failureDetail: wan.failureDetail || (failedWan === wan.id ? status.watchdog_state_failure_detail : '') || '',
    };
  });
  const activeWan = wanStatus.find((wan) => wan.id === status.active_default_wan && wan.usable)
    || wanStatus.find((wan) => wan.usable);
  const allWansDown = wanStatus.length > 0 && wanStatus.every((wan) => !wan.usable);
  return {
    profile: currentProfile(state),
    dualWanEnabled: Boolean(dualWan.enabled),
    dualWanMode: dualWan.mode || '',
    ratio: dualWan.ratio || '',
    routeCount: Number(dualWan.ruleCount || 0),
    failoverActive,
    failedWan,
    recoveryPending:
      failoverActive
      && wanStatus.length > 0
      && wanStatus.every((wan) => wan.online),
    failoverSince: status.watchdog_state_last_failover_at || '',
    outageKind: status.watchdog_state_failure_kind || '',
    failureReason: status.watchdog_state_failure_reason || '',
    failureDetail: status.watchdog_state_failure_detail || '',
    allWansDown,
    recoveryAt: status.watchdog_state_last_recovery_at || '',
    activeWan: activeWan?.id || '',
    activeWanLabel: activeWan?.label || '',
    wanStatus,
  };
}
