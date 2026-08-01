export const vpnProfiles = [
  {
    id: 'preferred_failover',
    policyMode: 'prefer_wan_with_failover',
    allowRouter: true,
    allowLan: true,
    allowInternet: true,
    natEnabled: true,
  },
  {
    id: 'force_primary',
    policyMode: 'force_wan',
    preferredRole: 'primary',
    allowRouter: true,
    allowLan: true,
    allowInternet: true,
    natEnabled: true,
  },
  {
    id: 'force_failover',
    policyMode: 'force_wan',
    preferredRole: 'failover',
    allowRouter: true,
    allowLan: true,
    allowInternet: true,
    natEnabled: true,
  },
  {
    id: 'native_balance',
    policyMode: 'balanced',
    allowRouter: true,
    allowLan: true,
    allowInternet: true,
    natEnabled: true,
  },
  {
    id: 'lan_only',
    policyMode: 'lan_only',
    allowRouter: true,
    allowLan: true,
    allowInternet: false,
    natEnabled: false,
  },
];

export function applyVpnProfile(config, profileId) {
  const profile = vpnProfiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`Unknown VPN profile: ${profileId}`);
  }
  let preferredWan = config.vpnPreferredWan || config.primaryWan || 'wan0';
  if (profile.preferredRole === 'primary') preferredWan = config.primaryWan || 'wan0';
  if (profile.preferredRole === 'failover') preferredWan = config.failoverWan || 'wan1';
  return {
    ...config,
    vpnManagementEnabled: true,
    vpnPolicyMode: profile.policyMode,
    vpnPreferredWan: preferredWan,
    vpnAllowRouter: profile.allowRouter,
    vpnAllowLan: profile.allowLan,
    vpnAllowInternet: profile.allowInternet,
    vpnNatEnabled: profile.natEnabled,
  };
}
