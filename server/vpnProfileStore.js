import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';

const MAX_PROFILE_BYTES = 2 * 1024 * 1024;

function validServerUnit(value = 1) {
  const unit = Number(value);
  if (!Number.isInteger(unit) || unit < 1 || unit > 2) {
    throw new Error('OpenVPN server unit must be 1 or 2.');
  }
  return unit;
}

function readyProfileFile(serverUnit) {
  const unit = validServerUnit(serverUnit);
  return unit === 1
    ? path.join(DATA_DIR, 'ready-openvpn-client.json')
    : path.join(DATA_DIR, `ready-openvpn-client-server${unit}.json`);
}

function safeFilename(value, serverUnit = 1) {
  const base = String(value || `asus-openvpn-server${serverUnit}-client.ovpn`)
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-');
  return base.toLowerCase().endsWith('.ovpn') ? base : `${base}.ovpn`;
}

function credentialsEmbedded(content) {
  return /<auth-user-pass>\s*\r?\n[^\r\n]+\r?\n[^\r\n]+\r?\n\s*<\/auth-user-pass>/i.test(content);
}

function authenticationMode(content) {
  if (credentialsEmbedded(content)) return 'embedded';
  if (/^\s*auth-user-pass(?:\s+\S+)?\s*$/im.test(String(content || ''))) return 'prompt';
  return 'none';
}

function remoteAddress(content) {
  return String(content || '').match(/^\s*remote\s+(\S+)/im)?.[1] || '';
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function remoteAccessScope(address) {
  if (!address) return 'unknown';
  if (isPrivateIpv4(address)) return 'local';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return 'public';
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      ? 'local'
      : 'public';
  }
  return 'hostname';
}

export function validateReadyOpenVpnProfile(input = {}) {
  const content = String(input.content || '').trim();
  if (!content || Buffer.byteLength(content, 'utf8') > MAX_PROFILE_BYTES) {
    throw new Error('The ready OpenVPN profile is empty or too large.');
  }
  if (!/^\s*client\s*$/im.test(content) || !/^\s*remote\s+\S+/im.test(content)) {
    throw new Error('The ready OpenVPN profile is missing client or remote directives.');
  }
  if (!content.includes('<ca>') && !/^\s*ca\s+\S+/im.test(content)) {
    throw new Error('The ready OpenVPN profile must include or reference a CA certificate.');
  }
  const serverAddress = remoteAddress(content);
  return {
    filename: safeFilename(input.filename),
    content: `${content}\n`,
    credentialsEmbedded: credentialsEmbedded(content),
    authenticationMode: authenticationMode(content),
    remoteAddress: serverAddress,
    accessScope: remoteAccessScope(serverAddress),
  };
}

export async function saveReadyOpenVpnProfile(input) {
  const serverUnit = validServerUnit(input?.server ?? input?.serverUnit ?? 1);
  const profile = validateReadyOpenVpnProfile({
    ...input,
    filename: input?.filename || `asus-openvpn-server${serverUnit}-client.ovpn`,
  });
  const savedAt = new Date().toISOString();
  const profileFile = readyProfileFile(serverUnit);
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${profileFile}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify({
    version: 1,
    serverUnit,
    savedAt,
    ...profile,
    filename: safeFilename(profile.filename, serverUnit),
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempFile, profileFile);
  return {
    available: true,
    serverUnit,
    filename: safeFilename(profile.filename, serverUnit),
    savedAt,
    credentialsEmbedded: profile.credentialsEmbedded,
    authenticationMode: profile.authenticationMode,
    remoteAddress: profile.remoteAddress,
    accessScope: profile.accessScope,
  };
}

export async function loadReadyOpenVpnProfile({ includeContent = false, server = 1 } = {}) {
  const serverUnit = validServerUnit(server);
  try {
    const saved = JSON.parse(await fs.readFile(readyProfileFile(serverUnit), 'utf8'));
    const profile = validateReadyOpenVpnProfile(saved);
    return {
      available: true,
      serverUnit,
      filename: profile.filename,
      savedAt: saved.savedAt || '',
      credentialsEmbedded: profile.credentialsEmbedded,
      authenticationMode: profile.authenticationMode,
      remoteAddress: profile.remoteAddress,
      accessScope: profile.accessScope,
      ...(includeContent ? { content: profile.content } : {}),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not load the ready OpenVPN profile: ${error.message}`);
    }
    return {
      available: false,
      serverUnit,
      filename: `asus-openvpn-server${serverUnit}-client.ovpn`,
      savedAt: '',
      credentialsEmbedded: false,
      authenticationMode: 'none',
      remoteAddress: '',
      accessScope: 'unknown',
      ...(includeContent ? { content: '' } : {}),
    };
  }
}
