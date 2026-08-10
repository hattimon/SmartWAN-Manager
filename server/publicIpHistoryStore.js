import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';

const HISTORY_FILE = path.join(DATA_DIR, 'wan-public-ip-history.json');
const DDNS_FILE = path.join(DATA_DIR, 'cloudflare-ddns.json');
const PUBLIC_STATE_FILE = path.join(DATA_DIR, 'public-network-state.json');
const TRUSTED_SOURCE = /^(?:nvram:|curl-source:|wget-bind:|wget-default:|nslookup:|panel:default-route|panel:google-policy)/;

function isPublicIpv4(ip) {
  const parts = String(ip || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  return true;
}

function emptyHistory() {
  return { version: 1, wans: { wan0: null, wan1: null } };
}

function normalizeEntry(value) {
  if (!isPublicIpv4(value?.ip)) return null;
  return {
    ip: value.ip,
    confirmedAt: String(value.confirmedAt || ''),
    source: String(value.source || ''),
    ifname: String(value.ifname || ''),
  };
}

function normalizeHistory(value = {}) {
  return {
    version: 1,
    wans: {
      wan0: normalizeEntry(value?.wans?.wan0),
      wan1: normalizeEntry(value?.wans?.wan1),
    },
  };
}

function trustedProbe(wan) {
  return isPublicIpv4(wan?.publicIp)
    && ['ok', 'panel_probe'].includes(String(wan?.publicIpStatus || ''))
    && TRUSTED_SOURCE.test(String(wan?.publicIpSource || ''));
}

export function mergeWanPublicIpHistory(wanStatus = [], history = emptyHistory(), nowIso = new Date().toISOString()) {
  const next = normalizeHistory(history);
  let changed = false;
  const resolved = wanStatus.map((wan) => {
    if (trustedProbe(wan)) {
      const entry = {
        ip: wan.publicIp,
        confirmedAt: nowIso,
        source: wan.publicIpSource,
        ifname: wan.ifname || '',
      };
      if (JSON.stringify(next.wans[wan.id] || null) !== JSON.stringify(entry)) changed = true;
      next.wans[wan.id] = entry;
      return {
        ...wan,
        publicIpConfirmedAt: entry.confirmedAt,
        publicIpStale: false,
      };
    }

    const lastConfirmed = next.wans[wan.id];
    if (lastConfirmed) {
      return {
        ...wan,
        publicIp: lastConfirmed.ip,
        publicIpStatus: 'last_confirmed',
        publicIpSource: 'panel:last-confirmed',
        publicIpConfirmedAt: lastConfirmed.confirmedAt,
        publicIpStale: true,
      };
    }

    // Legacy router cache entries may have been populated through the active
    // failover WAN. Never present them without a per-WAN confirmation.
    if (wan.publicIpSource === 'cache') {
      return {
        ...wan,
        publicIp: '',
        publicIpStatus: 'probe_failed',
        publicIpSource: '',
        publicIpConfirmedAt: '',
        publicIpStale: false,
      };
    }
    return {
      ...wan,
      publicIpConfirmedAt: '',
      publicIpStale: false,
    };
  });
  return { wanStatus: resolved, history: next, changed };
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not read ${path.basename(file)}: ${error.message}`);
    return null;
  }
}

async function migrateLegacyHistory() {
  const history = emptyHistory();
  const [publicState, ddns] = await Promise.all([
    readJson(PUBLIC_STATE_FILE),
    readJson(DDNS_FILE),
  ]);
  const legacyWans = publicState?.state?.wanStatus || [];
  const counts = legacyWans.reduce((result, wan) => {
    if (isPublicIpv4(wan.publicIp)) result[wan.publicIp] = (result[wan.publicIp] || 0) + 1;
    return result;
  }, {});
  for (const wan of legacyWans) {
    if (!['wan0', 'wan1'].includes(wan.id) || counts[wan.publicIp] !== 1 || !TRUSTED_SOURCE.test(wan.publicIpSource || '')) continue;
    history.wans[wan.id] = {
      ip: wan.publicIp,
      confirmedAt: publicState.lastSuccessfulAt || '',
      source: wan.publicIpSource,
      ifname: wan.ifname || '',
    };
  }
  if (['wan0', 'wan1'].includes(ddns?.lastWan) && isPublicIpv4(ddns?.lastIp)) {
    history.wans[ddns.lastWan] = {
      ip: ddns.lastIp,
      confirmedAt: ddns.lastUpdatedAt || '',
      source: 'cloudflare-ddns:last-confirmed',
      ifname: '',
    };
  }
  return history;
}

async function loadHistory() {
  const stored = await readJson(HISTORY_FILE);
  return stored ? normalizeHistory(stored) : migrateLegacyHistory();
}

async function saveHistory(history) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${HISTORY_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, HISTORY_FILE);
  await fs.chmod(HISTORY_FILE, 0o600);
}

let historyWriteQueue = Promise.resolve();

export async function applyWanPublicIpHistory(wanStatus = []) {
  const work = historyWriteQueue.then(async () => {
    const current = await loadHistory();
    const merged = mergeWanPublicIpHistory(wanStatus, current);
    if (merged.changed || !(await readJson(HISTORY_FILE))) await saveHistory(merged.history);
    return merged.wanStatus;
  });
  historyWriteQueue = work.catch(() => undefined);
  return work;
}
