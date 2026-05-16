/**
 * Brave Search API client — third press fallback (after Exa + SearXNG).
 *
 * Brave Search Data API freemium plan : 2000 req/mo gratuit, ~$5/CPM ensuite.
 * Beaucoup plus fiable que les instances SearxNG publiques sur les sujets
 * business FR, et complémentaire à Exa (Brave est keyword-first, Exa
 * sémantique). Cible : récupérer 10-20 articles presse sur une entreprise FR.
 *
 * Env vars :
 *   BRAVE_API_KEY   — clé API Brave Search (header X-Subscription-Token)
 *
 * Docs : https://api-dashboard.search.brave.com/app/documentation/web-search
 */

import axios from 'axios';
import { analyzeSentiment, categorizeMention } from '../utils/sentiment.js';

const BRAVE_BASE = 'https://api.search.brave.com/res/v1';
const BRAVE_TIMEOUT = 10000;

function getBraveKey() {
  return process.env.BRAVE_API_KEY || null;
}

export function hasBraveKey() {
  return !!getBraveKey();
}

function braveClient() {
  const key = getBraveKey();
  if (!key) return null;
  return axios.create({
    baseURL: BRAVE_BASE,
    timeout: BRAVE_TIMEOUT,
    headers: {
      'X-Subscription-Token': key,
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
    },
  });
}

/**
 * Recherche web Brave classique. Renvoie une liste normalisée.
 *
 * @param {string} query
 * @param {object} options — { count=20, country='FR', lang='fr', freshness=null }
 * @returns {{ results: Array, error: string|null }}
 */
export async function braveWebSearch(query, options = {}) {
  const client = braveClient();
  if (!client) return { results: [], error: 'BRAVE_API_KEY not set' };

  const params = {
    q: query,
    count: Math.min(options.count || 20, 20),
    country: options.country || 'FR',
    search_lang: options.lang || 'fr',
    safesearch: 'moderate',
  };
  if (options.freshness) params.freshness = options.freshness; // pd|pw|pm|py

  try {
    const resp = await client.get('/web/search', { params });
    const webResults = resp.data?.web?.results || [];
    const results = webResults.map(r => ({
      title: r.title || '',
      url: r.url || '',
      domain: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      snippet: r.description || r.extra_snippets?.[0] || '',
      age: r.age || r.page_age || null,
      thumbnail: r.thumbnail?.src || null,
    }));
    return { results, error: null };
  } catch (err) {
    const status = err.response?.status;
    const msg = status === 429
      ? 'Brave rate-limited (429)'
      : (err.response?.data?.message || err.message || 'Brave search failed');
    return { results: [], error: msg };
  }
}

/**
 * Recherche news Brave (endpoint /news/search). freshness par défaut 'pm' (30j).
 */
export async function braveNewsSearch(query, options = {}) {
  const client = braveClient();
  if (!client) return { results: [], error: 'BRAVE_API_KEY not set' };

  const params = {
    q: query,
    count: Math.min(options.count || 20, 20),
    country: options.country || 'FR',
    search_lang: options.lang || 'fr',
    freshness: options.freshness || 'pm',
  };

  try {
    const resp = await client.get('/news/search', { params });
    const newsResults = resp.data?.results || [];
    const results = newsResults.map(r => ({
      title: r.title || '',
      url: r.url || '',
      domain: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      snippet: r.description || '',
      age: r.age || r.page_age || null,
      thumbnail: r.thumbnail?.src || null,
      source: r.meta_url?.netloc || null,
    }));
    return { results, error: null };
  } catch (err) {
    const status = err.response?.status;
    const msg = status === 429
      ? 'Brave news rate-limited (429)'
      : (err.response?.data?.message || err.message || 'Brave news search failed');
    return { results: [], error: msg };
  }
}

/**
 * Press mentions wrapper drop-in compatible avec searchPressMentions
 * (searxng-search.js). Utilisé comme fallback dans fetchPressData.
 *
 * @param {string} brandName
 * @param {object} options
 * @returns {{ mentions: Array, error: string|null }}
 */
export async function searchPressMentionsViaBrave(brandName, options = {}) {
  const client = braveClient();
  if (!client) return { mentions: [], error: 'BRAVE_API_KEY not set' };

  const mentions = [];
  // 1) News fresh (30j)
  const news = await braveNewsSearch(brandName, { freshness: 'pm', count: 20, ...options });
  for (const r of news.results) {
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet, 'auto', { domain: r.domain || r.source || '' });
    mentions.push({
      source: 'brave-news',
      url: r.url,
      domain: r.domain || r.source || '',
      title: r.title,
      snippet: (r.snippet || '').substring(0, 300),
      age: r.age,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      category: categorizeMention(r.url, r.title, r.snippet),
    });
  }
  // 2) Web mentions (year)
  await new Promise(r => setTimeout(r, 350));
  const web = await braveWebSearch(`"${brandName}" actualité OR communiqué OR acquisition OR croissance`, { freshness: 'py', count: 15, ...options });
  for (const r of web.results) {
    if (mentions.some(m => m.url === r.url)) continue;
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet, 'auto', { domain: r.domain || r.source || '' });
    mentions.push({
      source: 'brave-web',
      url: r.url,
      domain: r.domain,
      title: r.title,
      snippet: (r.snippet || '').substring(0, 300),
      age: r.age,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      category: categorizeMention(r.url, r.title, r.snippet),
    });
  }

  // Filtre pertinence (le nom de marque doit apparaître dans le résultat)
  const brandLower = brandName.toLowerCase().trim();
  const filtered = mentions.filter(m => {
    const text = ((m.title || '') + ' ' + (m.snippet || '') + ' ' + (m.domain || '')).toLowerCase();
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
