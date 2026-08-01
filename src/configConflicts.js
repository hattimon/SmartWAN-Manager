function oppositeWan(wan) {
  return wan === 'wan0' ? 'wan1' : 'wan0';
}

function oppositeDualWanUnit(unit) {
  if (unit === 'wan') return 'lan';
  if (unit === 'lan') return 'wan';
  return 'wan';
}

export function resolveSmartWanPatch(current, patch) {
  const next = { ...current, ...patch };
  const messages = [];

  if (patch.orchestrationEnabled === true) {
    Object.assign(next, {
      enabled: true,
      orchestrationMode: 'dualwan_balanced_managed',
      routingMode: 'primary_failover',
      manageMainDefault: false,
      watchdogEnabled: true,
      failoverAction: 'runtime_policy_override',
      suspendAsusRulesOnFailover: true,
      restoreAsusRulesOnRecovery: true,
      domainRulesEnabled: false,
    });
    messages.push('conflictOrchestrationRequirements');
  }

  if (patch.enabled === false && current.orchestrationEnabled) {
    next.orchestrationEnabled = false;
    next.orchestrationMode = 'observe_only';
    messages.push('conflictOrchestrationDisabledWithSmartWan');
  }

  if (next.orchestrationEnabled) {
    if (!next.enabled || !next.watchdogEnabled || next.orchestrationMode !== 'dualwan_balanced_managed') {
      next.enabled = true;
      next.watchdogEnabled = true;
      next.orchestrationMode = 'dualwan_balanced_managed';
      messages.push('conflictOrchestrationRequirements');
    }
    if (next.manageMainDefault) {
      next.manageMainDefault = false;
      messages.push('conflictMainDefaultOwnership');
    }
    if (next.routingMode !== 'primary_failover') {
      next.routingMode = 'primary_failover';
      messages.push('conflictOrchestrationRoutingMode');
    }
    if (next.failoverAction !== 'runtime_policy_override') {
      next.failoverAction = 'runtime_policy_override';
      messages.push('conflictFailoverAction');
    }
    if (!next.suspendAsusRulesOnFailover) {
      next.suspendAsusRulesOnFailover = true;
      messages.push('conflictFailoverOverrideRequired');
    }
    if (!next.restoreAsusRulesOnRecovery) {
      next.restoreAsusRulesOnRecovery = true;
      messages.push('conflictRecoveryRestoreRequired');
    }
    if (patch.watchdogEnabled === false) {
      next.watchdogEnabled = true;
      messages.push('conflictWatchdogRequired');
    }
    if (patch.manageMainDefault === true) {
      next.manageMainDefault = false;
      messages.push('conflictMainDefaultOwnership');
    }
    if (patch.routingMode && patch.routingMode !== 'primary_failover') {
      next.routingMode = 'primary_failover';
      messages.push('conflictOrchestrationRoutingMode');
    }
    if (patch.failoverAction && patch.failoverAction !== 'runtime_policy_override') {
      next.failoverAction = 'runtime_policy_override';
      messages.push('conflictFailoverAction');
    }
    if (patch.suspendAsusRulesOnFailover === false) {
      next.suspendAsusRulesOnFailover = true;
      messages.push('conflictFailoverOverrideRequired');
    }
    if (patch.restoreAsusRulesOnRecovery === false) {
      next.restoreAsusRulesOnRecovery = true;
      messages.push('conflictRecoveryRestoreRequired');
    }
  }

  if (next.primaryWan === next.failoverWan) {
    if (Object.hasOwn(patch, 'primaryWan')) {
      next.failoverWan = oppositeWan(next.primaryWan);
    } else {
      next.primaryWan = oppositeWan(next.failoverWan);
    }
    messages.push('conflictSameWan');
  }

  return { config: next, messages: [...new Set(messages)] };
}

export function resolveDualWanPatch(current, patch) {
  const next = { ...current, ...patch };
  const messages = [];

  if (patch.enabled === false && next.routingEnabled) {
    next.routingEnabled = false;
    messages.push('conflictDualWanDisabledRules');
  }

  if (patch.mode === 'fo' && next.routingEnabled) {
    next.routingEnabled = false;
    messages.push('conflictDualWanFailoverRules');
  }

  if (patch.routingEnabled === true && next.mode === 'fo') {
    next.mode = 'lb';
    messages.push('conflictRulesRequireLoadBalance');
  }

  if (next.primary === next.secondary && next.primary !== 'none') {
    if (Object.hasOwn(patch, 'primary')) {
      next.secondary = oppositeDualWanUnit(next.primary);
    } else {
      next.primary = oppositeDualWanUnit(next.secondary);
    }
    messages.push('conflictDualWanSamePort');
  }

  return { config: next, messages: [...new Set(messages)] };
}

export function resolveVpnPatch(current, patch) {
  const next = { ...current, ...patch };
  const messages = [];

  if (patch.vpnAllowInternet === false && next.vpnNatEnabled) {
    next.vpnNatEnabled = false;
    messages.push('conflictVpnNatDisabled');
  }

  if (patch.vpnNatEnabled === true && !next.vpnAllowInternet) {
    next.vpnAllowInternet = true;
    messages.push('conflictVpnInternetEnabled');
  }

  if (next.vpnPolicyMode === 'lan_only') {
    next.vpnAllowInternet = false;
    next.vpnNatEnabled = false;
  }

  return { config: next, messages: [...new Set(messages)] };
}

export function smartWanConflictMessages(config, dualWanForm) {
  const messages = [];
  if (
    config.orchestrationEnabled
    && (
      !config.enabled
      || !config.watchdogEnabled
      || config.manageMainDefault
      || config.routingMode !== 'primary_failover'
      || config.failoverAction !== 'runtime_policy_override'
      || !config.suspendAsusRulesOnFailover
      || !config.restoreAsusRulesOnRecovery
    )
  ) {
    messages.push('conflictOrchestrationRequirements');
  }
  if (
    config.orchestrationEnabled
    && (String(config.serviceRules || '').trim() || String(config.hostRules || '').trim())
  ) {
    messages.push('conflictNormalRuleOwner');
  }
  if (config.testMode && config.enabled) {
    messages.push('conflictTestModeNoApply');
  }
  if (config.orchestrationEnabled && dualWanForm?.mode === 'fo') {
    messages.push('conflictNativeFailoverWithOrchestrator');
  }
  return messages;
}

export function vpnConflictMessages(config) {
  if (config.orchestrationEnabled && config.vpnPolicyMode === 'force_wan') {
    return ['conflictVpnForceWan'];
  }
  return [];
}

export function syncConfigWithDetectedWans(current, wanStatus = []) {
  if (current.autoDiscoverWans === false || wanStatus.length < 2) return current;

  const currentLabel = (wan) => String(current[`${wan}Label`] || '').trim().toLowerCase();
  const detectedById = Object.fromEntries(wanStatus.map((wan) => [wan.id, wan]));
  const detectedByLabel = new Map(
    wanStatus
      .filter((wan) => wan.label)
      .map((wan) => [String(wan.label).trim().toLowerCase(), wan.id]),
  );
  const semanticWan = (wan) => detectedByLabel.get(currentLabel(wan)) || wan;
  const nextPrimary = semanticWan(current.primaryWan || 'wan0');
  let nextFailover = semanticWan(current.failoverWan || 'wan1');
  if (nextPrimary === nextFailover) nextFailover = oppositeWan(nextPrimary);
  const nextVpnPreferred = semanticWan(current.vpnPreferredWan || current.primaryWan || 'wan0');

  const next = {
    ...current,
    primaryWan: nextPrimary,
    failoverWan: nextFailover,
    vpnPreferredWan: nextVpnPreferred,
  };

  for (const id of ['wan0', 'wan1']) {
    const detected = detectedById[id];
    if (!detected) continue;
    next[`${id}Label`] = detected.label || next[`${id}Label`];
    next[`${id}Ifname`] = detected.ifname || next[`${id}Ifname`];
    next[`${id}Gateway`] = detected.gateway || next[`${id}Gateway`];
    next[`${id}Table`] = detected.table || id;
  }
  return next;
}
