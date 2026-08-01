import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';

const MESSAGE_FILE = path.join(DATA_DIR, 'aurelka-messages.json');
const PREFERENCE_FILE = path.join(DATA_DIR, 'aurelka-preferences.json');
const MAX_MESSAGES = 50;
const MAX_PREFERENCES = 200;
let writeQueue = Promise.resolve();
let preferenceWriteQueue = Promise.resolve();

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

async function loadStore() {
  try {
    const saved = JSON.parse(await fs.readFile(MESSAGE_FILE, 'utf8'));
    return {
      version: 1,
      messages: Array.isArray(saved.messages) ? saved.messages.slice(0, MAX_MESSAGES) : [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not load Aurelka messages: ${error.message}`);
    }
    return { version: 1, messages: [] };
  }
}

async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${MESSAGE_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempFile, MESSAGE_FILE);
}

export async function listAurelkaMessages({ limit = 20 } = {}) {
  const store = await loadStore();
  return store.messages.slice(0, Math.max(1, Math.min(Number(limit) || 20, MAX_MESSAGES)));
}

export function addAurelkaMessage({ nickname, message, authorIp }) {
  const operation = writeQueue.then(async () => {
    const cleanNickname = cleanText(nickname, 24);
    const cleanMessage = cleanText(message, 180);
    const cleanAuthorIp = cleanText(authorIp, 64);
    if (!cleanNickname) throw new Error('Podaj nick.');
    if (!cleanMessage) throw new Error('Wpisz wiadomość.');

    const entry = {
      id: crypto.randomUUID(),
      nickname: cleanNickname,
      message: cleanMessage,
      authorIp: cleanAuthorIp || 'nieznane IP',
      createdAt: new Date().toISOString(),
    };
    const store = await loadStore();
    store.messages.unshift(entry);
    store.messages = store.messages.slice(0, MAX_MESSAGES);
    await saveStore(store);
    return entry;
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

async function loadPreferences() {
  try {
    const saved = JSON.parse(await fs.readFile(PREFERENCE_FILE, 'utf8'));
    return Array.isArray(saved.preferences) ? saved.preferences.slice(0, MAX_PREFERENCES) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not load Aurelka preferences: ${error.message}`);
    }
    return [];
  }
}

export async function readAurelkaPreferences({ clientIp, browserId }) {
  const preferences = await loadPreferences();
  const exact = preferences.find(
    (entry) => entry.clientIp === clientIp && entry.browserId === browserId,
  );
  const deviceFallback = preferences.find((entry) => entry.clientIp === clientIp);
  const selected = exact || deviceFallback;
  if (!selected) return { found: false };
  return {
    found: true,
    source: exact ? 'browser' : 'device',
    soundEnabled: selected.soundEnabled !== false,
    animationEnabled: selected.animationEnabled !== false,
    nickname: cleanText(selected.nickname, 24),
  };
}

export function saveAurelkaPreferences({
  clientIp,
  browserId,
  soundEnabled,
  animationEnabled,
  nickname,
}) {
  const operation = preferenceWriteQueue.then(async () => {
    const safeBrowserId = cleanText(browserId, 80);
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(safeBrowserId)) {
      throw new Error('Nieprawidłowy identyfikator przeglądarki.');
    }
    const entry = {
      clientIp: cleanText(clientIp, 64),
      browserId: safeBrowserId,
      soundEnabled: soundEnabled !== false,
      animationEnabled: animationEnabled !== false,
      nickname: cleanText(nickname, 24),
      updatedAt: new Date().toISOString(),
    };
    const preferences = await loadPreferences();
    const next = preferences.filter(
      (item) => !(item.clientIp === entry.clientIp && item.browserId === entry.browserId),
    );
    next.unshift(entry);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${PREFERENCE_FILE}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify({
      version: 1,
      preferences: next.slice(0, MAX_PREFERENCES),
    }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempFile, PREFERENCE_FILE);
    return entry;
  });
  preferenceWriteQueue = operation.catch(() => undefined);
  return operation;
}
