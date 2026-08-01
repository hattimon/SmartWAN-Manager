export const openVpnDnsPresets = {
  cloudflare: ['1.1.1.1', '1.0.0.1'],
  google: ['8.8.8.8', '8.8.4.4'],
  custom: [],
};

export const defaultOpenVpnTemplate = `# Import or paste the complete ASUS OpenVPN client profile below.
client
dev tun
proto udp
remote 192.168.1.1 1194
resolv-retry infinite
nobind
float
keepalive 15 60
auth-user-pass
remote-cert-tls server
`;

function cleanSingleLine(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function removeEditorManagedLines(lines) {
  const result = [];
  let insideInlineAuth = false;

  for (const line of lines) {
    if (/^\s*<auth-user-pass>\s*$/i.test(line)) {
      insideInlineAuth = true;
      continue;
    }
    if (insideInlineAuth) {
      if (/^\s*<\/auth-user-pass>\s*$/i.test(line)) insideInlineAuth = false;
      continue;
    }
    if (/^\s*auth-user-pass(?:\s+\S+)?\s*$/i.test(line)) continue;
    if (/^\s*pull-filter\s+ignore\s+["']?dhcp-option DNS["']?\s*$/i.test(line)) continue;
    if (/^\s*dhcp-option\s+DNS\s+\S+\s*$/i.test(line)) continue;
    result.push(line);
  }

  return result;
}

export function buildOpenVpnProfile({
  source,
  server,
  port = '1194',
  protocol = 'udp',
  dnsServers = openVpnDnsPresets.cloudflare,
  username = '',
  password = '',
  embedCredentials = false,
  authenticationMode,
}) {
  const normalizedServer = cleanSingleLine(server);
  const normalizedPort = cleanSingleLine(port) || '1194';
  const normalizedProtocol = cleanSingleLine(protocol).toLowerCase() === 'tcp' ? 'tcp' : 'udp';
  const normalizedUsername = cleanSingleLine(username);
  const normalizedPassword = cleanSingleLine(password);
  const normalizedDns = (dnsServers || []).map(cleanSingleLine).filter(Boolean);

  if (!normalizedServer) throw new Error('VPN server address is required.');
  if (!/^\d{1,5}$/.test(normalizedPort) || Number(normalizedPort) < 1 || Number(normalizedPort) > 65535) {
    throw new Error('VPN port must be between 1 and 65535.');
  }
  if (!String(source || '').trim()) throw new Error('OpenVPN profile content is required.');
  const resolvedAuthenticationMode = ['none', 'prompt', 'embedded'].includes(authenticationMode)
    ? authenticationMode
    : embedCredentials ? 'embedded' : 'prompt';
  if (resolvedAuthenticationMode === 'embedded' && (!normalizedUsername || !normalizedPassword)) {
    throw new Error('Username and password are required when credentials are embedded.');
  }

  const newline = String(source).includes('\r\n') ? '\r\n' : '\n';
  let lines = removeEditorManagedLines(String(source).split(/\r?\n/));

  const protoIndex = lines.findIndex((line) => /^\s*proto\s+\S+/i.test(line));
  if (protoIndex >= 0) lines[protoIndex] = `proto ${normalizedProtocol}`;
  else lines.splice(Math.max(0, lines.findIndex((line) => /^\s*dev\s+/i.test(line)) + 1), 0, `proto ${normalizedProtocol}`);

  const remoteIndex = lines.findIndex((line) => /^\s*remote\s+\S+/i.test(line));
  const remoteDirective = `remote ${normalizedServer} ${normalizedPort}`;
  if (remoteIndex >= 0) lines[remoteIndex] = remoteDirective;
  else lines.splice(protoIndex >= 0 ? protoIndex + 1 : 0, 0, remoteDirective);

  const currentProtoIndex = lines.findIndex((line) => /^\s*proto\s+\S+/i.test(line));
  const dnsDirectives = normalizedDns.length
    ? ['pull-filter ignore "dhcp-option DNS"', ...normalizedDns.map((address) => `dhcp-option DNS ${address}`)]
    : [];
  lines.splice(currentProtoIndex + 1, 0, ...dnsDirectives);

  const authIndex = lines.findIndex((line) => /^\s*remote-cert-tls\s+/i.test(line));
  const authDirectives = resolvedAuthenticationMode === 'embedded'
    ? ['<auth-user-pass>', normalizedUsername, normalizedPassword, '</auth-user-pass>']
    : resolvedAuthenticationMode === 'prompt' ? ['auth-user-pass'] : [];
  if (authDirectives.length) {
    lines.splice(authIndex >= 0 ? authIndex : lines.length, 0, ...authDirectives);
  }

  return lines.join(newline);
}

export function readOpenVpnProfileDefaults(source) {
  const content = String(source || '');
  const remote = content.match(/^\s*remote\s+(\S+)(?:\s+(\d+))?/im);
  const protocol = content.match(/^\s*proto\s+(\S+)/im);
  const dnsServers = [...content.matchAll(/^\s*dhcp-option\s+DNS\s+(\S+)\s*$/gim)]
    .map((match) => match[1]);
  const inlineAuth = content.match(
    /<auth-user-pass>\s*\r?\n([^\r\n]+)\r?\n([^\r\n]+)\r?\n\s*<\/auth-user-pass>/i,
  );
  const promptAuth = /^\s*auth-user-pass(?:\s+\S+)?\s*$/im.test(content);
  const authenticationMode = inlineAuth ? 'embedded' : promptAuth ? 'prompt' : 'none';
  const usesPreset = (preset) => (
    dnsServers.length === preset.length
    && preset.every((address, index) => dnsServers[index] === address)
  );
  const dnsPreset = usesPreset(openVpnDnsPresets.cloudflare)
    ? 'cloudflare'
    : usesPreset(openVpnDnsPresets.google)
      ? 'google'
      : 'custom';
  return {
    server: remote?.[1] || '',
    port: remote?.[2] || '1194',
    protocol: protocol?.[1]?.toLowerCase().startsWith('tcp') ? 'tcp' : 'udp',
    dnsPreset,
    customDns: dnsPreset === 'custom' ? dnsServers.join(', ') : '',
    username: inlineAuth?.[1]?.trim() || '',
    password: inlineAuth?.[2]?.trim() || '',
    embedCredentials: Boolean(inlineAuth),
    authenticationMode,
  };
}
