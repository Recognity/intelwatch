/**
 * SearXNG Search Provider — drop-in replacement for brave-search.js
 *
 * Strategy: SearXNG (self-hosted or public instance) as primary,
 * Serper (Google API, cheap key) as optional premium fallback.
 * Zero-cost by default. No mandatory API key.
 *
 * Env vars:
 *   SEARXNG_URL    — custom SearXNG instance URL (default: public instance)
 *   SERPER_API_KEY — optional Serper.dev API key for premium Google results
 */
import axios from 'axios';
import { handleError, retry } from '../utils/error-handler.js';
import { analyzeSentiment, categorizeMention } from '../utils/sentiment.js';

// ── Instance management ──────────────────────────────────────────────────────

const DEFAULT_PUBLIC_INSTANCES = [
  'https://search.sapti.me',
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searxng.ch',
  'https://search.mdosch.de',
];

const SEARXNG_TIMEOUT = 12000;
const SERPER_TIMEOUT = 10000;

function getSearxngUrl() {
  return process.env.SEARXNG_URL || null;
}

function getSerperKey() {
  return process.env.SERPER_API_KEY || null;
}

/**
 * Probe a SearXNG instance for availability. Returns true if reachable.
 */
async function probeInstance(url) {
  try {
    const resp = await axios.get(url, {
      params: { q: 'test', format: 'json', pageno: 1 },
      timeout: 5000,
      validateStatus: () => true,
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

/**
 * Find a working SearXNG instance. Tries custom URL first, then public list.
 * Caches the working instance for the session.
 */
let _cachedInstance = null;

async function findWorkingInstance() {
  if (_cachedInstance) return _cachedInstance;

  // 1. Custom instance from env
  const customUrl = getSearxngUrl();
  if (customUrl) {
    if (await probeInstance(customUrl)) {
      _cachedInstance = customUrl;
      return customUrl;
    }
    // Custom failed — fall through to public
  }

  // 2. Try public instances (race first 3)
  const candidates = shuffleArray([...DEFAULT_PUBLIC_INSTANCES]).slice(0, 3);
  for (const url of candidates) {
    if (await probeInstance(url)) {
      _cachedInstance = url;
      return url;
    }
  }

  return null;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── SearXNG API calls ────────────────────────────────────────────────────────

/**
 * Generic SearXNG search. Returns normalized results.
 */
async function searxngSearch(query, options = {}) {
  const {
    categories = 'general',
    count = 20,
    language = 'fr',
    timeRange = null, // 'day', 'week', 'month', 'year'
    pageno = 1,
  } = options;

  const instanceUrl = await findWorkingInstance();
  if (!instanceUrl) {
    return { results: [], error: 'No SearXNG instance available. Set SEARXNG_URL or check connectivity.' };
  }

  try {
    const params = {
      q: query,
      format: 'json',
      categories,
      language,
      pageno,
      pageno: String(pageno),
    };
    if (count) params.num = String(count);
    if (timeRange) params.time_range = timeRange;

    const resp = await retry(
      () => axios.get(instanceUrl, {
        params,
        timeout: SEARXNG_TIMEOUT,
        headers: { 'Accept': 'application/json' },
        validateStatus: status => status < 500,
      }),
      { maxAttempts: 2, baseDelay: 1000 }
    );

    if (resp.status === 429) {
      return { results: [], error: 'SearXNG rate limited. Try again later.' };
    }

    if (resp.status !== 200) {
      return { results: [], error: `SearXNG returned HTTP ${resp.status}` };
    }

    const data = resp.data;
    const results = (data.results || []).slice(0, count).map(r => {
      let domain = '';
      try {
        domain = new URL(r.url).hostname.replace('www.', '');
      } catch {}

      return {
        title: r.title || '',
        url: r.url || '',
        domain,
        snippet: r.content || '',
        age: r.publishedDate || null,
        engine: r.engine || null,
        category: r.category || categories,
      };
    });

    return { results, error: null };
  } catch (err) {
    // Reset cached instance on failure so next call rediscovers
    _cachedInstance = null;
    handleError(err, 'searxngSearch');
    return { results: [], error: err.message };
  }
}

// ── Serper (premium fallback) ────────────────────────────────────────────────

async function serperSearch(query, options = {}) {
  const apiKey = getSerperKey();
  if (!apiKey) return { results: [], error: 'No SERPER_API_KEY set' };

  const { count = 20, gl = 'fr', hl = 'fr', tbs = null } = options;

  try {
    const body = { q: query, num: count, gl, hl };
    if (tbs) body.tbs = tbs;

    const resp = await axios.post('https://google.serper.dev/search', body, {
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      timeout: SERPER_TIMEOUT,
    });

    const organic = (resp.data.organic || []).map(r => ({
      title: r.title || '',
      url: r.link || '',
      domain: r.link ? (() => { try { return new URL(r.link).hostname.replace('www.', ''); } catch { return ''; } })() : '',
      snippet: r.snippet || '',
      age: r.date || null,
      position: r.position || 0,
    }));

    const news = (resp.data.news || []).map(r => ({
      title: r.title || '',
      url: r.link || '',
      domain: r.link ? (() => { try { return new URL(r.link).hostname.replace('www.', ''); } catch { return ''; } })() : '',
      snippet: r.snippet || '',
      age: r.date || null,
      source: r.source || '',
    }));

    return { results: [...organic, ...news], error: null };
  } catch (err) {
    handleError(err, 'serperSearch');
    return { results: [], error: err.message };
  }
}

// ── Unified search with automatic fallback ────────────────────────────────────

/**
 * Web search: SearXNG → Serper fallback
 */
export async function webSearch(query, options = {}) {
  // Try SearXNG first (free)
  const searxResult = await searxngSearch(query, { categories: 'general', ...options });
  if (searxResult.results.length > 0 || !getSerperKey()) {
    return searxResult;
  }

  // Serper fallback
  const serperResult = await serperSearch(query, options);
  if (serperResult.results.length > 0) {
    return serperResult;
  }

  // Both failed — return SearXNG result (with its error for diagnostics)
  return searxResult;
}

/**
 * News search: SearXNG news category → Serper fallback
 */
export async function newsSearch(query, options = {}) {
  const searxResult = await searxngSearch(query, {
    categories: 'news',
    timeRange: options.timeRange || 'month',
    ...options,
  });
  if (searxResult.results.length > 0 || !getSerperKey()) {
    return searxResult;
  }

  // Serper fallback (news)
  const serperResult = await serperSearch(query, { tbs: 'qdr:m', ...options });
  return serperResult.results.length > 0 ? serperResult : searxResult;
}

// ── High-level API (drop-in compatible with brave-search.js exports) ─────────

/**
 * Full press & mentions search for a brand/company.
 * Combines news + web results, analyzes sentiment, categorizes.
 */
export async function searchPressMentions(brandName, options = {}) {
  const mentions = [];

  // 1. News search
  const news = await newsSearch(brandName, { timeRange: 'month', ...options });
  for (const r of news.results) {
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet);
    mentions.push({
      source: 'news',
      url: r.url,
      domain: r.domain || r.source || '',
      title: r.title,
      snippet: r.snippet?.substring(0, 300),
      age: r.age,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      category: categorizeMention(r.url, r.title, r.snippet),
    });
  }

  // 2. Web search for recent mentions
  await new Promise(r => setTimeout(r, 500));
  const web = await webSearch(`"${brandName}" avis OR actualité OR news`, { timeRange: 'week', ...options });
  for (const r of web.results) {
    if (mentions.some(m => m.url === r.url)) continue; // dedupe
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet);
    mentions.push({
      source: 'web',
      url: r.url,
      domain: r.domain,
      title: r.title,
      snippet: r.snippet?.substring(0, 300),
      age: r.age,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      category: categorizeMention(r.url, r.title, r.snippet),
    });
  }

  // 3. Search for reviews specifically
  await new Promise(r => setTimeout(r, 500));
  const reviews = await webSearch(`"${brandName}" avis clients trustpilot`, { count: 10, ...options });
  for (const r of reviews.results) {
    if (mentions.some(m => m.url === r.url)) continue;
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet);
    if (/trustpilot|avis|review|capterra|g2\.com|glassdoor/.test(r.url + r.title)) {
      mentions.push({
        source: 'review',
        url: r.url,
        domain: r.domain,
        title: r.title,
        snippet: r.snippet?.substring(0, 300),
        age: r.age,
        sentiment: sentiment.label,
        sentimentScore: sentiment.score,
        category: 'review',
      });
    }
  }

  // ── Relevance filter ──
  const brandLower = brandName.toLowerCase().trim();
  const brandWords = brandLower.split(/\s+/);
  const filtered = mentions.filter(m => {
    const text = ((m.title || '') + ' ' + (m.snippet || '') + ' ' + (m.domain || '')).toLowerCase();
    if (text.includes(brandLower)) return true;
    if (brandWords.length > 1 && brandWords.every(w => text.includes(w))) return false;
    return text.includes(brandLower);
  });

  return {
    brandName,
    checkedAt: new Date().toISOString(),
    mentions: filtered,
    mentionCount: filtered.length,
    unfilteredCount: mentions.length,
    error: news.error || web.error || null,
  };
}

/**
 * Search SERP rankings for a keyword
 */
export async function searchKeywordRankings(keyword, options = {}) {
  const search = await webSearch(keyword, { count: 20, ...options });
  return search.results.map((r, i) => ({
    position: r.position || i + 1,
    url: r.url,
    domain: r.domain,
    title: r.title,
    snippet: r.snippet,
  }));
}

/**
 * Social media search — filters by platform.
 * platforms: array of 'twitter', 'reddit', 'linkedin'
 */
export async function searchSocial(query, platforms = ['twitter', 'reddit', 'linkedin'], options = {}) {
  const siteFilters = {
    twitter: 'site:x.com OR site:twitter.com',
    reddit: 'site:reddit.com',
    linkedin: 'site:linkedin.com',
  };

  const siteQuery = platforms
    .map(p => siteFilters[p])
    .filter(Boolean)
    .join(' OR ');

  const fullQuery = `${query} (${siteQuery})`;
  const search = await webSearch(fullQuery, { count: options.count || 15, ...options });

  const results = (search.results || []).map(r => {
    let platform = 'other';
    const urlLower = r.url.toLowerCase();
    if (urlLower.includes('x.com') || urlLower.includes('twitter.com')) platform = 'twitter';
    else if (urlLower.includes('reddit.com')) platform = 'reddit';
    else if (urlLower.includes('linkedin.com')) platform = 'linkedin';
    return { ...r, platform };
  });

  const byPlatform = {};
  for (const r of results) {
    if (!byPlatform[r.platform]) byPlatform[r.platform] = [];
    byPlatform[r.platform].push(r);
  }

  return { results, byPlatform, error: search.error };
}

/**
 * Extract review ratings from search snippets
 */
export function extractRatingsFromResults(results) {
  const platforms = [];

  for (const r of results) {
    const text = `${r.title} ${r.snippet}`.toLowerCase();

    // Trustpilot pattern
    if (/trustpilot/.test(r.url) || /trustpilot/.test(text)) {
      const ratingMatch = text.match(/(\d[.,]\d)\s*(?:\/\s*5|sur\s*5|out of 5|stars?|étoiles?)/);
      const countMatch = text.match(/(\d[\d\s,.]*)\s*(?:avis|reviews?|évaluations?)/);
      if (ratingMatch) {
        platforms.push({
          name: 'Trustpilot', // Correction du nom de plateforme
          url: r.url,
          rating: parseFloat(ratingMatch[1].replace(',', '.')),
          reviewCount: countMatch ? countMatch[1].replace(/\s/g, '').replace(',', '') : null,
        });
      }
    }

    // Google reviews pattern
    if (/google/.test(text) && /avis|review/.test(text)) {
      const ratingMatch = text.match(/(\d[.,]\d)\s*(?:\/\s*5|sur\s*5|stars?|étoiles?)/);
      const countMatch = text.match(/(\d[\d\s,.]*)\s*(?:avis|reviews?|évaluations?)/);
      if (ratingMatch) {
        platforms.push({
          name: 'Google',
          url: r.url,
          rating: parseFloat(ratingMatch[1].replace(',', '.')),
          reviewCount: countMatch ? countMatch[1].replace(/\s/g, '') : null,
        });
      }
    }

    // Glassdoor (employer reputation)
    if (/glassdoor/.test(r.url)) {
      const ratingMatch = text.match(/(\d[.,]\d)\s*(?:\/\s*5|sur\s*5|stars?)/);
      if (ratingMatch) {
        platforms.push({
          name: 'Glassdoor',
          url: r.url,
          rating: parseFloat(ratingMatch[1].replace(',', '.')),
          reviewCount: null,
        });
      }
    }
  }

  return platforms;
}

// ── Backward-compatible aliases (brave-search.js API surface) ─────────────────

/** @deprecated Use webSearch() */
export async function braveWebSearch(query, options = {}) {
  return webSearch(query, options);
}

/** @deprecated Use newsSearch() */
export async function braveNewsSearch(query, options = {}) {
  const opts = {};
  if (options.freshness === 'pd') opts.timeRange = 'day';
  else if (options.freshness === 'pw') opts.timeRange = 'week';
  else if (options.freshness === 'pm') opts.timeRange = 'month';
  return newsSearch(query, { ...opts, ...options });
}

// ── Instance health check (useful for CLI status commands) ───────────────────

export async function getProviderStatus() {
  const customUrl = getSearxngUrl();
  const instanceUrl = customUrl || _cachedInstance;

  let searxStatus = 'unavailable';
  if (instanceUrl) {
    const ok = await probeInstance(instanceUrl);
    searxStatus = ok ? 'ok' : 'down';
  } else {
    // Try to discover
    const found = await findWorkingInstance();
    searxStatus = found ? 'ok' : 'unavailable';
  }

  const serperKey = getSerperKey();

  return {
    primary: { provider: 'searxng', instance: instanceUrl || 'none', status: searxStatus },
    fallback: { provider: 'serper', configured: !!serperKey, status: serperKey ? 'configured' : 'none' },
  };
}

/**
 * Reset cached instance (for testing or after connectivity change)
 */
export function resetInstanceCache() {
  _cachedInstance = null;
}
