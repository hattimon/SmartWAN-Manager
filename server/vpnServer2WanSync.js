export const VPN_SERVER_SUBNETS = {
  1: '10.8.0.0/24',
  2: '10.16.0.0/24',
};
export const VPN_SERVER2_SUBNET = VPN_SERVER_SUBNETS[2];

const WHOLE_IPV4_DESTINATIONS = new Set([
  '0.0.0.0/1',
  '1.0.0.0/1',
  '128.0.0.0/1',
]);

function normalizeWan(value) {
  const wan = String(value || '').toLowerCase();
  if (wan === 'wan0' || wan === '0') return 'wan0';
  if (wan === 'wan1' || wan === '1') return 'wan1';
  return '';
}

function selectedSubnet(serverUnit, serverSubnet) {
  return String(serverSubnet || VPN_SERVER_SUBNETS[serverUnit] || '').trim();
}

function isServerWholeTrafficRule(rule = {}, serverUnit = 2, serverSubnet = '') {
  return String(rule.source || '').trim() === selectedSubnet(serverUnit, serverSubnet)
    && WHOLE_IPV4_DESTINATIONS.has(String(rule.destination || '').trim());
}

export function inferServerWanFromRules(rules = [], serverUnit = 2, serverSubnet = '') {
  const matching = rules.filter((rule) => isServerWholeTrafficRule(rule, serverUnit, serverSubnet));
  if (!matching.length) return '';
  const units = new Set(matching.map((rule) => normalizeWan(rule.unit)).filter(Boolean));
  if (units.size !== 1) return '';
  return [...units][0];
}

export function setServerWanInDualWanForm(input = {}, preferredWan, serverUnit = 2, serverSubnet = '') {
  const wan = normalizeWan(preferredWan);
  if (!wan) throw new Error(`VPN Server ${serverUnit} WAN must be WAN0 or WAN1.`);
  const subnet = selectedSubnet(serverUnit, serverSubnet);
  if (!subnet) throw new Error('VPN server must be 1 or 2.');
  const unit = wan === 'wan1' ? '1' : '0';
  const rules = Array.isArray(input.rules) ? input.rules.map((rule) => ({ ...rule })) : [];
  let changed = false;
  let matched = false;
  for (const rule of rules) {
    if (!isServerWholeTrafficRule(rule, serverUnit, subnet)) continue;
    matched = true;
    if (String(rule.unit) !== unit) {
      rule.unit = unit;
      changed = true;
    }
  }
  if (!matched) {
    rules.push(
      { source: subnet, destination: '1.0.0.0/1', unit },
      { source: subnet, destination: '128.0.0.0/1', unit },
    );
    changed = true;
  }
  return {
    changed,
    form: {
      ...input,
      routingEnabled: true,
      rules,
    },
  };
}

export function setServerWanInSmartwanForm(input = {}, preferredWan, serverUnit = 2) {
  const wan = normalizeWan(preferredWan);
  if (!wan) throw new Error(`VPN Server ${serverUnit} WAN must be WAN0 or WAN1.`);
  if (serverUnit === 1) {
    return {
      changed: normalizeWan(input.vpnPreferredWan) !== wan,
      form: { ...input, vpnPreferredWan: wan },
    };
  }
  if (serverUnit !== 2) throw new Error('VPN server must be 1 or 2.');
  const profiles = String(input.vpnAdditionalProfiles || '')
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const detectedIndex = profiles.findIndex((entry) => (
    entry.startsWith('tun22|') || entry.split('|')[1] === VPN_SERVER2_SUBNET
  ));
  const index = detectedIndex >= 0 ? detectedIndex : profiles.length ? 0 : -1;
  const current = (index >= 0 ? profiles[index] : 'tun22|10.16.0.0/24|wan0').split('|');
  const serialized = `${current[0] || 'tun22'}|${current[1] || VPN_SERVER2_SUBNET}|${wan}`;
  const changed = index < 0 || profiles[index] !== serialized;
  if (index >= 0) profiles[index] = serialized;
  else profiles.push(serialized);
  return {
    changed,
    form: {
      ...input,
      vpnAdditionalProfiles: profiles.join('\n'),
    },
  };
}

export function inferServerWanFromSmartwanForm(input = {}, serverUnit = 2) {
  if (serverUnit === 1) return normalizeWan(input.vpnPreferredWan);
  if (serverUnit !== 2) return '';
  const profiles = String(input.vpnAdditionalProfiles || '')
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const profile = profiles.find((entry) => (
    entry.startsWith('tun22|') || entry.split('|')[1] === VPN_SERVER2_SUBNET
  )) || profiles[0];
  return normalizeWan(profile?.split('|')?.[2]);
}

export function inferServerSubnetFromSmartwanForm(input = {}, serverUnit = 2) {
  if (serverUnit === 1) return selectedSubnet(1, input.vpnSubnet);
  if (serverUnit !== 2) return '';
  const profiles = String(input.vpnAdditionalProfiles || '')
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const profile = profiles.find((entry) => (
    entry.startsWith('tun22|') || entry.split('|')[1] === VPN_SERVER2_SUBNET
  )) || profiles[0];
  return selectedSubnet(2, profile?.split('|')?.[1]);
}

export const inferServer2WanFromRules = (rules = []) => inferServerWanFromRules(rules, 2);
export const setServer2WanInDualWanForm = (input = {}, preferredWan) => (
  setServerWanInDualWanForm(input, preferredWan, 2)
);
export const setServer2WanInSmartwanForm = (input = {}, preferredWan) => (
  setServerWanInSmartwanForm(input, preferredWan, 2)
);
export const inferServer2WanFromSmartwanForm = (input = {}) => (
  inferServerWanFromSmartwanForm(input, 2)
);
