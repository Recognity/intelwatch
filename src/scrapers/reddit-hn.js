/**
 * Reddit & Hacker News scrapers for brand/keyword mentions.
 *
 * Uses public JSON APIs (no auth required):
 * - Reddit: https://www.reddit.com/search.json?q=<query>
 * - HN (Algolia): https://hn.algolia.com/api/v1/search?query=<query>
 */

import { fetch as fetchWithRetry } from '../utils/fetcher.js';
import { getLimits, isPro } from '../license.js';

const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';

// ── Reddit ───────────────────────────────────────────────────────────────────

/**
 * Search Reddit for mentions of a brand/keyword.
 * @param {string} query
 * @param {{ limit?: number, sort?: string, timeFilter?: string }} options
 * @returns {Promise<Array<{ title: string, url: string, subreddit: string, score: number, numComments: number, author: string, createdAt: string, selftext: string, domain: string, source: string }>>}
 */
export async function searchReddit(query, options = {}) {
  // Pro-only: Reddit scraping requires a license
  if (!isPro()) {
    if (process.env.DEBUG) {
      console.error('[reddit] Skipped — Pro license required');
    }
    return [];
  }

  const limits = getLimits();
  const { limit = limits.redditMaxResults, sort = 'relevance', timeFilter = 'month' } = options;

  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.min(limit, 100)),
      sort,
      t: timeFilter,
      type: 'link',
    });

    const url = `${REDDIT_SEARCH_URL}?${params}`;
    const resp = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'intelwatch/1.2.0 (competitive intelligence CLI)',
        'Accept': 'application/json',
      },
      timeout: 15000,
    });

    if (!resp || resp.status >= 400) {
      return [];
    }

    const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    const posts = data?.data?.children || [];

    return posts.slice(0, limits.redditMaxResults).map(({ data: post }) => ({
      title: post.title || '',
      url: `https://www.reddit.com${post.permalink}`,
      subreddit: post.subreddit_name_prefixed || `r/${post.subreddit}`,
      score: post.score || 0,
      numComments: post.num_comments || 0,
      author: post.author || '[deleted]',
      createdAt: new Date((post.created_utc || 0) * 1000).toISOString(),
      selftext: (post.selftext || '').slice(0, 500),
      domain: post.domain || '',
      source: 'reddit',
    }));
  } catch (err) {
    // Silently fail — Reddit rate-limits aggressively
    if (process.env.DEBUG) {
      console.error(`[reddit] Search failed: ${err.message}`);
    }
    return [];
  }
}

// ── Hacker News ──────────────────────────────────────────────────────────────

/**
 * Search Hacker News via Algolia API.
 * @param {string} query
 * @param {{ limit?: number, tags?: string }} options
 * @returns {Promise<Array<{ title: string, url: string, hnUrl: string, points: number, numComments: number, author: string, createdAt: string, source: string }>>}
 */
export async function searchHackerNews(query, options = {}) {
  // Pro-only: HackerNews scraping requires a license
  if (!isPro()) {
    if (process.env.DEBUG) {
      console.error('[hn] Skipped — Pro license required');
    }
    return [];
  }

  const limits = getLimits();
  const { limit = limits.hnMaxResults, tags = 'story' } = options;

  try {
    const params = new URLSearchParams({
      query,
      tags,
      hitsPerPage: String(Math.min(limit, 100)),
    });

    const url = `${HN_SEARCH_URL}?${params}`;
    const resp = await fetchWithRetry(url, {
      headers: { 'Accept': 'application/json' },
      timeout: 15000,
    });

    if (!resp || resp.status >= 400) {
      return [];
    }

    const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    const hits = data?.hits || [];

    return hits.slice(0, limits.hnMaxResults).map(hit => ({
      title: hit.title || '',
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      hnUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      points: hit.points || 0,
      numComments: hit.num_comments || 0,
      author: hit.author || '',
      createdAt: hit.created_at || '',
      source: 'hackernews',
    }));
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[hn] Search failed: ${err.message}`);
    }
    return [];
  }
}

// ── Combined search ──────────────────────────────────────────────────────────

/**
 * Search both Reddit and HN, return combined results sorted by recency.
 * @param {string} query
 * @param {{ redditLimit?: number, hnLimit?: number }} options
 * @returns {Promise<Array<object>>}
 */
export async function searchCommunities(query, options = {}) {
  const [redditResults, hnResults] = await Promise.all([
    searchReddit(query, { limit: options.redditLimit || 15 }),
    searchHackerNews(query, { limit: options.hnLimit || 15 }),
  ]);

  // Merge and sort by date (most recent first)
  const all = [...redditResults, ...hnResults].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime() || 0;
    const dateB = new Date(b.createdAt).getTime() || 0;
    return dateB - dateA;
  });

  return all;
}
