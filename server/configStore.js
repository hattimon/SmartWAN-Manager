import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = process.env.SMARTWAN_DATA_DIR || path.resolve(process.cwd(), 'data');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const KEY_DIR = path.join(DATA_DIR, 'keys');

const defaults = {
  router: {
    host: '',
    port: '',
    username: '',
    authMethod: 'key',
    privateKeyPath: '',
    privateKey: '',
    password: '',
    passphrase: '',
    smartwanDir: '/jffs/addons/smartwan.d',
  },
  ui: {
    language: 'en',
  },
  auth: {
    username: 'admin',
    passwordHash: '',
    passwordSalt: '',
    sessionSecret: '',
  },
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(KEY_DIR, { recursive: true });
}

function mergeSettings(base, next) {
  return {
    router: {
      ...base.router,
      ...(next.router || {}),
    },
    ui: {
      ...base.ui,
      ...(next.ui || {}),
    },
    auth: {
      ...base.auth,
      ...(next.auth || {}),
    },
  };
}

export async function loadSettings() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return mergeSettings(defaults, JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not load config: ${error.message}`);
    }
    return structuredClone(defaults);
  }
}

export async function saveSettings(incoming) {
  await ensureDataDir();
  const current = await loadSettings();
  const routerInput = incoming.router || {};
  const sanitizedIncoming = {
    ...incoming,
    router: {
      ...routerInput,
    },
  };
  delete sanitizedIncoming.router.clearPassword;
  delete sanitizedIncoming.router.clearPassphrase;
  delete sanitizedIncoming.router.clearPrivateKey;

  const next = mergeSettings(current, sanitizedIncoming);
  delete next.router.clearPassword;
  delete next.router.clearPassphrase;
  delete next.router.clearPrivateKey;

  if (!routerInput.clearPassword && !routerInput.password) {
    next.router.password = current.router.password;
  }
  if (routerInput.clearPassword) {
    next.router.password = '';
  }
  if (!routerInput.clearPassphrase && !routerInput.passphrase) {
    next.router.passphrase = current.router.passphrase;
  }
  if (routerInput.clearPassphrase) {
    next.router.passphrase = '';
  }
  if (!routerInput.clearPrivateKey && !routerInput.privateKey) {
    next.router.privateKey = current.router.privateKey;
  }
  if (routerInput.clearPrivateKey) {
    next.router.privateKey = '';
  }

  const tempPath = `${CONFIG_FILE}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, CONFIG_FILE);
  return next;
}

export async function saveAuthSettings(auth) {
  await ensureDataDir();
  const current = await loadSettings();
  const next = mergeSettings(current, { auth });
  const tempPath = `${CONFIG_FILE}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, CONFIG_FILE);
  return next.auth;
}

export function redactSettings(settings) {
  return {
    ...settings,
    auth: {
      username: settings.auth?.username || defaults.auth.username,
      configured: Boolean(settings.auth?.passwordHash),
    },
    router: {
      ...settings.router,
      privateKey: '',
      password: '',
      passphrase: '',
      hasPrivateKey: Boolean(settings.router.privateKey || settings.router.privateKeyPath),
      hasPassword: Boolean(settings.router.password),
      hasPassphrase: Boolean(settings.router.passphrase),
    },
  };
}

export function normalizeRouterSettings(router) {
  return {
    ...defaults.router,
    ...router,
    port: router.port === '' || router.port === undefined ? '' : Number(router.port),
    smartwanDir: router.smartwanDir || defaults.router.smartwanDir,
  };
}
