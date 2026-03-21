import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  isPro,
  getLicenseKey,
  getLimits,
  requirePro,
  applyFreeLimit,
  saveLicenseKey,
  printPaywallAndExit,
  FREE_LIMITS,
  PRO_LIMITS,
  _resetCache,
} from '../src/license.js';

const LICENSE_FILE = join(homedir(), '.intelwatch-license');
const LICENSE_FILE_ALT = join(homedir(), '.intelwatch-pro');

describe('License Module', () => {
  afterEach(() => {
    // Clean up
    delete process.env.INTELWATCH_PRO_KEY;
    delete process.env.INTELWATCH_LICENSE_KEY;
    for (const f of [LICENSE_FILE, LICENSE_FILE_ALT]) {
      if (existsSync(f)) {
        try { rmSync(f); } catch {}
      }
    }
    _resetCache();
  });

  // ── isPro ──────────────────────────────────────────────────────────────────

  describe('isPro', () => {
    test('returns false when no license', () => {
      _resetCache();
      assert.equal(isPro(), false);
    });

    test('returns true with INTELWATCH_PRO_KEY env', () => {
      process.env.INTELWATCH_PRO_KEY = 'test-key-123';
      _resetCache();
      assert.equal(isPro(), true);
    });

    test('returns true with INTELWATCH_LICENSE_KEY env (backward compat)', () => {
      process.env.INTELWATCH_LICENSE_KEY = 'legacy-key';
      _resetCache();
      assert.equal(isPro(), true);
    });

    test('returns true with license file', () => {
      writeFileSync(LICENSE_FILE, 'file-key-456', 'utf8');
      _resetCache();
      assert.equal(isPro(), true);
      rmSync(LICENSE_FILE);
    });

    test('env takes priority over file', () => {
      process.env.INTELWATCH_PRO_KEY = 'env-key';
      writeFileSync(LICENSE_FILE, 'file-key', 'utf8');
      _resetCache();
      assert.equal(getLicenseKey(), 'env-key');
      rmSync(LICENSE_FILE);
    });

    test('ignores empty env var', () => {
      process.env.INTELWATCH_PRO_KEY = '  ';
      _resetCache();
      // Trimmed empty string = falsy
      assert.equal(isPro(), false);
    });

    test('ignores empty license file', () => {
      writeFileSync(LICENSE_FILE, '  \n  ', 'utf8');
      _resetCache();
      assert.equal(isPro(), false);
      rmSync(LICENSE_FILE);
    });

    test('returns true with ~/.intelwatch-pro file', () => {
      writeFileSync(LICENSE_FILE_ALT, 'pro-file-key', 'utf8');
      _resetCache();
      assert.equal(isPro(), true);
      assert.equal(getLicenseKey(), 'pro-file-key');
      rmSync(LICENSE_FILE_ALT);
    });

    test('~/.intelwatch-license takes priority over ~/.intelwatch-pro', () => {
      writeFileSync(LICENSE_FILE, 'license-key', 'utf8');
      writeFileSync(LICENSE_FILE_ALT, 'pro-key', 'utf8');
      _resetCache();
      assert.equal(getLicenseKey(), 'license-key');
      rmSync(LICENSE_FILE);
      rmSync(LICENSE_FILE_ALT);
    });
  });

  // ── saveLicenseKey ─────────────────────────────────────────────────────────

  describe('saveLicenseKey', () => {
    test('saves key to ~/.intelwatch-pro', () => {
      const path = saveLicenseKey('my-pro-key');
      assert.equal(path, LICENSE_FILE_ALT);
      assert.ok(existsSync(LICENSE_FILE_ALT));
      const content = readFileSync(LICENSE_FILE_ALT, 'utf8').trim();
      assert.equal(content, 'my-pro-key');
      _resetCache();
      assert.equal(isPro(), true);
      rmSync(LICENSE_FILE_ALT);
    });

    test('throws on empty key', () => {
      assert.throws(() => saveLicenseKey(''), /empty/i);
      assert.throws(() => saveLicenseKey('   '), /empty/i);
    });

    test('busts cache after save', () => {
      _resetCache();
      assert.equal(isPro(), false);
      saveLicenseKey('fresh-key');
      // Cache should be reset — isPro should now return true
      assert.equal(isPro(), true);
      rmSync(LICENSE_FILE_ALT);
    });
  });

  // ── printPaywallAndExit ────────────────────────────────────────────────────

  describe('printPaywallAndExit', () => {
    test('calls process.exit(0)', () => {
      const origExit = process.exit;
      let exitCode = null;
      process.exit = (code) => { exitCode = code; };
      printPaywallAndExit('Test Feature');
      process.exit = origExit;
      assert.equal(exitCode, 0);
    });
  });

  // ── getLimits ──────────────────────────────────────────────────────────────

  describe('getLimits', () => {
    test('returns FREE_LIMITS without license', () => {
      _resetCache();
      const limits = getLimits();
      assert.equal(limits.csvMaxRows, FREE_LIMITS.csvMaxRows);
      assert.equal(limits.redditMaxResults, FREE_LIMITS.redditMaxResults);
      assert.equal(limits.pappersFullProfile, false);
    });

    test('returns PRO_LIMITS with license', () => {
      process.env.INTELWATCH_PRO_KEY = 'pro-key';
      _resetCache();
      const limits = getLimits();
      assert.equal(limits.csvMaxRows, Infinity);
      assert.equal(limits.redditMaxResults, PRO_LIMITS.redditMaxResults);
      assert.equal(limits.pappersFullProfile, true);
    });
  });

  // ── requirePro ─────────────────────────────────────────────────────────────

  describe('requirePro', () => {
    test('throws without license', () => {
      _resetCache();
      assert.throws(
        () => requirePro('XLS Export'),
        (err) => {
          assert.equal(err.code, 'LICENSE_REQUIRED');
          assert.ok(err.message.includes('XLS Export'));
          assert.ok(err.message.includes('Pro license'));
          return true;
        }
      );
    });

    test('does not throw with license', () => {
      process.env.INTELWATCH_PRO_KEY = 'key';
      _resetCache();
      assert.doesNotThrow(() => requirePro('XLS Export'));
    });
  });

  // ── applyFreeLimit ─────────────────────────────────────────────────────────

  describe('applyFreeLimit', () => {
    test('truncates array when Free and over limit', () => {
      _resetCache();
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const result = applyFreeLimit(data, 50, 'test rows');
      assert.equal(result.length, 50);
    });

    test('does not truncate when under limit', () => {
      _resetCache();
      const data = [{ id: 1 }, { id: 2 }];
      const result = applyFreeLimit(data, 50, 'test rows');
      assert.equal(result.length, 2);
    });

    test('does not truncate when Pro', () => {
      process.env.INTELWATCH_PRO_KEY = 'key';
      _resetCache();
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const result = applyFreeLimit(data, 50, 'test rows');
      assert.equal(result.length, 100);
    });

    test('handles non-array gracefully', () => {
      _resetCache();
      const result = applyFreeLimit('not an array', 50, 'test');
      assert.equal(result, 'not an array');
    });
  });

  // ── FREE_LIMITS values ─────────────────────────────────────────────────────

  describe('Limit constants', () => {
    test('FREE_LIMITS has expected values', () => {
      assert.equal(FREE_LIMITS.csvMaxRows, 50);
      assert.equal(FREE_LIMITS.redditMaxResults, 5);
      assert.equal(FREE_LIMITS.hnMaxResults, 5);
      assert.equal(FREE_LIMITS.pappersFullProfile, false);
      assert.deepEqual(FREE_LIMITS.exportFormats, ['json', 'csv']);
    });

    test('PRO_LIMITS has expected values', () => {
      assert.equal(PRO_LIMITS.csvMaxRows, Infinity);
      assert.equal(PRO_LIMITS.redditMaxResults, 100);
      assert.equal(PRO_LIMITS.hnMaxResults, 100);
      assert.equal(PRO_LIMITS.pappersFullProfile, true);
      assert.ok(PRO_LIMITS.exportFormats.includes('xls'));
      assert.ok(PRO_LIMITS.exportFormats.includes('pdf'));
    });
  });
});
