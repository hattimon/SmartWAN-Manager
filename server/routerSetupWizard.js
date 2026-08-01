import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';
import { createFullBackup } from './backupOps.js';
import { applyDualWan, readDualWan } from './dualWanOps.js';
import {
  applySmartwanConfig,
  installRouterScripts,
  probeRouter,
  readSmartwanConfig,
} from './routerOps.js';
import { execCommand } from './sshClient.js';

const PROFILE_FILE = path.join(DATA_DIR, 'router-setup-profile.json');
const BACKUP_DIR = path.join(DATA_DIR, 'router-setup-backups');

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? String(Math.min(max, Math.max(min, Math.round(parsed))))
    : String(fallback);
}

function normalizeTargets(value, fallback = '') {
  return String(value || fallback)
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');
}

function safeLabel(value, fallback) {
  return String(value || fallback || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['rawDualWan', 'rawRuleList', 'rulesSource'].includes(key))
        .map(([key, item]) => [key, comparable(item)]),
    );
  }
  return value;
}

function flatten(value, prefix = '', output = {}) {
  if (Array.isArray(value)) {
    output[prefix] = JSON.stringify(value);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output[prefix] = String(value ?? '');
  return output;
}

export function compareSetupProfiles(current, desired) {
  const before = flatten(comparable({
    dualWan: current?.dualWan,
    smartwan: current?.smartwan,
  }));
  const after = flatten(comparable({
    dualWan: desired?.dualWan,
    smartwan: desired?.smartwan,
  }));
  return Object.keys(after)
    .filter((key) => before[key] !== after[key])
    .map((key) => ({ key, current: before[key] || '', desired: after[key] || '' }));
}

export function buildWizardProfile(current, answers = {}) {
  const dualWan = current.dualWan || {};
  const smartwan = current.smartwan || {};
  const wan0Label = safeLabel(answers.wan0Label, smartwan.wan0Label || 'WAN0');
  const wan1Label = safeLabel(answers.wan1Label, smartwan.wan1Label || 'WAN1');
  return {
    kind: 'smartwan-router-setup-profile',
    version: 1,
    name: safeLabel(answers.name, 'SmartWAN — sprawdzona konfiguracja'),
    createdAt: new Date().toISOString(),
    identity: current.identity,
    dualWan: {
      ...dualWan,
      enabled: answers.dualWanEnabled !== false,
      primary: String(answers.primaryPort || dualWan.primary || 'wan'),
      secondary: String(answers.secondaryPort || dualWan.secondary || 'lan'),
      mode: answers.mode === 'fo' ? 'fo' : 'lb',
      ratioPrimary: boundedInteger(answers.ratioPrimary, dualWan.ratioPrimary || 9, 1, 100),
      ratioSecondary: boundedInteger(answers.ratioSecondary, dualWan.ratioSecondary || 1, 1, 100),
      routingEnabled: answers.routingEnabled !== false,
      rules: Array.isArray(dualWan.rules) ? dualWan.rules : [],
    },
    smartwan: {
      ...smartwan,
      enabled: true,
      orchestrationEnabled: true,
      orchestrationMode: 'dualwan_balanced_managed',
      autoDiscoverWans: true,
      healthProbeStrategy: 'per_wan_public_ipv4',
      healthProbePolicy: 'majority',
      failoverAction: 'runtime_policy_override',
      restoreAction: 'restore_dualwan_balance',
      suspendAsusRulesOnFailover: true,
      restoreAsusRulesOnRecovery: true,
      conntrackOnSwitch: 'failed_wan',
      manageMainDefault: false,
      wan0Label,
      wan1Label,
      domainRulesEnabled: false,
      watchdogEnabled: true,
      watchdogTargets: normalizeTargets(
        answers.watchdogTargets,
        smartwan.watchdogTargets || '1.1.1.1\n8.8.8.8',
      ),
      watchdogInterval: boundedInteger(
        answers.watchdogInterval,
        smartwan.watchdogInterval || 1,
        1,
        30,
      ),
      watchdogFailCount: boundedInteger(
        answers.watchdogFailCount,
        smartwan.watchdogFailCount || 2,
        1,
        5,
      ),
      watchdogRecoverCount: boundedInteger(
        answers.watchdogRecoverCount,
        smartwan.watchdogRecoverCount || 3,
        1,
        10,
      ),
      vpnManagementEnabled: answers.vpnManagementEnabled !== false,
      vpnSubnet: String(answers.vpnSubnet || smartwan.vpnSubnet || '10.8.0.0/24').trim(),
      vpnLanSubnet: String(answers.lanSubnet || smartwan.vpnLanSubnet || '192.168.1.0/24').trim(),
      vpnPolicyMode: 'prefer_wan_with_failover',
      runtimeDir: '/tmp',
      logEnabled: true,
    },
    exclusions: [
      'Wi-Fi and PPPoE passwords',
      'VPN certificates and credentials',
      'SSH keys',
      'dynamic public IP, WAN lease, gateway and DNS data',
    ],
  };
}

async function currentSetupState(settings) {
  const [router, dualWan, smartwan] = await Promise.all([
    probeRouter(settings),
    readDualWan(settings),
    readSmartwanConfig(settings),
  ]);
  if (!dualWan.ok) throw new Error(dualWan.stderr || 'Could not read ASUS Dual WAN.');
  return {
    identity: router.identity || {},
    dualWan: dualWan.form,
    smartwan: smartwan.form,
    runtime: {
      files: router.files || {},
      status: router.status || {},
    },
  };
}

function assertCompatible(current, profile) {
  const actualModel = String(current.identity?.model || '');
  const expectedModel = String(profile.identity?.model || '');
  const actualFirmware = String(current.identity?.firmware || '');
  const expectedFirmware = String(profile.identity?.firmware || '');
  if (!expectedModel || actualModel !== expectedModel) {
    throw new Error(`Router model mismatch: expected ${expectedModel || 'unknown'}, detected ${actualModel || 'unknown'}.`);
  }
  if (expectedFirmware && actualFirmware !== expectedFirmware) {
    throw new Error(`Router firmware mismatch: expected ${expectedFirmware}, detected ${actualFirmware || 'unknown'}.`);
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readSavedProfile() {
  try {
    return JSON.parse(await fs.readFile(PROFILE_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

export async function getRouterSetupWizard(settings) {
  const current = await currentSetupState(settings);
  const profile = await readSavedProfile();
  let compatible = false;
  if (profile) {
    try {
      assertCompatible(current, profile);
      compatible = true;
    } catch (_error) {
      compatible = false;
    }
  }
  return {
    current,
    profile,
    compatible,
    changes: profile ? compareSetupProfiles(current, profile) : [],
  };
}

export async function previewRouterSetupWizard(settings, answers = {}) {
  const current = await currentSetupState(settings);
  const profile = buildWizardProfile(current, answers);
  return {
    current,
    profile,
    compatible: true,
    changes: compareSetupProfiles(current, profile),
  };
}

export async function captureRouterSetupProfile(settings, input = {}) {
  const current = await currentSetupState(settings);
  const profile = {
    kind: 'smartwan-router-setup-profile',
    version: 1,
    name: safeLabel(input.name, 'SmartWAN — sprawdzona konfiguracja'),
    createdAt: new Date().toISOString(),
    identity: current.identity,
    dualWan: current.dualWan,
    smartwan: current.smartwan,
    exclusions: [
      'Wi-Fi and PPPoE passwords',
      'VPN certificates and credentials',
      'SSH keys',
      'dynamic public IP and WAN lease data',
    ],
  };
  await writeJsonAtomic(PROFILE_FILE, profile);
  return { current, profile, compatible: true, changes: [] };
}

async function savePreApplyBackup(settings) {
  const backup = await createFullBackup(settings);
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeJsonAtomic(path.join(BACKUP_DIR, filename), backup);
  return filename;
}

async function applyProfile(settings, profile, _options = {}) {
  const current = await currentSetupState(settings);
  assertCompatible(current, profile);
  const backupFile = await savePreApplyBackup(settings);

  await execCommand(settings, 'nvram set jffs2_scripts=1 && nvram commit', { timeoutMs: 10000 });
  const scripts = await installRouterScripts(settings, { preserveConfig: true });
  const smartwan = await applySmartwanConfig(settings, profile.smartwan);
  const dualWan = await applyDualWan(settings, profile.dualWan);

  return {
    ok: dualWan.ok && dualWan.verified && smartwan.apply.code === 0,
    backupFile,
    scripts,
    smartwan,
    dualWan,
    appliedProfile: profile,
  };
}

export async function applySavedRouterSetupProfile(settings, options = {}) {
  if (options.confirm !== 'APPLY PROFILE') throw new Error('Exact confirmation APPLY PROFILE is required.');
  const profile = await readSavedProfile();
  if (!profile) throw new Error('No saved router setup profile exists.');
  return applyProfile(settings, profile, options);
}

export async function applyRouterSetupWizard(settings, input = {}) {
  if (input.confirm !== 'APPLY WIZARD') throw new Error('Exact confirmation APPLY WIZARD is required.');
  const preview = await previewRouterSetupWizard(settings, input.answers || {});
  const result = await applyProfile(settings, preview.profile, input);
  if (input.saveAsProfile !== false) await writeJsonAtomic(PROFILE_FILE, preview.profile);
  return result;
}
