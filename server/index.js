import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createFullBackup, createRouterBackup, createSmartWanBackup, restoreBackup } from './backupOps.js';
import {
  addAurelkaMessage,
  listAurelkaMessages,
  readAurelkaPreferences,
  saveAurelkaPreferences,
} from './aurelkaMessageStore.js';
import { DATA_DIR, KEY_DIR, loadSettings, redactSettings, saveSettings } from './configStore.js';
import {
  activateDualWanPreset,
  applyDualWan,
  deleteDualWanPreset,
  listDualWanPresets,
  readDualWan,
  saveDualWanPreset,
} from './dualWanOps.js';
import { applyDmzPolicy, readDmzPolicy } from './dmzOps.js';
import {
  activatePreset,
  applySmartwanConfig,
  deletePreset,
  installRouterScripts,
  listPresets,
  readRouterEventJournal,
  readPreset,
  probeRouter,
  readSmartwanConfig,
  rollbackSmartwanConfig,
  savePreset,
  testConnection,
} from './routerOps.js';
import { listWanQualityHistory, previewWanQuality, runWanQualityTest } from './wanQualityOps.js';
import { exportVpnPolicy, readOpenVpnClientProfile } from './vpnOps.js';
import {
  loadReadyOpenVpnProfile,
  saveReadyOpenVpnProfile,
} from './vpnProfileStore.js';
import { loadRoutingGroups, resetRoutingGroups, saveRoutingGroups } from './routingGroupStore.js';
import {
  generateRoutingRulesWithAi,
  loadAiProviderConfig,
  saveAiProviderConfig,
} from './aiProviderStore.js';
import {
  buildGoogleLocationPublicStatus,
  loadGoogleLocationPolicy,
  runGoogleLocationPolicy,
  saveGoogleLocationPolicy,
} from './googleLocationPolicy.js';
import {
  loadCloudflareDdnsConfig,
  saveCloudflareDdnsConfig,
  setCloudflareDdnsPreferredWan,
  syncCloudflareDdns,
} from './cloudflareDdnsStore.js';
import {
  inferServerWanFromRules,
  inferServerSubnetFromSmartwanForm,
  inferServerWanFromSmartwanForm,
  setServerWanInDualWanForm,
  setServerWanInSmartwanForm,
} from './vpnServer2WanSync.js';
import {
  getTailscaleStatus,
  initializeTailscaleAccess,
  saveTailscaleAccessConfig,
  shutdownTailscaleAccess,
  startTailscaleAccess,
  stopTailscaleAccess,
} from './tailscaleAccessStore.js';
import {
  applyRouterSetupWizard,
  applySavedRouterSetupProfile,
  captureRouterSetupProfile,
  getRouterSetupWizard,
  previewRouterSetupWizard,
} from './routerSetupWizard.js';
import { applyActiveOutages, buildRoutingSummary, buildViewerRouting } from './publicStatus.js';
import { requestClientIp, requireTrustedLocalRequest } from './trustedNetworks.js';
import {
  ingestRouterJournal,
  listWanEvents,
  recordManualEvent,
} from './wanEventStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 8080);
const SESSION_COOKIE = 'smartwan_panel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_MAP_CACHE_MS = 60_000;
const PUBLIC_MAP_STALE_CACHE_MS = 60_000;
const ROUTER_EVENT_SYNC_MS = 30_000;
const CLOUDFLARE_DDNS_SYNC_MS = 5 * 60_000;
const PUBLIC_MAP_STATE_FILE = path.join(DATA_DIR, 'public-network-state.json');
let publicMapCache = {
  expiresAt: 0,
  state: null,
  stale: false,
  lastSuccessfulAt: '',
};
let publicMapRefreshPromise = null;
let routerReadQueue = Promise.resolve();
let routerEventSyncPromise = null;
let routerEventSyncState = {
  lastAttemptAt: '',
  lastSuccessAt: '',
  lastError: '',
};
let googleLocationPolicyTimer = null;
let googleLocationPolicyPromise = null;
let cloudflareDdnsTimer = null;
let cloudflareDdnsPromise = null;
let lastCloudflareDdnsEventId = '';
const aurelkaMessageRateLimit = new Map();
const aurelkaMessageStreams = new Set();
const uiLanguageStreams = new Set();

app.use(express.json({ limit: '10mb' }));

function broadcastAurelkaMessage(message) {
  const payload = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
  for (const stream of aurelkaMessageStreams) {
    if (stream.destroyed || stream.writableEnded) {
      aurelkaMessageStreams.delete(stream);
      continue;
    }
    stream.write(payload);
  }
}

function broadcastUiLanguage(language) {
  const payload = `event: language\ndata: ${JSON.stringify({ language })}\n\n`;
  for (const stream of uiLanguageStreams) {
    if (stream.destroyed || stream.writableEnded) {
      uiLanguageStreams.delete(stream);
      continue;
    }
    stream.write(payload);
  }
}

function resetPasswordCommand(username = 'admin') {
  const safeUsername = String(username || 'admin').replace(/[^A-Za-z0-9._-]/g, '') || 'admin';
  return `docker exec smartwan-manager node server/setPanelPassword.js ${safeUsername} 'new-strong-password'`;
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=');
        return index === -1
          ? [decodeURIComponent(item), '']
          : [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqual(a = '', b = '', encoding = 'hex') {
  const left = Buffer.from(a, encoding);
  const right = Buffer.from(b, encoding);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sessionSecret(settings) {
  return `${settings.auth?.passwordHash || ''}:${settings.auth?.passwordSalt || ''}:smartwan-session-v1`;
}

function createSessionToken(settings, username) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret(settings)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function sessionCookie(token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function authenticatedUser(req, settings) {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', sessionSecret(settings)).update(payload).digest('base64url');
  if (!safeEqual(signature, expected, 'base64url')) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (session.version !== 1 || !session.username || session.expiresAt < Date.now()) return null;
    return session.username;
  } catch (_error) {
    return null;
  }
}

function authSummary(settings, req) {
  const configured = Boolean(settings.auth?.passwordHash && settings.auth?.passwordSalt);
  return {
    configured,
    authenticated: configured ? Boolean(authenticatedUser(req, settings)) : false,
    username: settings.auth?.username || 'admin',
    resetCommand: resetPasswordCommand(settings.auth?.username),
  };
}

async function requirePanelAuth(req, res, next) {
  if (
    !req.path.startsWith('/api/')
    || req.path.startsWith('/api/auth/')
    || req.path.startsWith('/api/public/')
    || req.path === '/api/health'
  ) {
    next();
    return;
  }
  const settings = await loadSettings();
  const summary = authSummary(settings, req);
  if (!summary.configured) {
    res.status(503).json({
      error: 'Panel login is not configured. Set it from the Raspberry Pi terminal.',
      resetCommand: summary.resetCommand,
    });
    return;
  }
  if (!summary.authenticated) {
    res.status(401).json({ error: 'Panel login required.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

async function routerSettings() {
  return (await loadSettings()).router;
}

function publicNetworkMapState(state) {
  const pick = (source, keys) => Object.fromEntries(
    keys
      .filter((key) => source?.[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  const activeClients = (state?.clients || []).filter((client) => client.active !== false);
  const clientTypeCounts = activeClients.reduce((counts, client) => {
    const type = ['wifi', 'ethernet'].includes(client.connectionType) ? client.connectionType : 'unknown';
    counts[type] += 1;
    return counts;
  }, { wifi: 0, ethernet: 0, unknown: 0 });
  return {
    ok: Boolean(state?.ok),
    identity: pick(state?.identity, ['model', 'firmware', 'uptime']),
    dualWan: pick(state?.dualWan, ['enabled', 'mode', 'ratio', 'ruleCount', 'primary', 'secondary']),
    wanStatus: (state?.wanStatus || []).map((wan) => pick(wan, [
      'id',
      'label',
      'asusPort',
      'ifname',
      'ipaddr',
      'gateway',
      'publicIp',
      'publicIpStatus',
      'publicIpSource',
      'publicIpConfirmedAt',
      'publicIpStale',
      'dnsServers',
      'dnsMode',
      'linkStatus',
      'dhcpStatus',
      'internetStatus',
      'healthResult',
      'outageKind',
      'failureReason',
      'failureDetail',
      'serviceResult',
    ])),
    status: pick(state?.status, [
      'enabled',
      'active_preset',
      'active_default_wan',
      'effective_mode',
      'failover_override_active',
      'watchdog_state_last_failover_at',
      'watchdog_state_last_recovery_at',
      'watchdog_state_failed_wan',
      'watchdog_state_failure_kind',
      'watchdog_state_failure_reason',
      'watchdog_state_failure_detail',
      'normal_dualwan_mode',
      'vpn_interface_up',
      'vpn_interface_ip',
    ]),
    network: {
      ...pick(state?.network, [
        'lan_ipaddr',
        'lan_netmask',
        'lan_subnet',
        'dhcp_start',
        'dhcp_end',
        'dns',
        'lan_dns_primary',
        'lan_dns_secondary',
        'lan_dns_servers',
        'router_upstream_dns',
        'nat_enabled',
        'nat_rules',
        'client_count',
      ]),
      wifi_client_count: clientTypeCounts.wifi,
      ethernet_client_count: clientTypeCounts.ethernet,
      unknown_client_count: clientTypeCounts.unknown,
      active_client_count: activeClients.length,
    },
    clients: activeClients.map((client) => pick(client, [
      'name',
      'hostname',
      'ip',
      'mac',
      'connectionType',
      'active',
    ])),
    readOnly: true,
    observedAt: new Date().toISOString(),
  };
}

async function loadPersistedPublicState() {
  try {
    const saved = JSON.parse(await fs.readFile(PUBLIC_MAP_STATE_FILE, 'utf8'));
    if (!saved?.state || typeof saved.state !== 'object') return null;
    return {
      state: saved.state,
      lastSuccessfulAt: saved.lastSuccessfulAt || saved.savedAt || '',
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not load the last public network state: ${error.message}`);
    }
    return null;
  }
}

async function persistPublicState(state, lastSuccessfulAt) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${PUBLIC_MAP_STATE_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify({
    version: 1,
    lastSuccessfulAt,
    state,
  }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempFile, PUBLIC_MAP_STATE_FILE);
}

function serializedRouterRead(task) {
  const work = routerReadQueue.then(task, task);
  routerReadQueue = work.catch(() => undefined);
  return work;
}

async function refreshPublicState() {
  const settings = await routerSettings();
  const state = await serializedRouterRead(() => probeRouter(settings));
  const lastSuccessfulAt = new Date().toISOString();
  publicMapCache = {
    state,
    stale: false,
    lastSuccessfulAt,
    expiresAt: Date.now() + PUBLIC_MAP_CACHE_MS,
  };
  await persistPublicState(state, lastSuccessfulAt).catch((error) => {
    console.warn(`Could not persist the public network state: ${error.message}`);
  });
  return publicMapCache;
}

async function syncRouterEventJournal() {
  if (routerEventSyncPromise) return routerEventSyncPromise;
  routerEventSyncPromise = (async () => {
    const lastAttemptAt = new Date().toISOString();
    try {
      const settings = await routerSettings();
      const journal = await serializedRouterRead(() => readRouterEventJournal(settings));
      const eventStore = await ingestRouterJournal(journal);
      const latestEventId = eventStore.events?.[0]?.id || '';
      if (latestEventId && latestEventId !== lastCloudflareDdnsEventId) {
        const shouldSyncDdns = Boolean(lastCloudflareDdnsEventId);
        lastCloudflareDdnsEventId = latestEventId;
        if (shouldSyncDdns) {
          const ddnsConfig = await loadCloudflareDdnsConfig();
          if (ddnsConfig.enabled && publicMapCache.state) {
            const effectiveState = applyActiveOutages(
              publicMapCache.state,
              Object.values(eventStore.activeOutages || {}),
            );
            await runCloudflareDdnsSync(effectiveState).catch((error) => {
              console.warn(`Cloudflare DDNS event synchronization failed: ${error.message}`);
            });
          }
        }
      }
      routerEventSyncState = {
        lastAttemptAt,
        lastSuccessAt: new Date().toISOString(),
        lastError: '',
      };
    } catch (error) {
      routerEventSyncState = {
        ...routerEventSyncState,
        lastAttemptAt,
        lastError: error.message || 'Router event sync failed.',
      };
    }
    return routerEventSyncState;
  })().finally(() => {
    routerEventSyncPromise = null;
  });
  return routerEventSyncPromise;
}

function scheduleRouterEventSync(delay = 2_000) {
  const timer = setTimeout(async () => {
    await syncRouterEventJournal();
    scheduleRouterEventSync(ROUTER_EVENT_SYNC_MS);
  }, delay);
  timer.unref();
}

function scheduleGoogleLocationPolicy(delay = 15_000) {
  if (googleLocationPolicyTimer) clearTimeout(googleLocationPolicyTimer);
  googleLocationPolicyTimer = setTimeout(async () => {
    let nextDelay = 60_000;
    try {
      const policy = await loadGoogleLocationPolicy();
      if (policy.enabled && policy.configured) {
        const dueAt = policy.nextCheckAt ? new Date(policy.nextCheckAt).getTime() : 0;
        if (!dueAt || dueAt <= Date.now()) {
          if (!googleLocationPolicyPromise) {
            googleLocationPolicyPromise = serializedRouterRead(async () => (
              runGoogleLocationPolicy(await routerSettings())
            )).finally(() => {
              googleLocationPolicyPromise = null;
            });
          }
          const result = await googleLocationPolicyPromise;
          if (result?.applied) publicMapCache.expiresAt = 0;
          nextDelay = Math.max(
            60_000,
            new Date(result?.nextCheckAt || Date.now() + 60_000).getTime() - Date.now(),
          );
        } else {
          nextDelay = Math.max(60_000, dueAt - Date.now());
        }
      }
    } catch (error) {
      console.warn(`Google WAN location check failed: ${error.message}`);
    } finally {
      scheduleGoogleLocationPolicy(Math.min(nextDelay, 24 * 60 * 60 * 1000));
    }
  }, Math.max(1_000, delay));
  googleLocationPolicyTimer.unref?.();
}

async function currentPublicState() {
  if (publicMapCache.state && publicMapCache.expiresAt > Date.now()) return publicMapCache;

  if (!publicMapRefreshPromise) {
    publicMapRefreshPromise = refreshPublicState()
      .finally(() => {
        publicMapRefreshPromise = null;
      });
  }

  try {
    return await publicMapRefreshPromise;
  } catch (error) {
    const persisted = publicMapCache.state
      ? {
        state: publicMapCache.state,
        lastSuccessfulAt: publicMapCache.lastSuccessfulAt,
      }
      : await loadPersistedPublicState();

    if (persisted?.state) {
      console.warn(`Router status refresh failed; serving the last known state: ${error.message}`);
      publicMapCache = {
        state: persisted.state,
        stale: true,
        lastSuccessfulAt: persisted.lastSuccessfulAt || '',
        expiresAt: Date.now() + PUBLIC_MAP_STALE_CACHE_MS,
      };
      return publicMapCache;
    }

    const unavailable = new Error('Public network status is temporarily unavailable.');
    unavailable.statusCode = 503;
    throw unavailable;
  }
}

async function publicStatusResponse(req) {
  const {
    state,
    stale,
    lastSuccessfulAt,
  } = await currentPublicState();
  const events = await listWanEvents();
  const googleLocationPolicy = await loadGoogleLocationPolicy();
  const clientIp = requestClientIp(req);
  const readyVpnProfiles = await Promise.all([
    loadReadyOpenVpnProfile({ server: 1 }),
    loadReadyOpenVpnProfile({ server: 2 }),
  ]);
  const readyVpnProfile = readyVpnProfiles[0];
  const baseWanStatus = state?.wanStatus || [];
  const wanLabel = (id) => {
    const wan = baseWanStatus.find((item) => item.id === id);
    return wan ? `${wan.label || wan.id.toUpperCase()} / ${wan.asusPort || wan.id.toUpperCase()}` : id?.toUpperCase() || '';
  };
  const enrichWanEvent = (event) => {
    const eventWan = baseWanStatus.find((wan) => wan.id === event.wanId);
    const reasonActiveWan = String(event.reason || '').match(/_(wan[01])_ok$/)?.[1] || '';
    const activeWan = event.activeWan || reasonActiveWan;
    return {
      ...event,
      wanLabel: eventWan ? wanLabel(event.wanId) : event.wanLabel,
      operator: eventWan?.label || event.operator || '',
      activeWan,
      activeWanLabel: activeWan ? wanLabel(activeWan) : '',
    };
  };
  const enrichedEvents = events.events.map(enrichWanEvent);
  const enrichedActiveOutages = Object.values(events.activeOutages || {}).map((outage) => {
    const matchingEvent = events.events.find((event) => event.id === outage.id) || {};
    return enrichWanEvent({
      ...matchingEvent,
      ...outage,
      activeWan: outage.activeWan || matchingEvent.activeWan || '',
      reason: outage.reason || matchingEvent.reason || '',
    });
  });
  const effectiveState = applyActiveOutages(state, enrichedActiveOutages);
  const status = effectiveState?.status || {};
  const wanStatus = effectiveState?.wanStatus || [];
  const preferredWan = status.vpn_preferred_wan || '';
  const alternateWan = wanStatus.find((wan) => wan.id !== preferredWan);
  const failoverWan = alternateWan?.id || status.failover_wan || '';
  const onlineWans = wanStatus.filter((wan) => ['ok', 'reachable'].includes(
    String(wan?.internetStatus || '').toLowerCase(),
  ));
  const effectiveWan = onlineWans.length === 0
    ? ''
    : status.failover_override_active === '1'
      ? onlineWans.find((wan) => wan.id === status.active_default_wan)?.id || onlineWans[0]?.id || ''
      : onlineWans.find((wan) => wan.id === preferredWan)?.id
        || onlineWans.find((wan) => wan.id === status.active_default_wan)?.id
        || onlineWans[0]?.id
        || '';
  const routingVpnProfiles = String(status.vpn_profiles || '')
    .split(';')
    .map((entry) => {
      const [interfaceName, subnet, profilePreferredWan] = entry.split('|');
      return {
        interface: interfaceName || '',
        subnet: subnet || '',
        preferredWan: profilePreferredWan || preferredWan,
      };
    })
    .filter((entry) => entry.interface && entry.subnet);
  const publicVpnProfiles = readyVpnProfiles.map((profile, index) => {
    const serverUnit = index + 1;
    const routingProfile = routingVpnProfiles[index] || {};
    const profilePreferredWan = routingProfile.preferredWan || preferredWan;
    const profileFailoverWan = wanStatus.find((wan) => wan.id !== profilePreferredWan)?.id || '';
    const profileEffectiveWan = status.failover_override_active === '1'
      ? effectiveWan
      : onlineWans.find((wan) => wan.id === profilePreferredWan)?.id
        || effectiveWan;
    return {
      ...profile,
      serverUnit,
      interface: routingProfile.interface || `tun2${serverUnit}`,
      subnet: routingProfile.subnet || (serverUnit === 1 ? status.vpn_subnet || '' : ''),
      preferredWan: profilePreferredWan,
      preferredWanLabel: wanLabel(profilePreferredWan),
      failoverWan: profileFailoverWan,
      failoverWanLabel: wanLabel(profileFailoverWan),
      effectiveWan: profileEffectiveWan,
      effectiveWanLabel: wanLabel(profileEffectiveWan),
    };
  });
  const viewer = buildViewerRouting(effectiveState, clientIp);
  const routing = buildRoutingSummary(effectiveState);
  return {
    ...publicNetworkMapState(effectiveState),
    viewer,
    routing,
    googleLocation: buildGoogleLocationPublicStatus(
      googleLocationPolicy,
      viewer,
      routing,
      wanStatus,
    ),
    events: enrichedEvents,
    activeOutages: enrichedActiveOutages,
    stale,
    lastSuccessfulAt,
    eventStorage: {
      persistent: true,
      location: 'panel',
      routerBuffer: 'ram',
      syncIntervalSeconds: ROUTER_EVENT_SYNC_MS / 1000,
      lastSyncAt: routerEventSyncState.lastSuccessAt,
    },
    vpn: {
      enabled: status.vpn_management_enabled === '1',
      interfaceUp: status.vpn_interface_up === '1',
      interface: status.vpn_interface || '',
      policyMode: status.vpn_policy_mode || 'router_default',
      allowInternet: status.vpn_allow_internet !== '0',
      preferredWan,
      preferredWanLabel: wanLabel(preferredWan),
      failoverWan,
      failoverWanLabel: wanLabel(failoverWan),
      effectiveWan,
      effectiveWanLabel: wanLabel(effectiveWan),
      failoverActive: status.failover_override_active === '1',
      profile: readyVpnProfile,
      profiles: publicVpnProfiles,
    },
  };
}

function runLocal(command, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function runCloudflareDdnsSync(stateOverride = null) {
  if (cloudflareDdnsPromise) return cloudflareDdnsPromise;
  cloudflareDdnsPromise = (async () => {
    const state = stateOverride || (await currentPublicState()).state;
    return syncCloudflareDdns(state);
  })().finally(() => {
    cloudflareDdnsPromise = null;
  });
  return cloudflareDdnsPromise;
}

function scheduleCloudflareDdns(delay = CLOUDFLARE_DDNS_SYNC_MS) {
  clearTimeout(cloudflareDdnsTimer);
  cloudflareDdnsTimer = setTimeout(async () => {
    try {
      const config = await loadCloudflareDdnsConfig();
      if (config.enabled) await runCloudflareDdnsSync();
    } catch (error) {
      console.warn(`Cloudflare DDNS synchronization failed: ${error.message}`);
    } finally {
      scheduleCloudflareDdns(CLOUDFLARE_DDNS_SYNC_MS);
    }
  }, delay);
  cloudflareDdnsTimer.unref?.();
}

async function synchronizeServerWan(serverUnit, preferredWan) {
  if (!['wan0', 'wan1'].includes(preferredWan)) {
    return { changed: false, preferredWan };
  }
  const settings = await routerSettings();
  const state = await currentPublicState();
  if (state.state?.status?.failover_override_active === '1') {
    const error = new Error(`VPN Server ${serverUnit} WAN cannot be changed while SmartWAN emergency failover is active.`);
    error.statusCode = 409;
    throw error;
  }

  const smartwan = await readSmartwanConfig(settings);
  const serverSubnet = inferServerSubnetFromSmartwanForm(smartwan.form, serverUnit);
  const smartwanUpdate = setServerWanInSmartwanForm(smartwan.form, preferredWan, serverUnit);
  if (smartwanUpdate.changed) {
    await applySmartwanConfig(settings, smartwanUpdate.form);
  }

  const dualwan = await readDualWan(settings);
  const dualwanUpdate = setServerWanInDualWanForm(
    dualwan.form,
    preferredWan,
    serverUnit,
    serverSubnet,
  );
  if (dualwanUpdate.changed) {
    await applyDualWan(settings, dualwanUpdate.form);
  }
  publicMapCache.expiresAt = 0;
  return {
    changed: smartwanUpdate.changed || dualwanUpdate.changed,
    smartwanChanged: smartwanUpdate.changed,
    dualwanChanged: dualwanUpdate.changed,
    preferredWan,
    serverUnit,
  };
}

function openSshFingerprint(publicKeyLine) {
  const parts = publicKeyLine.trim().split(/\s+/);
  if (parts.length < 2) {
    return '';
  }
  const keyBlob = Buffer.from(parts[1], 'base64');
  const digest = crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/g, '');
  return `SHA256:${digest}`;
}

async function readCurrentPanelKey() {
  const privatePath = path.join(KEY_DIR, 'smartwan_panel_ed25519');
  const publicPath = `${privatePath}.pub`;
  try {
    const publicKey = await fs.readFile(publicPath, 'utf8');
    return {
      exists: true,
      privateKeyPath: privatePath,
      publicKey: publicKey.trim(),
      fingerprint: openSshFingerprint(publicKey),
    };
  } catch (_error) {
    return {
      exists: false,
      privateKeyPath: privatePath,
      publicKey: '',
      fingerprint: '',
    };
  }
}

app.get(
  '/api/health',
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, name: 'SmartWAN Manager' });
  }),
);

app.use('/api/public', requireTrustedLocalRequest);

app.get(
  '/api/public/ui-language',
  asyncRoute(async (_req, res) => {
    const settings = await loadSettings();
    const language = ['pl', 'en'].includes(settings.ui?.language) ? settings.ui.language : 'en';
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ language });
  }),
);

app.post(
  '/api/public/ui-language',
  asyncRoute(async (req, res) => {
    const language = String(req.body?.language || '');
    if (!['pl', 'en'].includes(language)) {
      res.status(400).json({ error: 'Unsupported panel language.' });
      return;
    }
    await saveSettings({ ui: { language } });
    broadcastUiLanguage(language);
    res.json({ language });
  }),
);

app.get('/api/public/ui-language-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  uiLanguageStreams.add(res);
  res.write('event: connected\ndata: {"ok":true}\n\n');

  const keepAlive = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
  }, 25_000);
  const close = () => {
    clearInterval(keepAlive);
    uiLanguageStreams.delete(res);
  };
  req.once('close', close);
  res.once('close', close);
});

app.get(
  '/api/public/network-map',
  asyncRoute(async (req, res) => {
    const value = await publicStatusResponse(req);
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.json(value);
  }),
);

app.get(
  '/api/public/events',
  asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=10');
    res.json(await listWanEvents());
  }),
);

app.get(
  '/api/public/aurelka-messages',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      clientIp: requestClientIp(req),
      messages: await listAurelkaMessages(),
    });
  }),
);

app.get('/api/public/aurelka-message-events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  aurelkaMessageStreams.add(res);
  res.write('event: connected\ndata: {"ok":true}\n\n');

  const keepAlive = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n');
  }, 25_000);
  const close = () => {
    clearInterval(keepAlive);
    aurelkaMessageStreams.delete(res);
  };
  req.once('close', close);
  res.once('close', close);
});

app.post(
  '/api/public/aurelka-messages',
  asyncRoute(async (req, res) => {
    const clientIp = requestClientIp(req);
    const now = Date.now();
    const previous = aurelkaMessageRateLimit.get(clientIp) || 0;
    if (now - previous < 15_000) {
      res.status(429).json({ error: 'Aurelka odpoczywa. Spróbuj ponownie za kilkanaście sekund.' });
      return;
    }
    const nickname = String(req.body?.nickname || '');
    const message = String(req.body?.message || '');
    if (nickname.length > 24 || message.length > 180) {
      res.status(400).json({ error: 'Nick lub wiadomość są zbyt długie.' });
      return;
    }
    try {
      const saved = await addAurelkaMessage({ nickname, message, authorIp: clientIp });
      aurelkaMessageRateLimit.set(clientIp, now);
      broadcastAurelkaMessage(saved);
      res.status(201).json({ message: saved });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }),
);

app.get(
  '/api/public/aurelka-preferences',
  asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await readAurelkaPreferences({
      clientIp: requestClientIp(req),
      browserId: String(req.query?.browserId || ''),
    }));
  }),
);

app.post(
  '/api/public/aurelka-preferences',
  asyncRoute(async (req, res) => {
    try {
      const saved = await saveAurelkaPreferences({
        clientIp: requestClientIp(req),
        browserId: String(req.body?.browserId || ''),
        soundEnabled: req.body?.soundEnabled !== false,
        animationEnabled: req.body?.animationEnabled !== false,
        nickname: String(req.body?.nickname || ''),
      });
      res.json({
        saved: true,
        soundEnabled: saved.soundEnabled,
        animationEnabled: saved.animationEnabled,
        nickname: saved.nickname,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }),
);

app.get(
  '/api/public/vpn-profile',
  asyncRoute(async (req, res) => {
    const profile = await loadReadyOpenVpnProfile({
      includeContent: true,
      server: Number(req.query?.server || 1),
    });
    if (!profile.available) {
      res.status(404).json({ error: 'A ready OpenVPN client profile has not been saved yet.' });
      return;
    }
    if (String(req.query?.transport || '') === 'tailscale') {
      res.status(410).json({
        error: 'Tailscale is a separate exit-node connection and does not use an OpenVPN profile.',
      });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/x-openvpn-profile; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${profile.filename}"`);
    res.send(profile.content);
  }),
);

app.get(
  '/api/auth/status',
  asyncRoute(async (req, res) => {
    res.json(authSummary(await loadSettings(), req));
  }),
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const settings = await loadSettings();
    const summary = authSummary(settings, req);
    if (!summary.configured) {
      res.status(503).json({
        error: 'Panel login is not configured. Set it from the Raspberry Pi terminal.',
        resetCommand: summary.resetCommand,
      });
      return;
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const expectedUsername = settings.auth?.username || 'admin';
    const candidate = hashPassword(password, settings.auth.passwordSalt);
    if (username !== expectedUsername || !safeEqual(candidate, settings.auth.passwordHash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = createSessionToken(settings, username);
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.json({ authenticated: true, username, configured: true });
  }),
);

app.post(
  '/api/auth/logout',
  asyncRoute(async (_req, res) => {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    res.json({ authenticated: false });
  }),
);

app.use(requirePanelAuth);

app.get(
  '/api/settings',
  asyncRoute(async (_req, res) => {
    res.json(redactSettings(await loadSettings()));
  }),
);

app.post(
  '/api/settings',
  asyncRoute(async (req, res) => {
    const saved = await saveSettings(req.body || {});
    res.json(redactSettings(saved));
  }),
);

app.post(
  '/api/ssh/test',
  asyncRoute(async (_req, res) => {
    res.json(await testConnection(await routerSettings()));
  }),
);

app.get(
  '/api/ssh/panel-key',
  asyncRoute(async (_req, res) => {
    res.json(await readCurrentPanelKey());
  }),
);

app.post(
  '/api/ssh/panel-key',
  asyncRoute(async (req, res) => {
    await fs.mkdir(KEY_DIR, { recursive: true });
    const keyPath = path.join(KEY_DIR, 'smartwan_panel_ed25519');
    const overwrite = Boolean(req.body?.overwrite);
    const passphrase = String(req.body?.passphrase || '');
    const comment = String(req.body?.comment || 'smartwan-manager');

    try {
      await fs.access(keyPath);
      if (!overwrite) {
        res.status(409).json({ error: 'Panel key already exists. Set overwrite=true to replace it.' });
        return;
      }
      await fs.rm(keyPath, { force: true });
      await fs.rm(`${keyPath}.pub`, { force: true });
    } catch (_error) {
      // Key does not exist yet.
    }

    const result = await runLocal('ssh-keygen', ['-t', 'ed25519', '-N', passphrase, '-C', comment, '-f', keyPath]);
    if (result.code !== 0) {
      throw new Error(result.stderr || 'ssh-keygen failed');
    }
    await fs.chmod(keyPath, 0o600);
    res.json(await readCurrentPanelKey());
  }),
);

app.post(
  '/api/ssh/host-key',
  asyncRoute(async (_req, res) => {
    const settings = await routerSettings();
    const result = await runLocal('ssh-keyscan', ['-T', '5', '-p', String(settings.port), settings.host]);
    const keys = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => ({
        line,
        fingerprint: openSshFingerprint(line.replace(/^\S+\s+/, '')),
      }));
    res.json({ code: result.code, stderr: result.stderr.trim(), keys });
  }),
);

app.get(
  '/api/router/state',
  asyncRoute(async (_req, res) => {
    const settings = await routerSettings();
    const state = await serializedRouterRead(() => probeRouter(settings));
    if (state?.status?.failover_override_active !== '1') {
      res.json(state);
      return;
    }

    // The event that activated the current failover is the stable source for
    // its failure kind and diagnosis. Later probes can fluctuate after routes
    // have already been overridden, so every authenticated view must use the
    // same confirmed outage classification as the login/public status.
    const events = await listWanEvents();
    res.json(applyActiveOutages(state, Object.values(events.activeOutages || {})));
  }),
);

app.get(
  '/api/router/config',
  asyncRoute(async (_req, res) => {
    res.json(await readSmartwanConfig(await routerSettings()));
  }),
);

app.get(
  '/api/router/dualwan',
  asyncRoute(async (_req, res) => {
    res.json(await readDualWan(await routerSettings()));
  }),
);

app.get(
  '/api/router/dmz',
  asyncRoute(async (_req, res) => {
    res.json(await readDmzPolicy(await routerSettings()));
  }),
);

app.put(
  '/api/router/dmz',
  asyncRoute(async (req, res) => {
    const result = await applyDmzPolicy(await routerSettings(), req.body || {});
    const policy = result.policy;
    await recordManualEvent({
      type: 'dmz-config',
      action: policy.enabled
        ? `Managed DMZ for ${policy.targetIp} uses ${policy.preferredWan}; failover mode: ${policy.failoverMode}.`
        : 'Managed DMZ was disabled.',
      profile: 'SmartWAN DMZ',
      summary: policy.enabled
        ? 'Administrator applied a managed DMZ policy.'
        : 'Administrator disabled the managed DMZ policy.',
      username: authenticatedUser(req, await loadSettings()) || 'admin',
      change: {
        enabled: policy.enabled,
        targetIp: policy.targetIp,
        preferredWan: policy.preferredWan,
        failoverMode: policy.failoverMode,
      },
    });
    publicMapCache.expiresAt = 0;
    res.json(result);
  }),
);

app.post(
  '/api/router/dualwan/apply',
  asyncRoute(async (req, res) => {
    const result = await applyDualWan(await routerSettings(), req.body || {});
    const ddnsConfig = await loadCloudflareDdnsConfig();
    const smartwanConfig = await readSmartwanConfig(await routerSettings());
    const ddnsServerSubnet = inferServerSubnetFromSmartwanForm(
      smartwanConfig.form,
      ddnsConfig.serverUnit,
    );
    const ddnsServerWan = inferServerWanFromRules(
      req.body?.rules || [],
      ddnsConfig.serverUnit,
      ddnsServerSubnet,
    );
    if (ddnsServerWan) {
      await setCloudflareDdnsPreferredWan(ddnsServerWan);
      const smartwanUpdate = setServerWanInSmartwanForm(
        smartwanConfig.form,
        ddnsServerWan,
        ddnsConfig.serverUnit,
      );
      if (smartwanUpdate.changed) {
        await applySmartwanConfig(await routerSettings(), smartwanUpdate.form);
      }
      scheduleCloudflareDdns(1_000);
    }
    await recordManualEvent({
      type: 'dualwan-config',
      action: 'ASUS Dual WAN configuration changed from the panel.',
      profile: req.body?.mode === 'lb' ? 'Dual WAN — Load Balance' : 'Dual WAN — Failover',
      summary: 'Administrator applied a new Dual WAN routing configuration.',
      username: authenticatedUser(req, await loadSettings()) || 'admin',
      change: result.change,
    });
    res.json(result);
  }),
);

app.get(
  '/api/router/dualwan/presets',
  asyncRoute(async (_req, res) => {
    res.json(await listDualWanPresets(await routerSettings()));
  }),
);

app.get(
  '/api/router/dualwan/routing-groups',
  asyncRoute(async (req, res) => {
    const current = await readDualWan(await routerSettings());
    res.json(req.query.refresh === '1'
      ? await resetRoutingGroups(current.form?.rules || [])
      : await loadRoutingGroups(current.form?.rules || []));
  }),
);

app.put(
  '/api/router/dualwan/routing-groups',
  asyncRoute(async (req, res) => {
    res.json(await saveRoutingGroups(req.body?.groups || []));
  }),
);

app.get(
  '/api/router/dualwan/ai-provider',
  asyncRoute(async (_req, res) => {
    res.json(await loadAiProviderConfig());
  }),
);

app.put(
  '/api/router/dualwan/ai-provider',
  asyncRoute(async (req, res) => {
    res.json(await saveAiProviderConfig(req.body || {}));
  }),
);

app.post(
  '/api/router/dualwan/ai-generate',
  asyncRoute(async (req, res) => {
    res.json(await generateRoutingRulesWithAi(req.body?.prompt));
  }),
);

app.get(
  '/api/router/dualwan/google-location-policy',
  asyncRoute(async (_req, res) => {
    res.json(await loadGoogleLocationPolicy());
  }),
);

app.put(
  '/api/router/dualwan/google-location-policy',
  asyncRoute(async (req, res) => {
    const saved = await saveGoogleLocationPolicy(req.body || {});
    scheduleGoogleLocationPolicy(saved.enabled ? 2_000 : 60_000);
    res.json(saved);
  }),
);

app.post(
  '/api/router/dualwan/google-location-policy/check',
  asyncRoute(async (_req, res) => {
    if (!googleLocationPolicyPromise) {
      googleLocationPolicyPromise = serializedRouterRead(async () => (
        runGoogleLocationPolicy(await routerSettings(), { force: true })
      )).finally(() => {
        googleLocationPolicyPromise = null;
      });
    }
    const result = await googleLocationPolicyPromise;
    if (result?.applied) publicMapCache.expiresAt = 0;
    res.json(result);
  }),
);

app.post(
  '/api/router/dualwan/presets',
  asyncRoute(async (req, res) => {
    res.json(await saveDualWanPreset(await routerSettings(), req.body?.name, req.body?.config));
  }),
);

app.post(
  '/api/router/dualwan/presets/:name/activate',
  asyncRoute(async (req, res) => {
    res.json(await activateDualWanPreset(await routerSettings(), req.params.name));
  }),
);

app.delete(
  '/api/router/dualwan/presets/:name',
  asyncRoute(async (req, res) => {
    res.json(await deleteDualWanPreset(await routerSettings(), req.params.name));
  }),
);

app.post(
  '/api/router/config/apply',
  asyncRoute(async (req, res) => {
    const result = await applySmartwanConfig(await routerSettings(), req.body || {});
    const ddnsConfig = await loadCloudflareDdnsConfig();
    const ddnsServerWan = inferServerWanFromSmartwanForm(
      req.body || {},
      ddnsConfig.serverUnit,
    );
    if (ddnsServerWan) {
      await setCloudflareDdnsPreferredWan(ddnsServerWan);
      await synchronizeServerWan(ddnsConfig.serverUnit, ddnsServerWan);
      scheduleCloudflareDdns(1_000);
    }
    await recordManualEvent({
      type: 'smartwan-config',
      action: 'SmartWAN configuration and routing rules applied.',
      profile: req.body?.activePreset || req.body?.routingMode || 'SmartWAN',
      summary: 'Administrator applied SmartWAN settings.',
      username: authenticatedUser(req, await loadSettings()) || 'admin',
    });
    publicMapCache.expiresAt = 0;
    res.json(result);
  }),
);

app.post(
  '/api/router/config/rollback',
  asyncRoute(async (req, res) => {
    const result = await rollbackSmartwanConfig(await routerSettings());
    await recordManualEvent({
      type: 'smartwan-rollback',
      action: 'Previous SmartWAN configuration restored.',
      profile: 'Restored configuration',
      summary: 'Administrator rolled back SmartWAN settings.',
      username: authenticatedUser(req, await loadSettings()) || 'admin',
    });
    publicMapCache.expiresAt = 0;
    res.json(result);
  }),
);

app.get(
  '/api/events',
  asyncRoute(async (req, res) => {
    const {
      state,
      stale,
      lastSuccessfulAt,
    } = await currentPublicState();
    const data = await listWanEvents();
    const effectiveState = applyActiveOutages(state, data.activeOutages);
    res.json({
      ...data,
      viewer: buildViewerRouting(effectiveState, requestClientIp(req)),
      routing: buildRoutingSummary(effectiveState),
      stale,
      lastSuccessfulAt,
      eventStorage: {
        persistent: true,
        location: 'panel',
        routerBuffer: 'ram',
        syncIntervalSeconds: ROUTER_EVENT_SYNC_MS / 1000,
        ...routerEventSyncState,
      },
      monitoring: {
        failThreshold: Number(state?.status?.watchdog_fail_count || state?.config?.values?.watchdog_fail_count || 1),
        recoveryThreshold: Number(state?.status?.watchdog_recover_count || state?.config?.values?.watchdog_recover_count || 2),
        intervalSeconds: Number(state?.status?.watchdog_interval || state?.config?.values?.watchdog_interval || 30),
      },
    });
  }),
);

app.post(
  '/api/router/vpn/export-policy',
  asyncRoute(async (req, res) => {
    res.json(exportVpnPolicy(req.body || {}));
  }),
);

app.get(
  '/api/router/vpn/client-profile',
  asyncRoute(async (req, res) => {
    res.json(await readOpenVpnClientProfile(
      await routerSettings(),
      Number(req.query?.server || 1),
    ));
  }),
);

app.get(
  '/api/router/vpn/client-profile/ready',
  asyncRoute(async (req, res) => {
    const profile = await loadReadyOpenVpnProfile({
      includeContent: true,
      server: Number(req.query?.server || 1),
    });
    if (!profile.available) {
      res.status(404).json({ error: 'A ready OpenVPN client profile has not been saved yet.' });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(profile);
  }),
);

app.post(
  '/api/router/vpn/client-profile/ready',
  asyncRoute(async (req, res) => {
    const saved = await saveReadyOpenVpnProfile(req.body || {});
    publicMapCache.expiresAt = 0;
    res.json(saved);
  }),
);

app.get(
  '/api/router/vpn/cloudflare-ddns',
  asyncRoute(async (_req, res) => {
    let config = await loadCloudflareDdnsConfig();
    const dualwan = await readDualWan(await routerSettings()).catch(() => null);
    const smartwan = await readSmartwanConfig(await routerSettings()).catch(() => null);
    const routedWan = inferServerWanFromRules(
      dualwan?.form?.rules || [],
      config.serverUnit,
      inferServerSubnetFromSmartwanForm(smartwan?.form || {}, config.serverUnit),
    );
    if (routedWan && routedWan !== config.preferredWan) {
      config = await setCloudflareDdnsPreferredWan(routedWan);
    }
    res.json(config);
  }),
);

app.put(
  '/api/router/vpn/cloudflare-ddns',
  asyncRoute(async (req, res) => {
    const previous = await loadCloudflareDdnsConfig();
    const saved = await saveCloudflareDdnsConfig(req.body || {});
    let routingSync = { changed: false, preferredWan: saved.preferredWan };
    if (['wan0', 'wan1'].includes(saved.preferredWan)) {
      try {
        routingSync = await synchronizeServerWan(saved.serverUnit, saved.preferredWan);
      } catch (error) {
        await setCloudflareDdnsPreferredWan(previous.preferredWan);
        throw error;
      }
    }
    if (saved.enabled) scheduleCloudflareDdns(1_000);
    res.json({ ...saved, routingSync });
  }),
);

app.post(
  '/api/router/vpn/cloudflare-ddns/sync',
  asyncRoute(async (_req, res) => {
    res.json(await runCloudflareDdnsSync());
  }),
);

app.get(
  '/api/router/vpn/tailscale',
  asyncRoute(async (_req, res) => {
    res.json(await getTailscaleStatus({ refresh: true }));
  }),
);

app.put(
  '/api/router/vpn/tailscale',
  asyncRoute(async (req, res) => {
    res.json(await saveTailscaleAccessConfig(req.body || {}));
  }),
);

app.post(
  '/api/router/vpn/tailscale/start',
  asyncRoute(async (req, res) => {
    res.json(await startTailscaleAccess(req.body || {}));
  }),
);

app.post(
  '/api/router/vpn/tailscale/stop',
  asyncRoute(async (_req, res) => {
    res.json(await stopTailscaleAccess());
  }),
);

app.get(
  '/api/router/presets',
  asyncRoute(async (_req, res) => {
    res.json(await listPresets(await routerSettings()));
  }),
);

app.post(
  '/api/router/presets',
  asyncRoute(async (req, res) => {
    res.json(await savePreset(await routerSettings(), req.body?.name, req.body?.configText));
  }),
);

app.get(
  '/api/router/presets/:name',
  asyncRoute(async (req, res) => {
    res.json(await readPreset(await routerSettings(), req.params.name));
  }),
);

app.post(
  '/api/router/presets/:name/activate',
  asyncRoute(async (req, res) => {
    res.json(await activatePreset(await routerSettings(), req.params.name));
  }),
);

app.delete(
  '/api/router/presets/:name',
  asyncRoute(async (req, res) => {
    res.json(await deletePreset(await routerSettings(), req.params.name));
  }),
);

app.post(
  '/api/router/scripts/install',
  asyncRoute(async (req, res) => {
    res.json(await installRouterScripts(await routerSettings(), req.body || {}));
  }),
);

app.get(
  '/api/router/setup-wizard',
  asyncRoute(async (_req, res) => {
    res.json(await getRouterSetupWizard(await routerSettings()));
  }),
);

app.post(
  '/api/router/setup-wizard/preview',
  asyncRoute(async (req, res) => {
    res.json(await previewRouterSetupWizard(await routerSettings(), req.body || {}));
  }),
);

app.post(
  '/api/router/setup-wizard/capture',
  asyncRoute(async (req, res) => {
    res.json(await captureRouterSetupProfile(await routerSettings(), req.body || {}));
  }),
);

app.post(
  '/api/router/setup-wizard/apply-profile',
  asyncRoute(async (req, res) => {
    res.json(await applySavedRouterSetupProfile(await routerSettings(), req.body || {}));
  }),
);

app.post(
  '/api/router/setup-wizard/apply',
  asyncRoute(async (req, res) => {
    res.json(await applyRouterSetupWizard(await routerSettings(), req.body || {}));
  }),
);

app.post(
  '/api/backups/create',
  asyncRoute(async (req, res) => {
    const kind = String(req.body?.kind || 'full');
    const settings = await routerSettings();
    if (kind === 'router') {
      res.json(await createRouterBackup(settings));
      return;
    }
    if (kind === 'smartwan') {
      res.json(await createSmartWanBackup(settings));
      return;
    }
    res.json(await createFullBackup(settings));
  }),
);

app.post(
  '/api/backups/restore',
  asyncRoute(async (req, res) => {
    res.json(await restoreBackup(await routerSettings(), req.body || {}));
  }),
);

app.get(
  '/api/tools/wan-quality/history',
  asyncRoute(async (_req, res) => {
    res.json(await listWanQualityHistory());
  }),
);

app.post(
  '/api/tools/wan-quality/preview',
  asyncRoute(async (req, res) => {
    res.json(await previewWanQuality(await routerSettings(), req.body || {}));
  }),
);

app.post(
  '/api/tools/wan-quality/run',
  asyncRoute(async (req, res) => {
    res.json(await runWanQualityTest(await routerSettings(), req.body || {}));
  }),
);

const distPath = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  setHeaders(response, filePath) {
    if (filePath.endsWith('index.html')) {
      response.setHeader('Cache-Control', 'no-store');
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));
app.get('/{*splat}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(Number(error.statusCode) || 500).json({
    error: error.message || 'Unexpected server error',
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`SmartWAN Manager listening on http://0.0.0.0:${port}`);
  void initializeTailscaleAccess();
  scheduleRouterEventSync();
  scheduleGoogleLocationPolicy();
  scheduleCloudflareDdns(5_000);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    shutdownTailscaleAccess();
    process.exit(0);
  });
}
