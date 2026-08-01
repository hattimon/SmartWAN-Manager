function normalizeIp(value = '') {
  const text = String(value).trim();
  if (text.startsWith('::ffff:')) return text.slice(7);
  if (text === '::1') return '127.0.0.1';
  return text;
}

function ipv4ToInt(value) {
  const parts = normalizeIp(value).split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

export function ipInCidr(ip, cidr) {
  const [network, prefixText = '32'] = String(cidr || '').trim().split('/');
  const address = ipv4ToInt(ip);
  const networkAddress = ipv4ToInt(network);
  const prefix = Number(prefixText);
  if (address === null || networkAddress === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (networkAddress & mask);
}

export function configuredTrustedSubnets() {
  const configured = String(process.env.SMARTWAN_TRUSTED_SUBNETS || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length
    ? configured
    : ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
}

export function configuredTrustedProxies() {
  return String(process.env.SMARTWAN_TRUSTED_PROXIES || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isInNetworks(ip, networks) {
  return networks.some((cidr) => ipInCidr(ip, cidr));
}

export function requestClientIp(req) {
  const socketIp = normalizeIp(req.socket?.remoteAddress || '');
  const trustedProxies = configuredTrustedProxies();
  if (trustedProxies.length && isInNetworks(socketIp, trustedProxies)) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((item) => normalizeIp(item))
      .filter(Boolean);
    if (forwarded.length) return forwarded[0];
  }
  return socketIp;
}

export function isTrustedLocalRequest(req) {
  const forwardedHeader = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwardedHeader) {
    const socketIp = normalizeIp(req.socket?.remoteAddress || '');
    const trustedProxies = configuredTrustedProxies();
    if (!trustedProxies.length || !isInNetworks(socketIp, trustedProxies)) return false;
  }
  return isInNetworks(requestClientIp(req), configuredTrustedSubnets());
}

export function requireTrustedLocalRequest(req, res, next) {
  if (!isTrustedLocalRequest(req)) {
    res.status(403).json({ error: 'Public network status is available only from a trusted LAN or VPN subnet.' });
    return;
  }
  next();
}
