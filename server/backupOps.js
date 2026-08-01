import { execCommand } from './sshClient.js';
import { shellQuote } from './smartwanConfig.js';

const ROUTER_NVRAM_KEYS = [
  'wans_dualwan',
  'wans_dualwan_enable',
  'wans_enable',
  'wans_mode',
  'wans_lb_ratio',
  'wans_routing_enable',
  'wans_routing_rulelist',
  'wans_lanport',
  'wans_lanport1',
  'wans_lanport2',
  'wans_primary',
  'wans_standby',
  'wan0_proto',
  'wan1_proto',
  'wan0_ifname',
  'wan1_ifname',
  'wan0_gateway',
  'wan1_gateway',
  'wan0_dns',
  'wan1_dns',
  'wan0_dnsenable_x',
  'wan1_dnsenable_x',
  'wan0_peerdns',
  'wan1_peerdns',
  'wan_dnsenable_x',
  'dhcp_dns1_x',
  'dhcp_dns2_x',
  'lan_ipaddr',
  'lan_netmask',
  'lan_domain',
];

const SMARTWAN_FILES = [
  'smartwan.conf',
  'backend.sh',
  'smartwanctl.sh',
];

function remoteDir(settings) {
  return settings.smartwanDir || '/jffs/addons/smartwan.d';
}

function parseSections(output = '') {
  const sections = {};
  let current = 'root';
  for (const line of output.split(/\r?\n/)) {
    const marker = line.match(/^__BACKUP_SECTION__([A-Za-z0-9_.-]+)$/);
    if (marker) {
      current = marker[1];
      sections[current] = '';
    } else {
      sections[current] = `${sections[current] || ''}${line}\n`;
    }
  }
  return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value.trimEnd()]));
}

function parseKeyValueBlock(raw = '') {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) {
      result[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return result;
}

function applyScriptForNvram(nvram = {}) {
  const lines = ['#!/bin/sh', 'set -eu'];
  for (const key of ROUTER_NVRAM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(nvram, key)) {
      lines.push(`nvram set ${key}=${shellQuote(nvram[key])}`);
    }
  }
  lines.push('nvram commit');
  lines.push('# Restart WAN from the ASUS UI, or run: service restart_wan');
  lines.push('');
  return lines.join('\n');
}

function parsePresetSections(sections) {
  return Object.fromEntries(
    Object.entries(sections)
      .filter(([key]) => key.startsWith('preset.'))
      .map(([key, value]) => [key.slice('preset.'.length), value]),
  );
}

function parseHookSections(sections) {
  return Object.fromEntries(
    Object.entries(sections)
      .filter(([key]) => key.startsWith('hook.'))
      .map(([key, value]) => [key.slice('hook.'.length), value]),
  );
}

export async function createRouterBackup(settings) {
  const script = `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
section(){ echo "__BACKUP_SECTION__$1"; }
section nvram
for key in ${ROUTER_NVRAM_KEYS.map(shellQuote).join(' ')}; do
  echo "$key=$(nvram get "$key" 2>/dev/null || true)"
done
section routes
ip rule show 2>/dev/null || true
echo "--- route-main ---"
ip route show table main 2>/dev/null || true
section dnsmasq
nvram get dhcp_dns1_x 2>/dev/null || true
nvram get dhcp_dns2_x 2>/dev/null || true
`;
  const result = await execCommand(settings, 'sh -s', { timeoutMs: 15000, stdin: script });
  const sections = parseSections(result.stdout);
  const nvram = parseKeyValueBlock(sections.nvram || '');
  return {
    kind: 'router',
    version: 1,
    createdAt: new Date().toISOString(),
    target: 'ASUS RT-N18U Asuswrt-Merlin router settings',
    nvram,
    routes: sections.routes || '',
    dnsmasq: sections.dnsmasq || '',
    applyScript: applyScriptForNvram(nvram),
    warnings: [
      'This backup contains router-side ASUS/Merlin settings only, not panel SSH credentials.',
      'Restoring router settings writes nvram and may require a WAN restart or router reboot.',
    ],
  };
}

export async function createSmartWanBackup(settings) {
  const dir = remoteDir(settings);
  const script = `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
SWDIR=${shellQuote(dir)}
section(){ echo "__BACKUP_SECTION__$1"; }
section meta
echo "smartwan_dir=$SWDIR"
echo "hostname=$(hostname 2>/dev/null || true)"
echo "model=$(nvram get productid 2>/dev/null || true)"
for file in ${SMARTWAN_FILES.map(shellQuote).join(' ')}; do
  section "file.$file"
  cat "$SWDIR/$file" 2>/dev/null || true
done
for preset in "$SWDIR"/presets/*.conf; do
  [ -f "$preset" ] || continue
  name="$(basename "$preset")"
  section "preset.$name"
  cat "$preset" 2>/dev/null || true
done
for hook in services-start firewall-start nat-start wan-event; do
  section "hook.$hook"
  cat "/jffs/scripts/$hook" 2>/dev/null || true
done
section dnsmasq_add
cat /jffs/configs/dnsmasq.conf.add 2>/dev/null || true
section status
if [ -x "$SWDIR/smartwanctl.sh" ]; then "$SWDIR/smartwanctl.sh" status 2>/dev/null || true; fi
`;
  const result = await execCommand(settings, 'sh -s', { timeoutMs: 18000, stdin: script });
  const sections = parseSections(result.stdout);
  return {
    kind: 'smartwan',
    version: 1,
    createdAt: new Date().toISOString(),
    target: 'SmartWAN scripts, config, presets, and Merlin hooks',
    smartwanDir: dir,
    meta: parseKeyValueBlock(sections.meta || ''),
    files: Object.fromEntries(
      SMARTWAN_FILES.map((file) => [file, sections[`file.${file}`] || '']),
    ),
    presets: parsePresetSections(sections),
    hooks: parseHookSections(sections),
    dnsmasqAdd: sections.dnsmasq_add || '',
    status: sections.status || '',
    warnings: [
      'This backup contains router-side SmartWAN scripts/configuration only, not panel SSH credentials.',
      'Restoring SmartWAN scripts can replace files under the SmartWAN directory and managed Merlin hooks.',
    ],
  };
}

export async function createFullBackup(settings) {
  const [router, smartwan] = await Promise.all([
    createRouterBackup(settings),
    createSmartWanBackup(settings),
  ]);
  return {
    kind: 'full',
    version: 1,
    createdAt: new Date().toISOString(),
    router,
    smartwan,
  };
}

async function remoteAtomicWrite(settings, remotePath, content, mode = '600') {
  const tempPath = `${remotePath}.tmp.${Date.now()}`;
  const write = await execCommand(settings, `cat > ${shellQuote(tempPath)}`, {
    timeoutMs: 15000,
    stdin: content || '',
  });
  if (write.code !== 0) {
    throw new Error(write.stderr || `Could not write ${remotePath}`);
  }
  await execCommand(settings, `chmod ${shellQuote(mode)} ${shellQuote(tempPath)} && mv ${shellQuote(tempPath)} ${shellQuote(remotePath)}`, {
    timeoutMs: 10000,
  });
}

export async function restoreRouterBackup(settings, backup, options = {}) {
  const routerBackup = backup?.kind === 'full' ? backup.router : backup;
  if (!routerBackup?.nvram || typeof routerBackup.nvram !== 'object') {
    throw new Error('Invalid router backup payload.');
  }
  if (options.confirm !== 'RESTORE') {
    throw new Error('Restore confirmation is required.');
  }

  const lines = ['PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin'];
  for (const key of ROUTER_NVRAM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(routerBackup.nvram, key)) {
      lines.push(`nvram set ${key}=${shellQuote(routerBackup.nvram[key])}`);
    }
  }
  lines.push('nvram commit');
  if (options.restartWan) {
    lines.push('(service restart_wan >/tmp/smartwan_router_restore.log 2>&1 || rc restart_wan >/tmp/smartwan_router_restore.log 2>&1 || true) &');
  }
  lines.push('echo restored_router');

  const result = await execCommand(settings, 'sh -s', { timeoutMs: 20000, stdin: `${lines.join('\n')}\n` });
  return {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    restoredKeys: ROUTER_NVRAM_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(routerBackup.nvram, key)),
  };
}

export async function restoreSmartWanBackup(settings, backup, options = {}) {
  const smartwanBackup = backup?.kind === 'full' ? backup.smartwan : backup;
  if (!smartwanBackup?.files || typeof smartwanBackup.files !== 'object') {
    throw new Error('Invalid SmartWAN backup payload.');
  }
  if (options.confirm !== 'RESTORE') {
    throw new Error('Restore confirmation is required.');
  }

  const dir = smartwanBackup.smartwanDir || remoteDir(settings);
  await execCommand(settings, `mkdir -p ${shellQuote(dir)} ${shellQuote(`${dir}/presets`)}`, { timeoutMs: 10000 });

  const restored = [];
  for (const file of SMARTWAN_FILES) {
    if (Object.prototype.hasOwnProperty.call(smartwanBackup.files, file)) {
      await remoteAtomicWrite(settings, `${dir}/${file}`, smartwanBackup.files[file], file.endsWith('.sh') ? '755' : '600');
      restored.push(file);
    }
  }

  for (const [name, content] of Object.entries(smartwanBackup.presets || {})) {
    if (!/^[A-Za-z0-9._-]+\.conf$/.test(name)) continue;
    await remoteAtomicWrite(settings, `${dir}/presets/${name}`, content, '600');
    restored.push(`presets/${name}`);
  }

  if (options.installHooks && smartwanBackup.files?.['smartwanctl.sh']) {
    await execCommand(settings, `[ -x ${shellQuote(`${dir}/smartwanctl.sh`)} ] && ${shellQuote(`${dir}/smartwanctl.sh`)} hooks install || true`, {
      timeoutMs: 12000,
    });
  }

  return { ok: true, restored };
}

export async function restoreBackup(settings, body = {}) {
  const backup = body.backup;
  const restoreRouter = Boolean(body.restoreRouter);
  const restoreSmartwan = Boolean(body.restoreSmartwan);
  const result = {};
  if (!restoreRouter && !restoreSmartwan) {
    throw new Error('Select at least one restore target.');
  }
  if (restoreRouter) {
    result.router = await restoreRouterBackup(settings, backup, body);
  }
  if (restoreSmartwan) {
    result.smartwan = await restoreSmartWanBackup(settings, backup, body);
  }
  return result;
}
