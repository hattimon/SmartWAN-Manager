import crypto from 'node:crypto';
import { loadSettings, saveAuthSettings } from './configStore.js';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

const [, , usernameArg, passwordArg] = process.argv;
const username = String(usernameArg || 'admin').trim();
const password = String(passwordArg || '');

if (!username || !password || password.length < 8) {
  console.error('Usage: node server/setPanelPassword.js <username> <password-min-8-chars>');
  process.exit(2);
}

const current = await loadSettings();
const { salt, hash } = hashPassword(password);
await saveAuthSettings({
  ...(current.auth || {}),
  username,
  passwordSalt: salt,
  passwordHash: hash,
  sessionSecret: current.auth?.sessionSecret || crypto.randomBytes(32).toString('hex'),
});

console.log(`Panel password updated for user: ${username}`);
