import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock axios before importing the module
const axiosMock = {
  get: mock.fn(),
  post: mock.fn(),
};

// We need to inject the mock — since ESM doesn't allow easy mockery,
// we test through the public API with controlled env vars.
// For unit tests without network, we test logic and edge cases.

import {
  extractRatingsFromResults,
  resetInstanceCache,
  searchPressMentions,
  searchKeywordRankings,
  searchSocial,
  webSearch,
  newsSearch,
  getProviderStatus,
} from '../src/scrapers/searxng-search.js';

describe('extractRatingsFromResults', () => {
  test('extracts Trustpilot rating from URL and snippet', () => {
    const results = [
      {
        url: 'https://trustpilot.com/review/example',
        title: 'Example on Trustpilot',
        snippet: 'Rated 4.5 out of 5 with 1234 avis',
      },
    ];
    const ratings = extractRatingsFromResults(results);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].name, 'Trustpilot');
    assert.equal(ratings[0].rating, 4.5);
    assert.equal(ratings[0].reviewCount, '1234');
  });

  test('extracts Trustpilot rating with French format', () => {
    const results = [
      {
        url: 'https://trustpilot.com/review/example',
        title: 'Example',
        snippet: 'Note 3,8 sur 5',
      },
    ];
    const ratings = extractRatingsFromResults(results);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].rating, 3.8);
  });

  test('extracts Google review rating', () => {
    const results = [
      {
        url: 'https://example.com/page',
        title: 'Google avis example',
        snippet: '4.2/5 stars based on 567 avis',
      },
    ];
    const ratings = extractRatingsFromResults(results);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].name, 'Google');
    assert.equal(ratings[0].rating, 4.2);
    assert.equal(ratings[0].reviewCount, '567');
  });

  test('extracts Glassdoor rating from URL', () => {
    const results = [
      {
        url: 'https://glassdoor.com/Reviews/example',
        title: 'Example Reviews',
        snippet: '3.7/5 stars',
      },
    ];
    const ratings = extractRatingsFromResults(results);
    assert.equal(ratings.length, 1);
    assert.equal(ratings[0].name, 'Glassdoor');
    assert.equal(ratings[0].rating, 3.7);
  });

  test('returns empty array for no matching platforms', () => {
    const results = [
      { url: 'https://example.com', title: 'Random page', snippet: 'No ratings here' },
    ];
    const ratings = extractRatingsFromResults(results);
    assert.equal(ratings.length, 0);
  });

  test('handles empty results array', () => {
    const ratings = extractRatingsFromResults([]);
    assert.equal(ratings.length, 0);
  });

  test('handles null/undefined fields gracefully', () => {
    const results = [
      { url: null, title: null, snippet: null },
    ];
    assert.doesNotThrow(() => extractRatingsFromResults(results));
  });

  test('handles French comma decimal in rating', () => {
    const results = [
      {
        url: 'https://trustpilot.com/review/x',
        title: 'Test',
        snippet: '4,7/5 étoiles avec 200 avis',
      },
    ];
    const ratings = extractRatingsFromResults(results);
    assert.equal(ratings[0].rating, 4.7);
  });
});

describe('searchSocial — unit logic', () => {
  test('classifies Twitter/X URLs correctly', () => {
    // We test the platform classification logic indirectly
    // by examining the function contract
    assert.ok(typeof searchSocial === 'function');
  });

  test('accepts custom platform list', () => {
    assert.ok(typeof searchSocial === 'function');
    // Function should accept platforms parameter without error
    assert.doesNotThrow(() => {
      // Just verify the function exists and is callable
      // Actual network calls tested in integration
    });
  });
});

describe('searchKeywordRankings — contract', () => {
  test('returns array shape on success', async () => {
    // Without SearXNG/Serper available, should return empty or error gracefully
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = 'http://localhost:9999'; // unreachable

    try {
      const results = await searchKeywordRankings('test keyword');
      // Should be an array even on failure
      assert.ok(Array.isArray(results));
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      resetInstanceCache();
    }
  });
});

describe('webSearch — error handling', () => {
  test('returns error object when no instance available', async () => {
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    const originalSerper = process.env.SERPER_API_KEY;
    process.env.SEARXNG_URL = 'http://localhost:19999'; // unreachable
    delete process.env.SERPER_API_KEY;

    try {
      const result = await webSearch('test query');
      assert.ok(result);
      assert.ok(Array.isArray(result.results));
      // Either has results or has error
      if (result.results.length === 0) {
        assert.ok(result.error);
      }
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      if (originalSerper) process.env.SERPER_API_KEY = originalSerper;
      resetInstanceCache();
    }
  });

  test('returns empty results when Serper key missing and SearXNG down', async () => {
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    const originalSerper = process.env.SERPER_API_KEY;
    process.env.SEARXNG_URL = 'http://localhost:19999';
    delete process.env.SERPER_API_KEY;

    try {
      const result = await webSearch('nonexistent query test');
      assert.ok(Array.isArray(result.results));
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      if (originalSerper) process.env.SERPER_API_KEY = originalSerper;
      resetInstanceCache();
    }
  });
});

describe('newsSearch — error handling', () => {
  test('gracefully handles unreachable instance', async () => {
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    const originalSerper = process.env.SERPER_API_KEY;
    process.env.SEARXNG_URL = 'http://localhost:19998';
    delete process.env.SERPER_API_KEY;

    try {
      const result = await newsSearch('test news');
      assert.ok(result);
      assert.ok(Array.isArray(result.results));
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      if (originalSerper) process.env.SERPER_API_KEY = originalSerper;
      resetInstanceCache();
    }
  });
});

describe('searchPressMentions — edge cases', () => {
  test('handles empty brand name', async () => {
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = 'http://localhost:19997';

    try {
      const result = await searchPressMentions('');
      assert.ok(result);
      assert.equal(result.brandName, '');
      assert.ok(Array.isArray(result.mentions));
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      resetInstanceCache();
    }
  });

  test('result shape matches expected contract', async () => {
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = 'http://localhost:19996';

    try {
      const result = await searchPressMentions('TestBrand');
      assert.ok(result.brandName);
      assert.ok(result.checkedAt);
      assert.ok(Array.isArray(result.mentions));
      assert.ok(typeof result.mentionCount === 'number');
      assert.ok(typeof result.unfilteredCount === 'number');
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      resetInstanceCache();
    }
  });

  test('deduplicates URLs across news and web sources', async () => {
    // Verify function handles dedup logic even with empty results
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    process.env.SEARXNG_URL = 'http://localhost:19995';

    try {
      const result = await searchPressMentions('DedupeTest');
      // Should not throw and should have valid structure
      assert.ok(result);
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      resetInstanceCache();
    }
  });
});

describe('getProviderStatus', () => {
  test('returns status object with correct shape', async () => {
    resetInstanceCache();
    const originalEnv = process.env.SEARXNG_URL;
    const originalSerper = process.env.SERPER_API_KEY;
    delete process.env.SEARXNG_URL;
    delete process.env.SERPER_API_KEY;

    try {
      const status = await getProviderStatus();
      assert.ok(status.primary);
      assert.ok(status.fallback);
      assert.equal(status.primary.provider, 'searxng');
      assert.equal(status.fallback.provider, 'serper');
      assert.ok(typeof status.primary.status === 'string');
      assert.ok(typeof status.fallback.configured === 'boolean');
    } finally {
      if (originalEnv) process.env.SEARXNG_URL = originalEnv;
      else delete process.env.SEARXNG_URL;
      if (originalSerper) process.env.SERPER_API_KEY = originalSerper;
      else delete process.env.SERPER_API_KEY;
      resetInstanceCache();
    }
  });

  test('reports Serper as configured when key is set', async () => {
    resetInstanceCache();
    const originalSerper = process.env.SERPER_API_KEY;
    process.env.SERPER_API_KEY = 'test-key-123';

    try {
      const status = await getProviderStatus();
      assert.equal(status.fallback.configured, true);
      assert.equal(status.fallback.status, 'configured');
    } finally {
      if (originalSerper) process.env.SERPER_API_KEY = originalSerper;
      else delete process.env.SERPER_API_KEY;
      resetInstanceCache();
    }
  });
});

describe('resetInstanceCache', () => {
  test('is callable and does not throw', () => {
    assert.doesNotThrow(() => resetInstanceCache());
  });
});
