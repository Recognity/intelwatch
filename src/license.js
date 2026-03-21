/**
 * Freemium license gate for Intelwatch.
 *
 * License check order:
 *   1. process.env.INTELWATCH_PRO_KEY
 *   2. ~/.intelwatch-license (file containing license key)
 *
 * Pro features:
 *   - XLS / PDF export
 *   - Unlimited CSV rows (Free: capped at 50)
 *   - Unlimited Reddit/HN results (Free: capped at 5)
 *   - Full Pappers company profile (Free: --preview only)
 *   - Full brand mention history
 *
 * The key is validated as a non-empty string. Actual server-side
 * validation can be added later (e.g. license.recognity.fr/verify).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

const LICENSE_FILE = join(homedir(), '.intelwatch-license');
const LICENSE_FILE_ALT = join(homedir(), '.intelwatch-pro');
const LICENSE_URL = 'https://recognity.fr/tools/intelwatch';

// ── Limits ───────────────────────────────────────────────────────────────────

export const FREE_LIMITS = {
  csvMaxRows: 50,
  redditMaxResults: 5,
  hnMaxResults: 5,
  pappersFullProfile: false,
  exportFormats: ['json', 'csv'],
};

export const PRO_LIMITS = {
  csvMaxRows: Infinity,
  redditMaxResults: 100,
  hnMaxResults: 100,
  pappersFullProfile: true,
  exportFormats: ['json', 'csv', 'xls', 'xlsx', 'excel', 'pdf'],
};

// ── Cache ────────────────────────────────────────────────────────────────────

let _cachedKey = undefined;

function readLicenseKey() {
  if (_cachedKey !== undefined) return _cachedKey;

  // 1. Environment variable
  if (process.env.INTELWATCH_PRO_KEY) {
    _cachedKey = process.env.INTELWATCH_PRO_KEY.trim();
    return _cachedKey;
  }

  // 2. Legacy env var (backward compat with profile.js)
  if (process.env.INTELWATCH_LICENSE_KEY) {
    _cachedKey = process.env.INTELWATCH_LICENSE_KEY.trim();
    return _cachedKey;
  }

  // 3. License file (~/.intelwatch-license or ~/.intelwatch-pro)
  for (const file of [LICENSE_FILE, LICENSE_FILE_ALT]) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, 'utf8').trim();
        if (content) {
          _cachedKey = content;
          return _cachedKey;
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  _cachedKey = null;
  return _cachedKey;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check if the user has a Pro license.
 */
export function isPro() {
  return !!readLicenseKey();
}

/**
 * Get the current license key (or null).
 */
export function getLicenseKey() {
  return readLicenseKey();
}

/**
 * Get the limits for the current tier.
 */
export function getLimits() {
  return isPro() ? PRO_LIMITS : FREE_LIMITS;
}

/**
 * Assert that a Pro feature is available. Throws if not.
 * @param {string} featureName — human-readable feature name for the error message
 */
export function requirePro(featureName) {
  if (isPro()) return;
  const msg = `${featureName} requires an Intelwatch Pro license.`;
  const err = new Error(msg);
  err.code = 'LICENSE_REQUIRED';
  err.featureName = featureName;
  throw err;
}

/**
 * Print a Pro upgrade message to stderr (non-blocking, doesn't throw).
 * @param {string} featureName
 */
export function printProUpgrade(featureName) {
  console.error('');
  console.error(chalk.yellow(`  ⚡ ${featureName} — Pro Feature`));
  console.error(chalk.gray(`     Upgrade to Intelwatch Pro for full access.`));
  console.error(chalk.gray(`     ${LICENSE_URL}`));
  console.error(chalk.gray(`     Set INTELWATCH_PRO_KEY or create ~/.intelwatch-license`));
  console.error('');
}

/**
 * Gate a Pro feature: if not Pro, print upgrade message and return false.
 * @param {string} featureName
 * @returns {boolean} true if Pro, false otherwise
 */
export function gatePro(featureName) {
  if (isPro()) return true;
  printProUpgrade(featureName);
  return false;
}

/**
 * Truncate an array to Free-tier limit with a warning.
 * @param {Array} data
 * @param {number} freeLimit
 * @param {string} featureName
 * @returns {Array}
 */
export function applyFreeLimit(data, freeLimit, featureName) {
  if (!Array.isArray(data)) return data;
  if (isPro() || data.length <= freeLimit) return data;

  console.error(chalk.yellow(`  ⚠️  Free tier: showing ${freeLimit}/${data.length} results. Upgrade to Pro for unlimited ${featureName}.`));
  return data.slice(0, freeLimit);
}

/**
 * Save a license key to ~/.intelwatch-pro and refresh the cache.
 * @param {string} key
 */
export function saveLicenseKey(key) {
  const trimmed = (key || '').trim();
  if (!trimmed) {
    throw new Error('License key cannot be empty.');
  }
  writeFileSync(LICENSE_FILE_ALT, trimmed + '\n', 'utf8');
  _cachedKey = undefined; // bust cache
  return LICENSE_FILE_ALT;
}

/**
 * Print a clean paywall block and exit the process (non-throwing).
 * Use this instead of requirePro when you want a user-friendly exit.
 * @param {string} featureName
 */
export function printPaywallAndExit(featureName) {
  console.error('');
  console.error(chalk.red('  🔒 This is a Pro feature!'));
  console.error(chalk.yellow(`     "${featureName}" requires an Intelwatch Pro license.`));
  console.error('');
  console.error(chalk.gray('     Upgrade at ') + chalk.cyan.underline(LICENSE_URL));
  console.error(chalk.gray('     Then run: ') + chalk.white('intelwatch auth <key>'));
  console.error('');
  process.exit(0);
}

/**
 * Reset cached license (for testing).
 */
export function _resetCache() {
  _cachedKey = undefined;
}
