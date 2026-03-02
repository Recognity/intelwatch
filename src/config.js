import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { BASE_DIR, ensureDirectories } from './storage.js';

const CONFIG_FILE = join(BASE_DIR, 'config.yml');

const DEFAULT_CONFIG = {
  notifications: {
    webhook: null,
    email: null,
    events: [
      'competitor.new_page',
      'competitor.price_change',
      'keyword.position_change',
      'brand.new_mention',
    ],
  },
  scraping: {
    delay_min: 1000,
    delay_max: 2500,
    retries: 3,
    user_agent_rotate: true,
  },
};

export function loadConfig() {
  ensureDirectories();
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = parseYaml(raw);
    return deepMerge(DEFAULT_CONFIG, parsed || {});
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  ensureDirectories();
  writeFileSync(CONFIG_FILE, stringifyYaml(config), 'utf8');
}

export function updateConfig(updates) {
  const current = loadConfig();
  const merged = deepMerge(current, updates);
  saveConfig(merged);
  return merged;
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export { CONFIG_FILE };
