import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';
import { execCommand } from './sshClient.js';
import { shellQuote, validatePresetName } from './smartwanConfig.js';
import { summarizeDualWanChange } from './dualWanChangeSummary.js';

const PRESET_DIR = path.join(DATA_DIR, 'dualwan-presets');
const APPLY_BACKUP_DIR = path.join(DATA_DIR, 'dualwan-apply-backups');

function parseKeyValueBlock(raw = '') {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function normalizeBoolean(value) {
  return value === true || value === '1' || value === 'true' || value === 'on';
}

function normalizeScalar(value, fallback = '') {
  return String(value ?? fallback).replace(/[\r\n]/g, ' ').trim();
}

function normalizeUnit(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '1' || text === 'wan1' || text === 'secondary') return '1';
  return '0';
}

function parseRatio(value = '') {
  const match = String(value || '').match(/(\d+)\s*:\s*(\d+)/);
  return {
    primary: match ? match[1] : '9',
    secondary: match ? match[2] : '1',
  };
}

export function parseAsusRuleList(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return [];

  const bracketRules = text
    .split('<')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('>').map((part) => part.trim()))
    .filter((parts) => parts.length >= 3)
    .map(([source, destination, unit]) => ({
      source,
      destination,
      unit: normalizeUnit(unit),
    }));

  if (bracketRules.length) {
    return bracketRules;
  }

  return text
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [source, destination, unit] = entry.split(/[>,|]/).map((part) => part.trim());
      return source && destination ? { source, destination, unit: normalizeUnit(unit) } : null;
    })
    .filter(Boolean);
}

export function buildAsusRuleList(rules = []) {
  return rules
    .map((rule) => ({
      source: normalizeScalar(rule.source),
      destination: normalizeScalar(rule.destination),
      unit: normalizeUnit(rule.unit),
    }))
    .filter((rule) => rule.source && rule.destination)
    .slice(0, 64)
    .map((rule) => `<${rule.source}>${rule.destination}>${rule.unit}`)
    .join('');
}

function parseRulesFromIpRule(raw = '') {
  const rules = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/\bfrom\s+(\S+)\s+to\s+(\S+)\s+lookup\s+(wan[01]|\d+)/);
    if (!match) continue;
    const [, source, destination, lookup] = match;
    const unit = lookup === 'wan1' || lookup === '101' ? '1' : '0';
    const key = `${source}|${destination}|${unit}`;
    if (!rules.some((rule) => `${rule.source}|${rule.destination}|${rule.unit}` === key)) {
      rules.push({ source, destination, unit });
    }
  }
  return rules;
}

function dualWanForm(values, routeRules) {
  const dualwanParts = String(values.wans_dualwan || '').split(/\s+/).filter(Boolean);
  const ratio = parseRatio(values.wans_lb_ratio);
  const nvramRules = parseAsusRuleList(values.wans_routing_rulelist);
  const fallbackRules = parseRulesFromIpRule(routeRules);
  const rules = nvramRules.length ? nvramRules : fallbackRules;
  return {
    enabled: normalizeBoolean(values.wans_dualwan_enable || values.wans_enable || values.wans_dualwan_enabled || (dualwanParts[1] && dualwanParts[1] !== 'none' ? '1' : '0')),
    primary: dualwanParts[0] || 'wan',
    secondary: dualwanParts[1] || 'lan',
    mode: values.wans_mode || 'lb',
    ratioPrimary: ratio.primary,
    ratioSecondary: ratio.secondary,
    routingEnabled: normalizeBoolean(values.wans_routing_enable || (rules.length ? '1' : '0')),
    lanPort: values.wans_lanport || values.wans_lanport1 || values.wans_lanport2 || '',
    rawDualWan: values.wans_dualwan || '',
    rawRuleList: values.wans_routing_rulelist || '',
    rules,
    rulesSource: nvramRules.length ? 'nvram' : fallbackRules.length ? 'ip-rule' : 'empty',
  };
}

function normalizeDualWanInput(input = {}) {
  const ratioPrimary = Math.max(1, Number(input.ratioPrimary || 9));
  const ratioSecondary = Math.max(1, Number(input.ratioSecondary || 1));
  const primary = normalizeScalar(input.primary, 'wan') || 'wan';
  const secondary = normalizeScalar(input.secondary, 'lan') || 'lan';
  const mode = normalizeScalar(input.mode, 'lb') === 'fo' ? 'fo' : 'lb';
  return {
    enabled: normalizeBoolean(input.enabled),
    primary,
    secondary,
    mode,
    ratioPrimary: String(ratioPrimary),
    ratioSecondary: String(ratioSecondary),
    routingEnabled: normalizeBoolean(input.routingEnabled),
    lanPort: normalizeScalar(input.lanPort),
    rules: Array.isArray(input.rules) ? input.rules : [],
  };
}

function dualWanRuleKey(rule = {}) {
  return [
    normalizeScalar(rule.source),
    normalizeScalar(rule.destination),
    normalizeUnit(rule.unit),
  ].join('|');
}

export function matchDualWanPreset(currentInput, presets = []) {
  if (!currentInput) return null;
  const current = normalizeDualWanInput(currentInput);
  const currentRules = new Set(current.rules.map(dualWanRuleKey).filter(Boolean));
  const fields = [
    'enabled',
    'primary',
    'secondary',
    'mode',
    'ratioPrimary',
    'ratioSecondary',
    'routingEnabled',
  ];

  const matches = presets
    .map((preset) => {
      const config = normalizeDualWanInput(preset.config || {});
      const settingsMatch = fields.every((field) => String(config[field]) === String(current[field]))
        && (!config.lanPort || !current.lanPort || config.lanPort === current.lanPort);
      if (!settingsMatch) return null;

      const presetRuleKeys = [...new Set(config.rules.map(dualWanRuleKey).filter(Boolean))];
      const matchingRuleCount = presetRuleKeys.filter((key) => currentRules.has(key)).length;
      const isSubset = matchingRuleCount === presetRuleKeys.length;
      const sourceGroups = new Map();
      for (const rule of config.rules) {
        const source = normalizeScalar(rule.source);
        if (!source) continue;
        const keys = sourceGroups.get(source) || [];
        keys.push(dualWanRuleKey(rule));
        sourceGroups.set(source, keys);
      }
      const dominantRuleKeys = [...sourceGroups.values()]
        .sort((a, b) => b.length - a.length)[0] || [];
      const dominantProfileMatch = (
        dominantRuleKeys.length >= 2
        && dominantRuleKeys.length >= Math.ceil(presetRuleKeys.length * 0.6)
        && dominantRuleKeys.every((key) => currentRules.has(key))
      );
      if (!isSubset && !dominantProfileMatch) return null;

      const exact = isSubset && currentRules.size === presetRuleKeys.length;
      const additionalRuleCount = Math.max(0, currentRules.size - matchingRuleCount);
      return {
        name: preset.name,
        matchType: exact ? 'exact' : 'base',
        matchQuality: exact ? 3 : isSubset ? 2 : 1,
        ruleCount: matchingRuleCount,
        additionalRuleCount,
        ignoredPresetRuleCount: Math.max(0, presetRuleKeys.length - matchingRuleCount),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.matchQuality !== b.matchQuality) return b.matchQuality - a.matchQuality;
      if (a.ruleCount !== b.ruleCount) return b.ruleCount - a.ruleCount;
      return a.name.localeCompare(b.name);
    });

  return matches[0] || null;
}

export async function readDualWan(settings) {
  const script = `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
section(){ echo "__DUALWAN_SECTION__$1"; }
section nvram
for key in \
  wans_dualwan wans_dualwan_enable wans_enable wans_mode wans_lb_ratio \
  wans_routing_enable wans_routing_rulelist wans_lanport wans_lanport1 wans_lanport2 \
  wans_primary wans_standby wans_isp_unit wan0_ifname wan1_ifname wan0_gateway wan1_gateway \
  wan0_ipaddr wan1_ipaddr wan0_proto wan1_proto
do
  echo "$key=$(nvram get "$key" 2>/dev/null || true)"
done
section routes
ip rule show 2>/dev/null || true
`;
  const result = await execCommand(settings, 'sh -s', { timeoutMs: 12000, stdin: script });
  const sections = {};
  let current = 'root';
  for (const line of result.stdout.split(/\r?\n/)) {
    const marker = line.match(/^__DUALWAN_SECTION__([A-Za-z0-9_-]+)$/);
    if (marker) {
      current = marker[1];
      sections[current] = '';
    } else {
      sections[current] = `${sections[current] || ''}${line}\n`;
    }
  }
  const nvram = parseKeyValueBlock(sections.nvram || '');
  const form = dualWanForm(nvram, sections.routes || '');
  return {
    ok: result.code === 0,
    code: result.code,
    stderr: result.stderr.trim(),
    nvram,
    routes: (sections.routes || '').trim(),
    form,
  };
}

export async function applyDualWan(settings, input) {
  const form = normalizeDualWanInput(input);
  const ruleList = buildAsusRuleList(form.rules);
  const dualWanValue = `${form.primary} ${form.enabled ? form.secondary : 'none'}`;
  const ratio = `${form.ratioPrimary}:${form.ratioSecondary}`;
  const smartwanCtl = `${settings.smartwanDir || '/jffs/addons/smartwan.d'}/smartwanctl.sh`;
  const before = await readDualWan(settings);
  await fs.mkdir(APPLY_BACKUP_DIR, { recursive: true });
  const backupFile = path.join(
    APPLY_BACKUP_DIR,
    `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await fs.writeFile(
    backupFile,
    `${JSON.stringify({
      kind: 'dualwan-before-apply',
      version: 1,
      createdAt: new Date().toISOString(),
      nvram: before.nvram,
      form: before.form,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const script = `
PATH=$PATH:/sbin:/usr/sbin:/bin:/usr/bin
nvram set wans_dualwan=${shellQuote(dualWanValue)}
nvram set wans_dualwan_enable=${form.enabled ? '1' : '0'}
nvram set wans_mode=${shellQuote(form.mode)}
nvram set wans_lb_ratio=${shellQuote(ratio)}
nvram set wans_routing_enable=${form.routingEnabled ? '1' : '0'}
nvram set wans_routing_rulelist=${shellQuote(ruleList)}
if [ -n ${shellQuote(form.lanPort)} ]; then nvram set wans_lanport=${shellQuote(form.lanPort)}; fi
nvram commit
echo "__DUALWAN_VERIFY__"
for key in wans_dualwan wans_dualwan_enable wans_mode wans_lb_ratio wans_routing_enable wans_routing_rulelist wans_lanport; do
  echo "$key=$(nvram get "$key" 2>/dev/null || true)"
done
if command -v service >/dev/null 2>&1; then
  (service restart_wan >/tmp/smartwan_dualwan_apply.log 2>&1 || true) &
elif command -v rc >/dev/null 2>&1; then
  (rc restart_wan >/tmp/smartwan_dualwan_apply.log 2>&1 || true) &
fi
(sleep 15; [ -x ${shellQuote(smartwanCtl)} ] && ${shellQuote(smartwanCtl)} asus sources apply) >/tmp/smartwan_asus_sources_apply.log 2>&1 &
echo applied
`;
  const result = await execCommand(settings, 'sh -s', { timeoutMs: 18000, stdin: script });
  const verifyBlock = result.stdout.split('__DUALWAN_VERIFY__')[1] || '';
  const verifiedNvram = parseKeyValueBlock(verifyBlock);
  const expected = {
    wans_dualwan: dualWanValue,
    wans_dualwan_enable: form.enabled ? '1' : '0',
    wans_mode: form.mode,
    wans_lb_ratio: ratio,
    wans_routing_enable: form.routingEnabled ? '1' : '0',
    wans_routing_rulelist: ruleList,
    ...(form.lanPort ? { wans_lanport: form.lanPort } : {}),
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => String(verifiedNvram[key] ?? '') !== String(value))
    .map(([key, value]) => ({
      key,
      expected: String(value),
      actual: String(verifiedNvram[key] ?? ''),
    }));
  if (result.code !== 0 || mismatches.length) {
    const detail = mismatches
      .map((item) => `${item.key}: expected ${item.expected}, got ${item.actual}`)
      .join('; ');
    throw new Error(result.stderr.trim() || detail || 'ASUS Dual WAN settings were not verified after apply.');
  }
  return {
    ok: true,
    verified: true,
    code: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    ruleList,
    verifiedNvram,
    backupFile: path.basename(backupFile),
    change: summarizeDualWanChange(before.form, form),
  };
}

async function ensurePresetDir() {
  await fs.mkdir(PRESET_DIR, { recursive: true });
}

async function readPresetFile(file) {
  const raw = await fs.readFile(path.join(PRESET_DIR, file), 'utf8');
  return JSON.parse(raw);
}

export async function listDualWanPresets(settings) {
  await ensurePresetDir();
  const current = await readDualWan(settings).catch(() => null);
  const files = await fs.readdir(PRESET_DIR).catch(() => []);
  const presets = [];

  for (const file of files.filter((item) => item.endsWith('.json'))) {
    const preset = await readPresetFile(file).catch(() => null);
    if (!preset) continue;
    const config = normalizeDualWanInput(preset.config || {});
    presets.push({
      name: file.replace(/\.json$/, ''),
      createdAt: preset.createdAt || '',
      updatedAt: preset.updatedAt || '',
      ruleCount: config.rules.length,
      config,
      active: false,
      matchType: '',
      additionalRuleCount: 0,
    });
  }

  const activeMatch = matchDualWanPreset(current?.form, presets);
  for (const preset of presets) {
    if (preset.name !== activeMatch?.name) continue;
    preset.active = true;
    preset.matchType = activeMatch.matchType;
    preset.additionalRuleCount = activeMatch.additionalRuleCount;
    preset.ignoredPresetRuleCount = activeMatch.ignoredPresetRuleCount;
  }

  return {
    activePreset: activeMatch?.name || '',
    activePresetMatchType: activeMatch?.matchType || '',
    additionalRuleCount: activeMatch?.additionalRuleCount || 0,
    presets: presets.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function saveDualWanPreset(_settings, name, config) {
  await ensurePresetDir();
  const safeName = validatePresetName(name);
  const target = path.join(PRESET_DIR, `${safeName}.json`);
  let createdAt = new Date().toISOString();
  try {
    const existing = JSON.parse(await fs.readFile(target, 'utf8'));
    createdAt = existing.createdAt || createdAt;
  } catch (_error) {
    // New preset.
  }
  const payload = {
    name: safeName,
    createdAt,
    updatedAt: new Date().toISOString(),
    config: normalizeDualWanInput(config || {}),
  };
  await fs.writeFile(`${target}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${target}.tmp`, target);
  return payload;
}

export async function deleteDualWanPreset(_settings, name) {
  const safeName = validatePresetName(name);
  await fs.rm(path.join(PRESET_DIR, `${safeName}.json`), { force: true });
  return { name: safeName };
}

export async function activateDualWanPreset(settings, name) {
  const safeName = validatePresetName(name);
  const preset = await readPresetFile(`${safeName}.json`);
  const apply = await applyDualWan(settings, preset.config);
  return { name: safeName, apply };
}
