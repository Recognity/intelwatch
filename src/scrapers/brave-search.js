import axios from 'axios';
import { analyzeSentiment, categorizeMention } from '../utils/sentiment.js';

const BRAVE_API = 'https://api.search.brave.com/res/v1';

/**
 * Search via Brave Search API — reliable, no rate limiting issues.
 * Uses BRAVE_API_KEY env var or falls back to config.
 */
function getApiKey() {
  return process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY || null;
}

/**
 * Web search via Brave
 */
export async function braveWebSearch(query, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { results: [], error: 'No BRAVE_API_KEY set' };

  try {
    const params = {
      q: query,
      count: options.count || 20,
      country: options.country || 'FR',
      search_lang: options.lang || 'fr',
      freshness: options.freshness || undefined, // 'pd' (day), 'pw' (week), 'pm' (month)
    };

    const resp = await axios.get(`${BRAVE_API}/web/search`, {
      headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
      params,
      timeout: 15000,
    });

    const results = (resp.data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      domain: r.meta_url?.hostname?.replace('www.', '') || new URL(r.url).hostname.replace('www.', ''),
      snippet: r.description || '',
      age: r.age || null,
    }));

    return { results, error: null };
  } catch (err) {
    return { results: [], error: err.message };
  }
}

/**
 * News search via Brave
 */
export async function braveNewsSearch(query, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { results: [], error: 'No BRAVE_API_KEY set' };

  try {
    const params = {
      q: query,
      count: options.count || 20,
      country: options.country || 'FR',
      search_lang: options.lang || 'fr',
      freshness: options.freshness || 'pm', // last month by default
    };

    const resp = await axios.get(`${BRAVE_API}/news/search`, {
      headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
      params,
      timeout: 15000,
    });

    const results = (resp.data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      domain: r.meta_url?.hostname?.replace('www.', '') || '',
      snippet: r.description || '',
      age: r.age || null,
      source: r.meta_url?.hostname || '',
    }));

    return { results, error: null };
  } catch (err) {
    return { results: [], error: err.message };
  }
}

/**
 * Full press & mentions search for a brand/company.
 * Combines news + web results, analyzes sentiment, categorizes.
 */
export async function searchPressMentions(brandName, options = {}) {
  const mentions = [];

  // 1. News search
  const news = await braveNewsSearch(brandName, { freshness: 'pm', ...options });
  for (const r of news.results) {
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet);
    mentions.push({
      source: 'news',
      url: r.url,
      domain: r.domain || r.source,
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
  const web = await braveWebSearch(`"${brandName}" avis OR actualité OR news`, { freshness: 'pw', ...options });
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
  const reviews = await braveWebSearch(`"${brandName}" avis clients trustpilot`, { count: 10, ...options });
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

  // ── Relevance filter: drop results that don't actually mention the brand ──
  const brandLower = brandName.toLowerCase().trim();
  const brandWords = brandLower.split(/\s+/);
  const filtered = mentions.filter(m => {
    const text = ((m.title || '') + ' ' + (m.snippet || '') + ' ' + (m.domain || '')).toLowerCase();
    // Must contain the exact brand name OR all words of the brand
    if (text.includes(brandLower)) return true;
    if (brandWords.length > 1 && brandWords.every(w => text.includes(w))) return true;
    // Fuzzy: allow 1 char difference for short names (e.g. "Endrix" vs "Endrick" should be EXCLUDED)
    return false;
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
  const search = await braveWebSearch(keyword, { count: 20, ...options });
  
  return search.results.map((r, i) => ({
    position: i + 1,
    url: r.url,
    domain: r.domain,
    title: r.title,
    snippet: r.snippet,
  }));
}

/**
 * Social media search via Brave — filters by platform.
 * platforms: array of 'twitter', 'reddit', 'linkedin'
 */
export async function searchSocial(query, platforms = ['twitter', 'reddit', 'linkedin'], options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { results: [], byPlatform: {}, error: 'No BRAVE_API_KEY set' };

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

  const search = await braveWebSearch(fullQuery, { count: options.count || 15, ...options });

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
      const countMatch = text.match(/([\d\s,.]+)\s*(?:avis|reviews?|évaluations?)/);
      if (ratingMatch || countMatch) {
        platforms.push({
          name: 'Trustpilot',
          url: r.url,
          rating: ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null,
          reviewCount: countMatch ? countMatch[1].replace(/\s/g, '').replace(',', '') : null,
        });
      }
    }

    // Google reviews pattern
    if (/google/.test(text) && /avis|review/.test(text)) {
      const ratingMatch = text.match(/(\d[.,]\d)\s*(?:\/\s*5|sur\s*5|stars?|étoiles?)/);
      const countMatch = text.match(/([\d\s,.]+)\s*(?:avis|reviews?|évaluations?)/);
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
