import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';

const EVENT_FILE = path.join(DATA_DIR, 'wan-events.json');
const MAX_EVENTS = 500;
const pendingTransitions = new Map();

function isOnline(wan) {
  return ['ok', 'reachable'].includes(String(wan?.internetStatus || '').toLowerCase());
}

function wanLabel(wan = {}) {
  return `${wan.label || wan.id?.toUpperCase() || 'WAN'} / ${wan.asusPort || wan.id?.toUpperCase() || 'WAN'}`;
}

async function loadStore() {
  try {
    return JSON.parse(await fs.readFile(EVENT_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not load WAN events: ${error.message}`);
    return { version: 1, wanState: {}, activeOutages: {}, events: [] };
  }
}

async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${EVENT_FILE}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, EVENT_FILE);
}

function eventId(type, wanId, at) {
  return `${at.replace(/\D/g, '')}-${wanId}-${type}`;
}

function addEvent(store, event) {
  if (store.events.some((item) => item.id === event.id)) return;
  store.events.unshift(event);
  store.events = store.events.slice(0, MAX_EVENTS);
}

export function parseRouterJournal(raw = '') {
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        version,
        id,
        epoch,
        routerTime,
        type,
        wanId,
        reason,
        activeWan,
        failures,
        mode,
      ] = line.split('|');
      const epochNumber = Number(epoch);
      if (version !== '1' || !id || !['outage', 'recovery'].includes(type) || !wanId) return null;
      return {
        id: `router-${id}`,
        type,
        wanId,
        reason: reason || '',
        activeWan: activeWan || '',
        failures: Number.isFinite(Number(failures)) ? Number(failures) : 0,
        mode: mode || '',
        routerTime: routerTime || '',
        at: Number.isFinite(epochNumber) && epochNumber > 0
          ? new Date(epochNumber * 1000).toISOString()
          : '',
      };
    })
    .filter(Boolean);
}

export function inferActiveWanRecovery(store, entry) {
  if (entry?.type !== 'outage' || !entry.activeWan) return null;
  const outage = store?.activeOutages?.[entry.activeWan];
  if (!outage) return null;

  const endedAt = entry.at || new Date().toISOString();
  const durationSeconds = outage.startedAt
    ? Math.max(0, Math.round(
      (new Date(endedAt).getTime() - new Date(outage.startedAt).getTime()) / 1000,
    ))
    : null;
  return {
    id: `${entry.id}-inferred-recovery-${entry.activeWan}`,
    type: 'recovery',
    severity: 'success',
    source: 'router-watchdog-inferred',
    wanId: entry.activeWan,
    wanLabel: outage.wanLabel || entry.activeWan.toUpperCase(),
    operator: outage.operator || '',
    startedAt: outage.startedAt || '',
    endedAt,
    durationSeconds,
    action: `Internet access was confirmed because traffic switched to ${entry.activeWan.toUpperCase()}.`,
    profileBefore: outage.profileBefore || 'SmartWAN Failover',
    failoverProfile: outage.failoverProfile || 'SmartWAN Failover',
    restoredProfile: 'SmartWAN Failover',
    profile: 'SmartWAN Failover',
    summary: `Stable internet access through ${entry.activeWan.toUpperCase()} was restored.`,
    routerTime: entry.routerTime,
    reason: 'active_wan_confirmed_recovered',
    activeWan: entry.activeWan,
  };
}

export async function ingestRouterJournal(raw) {
  const entries = parseRouterJournal(raw);
  if (!entries.length) return loadStore();

  const store = await loadStore();
  let changed = false;
  for (const entry of entries) {
    const inferredRecovery = inferActiveWanRecovery(store, entry);
    if (inferredRecovery) {
      addEvent(store, inferredRecovery);
      delete store.activeOutages[inferredRecovery.wanId];
      store.wanState[inferredRecovery.wanId] = {
        online: true,
        observedAt: inferredRecovery.endedAt,
      };
      changed = true;
    }
    if (store.events.some((event) => event.id === entry.id)) continue;
    const at = entry.at || new Date().toISOString();
    const label = entry.wanId.toUpperCase();
    if (entry.type === 'outage') {
      const outage = {
        id: entry.id,
        wanId: entry.wanId,
        wanLabel: label,
        operator: '',
        startedAt: at,
        profileBefore: 'Dual WAN — Load Balance',
        failoverProfile: 'SmartWAN Failover',
        activeWan: entry.activeWan,
        failures: entry.failures || 1,
        routerTime: entry.routerTime,
        reason: entry.reason,
      };
      store.activeOutages[entry.wanId] = outage;
      addEvent(store, {
        ...outage,
        type: 'outage',
        severity: 'error',
        source: 'router-watchdog',
        activeWan: entry.activeWan,
        failures: entry.failures || 1,
        action: entry.activeWan
          ? `Traffic moved to ${entry.activeWan.toUpperCase()}.`
          : 'Traffic moved to the available WAN.',
        profile: 'SmartWAN Failover',
        summary: `Internet access through ${label} was lost after ${entry.failures || 1} confirmed failed check(s).`,
        routerTime: entry.routerTime,
        reason: entry.reason,
      });
      store.wanState[entry.wanId] = { online: false, observedAt: at };
    } else {
      const outage = store.activeOutages[entry.wanId];
      const durationSeconds = outage?.startedAt
        ? Math.max(0, Math.round((new Date(at).getTime() - new Date(outage.startedAt).getTime()) / 1000))
        : null;
      addEvent(store, {
        id: entry.id,
        type: 'recovery',
        severity: 'success',
        source: 'router-watchdog',
        wanId: entry.wanId,
        wanLabel: label,
        operator: '',
        startedAt: outage?.startedAt || '',
        endedAt: at,
        durationSeconds,
        action: 'Stable connection confirmed and normal routing restored.',
        profileBefore: outage?.profileBefore || 'SmartWAN Failover',
        failoverProfile: outage?.failoverProfile || 'SmartWAN Failover',
        restoredProfile: 'Dual WAN — Load Balance',
        profile: 'Dual WAN — Load Balance',
        summary: `Stable internet access through ${label} was restored.`,
        routerTime: entry.routerTime,
        reason: entry.reason,
        activeWan: entry.activeWan,
      });
      delete store.activeOutages[entry.wanId];
      store.wanState[entry.wanId] = { online: true, observedAt: at };
    }
    changed = true;
  }

  if (changed) await saveStore(store);
  return store;
}

function transitionConfirmed(wanId, nextOnline) {
  const key = `${wanId}:${nextOnline ? 'up' : 'down'}`;
  const count = (pendingTransitions.get(key) || 0) + 1;
  pendingTransitions.set(key, count);
  pendingTransitions.delete(`${wanId}:${nextOnline ? 'down' : 'up'}`);
  return count >= 2;
}

export async function ingestWanState(state, { source = 'automatic' } = {}) {
  const store = await loadStore();
  const now = new Date();
  const nowIso = now.toISOString();
  const status = state?.status || {};
  const failoverActive = status.failover_override_active === '1';
  let changed = false;

  for (const wan of state?.wanStatus || []) {
    const nextOnline = isOnline(wan);
    const previous = store.wanState[wan.id];
    if (!previous) {
      store.wanState[wan.id] = { online: nextOnline, observedAt: nowIso };
      changed = true;
      continue;
    }
    if (previous.online === nextOnline) {
      pendingTransitions.delete(`${wan.id}:up`);
      pendingTransitions.delete(`${wan.id}:down`);
      continue;
    }
    if (!transitionConfirmed(wan.id, nextOnline) && !(!nextOnline && failoverActive)) continue;

    const label = wanLabel(wan);
    if (!nextOnline) {
      const outage = {
        id: eventId('outage', wan.id, nowIso),
        wanId: wan.id,
        wanLabel: label,
        operator: wan.label || '',
        startedAt: nowIso,
        profileBefore: status.normal_dualwan_mode === 'lb' ? 'Dual WAN — Load Balance' : 'SmartWAN',
        failoverProfile: failoverActive ? 'SmartWAN Failover' : '',
      };
      store.activeOutages[wan.id] = outage;
      addEvent(store, {
        ...outage,
        type: 'outage',
        severity: 'error',
        source,
        action: failoverActive ? 'Traffic moved to the available WAN.' : 'WAN marked unavailable after confirmed failed checks.',
        profile: outage.failoverProfile || outage.profileBefore,
        summary: `Internet access through ${label} was lost.`,
      });
    } else {
      const outage = store.activeOutages[wan.id];
      const durationSeconds = outage
        ? Math.max(0, Math.round((now.getTime() - new Date(outage.startedAt).getTime()) / 1000))
        : null;
      addEvent(store, {
        id: eventId('recovery', wan.id, nowIso),
        type: 'recovery',
        severity: 'success',
        source,
        wanId: wan.id,
        wanLabel: label,
        operator: wan.label || '',
        startedAt: outage?.startedAt || '',
        endedAt: nowIso,
        durationSeconds,
        action: 'Stable connection confirmed and normal routing restored.',
        profileBefore: outage?.profileBefore || '',
        failoverProfile: outage?.failoverProfile || '',
        restoredProfile: status.normal_dualwan_mode === 'lb' ? 'Dual WAN — Load Balance' : 'SmartWAN',
        profile: status.normal_dualwan_mode === 'lb' ? 'Dual WAN — Load Balance' : 'SmartWAN',
        summary: `Stable internet access through ${label} was restored.`,
      });
      delete store.activeOutages[wan.id];
    }
    store.wanState[wan.id] = { online: nextOnline, observedAt: nowIso };
    changed = true;
  }

  if (changed) await saveStore(store);
  return store;
}

export async function recordManualEvent({
  type = 'manual',
  source = 'manual',
  severity = 'info',
  testMode = false,
  action,
  profile = '',
  summary,
  username = 'admin',
  change = null,
}) {
  const store = await loadStore();
  const at = new Date().toISOString();
  if (type === 'dualwan-config') {
    store.events = (store.events || []).filter((event) => !(
      event.type === 'dualwan-config'
      || (event.source === 'manual' && (
        String(event.action || '').includes('Dual WAN configuration changed')
        || String(event.summary || '').includes('Dual WAN routing configuration')
      ))
    ));
  }
  addEvent(store, {
    id: eventId(type, 'panel', at),
    type,
    severity,
    source,
    testMode: testMode === true,
    startedAt: at,
    action,
    profile,
    device: username,
    summary,
    change,
  });
  await saveStore(store);
}

export async function recordRecoveredWanIncident({
  incidentId,
  wanId,
  wanLabel: label,
  operator = '',
  startedAt,
  endedAt,
  outageAction,
  outageSummary,
  recoveryAction,
  recoverySummary,
  profileBefore = 'Dual WAN — Load Balance',
  failoverProfile = 'SmartWAN Failover',
  restoredProfile = 'Dual WAN — Load Balance',
}) {
  const safeId = String(incidentId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!safeId || !wanId || !startedAt || !endedAt) {
    throw new Error('Historical WAN incident requires an ID, WAN and timestamps.');
  }
  const store = await loadStore();
  const outageId = `historical-${safeId}-outage`;
  const recoveryId = `historical-${safeId}-recovery`;
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  addEvent(store, {
    id: outageId,
    type: 'outage',
    severity: 'error',
    source: 'router-log-recovery',
    wanId,
    wanLabel: label || wanId.toUpperCase(),
    operator,
    startedAt,
    action: outageAction,
    profileBefore,
    failoverProfile,
    profile: failoverProfile,
    summary: outageSummary,
  });
  addEvent(store, {
    id: recoveryId,
    type: 'recovery',
    severity: 'success',
    source: 'router-log-recovery',
    wanId,
    wanLabel: label || wanId.toUpperCase(),
    operator,
    startedAt,
    endedAt,
    durationSeconds,
    action: recoveryAction,
    profileBefore,
    failoverProfile,
    restoredProfile,
    profile: restoredProfile,
    summary: recoverySummary,
  });
  delete store.activeOutages[wanId];
  store.wanState[wanId] = { online: true, observedAt: endedAt };
  await saveStore(store);
  return { outageId, recoveryId, durationSeconds };
}

export async function listWanEvents() {
  const store = await loadStore();
  let foundDualWanConfig = false;
  const events = (store.events || []).filter((event) => {
    const isDualWanConfig = event.type === 'dualwan-config'
      || (event.source === 'manual' && (
        String(event.action || '').includes('Dual WAN configuration changed')
        || String(event.summary || '').includes('Dual WAN routing configuration')
      ));
    if (!isDualWanConfig) return true;
    if (foundDualWanConfig) return false;
    foundDualWanConfig = true;
    return true;
  });
  return {
    events,
    activeOutages: Object.values(store.activeOutages || {}),
  };
}
