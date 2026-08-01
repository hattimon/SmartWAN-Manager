import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';
import {
  migrateFlatRulesToGroups,
  normalizeRoutingGroup,
  reconcileRoutingGroupsWithFlatRules,
  splitRoutingGroupsBySource,
} from '../src/dualWanRoutingGroups.js';

const ROUTING_GROUPS_FILE = path.join(DATA_DIR, 'dualwan-routing-groups.json');

async function writeGroups(groups) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const normalized = splitRoutingGroupsBySource(
    groups.slice(0, 64).map(normalizeRoutingGroup),
  ).groups;
  const payload = {
    schemaVersion: '1.0',
    updatedAt: new Date().toISOString(),
    groups: normalized,
  };
  const temporary = `${ROUTING_GROUPS_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, ROUTING_GROUPS_FILE);
  return payload;
}

export async function loadRoutingGroups(flatRules = []) {
  try {
    const payload = JSON.parse(await fs.readFile(ROUTING_GROUPS_FILE, 'utf8'));
    if (payload?.schemaVersion === '1.0' && Array.isArray(payload.groups)) {
      const reconciled = reconcileRoutingGroupsWithFlatRules(payload.groups, flatRules);
      if (reconciled.changed) {
        const saved = await writeGroups(reconciled.groups);
        return { ...saved, migrated: true };
      }
      return {
        schemaVersion: '1.0',
        updatedAt: payload.updatedAt || '',
        groups: reconciled.groups,
        migrated: false,
      };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const groups = migrateFlatRulesToGroups(flatRules);
  const payload = await writeGroups(groups);
  return { ...payload, migrated: groups.length > 0 };
}

export async function saveRoutingGroups(groups = []) {
  if (!Array.isArray(groups)) throw new Error('Routing groups must be an array.');
  const totalRules = groups.reduce((total, group) => total + (Array.isArray(group?.rules) ? group.rules.length : 0), 0);
  if (groups.length > 64 || totalRules > 256) {
    throw new Error('Routing group metadata limit exceeded.');
  }
  return writeGroups(groups);
}

export async function resetRoutingGroups(flatRules = []) {
  const groups = migrateFlatRulesToGroups(flatRules);
  const payload = await writeGroups(groups);
  return { ...payload, migrated: groups.length > 0, refreshedFromRouter: true };
}
