import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  exportToJSON,
  exportToCSV,
  exportToXLS,
  flattenObject,
  formatForExport,
  handleExport,
} from '../src/utils/export.js';
import { _resetCache } from '../src/license.js';

const testDir = join(tmpdir(), 'intelwatch-export-test-' + Date.now());

describe('Export Module', () => {
  before(() => {
    mkdirSync(testDir, { recursive: true });
    // Enable Pro for export tests so XLS/PDF don't throw license errors
    process.env.INTELWATCH_PRO_KEY = 'test-key';
    _resetCache();
  });

  after(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    delete process.env.INTELWATCH_PRO_KEY;
    _resetCache();
  });

  // ── JSON ─────────────────────────────────────────────────────────────────

  describe('exportToJSON', () => {
    test('writes JSON to file', () => {
      const data = [{ name: 'Test', value: 42 }];
      const path = join(testDir, 'test.json');
      const result = exportToJSON(data, path);
      assert.ok(result.includes('Exported to'));
      assert.ok(existsSync(path));
      const content = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(content[0].name, 'Test');
      assert.equal(content[0].value, 42);
    });

    test('handles nested objects', () => {
      const data = { nested: { deep: { value: 'found' } } };
      const path = join(testDir, 'nested.json');
      exportToJSON(data, path);
      const content = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(content.nested.deep.value, 'found');
    });

    test('handles null values', () => {
      const data = { a: null, b: undefined, c: 0, d: '' };
      const path = join(testDir, 'nulls.json');
      exportToJSON(data, path);
      const content = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(content.a, null);
      assert.equal(content.c, 0);
      assert.equal(content.d, '');
    });
  });

  // ── CSV ──────────────────────────────────────────────────────────────────

  describe('exportToCSV', () => {
    test('writes CSV to file', () => {
      const data = [
        { name: 'Alice', score: 95 },
        { name: 'Bob', score: 87 },
      ];
      const path = join(testDir, 'test.csv');
      const result = exportToCSV(data, path);
      assert.ok(result.includes('CSV exported'));
      const content = readFileSync(path, 'utf8');
      assert.ok(content.startsWith('name,score'));
      assert.ok(content.includes('Alice,95'));
      assert.ok(content.includes('Bob,87'));
    });

    test('escapes commas and quotes', () => {
      const data = [{ text: 'hello, "world"', value: 'normal' }];
      const path = join(testDir, 'escaped.csv');
      exportToCSV(data, path);
      const content = readFileSync(path, 'utf8');
      assert.ok(content.includes('"hello, ""world"""'));
    });

    test('handles empty array', () => {
      const path = join(testDir, 'empty.csv');
      const result = exportToCSV([], path, { headers: ['a', 'b'] });
      assert.ok(result.includes('Empty'));
      const content = readFileSync(path, 'utf8');
      assert.equal(content.trim(), 'a,b');
    });

    test('throws on non-array', () => {
      assert.throws(() => exportToCSV('not array', null), /array/i);
    });

    test('handles arrays in values', () => {
      const data = [{ tags: ['seo', 'web', 'audit'] }];
      const path = join(testDir, 'arrays.csv');
      exportToCSV(data, path);
      const content = readFileSync(path, 'utf8');
      assert.ok(content.includes('seo; web; audit'));
    });

    test('handles newlines in values', () => {
      const data = [{ desc: 'line1\nline2' }];
      const path = join(testDir, 'newlines.csv');
      exportToCSV(data, path);
      const content = readFileSync(path, 'utf8');
      assert.ok(content.includes('"line1\nline2"'));
    });

    test('supports custom headers', () => {
      const data = [{ a: 1, b: 2, c: 3 }];
      const path = join(testDir, 'custom-headers.csv');
      exportToCSV(data, path, { headers: ['a', 'c'] });
      const content = readFileSync(path, 'utf8');
      assert.ok(content.startsWith('a,c'));
      assert.ok(content.includes('1,3'));
    });
  });

  // ── XLS ──────────────────────────────────────────────────────────────────

  describe('exportToXLS', () => {
    test('writes XLSX file', () => {
      const data = [
        { name: 'CompanyA', revenue: 1000000, employees: 50 },
        { name: 'CompanyB', revenue: 500000, employees: 25 },
      ];
      const path = join(testDir, 'test.xlsx');
      const result = exportToXLS(data, path);
      assert.ok(result.includes('XLS exported'));
      assert.ok(existsSync(path));
      // Verify file is valid by checking size > 0
      const stat = readFileSync(path);
      assert.ok(stat.length > 100);
    });

    test('handles empty data', () => {
      const path = join(testDir, 'empty.xlsx');
      const result = exportToXLS([], path, { headers: ['a', 'b'] });
      assert.ok(result.includes('XLS exported'));
      assert.ok(existsSync(path));
    });

    test('throws without output path', () => {
      assert.throws(() => exportToXLS([{ a: 1 }]), /output path/i);
    });

    test('throws on non-array', () => {
      assert.throws(() => exportToXLS('bad', join(testDir, 'x.xlsx')), /array/i);
    });

    test('custom sheet name', () => {
      const path = join(testDir, 'custom-sheet.xlsx');
      exportToXLS([{ x: 1 }], path, { sheetName: 'My Sheet' });
      assert.ok(existsSync(path));
    });
  });

  // ── flattenObject ────────────────────────────────────────────────────────

  describe('flattenObject', () => {
    test('flattens nested object', () => {
      const result = flattenObject({ a: { b: { c: 1 } } });
      assert.equal(result['a.b.c'], 1);
    });

    test('preserves arrays', () => {
      const result = flattenObject({ tags: ['a', 'b'] });
      assert.deepEqual(result.tags, ['a', 'b']);
    });

    test('handles empty object', () => {
      const result = flattenObject({});
      assert.deepEqual(result, {});
    });

    test('handles mixed depths', () => {
      const result = flattenObject({ a: 1, b: { c: 2, d: { e: 3 } } });
      assert.equal(result.a, 1);
      assert.equal(result['b.c'], 2);
      assert.equal(result['b.d.e'], 3);
    });
  });

  // ── formatForExport ────────────────────────────────────────────────────

  describe('formatForExport', () => {
    test('check format', () => {
      const data = [
        { id: '1', name: 'Test', url: 'https://ex.com', type: 'competitor', status: 'active', techStack: ['React', 'Node'] }
      ];
      const result = formatForExport(data, 'check');
      assert.ok(Array.isArray(result));
      assert.equal(result[0].techStack, 'React; Node');
    });

    test('digest format', () => {
      const data = [
        { trackerId: '1', name: 'Test', type: 'competitor', changes: [
          { severity: 'critical' }, { severity: 'minor' }
        ] }
      ];
      const result = formatForExport(data, 'digest');
      assert.ok(Array.isArray(result));
      assert.equal(result[0]['changes.total'], 2);
      assert.equal(result[0]['changes.critical'], 1);
    });

    test('profile format', () => {
      const data = {
        siren: '123456789',
        identity: { name: 'TestCo', formeJuridique: 'SAS' },
        financialHistory: [{ revenue: 1000000, year: 2024 }],
        strengths: ['good', 'great'],
        weaknesses: ['small'],
      };
      const result = formatForExport(data, 'profile');
      assert.ok(Array.isArray(result));
      assert.equal(result[0].siren, '123456789');
      assert.equal(result[0].name, 'TestCo');
    });

    test('discover format', () => {
      const data = [{ domain: 'example.com', url: 'https://example.com', score: 85 }];
      const result = formatForExport(data, 'discover');
      assert.ok(Array.isArray(result));
      assert.equal(result[0].domain, 'example.com');
    });

    test('unknown format returns data as-is', () => {
      const data = [{ x: 1 }];
      const result = formatForExport(data, 'unknown');
      assert.deepEqual(result, data);
    });
  });

  // ── handleExport ─────────────────────────────────────────────────────────

  describe('handleExport', () => {
    test('handles JSON export', async () => {
      const data = [{ a: 1 }];
      const path = join(testDir, 'handle-test.json');
      const result = await handleExport('json', data, { output: path });
      assert.ok(result.includes('Exported'));
      assert.ok(existsSync(path));
    });

    test('handles CSV export', async () => {
      const data = [{ a: 1, b: 2 }];
      const path = join(testDir, 'handle-test.csv');
      const result = await handleExport('csv', data, { output: path });
      assert.ok(result.includes('CSV exported'));
    });

    test('handles XLS export', async () => {
      const data = [{ a: 1, b: 2 }];
      const path = join(testDir, 'handle-test.xlsx');
      const result = await handleExport('xls', data, { output: path });
      assert.ok(result.includes('XLS exported'));
    });

    test('throws on unsupported format', async () => {
      await assert.rejects(
        () => handleExport('xml', [{ a: 1 }], {}),
        /unsupported/i
      );
    });

    test('XLS export calls process.exit without Pro key', async () => {
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      // printPaywallAndExit calls process.exit(0) — mock it to verify
      const origExit = process.exit;
      let exitCalled = false;
      let exitCode = null;
      process.exit = (code) => { exitCalled = true; exitCode = code; };
      try {
        await handleExport('xls', [{ a: 1 }], { output: join(testDir, 'gated.xlsx') });
      } catch { /* ignore if anything throws after mock */ }
      process.exit = origExit;
      assert.equal(exitCalled, true, 'process.exit should be called for Pro-only export');
      assert.equal(exitCode, 0, 'should exit with code 0 (clean paywall)');
      // Restore for remaining tests
      process.env.INTELWATCH_PRO_KEY = 'test-key';
      _resetCache();
    });

    test('PDF export calls process.exit without Pro key', async () => {
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      const origExit = process.exit;
      let exitCalled = false;
      let exitCode = null;
      process.exit = (code) => { exitCalled = true; exitCode = code; };
      try {
        await handleExport('pdf', [{ a: 1 }], { output: join(testDir, 'gated.pdf') });
      } catch { /* ignore */ }
      process.exit = origExit;
      assert.equal(exitCalled, true, 'process.exit should be called for Pro-only export');
      assert.equal(exitCode, 0);
      process.env.INTELWATCH_PRO_KEY = 'test-key';
      _resetCache();
    });

    test('handles commandType formatting', async () => {
      const data = [{ id: '1', name: 'Co', url: 'https://ex.com', type: 'competitor', techStack: ['React'] }];
      const path = join(testDir, 'formatted.json');
      const result = await handleExport('json', data, { output: path, commandType: 'check' });
      assert.ok(result.includes('Exported'));
    });
  });
});
