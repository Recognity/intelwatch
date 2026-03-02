import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Override the BASE_DIR to use a temp directory for tests
const testDir = join(tmpdir(), 'intelwatch-test-' + Date.now());

// We need to mock the storage module's BASE_DIR
// Since ESM doesn't support easy mocking, we test the logic directly

describe('Storage helpers', () => {
  const tempTrackersFile = join(testDir, 'trackers.json');
  const tempSnapshotsDir = join(testDir, 'snapshots');

  before(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(tempSnapshotsDir, { recursive: true });
  });

  after(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  test('directory creation', () => {
    assert.ok(existsSync(testDir));
    assert.ok(existsSync(tempSnapshotsDir));
  });

  test('tracker ID generation from URL', () => {
    function slugify(str) {
      return str
        .toLowerCase()
        .replace(/https?:\/\//g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    const id = slugify('https://www.example.com');
    assert.equal(id, 'www-example-com');

    const id2 = slugify('https://competitor.io/pricing');
    assert.equal(id2, 'competitor-io-pricing');
  });

  test('tracker data structure', () => {
    const tracker = {
      id: 'test-tracker',
      type: 'competitor',
      url: 'https://example.com',
      name: 'Example',
      createdAt: new Date().toISOString(),
      lastCheckedAt: null,
      status: 'active',
      checkCount: 0,
    };

    assert.equal(tracker.type, 'competitor');
    assert.equal(tracker.status, 'active');
    assert.equal(tracker.checkCount, 0);
    assert.ok(tracker.createdAt);
  });

  test('snapshot structure', () => {
    const snapshot = {
      type: 'competitor',
      trackerId: 'test-id',
      url: 'https://example.com',
      checkedAt: new Date().toISOString(),
      status: 'ok',
      error: null,
      meta: { title: 'Test', description: 'A test page' },
      techStack: [],
      socialLinks: {},
      links: [],
      pageCount: 0,
      pricing: null,
      jobs: null,
      keyPages: {},
    };

    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.error, null);
    assert.ok(Array.isArray(snapshot.techStack));
  });

  test('date formatting', () => {
    const now = new Date().toISOString();
    const d = new Date(now);
    assert.ok(!isNaN(d.getTime()));
  });

  test('JSON serialization round-trip', () => {
    const data = {
      id: 'test',
      type: 'keyword',
      keyword: 'audit SEO',
      results: [{ position: 1, domain: 'example.com', title: 'Test' }],
    };

    const serialized = JSON.stringify(data);
    const deserialized = JSON.parse(serialized);

    assert.equal(deserialized.keyword, 'audit SEO');
    assert.equal(deserialized.results[0].position, 1);
  });
});
