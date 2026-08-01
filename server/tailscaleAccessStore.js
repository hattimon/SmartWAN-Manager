import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './configStore.js';

const CONFIG_FILE = path.join(DATA_DIR, 'tailscale-access.json');
const STATE_DIR = path.join(DATA_DIR, 'tailscale');
const STATE_FILE = path.join(STATE_DIR, 'tailscaled.state');
const SOCKET_FILE = path.join(STATE_DIR, 'tailscaled.sock');
const DEFAULT_ROUTE = '192.168.1.0/24';
const STATUS_CACHE_MS = 3_000;
const MAX_LOG_LINES = 80;

let daemonProcess = null;
let loginProcess = null;
let lastAuthUrl = '';
let runtimeError = '';
let runtimeLogs = [];
let statusCache = { expiresAt: 0, value: null };

const defaultConfig = {
  version: 1,
  enabled: false,
  hostname: 'smartwan-panel',
  advertiseRoutes: [DEFAULT_ROUTE],
  advertiseExitNode: false,
  savedAt: '',
};

function appendLog(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  runtimeLogs = [...runtimeLogs, ...lines].slice(-MAX_LOG_LINES);
}

function normalizeHostname(value) {
  const hostname = String(value || defaultConfig.hostname).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) {
    throw new Error('Tailscale device name may contain only letters, numbers, and hyphens.');
  }
  return hostname;
}

function validIpv4(value) {
  const parts = String(value || '').split('.').map(Number);
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

function normalizeRoute(value) {
  const route = String(value || '').trim();
  const [address, prefixText] = route.split('/');
  const prefix = Number(prefixText);
  if (!validIpv4(address) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid IPv4 subnet advertised by Tailscale: ${route}`);
  }
  return `${address}/${prefix}`;
}

function normalizeConfig(input = {}) {
  const rawRoutes = Array.isArray(input.advertiseRoutes)
    ? input.advertiseRoutes
    : String(input.advertiseRoutes || DEFAULT_ROUTE).split(/[,\s]+/);
  const advertiseRoutes = [...new Set(rawRoutes.map(normalizeRoute))].slice(0, 8);
  if (!advertiseRoutes.length) throw new Error('At least one local subnet must be advertised.');
  return {
    version: 1,
    enabled: input.enabled === true,
    hostname: normalizeHostname(input.hostname),
    advertiseRoutes,
    advertiseExitNode: input.advertiseExitNode === true,
    savedAt: String(input.savedAt || ''),
  };
}

export function validateTailscaleAccessConfig(input = {}) {
  return normalizeConfig(input);
}

async function binaryAvailable(command) {
  try {
    await fs.access(`/usr/local/bin/${command}`);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function waitForSocket(timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.stat(SOCKET_FILE);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  return false;
}

async function daemonResponds() {
  if (!(await binaryAvailable('tailscale'))) return false;
  try {
    const result = await runCommand(
      '/usr/local/bin/tailscale',
      [`--socket=${SOCKET_FILE}`, 'status', '--json'],
      { timeoutMs: 2_500 },
    );
    return Boolean(result.stdout.trim());
  } catch {
    return false;
  }
}

export function tailscalePreferenceArgs(config) {
  return [
    `--hostname=${config.hostname}`,
    `--advertise-routes=${config.advertiseRoutes.join(',')}`,
    `--advertise-exit-node=${config.advertiseExitNode ? 'true' : 'false'}`,
    '--accept-dns=false',
  ];
}

async function applyPreferences(config) {
  await ensureDaemon();
  const result = await runCommand(
    '/usr/local/bin/tailscale',
    [
      `--socket=${SOCKET_FILE}`,
      'set',
      ...tailscalePreferenceArgs(config),
    ],
    { timeoutMs: 10_000 },
  );
  appendLog(result.stdout);
  appendLog(result.stderr);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Tailscale rejected the requested routing settings.');
  }
  runtimeError = '';
  statusCache.expiresAt = 0;
}

async function ensureDaemon() {
  if (!(await binaryAvailable('tailscaled')) || !(await binaryAvailable('tailscale'))) {
    throw new Error('Tailscale binaries are not installed in this panel container yet.');
  }
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  if (await daemonResponds()) return;
  if (daemonProcess && daemonProcess.exitCode === null) {
    if (await waitForSocket()) return;
    throw new Error('Tailscale daemon started but its control socket is unavailable.');
  }

  try {
    await fs.unlink(SOCKET_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  runtimeError = '';
  daemonProcess = spawn('/usr/local/bin/tailscaled', [
    `--state=${STATE_FILE}`,
    `--socket=${SOCKET_FILE}`,
    '--tun=tailscale0',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  daemonProcess.stdout.on('data', appendLog);
  daemonProcess.stderr.on('data', appendLog);
  daemonProcess.once('error', (error) => {
    runtimeError = error.message;
    appendLog(error.message);
  });
  daemonProcess.once('close', (code, signal) => {
    if (code && !runtimeError) runtimeError = `tailscaled stopped with code ${code}${signal ? ` (${signal})` : ''}.`;
    daemonProcess = null;
    statusCache.expiresAt = 0;
  });
  if (!(await waitForSocket())) {
    throw new Error(runtimeError || 'Tailscale daemon did not create its control socket.');
  }
}

export async function loadTailscaleAccessConfig() {
  try {
    return normalizeConfig(JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not load Tailscale access settings: ${error.message}`);
    return { ...defaultConfig, advertiseRoutes: [...defaultConfig.advertiseRoutes] };
  }
}

export async function saveTailscaleAccessConfig(input = {}) {
  const current = await loadTailscaleAccessConfig();
  const config = normalizeConfig({ ...current, ...input });
  config.savedAt = new Date().toISOString();
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${CONFIG_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, CONFIG_FILE);
  statusCache.expiresAt = 0;
  if (config.enabled) {
    await ensureDaemon();
    const status = await getTailscaleStatus({ refresh: true });
    if (status.connected) await applyPreferences(config);
  }
  return getTailscaleStatus({ refresh: true });
}

function publicStatusFromJson(config, value = {}) {
  const self = value.Self || {};
  return {
    installed: true,
    enabled: config.enabled,
    connected: value.BackendState === 'Running' && self.Online !== false,
    needsLogin: value.BackendState === 'NeedsLogin' || value.BackendState === 'NoState',
    backendState: value.BackendState || 'Unknown',
    hostname: config.hostname,
    deviceName: self.HostName || config.hostname,
    dnsName: String(self.DNSName || '').replace(/\.$/, ''),
    tailscaleIps: Array.isArray(value.TailscaleIPs) ? value.TailscaleIPs : [],
    advertiseRoutes: config.advertiseRoutes,
    advertiseExitNode: config.advertiseExitNode,
    tailnet: value.CurrentTailnet?.Name || value.MagicDNSSuffix || '',
    authUrl: lastAuthUrl,
    lastError: runtimeError,
    savedAt: config.savedAt,
  };
}

export async function getTailscaleStatus({ refresh = false } = {}) {
  if (!refresh && statusCache.value && statusCache.expiresAt > Date.now()) {
    return statusCache.value;
  }
  const config = await loadTailscaleAccessConfig();
  const installed = await binaryAvailable('tailscale') && await binaryAvailable('tailscaled');
  if (!installed) {
    const value = {
      installed: false,
      enabled: config.enabled,
      connected: false,
      needsLogin: false,
      backendState: 'NotInstalled',
      hostname: config.hostname,
      deviceName: config.hostname,
      dnsName: '',
      tailscaleIps: [],
      advertiseRoutes: config.advertiseRoutes,
      advertiseExitNode: config.advertiseExitNode,
      tailnet: '',
      authUrl: '',
      lastError: 'Tailscale binaries are not installed in this panel container.',
      savedAt: config.savedAt,
    };
    statusCache = { expiresAt: Date.now() + STATUS_CACHE_MS, value };
    return value;
  }
  if (config.enabled) {
    try {
      await ensureDaemon();
    } catch (error) {
      runtimeError = error.message;
    }
  }
  let parsed = {};
  if (config.enabled || await daemonResponds()) {
    try {
      const result = await runCommand(
        '/usr/local/bin/tailscale',
        [`--socket=${SOCKET_FILE}`, 'status', '--json'],
        { timeoutMs: 3_000 },
      );
      parsed = JSON.parse(result.stdout || '{}');
    } catch (error) {
      runtimeError = error.message;
    }
  }
  const value = publicStatusFromJson(config, parsed);
  statusCache = { expiresAt: Date.now() + STATUS_CACHE_MS, value };
  return value;
}

export async function startTailscaleAccess(input = {}) {
  const status = await saveTailscaleAccessConfig({ ...input, enabled: true });
  await ensureDaemon();
  if (status.connected) return status;
  if (loginProcess && loginProcess.exitCode === null) return getTailscaleStatus({ refresh: true });

  const config = await loadTailscaleAccessConfig();
  const args = [
    `--socket=${SOCKET_FILE}`,
    'up',
    '--reset',
    '--accept-dns=false',
    `--hostname=${config.hostname}`,
    `--advertise-routes=${config.advertiseRoutes.join(',')}`,
    ...(config.advertiseExitNode ? ['--advertise-exit-node'] : []),
  ];
  lastAuthUrl = '';
  runtimeError = '';
  loginProcess = spawn('/usr/local/bin/tailscale', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const detect = (chunk) => {
    const text = chunk.toString('utf8');
    appendLog(text);
    const match = text.match(/https:\/\/login\.tailscale\.com\/[A-Za-z0-9/?=_-]+/);
    if (match) lastAuthUrl = match[0];
  };
  loginProcess.stdout.on('data', detect);
  loginProcess.stderr.on('data', detect);
  loginProcess.once('error', (error) => {
    runtimeError = error.message;
    appendLog(error.message);
  });
  loginProcess.once('close', (code) => {
    if (code && !lastAuthUrl) runtimeError = `tailscale up stopped with code ${code}.`;
    loginProcess = null;
    statusCache.expiresAt = 0;
  });

  const deadline = Date.now() + 8_000;
  while (!lastAuthUrl && loginProcess && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return getTailscaleStatus({ refresh: true });
}

export async function stopTailscaleAccess() {
  const config = await loadTailscaleAccessConfig();
  if (await daemonResponds()) {
    await runCommand(
      '/usr/local/bin/tailscale',
      [`--socket=${SOCKET_FILE}`, 'down'],
      { timeoutMs: 5_000 },
    );
  }
  if (loginProcess && loginProcess.exitCode === null) loginProcess.kill('SIGTERM');
  if (daemonProcess && daemonProcess.exitCode === null) daemonProcess.kill('SIGTERM');
  loginProcess = null;
  daemonProcess = null;
  lastAuthUrl = '';
  statusCache.expiresAt = 0;
  await saveTailscaleAccessConfig({ ...config, enabled: false });
  return getTailscaleStatus({ refresh: true });
}

export async function initializeTailscaleAccess() {
  const config = await loadTailscaleAccessConfig();
  if (!config.enabled) return;
  try {
    await ensureDaemon();
    const status = await getTailscaleStatus({ refresh: true });
    if (status.connected) await applyPreferences(config);
  } catch (error) {
    runtimeError = error.message;
    console.warn(`Could not initialize Tailscale access: ${error.message}`);
  }
}

export function shutdownTailscaleAccess() {
  if (loginProcess && loginProcess.exitCode === null) loginProcess.kill('SIGTERM');
  if (daemonProcess && daemonProcess.exitCode === null) daemonProcess.kill('SIGTERM');
}

export function tailscaleRuntimeLog() {
  return runtimeLogs.slice();
}
