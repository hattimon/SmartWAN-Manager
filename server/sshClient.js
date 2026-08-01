import fs from 'node:fs/promises';
import { Client } from 'ssh2';
import { normalizeRouterSettings } from './configStore.js';

export function inlinePrivateKeyStatus(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { usable: false, text: '' };
  }

  if (text.startsWith('PuTTY-User-Key-File-')) {
    return {
      usable: false,
      text,
      error:
        'PuTTY .ppk private keys are not supported directly. Export the key to OpenSSH private key format or use the generated panel key path.',
    };
  }

  const begin = text.match(/^-{5}BEGIN ([A-Z0-9 ]*PRIVATE KEY)-{5}/);
  if (begin && text.includes(`-----END ${begin[1]}-----`)) {
    return { usable: true, text };
  }

  if (begin) {
    return {
      usable: false,
      text,
      error:
        'Incomplete private key. Paste the full OpenSSH private key including the END line, or leave this field empty and use the private key path.',
    };
  }

  return {
    usable: false,
    text,
    error: 'Unsupported inline private key format. Paste an OpenSSH private key or use the private key path.',
  };
}

async function readPrivateKey(settings) {
  const inline = inlinePrivateKeyStatus(settings.privateKey);
  if (inline.usable) {
    return inline.text;
  }

  if (settings.privateKeyPath) {
    try {
      return await fs.readFile(settings.privateKeyPath, 'utf8');
    } catch (error) {
      if (inline.error) {
        throw new Error(`${inline.error} Could not read private key path ${settings.privateKeyPath}: ${error.message}`);
      }
      throw error;
    }
  }

  if (inline.error) {
    throw new Error(inline.error);
  }

  return '';
}

export async function openSsh(rawSettings) {
  const settings = normalizeRouterSettings(rawSettings);
  if (!settings.host) {
    throw new Error('Router host/IP is required in setup.');
  }
  if (!settings.port) {
    throw new Error('SSH port is required in setup.');
  }
  if (!settings.username) {
    throw new Error('SSH username is required in setup.');
  }
  const connectionConfig = {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    readyTimeout: 10000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 2,
  };

  if (settings.authMethod === 'agent') {
    if (!process.env.SSH_AUTH_SOCK) {
      throw new Error('SSH agent auth selected, but SSH_AUTH_SOCK is not available inside the container.');
    }
    connectionConfig.agent = process.env.SSH_AUTH_SOCK;
  } else if (settings.authMethod === 'password') {
    connectionConfig.password = settings.password;
  } else {
    const privateKey = await readPrivateKey(settings);
    if (!privateKey) {
      throw new Error('SSH private key is required for key authentication.');
    }
    connectionConfig.privateKey = privateKey;
    if (settings.passphrase) {
      connectionConfig.passphrase = settings.passphrase;
    }
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.once('ready', () => resolve(conn));
    conn.once('error', reject);
    conn.connect(connectionConfig);
  });
}

export async function execCommand(settings, command, options = {}) {
  const conn = await openSsh(settings);
  const timeoutMs = options.timeoutMs || 15000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        conn.end();
        reject(new Error(`SSH command timed out after ${timeoutMs} ms`));
      }
    }, timeoutMs);

    conn.exec(command, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        settled = true;
        conn.end();
        reject(error);
        return;
      }

      let stdout = '';
      let stderr = '';
      if (options.stdin) {
        stream.write(options.stdin);
        stream.end();
      }
      stream.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      stream.on('close', (code, signal) => {
        if (!settled) {
          clearTimeout(timer);
          settled = true;
          conn.end();
          resolve({ stdout, stderr, code, signal });
        }
      });
    });
  });
}

export async function withSftp(settings, action) {
  const conn = await openSsh(settings);
  try {
    const sftp = await new Promise((resolve, reject) => {
      conn.sftp((error, client) => (error ? reject(error) : resolve(client)));
    });
    return await action(sftp);
  } finally {
    conn.end();
  }
}

export function sftpReadFile(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, 'utf8', (error, data) => (error ? reject(error) : resolve(data)));
  });
}

export function sftpWriteFile(sftp, remotePath, content, mode = 0o600) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, { mode }, (error) => (error ? reject(error) : resolve()));
  });
}

export function sftpReaddir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, list) => (error ? reject(error) : resolve(list)));
  });
}

export function sftpUnlink(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => (error ? reject(error) : resolve()));
  });
}
