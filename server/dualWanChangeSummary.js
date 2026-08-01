function normalizeWan(value) {
  return String(value) === '1' ? 'wan1' : 'wan0';
}

function normalizedRules(form = {}) {
  return (Array.isArray(form.rules) ? form.rules : []).map((rule) => ({
    source: String(rule.source || '').trim(),
    destination: String(rule.destination || '').trim(),
    wan: normalizeWan(rule.unit ?? rule.targetWan),
  })).filter((rule) => rule.source && rule.destination);
}

function wholeTrafficWan(rules, source) {
  const sourceRules = rules.filter((rule) => rule.source === source);
  const lowerHalfDestinations = new Set(['1.0.0.0/1', '0.0.0.0/1']);
  for (const wan of ['wan0', 'wan1']) {
    if (sourceRules.some((rule) => rule.wan === wan && lowerHalfDestinations.has(rule.destination))
      && sourceRules.some((rule) => rule.wan === wan && rule.destination === '128.0.0.0/1')) {
      return wan;
    }
  }
  return '';
}

function ruleKey(rule) {
  return `${rule.source}|${rule.destination}|${rule.wan}`;
}

export function summarizeDualWanChange(before = {}, after = {}) {
  const oldRules = normalizedRules(before);
  const newRules = normalizedRules(after);
  const sources = [...new Set([...oldRules, ...newRules].map((rule) => rule.source))];

  for (const source of sources) {
    const from = wholeTrafficWan(oldRules, source);
    const to = wholeTrafficWan(newRules, source);
    if (from && to && from !== to) {
      return { kind: 'wholeTrafficWan', source, from, to };
    }
  }

  for (const previous of oldRules) {
    const next = newRules.find((rule) => (
      rule.source === previous.source
      && rule.destination === previous.destination
      && rule.wan !== previous.wan
    ));
    if (next) {
      return {
        kind: 'ruleWan',
        source: previous.source,
        destination: previous.destination,
        from: previous.wan,
        to: next.wan,
      };
    }
  }

  const oldKeys = new Set(oldRules.map(ruleKey));
  const newKeys = new Set(newRules.map(ruleKey));
  const removed = oldRules.filter((rule) => !newKeys.has(ruleKey(rule)));
  const added = newRules.filter((rule) => !oldKeys.has(ruleKey(rule)));
  const replacedDestination = removed.find((previous) => added.some((next) => (
    next.source === previous.source && next.wan === previous.wan
  )));
  if (replacedDestination) {
    const next = added.find((rule) => (
      rule.source === replacedDestination.source && rule.wan === replacedDestination.wan
    ));
    return {
      kind: 'destination',
      source: replacedDestination.source,
      from: replacedDestination.destination,
      to: next.destination,
      wan: next.wan,
    };
  }

  if (String(before.mode || '') !== String(after.mode || '')) {
    return { kind: 'mode', from: String(before.mode || ''), to: String(after.mode || '') };
  }
  if (added.length || removed.length) {
    return {
      kind: 'ruleCount',
      added: added.length,
      removed: removed.length,
      source: added[0]?.source || removed[0]?.source || '',
    };
  }
  const beforeRatio = `${before.ratioPrimary || 1}:${before.ratioSecondary || 1}`;
  const afterRatio = `${after.ratioPrimary || 1}:${after.ratioSecondary || 1}`;
  if (beforeRatio !== afterRatio) {
    return { kind: 'ratio', from: beforeRatio, to: afterRatio };
  }
  return { kind: 'configuration' };
}
