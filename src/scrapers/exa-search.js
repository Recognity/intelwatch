/**
 * Exa Search Client — semantic + keyword press discovery for company DD.
 *
 * Exa (https://exa.ai) indexe le web avec une couche sémantique et renvoie
 * des résultats rankés pour une entreprise cible. Beaucoup plus pertinent
 * que SearxNG sur les sujets M&A / restructuring / leadership.
 *
 * Endpoints utilisés :
 *   POST /search            — recherche keyword + semantic (date filter, domain filter)
 *   POST /contents          — fetch full text d'une liste d'URLs déjà découvertes
 *
 * Env vars :
 *   EXA_API_KEY   — clé API Exa (x-api-key header)
 *
 * Docs : https://docs.exa.ai/reference/search
 */

import axios from 'axios';

const EXA_BASE = 'https://api.exa.ai';
const EXA_TIMEOUT = 15000;

function getExaKey() {
  return process.env.EXA_API_KEY || null;
}

export function hasExaKey() {
  return !!getExaKey();
}

function exaClient() {
  const key = getExaKey();
  if (!key) return null;
  return axios.create({
    baseURL: EXA_BASE,
    timeout: EXA_TIMEOUT,
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
}

/**
 * Recherche presse focalisée entreprise : mentions récentes, M&A, procédures,
 * dirigeants, opérations. Renvoie un tableau de mentions au même schéma que
 * searxng-search.js (pour intégration drop-in).
 *
 * @param {string} brandName — raison sociale
 * @param {object} options   — { lookbackMonths=12, numResults=15, siren=null }
 * @returns {{ mentions: Array, error: string|null, cost: number }}
 */
export async function searchCompanyPressViaExa(brandName, options = {}) {
  const client = exaClient();
  if (!client) return { mentions: [], error: 'EXA_API_KEY not set', cost: 0 };

  const lookbackMonths = options.lookbackMonths || 12;
  const numResults = options.numResults || 15;

  const startPublishedDate = new Date(
    Date.now() - lookbackMonths * 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  // Requête ciblée : raison sociale + contexte business français
  const query = options.siren
    ? `"${brandName}" OR "${options.siren}" entreprise France`
    : `"${brandName}" entreprise France`;

  try {
    const resp = await client.post('/search', {
      query,
      numResults,
      type: 'auto',                    // auto = semantic + keyword mix
      useAutoprompt: true,
      startPublishedDate,
      contents: {
        text: { maxCharacters: 2500 }, // inclut le texte dans la réponse
        highlights: { numSentences: 2, highlightsPerUrl: 2 },
      },
      // Focus press/news domains + docs publics (pas de scraping social)
      category: 'news',
    });

    const results = resp.data?.results || [];
    const cost = resp.data?.costDollars?.total || 0;

    // Normalise au format SearxNG
    const mentions = results.map(r => ({
      source: 'exa',
      url: r.url,
      domain: (() => { try { return new URL(r.url).hostname; } catch { return ''; } })(),
      title: r.title || '',
      snippet: (r.text || r.highlights?.join(' · ') || '').substring(0, 500),
      publishedDate: r.publishedDate || null,
      author: r.author || null,
      score: r.score || null,
      sentiment: 'neutral',  // enrichissable par analyzeSentiment upstream
      category: 'press',
    }));

    return { mentions, error: null, cost };
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Exa search failed';
    return { mentions: [], error: msg, cost: 0 };
  }
}

/**
 * Fetch le contenu complet d'URLs via Exa `/contents`. Utile pour lire des
 * articles que nos scrapers ne peuvent pas atteindre (bot detection légère).
 * Pas un vrai "bypass paywall" — pour ça, voir camofox-fetch.js.
 *
 * @param {string[]} urls
 * @returns {{ contents: Array, error: string|null, cost: number }}
 */
export async function fetchContentsViaExa(urls) {
  const client = exaClient();
  if (!client) return { contents: [], error: 'EXA_API_KEY not set', cost: 0 };
  if (!urls.length) return { contents: [], error: null, cost: 0 };

  try {
    const resp = await client.post('/contents', {
      urls,
      text: { maxCharacters: 8000, includeHtmlTags: false },
    });
    const contents = (resp.data?.results || []).map(r => ({
      url: r.url,
      title: r.title || '',
      text: r.text || '',
      publishedDate: r.publishedDate || null,
      author: r.author || null,
    }));
    const cost = resp.data?.costDollars?.total || 0;
    return { contents, error: null, cost };
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Exa contents failed';
    return { contents: [], error: msg, cost: 0 };
  }
}
