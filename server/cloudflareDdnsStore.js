import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';

const DDNS_FILE = path.join(DATA_DIR, 'cloudflare-ddns.json');
const DEFAULT_CONFIG = {
  enabled: false,
  zone: 'example.com',
  hostname: 'vpn.example.com',
  serverUnit: 2,
  preferredWan: 'auto',
  zoneId: '',
  recordId: '',
  token: '',
  lastIp: '',
  lastWan: '',
  lastUpdatedAt: '',
  lastError: '',
};

function cleanHostname(value) {
  const hostname = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253 || !/^[a-z0-9.-]+$/.test(hostname)) {
    throw new Error('Nieprawidłowa nazwa hosta DDNS.');
  }
  return hostname;
}

function cleanWan(value) {
  return ['auto', 'wan0', 'wan1'].includes(value) ? value : 'auto';
}

function cleanServerUnit(value) {
  return Number(value) === 1 ? 1 : 2;
}

async function writeConfig(config) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DDNS_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempFile, DDNS_FILE);
  await fs.chmod(DDNS_FILE, 0o600);
}

export async function loadCloudflareDdnsConfig({ includeToken = false } = {}) {
  let config = { ...DEFAULT_CONFIG };
  try {
    config = { ...config, ...JSON.parse(await fs.readFile(DDNS_FILE, 'utf8')) };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not read Cloudflare DDNS configuration: ${error.message}`);
    }
  }
  return {
    ...config,
    tokenConfigured: Boolean(config.token),
    ...(includeToken ? {} : { token: '' }),
  };
}

export async function saveCloudflareDdnsConfig(input = {}) {
  const current = await loadCloudflareDdnsConfig({ includeToken: true });
  const nextToken = String(input.token || '').trim();
  const removeToken = input.removeToken === true;
  const zone = cleanHostname(input.zone || current.zone);
  const hostname = cleanHostname(input.hostname || current.hostname);
  if (hostname !== zone && !hostname.endsWith(`.${zone}`)) {
    throw new Error('Nazwa hosta DDNS musi należeć do wybranej strefy.');
  }
  const next = {
    ...current,
    enabled: input.enabled === true,
    zone,
    hostname,
    serverUnit: cleanServerUnit(input.serverUnit ?? current.serverUnit),
    preferredWan: cleanWan(input.preferredWan),
    zoneId: String(input.zoneId || current.zoneId || '').trim(),
    recordId: String(input.recordId || current.recordId || '').trim(),
    token: removeToken ? '' : nextToken || current.token || '',
  };
  delete next.tokenConfigured;
  if (next.enabled && !next.token) {
    throw new Error('Wpisz token API Cloudflare przed włączeniem DDNS.');
  }
  await writeConfig(next);
  return loadCloudflareDdnsConfig();
}

export async function updateCloudflareDdnsRuntime(patch = {}) {
  const current = await loadCloudflareDdnsConfig({ includeToken: true });
  const next = { ...current, ...patch };
  delete next.tokenConfigured;
  await writeConfig(next);
  return loadCloudflareDdnsConfig();
}

export async function setCloudflareDdnsPreferredWan(preferredWan) {
  const current = await loadCloudflareDdnsConfig({ includeToken: true });
  const next = {
    ...current,
    preferredWan: cleanWan(preferredWan),
  };
  delete next.tokenConfigured;
  await writeConfig(next);
  return loadCloudflareDdnsConfig();
}

export function selectDdnsWan(state, preferredWan = 'auto') {
  const wanStatus = Array.isArray(state?.wanStatus) ? state.wanStatus : [];
  const online = wanStatus.filter((wan) => (
    ['ok', 'reachable'].includes(String(wan?.internetStatus || '').toLowerCase())
    && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(wan?.publicIp || ''))
  ));
  if (!online.length) return null;
  const wanted = preferredWan === 'auto'
    ? state?.status?.active_default_wan || ''
    : preferredWan;
  return online.find((wan) => wan.id === wanted) || online[0];
}

async function cloudflareRequest(config, method, endpoint, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map((item) => item.message).filter(Boolean).join('; ')
      || `Cloudflare API HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.result;
}

export async function syncCloudflareDdns(state) {
  const config = await loadCloudflareDdnsConfig({ includeToken: true });
  if (!config.enabled) {
    return { ...await loadCloudflareDdnsConfig(), skipped: true, reason: 'disabled' };
  }
  const selectedWan = selectDdnsWan(state, config.preferredWan);
  if (!selectedWan) {
    const message = 'Żaden aktywny WAN nie ma wykrytego publicznego adresu IPv4.';
    await updateCloudflareDdnsRuntime({ lastError: message });
    throw new Error(message);
  }

  try {
    let zoneId = config.zoneId;
    if (!zoneId) {
      const zones = await cloudflareRequest(
        config,
        'GET',
        `/zones?name=${encodeURIComponent(config.zone)}&status=active`,
      );
      zoneId = zones?.[0]?.id || '';
      if (!zoneId) throw new Error(`Nie znaleziono aktywnej strefy ${config.zone}.`);
    }

    let recordId = config.recordId;
    let record = null;
    if (recordId) {
      record = await cloudflareRequest(config, 'GET', `/zones/${zoneId}/dns_records/${recordId}`)
        .catch(() => null);
    }
    if (!record) {
      const records = await cloudflareRequest(
        config,
        'GET',
        `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(config.hostname)}`,
      );
      record = records?.[0] || null;
      recordId = record?.id || '';
    }

    const desired = {
      type: 'A',
      name: config.hostname,
      content: selectedWan.publicIp,
      ttl: 1,
      proxied: false,
      comment: `SmartWAN Manager OpenVPN Server ${config.serverUnit} DDNS`,
    };
    let changed = false;
    if (!record) {
      record = await cloudflareRequest(config, 'POST', `/zones/${zoneId}/dns_records`, desired);
      recordId = record.id;
      changed = true;
    } else if (
      record.content !== desired.content
      || record.proxied !== false
      || record.type !== 'A'
    ) {
      record = await cloudflareRequest(
        config,
        'PUT',
        `/zones/${zoneId}/dns_records/${recordId}`,
        desired,
      );
      changed = true;
    }

    const saved = await updateCloudflareDdnsRuntime({
      zoneId,
      recordId,
      lastIp: selectedWan.publicIp,
      lastWan: selectedWan.id,
      lastUpdatedAt: new Date().toISOString(),
      lastError: '',
    });
    return { ...saved, changed, selectedWan: selectedWan.id };
  } catch (error) {
    await updateCloudflareDdnsRuntime({ lastError: error.message });
    throw error;
  }
}
