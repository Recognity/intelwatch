/**
 * Camofox fetch client — bypass des protections bot/paywall sur la presse FR.
 *
 * Camofox expose un Firefox headless camouflé via API HTTP sur localhost:9377
 * (ou URL custom via CAMOFOX_URL). Utilisé pour récupérer les articles des
 * grands quotidiens français qui bloquent les fetchers standards :
 *   - lesechos.fr, lefigaro.fr, lemonde.fr, challenges.fr, latribune.fr,
 *     leparisien.fr, capital.fr, bfmtv.com, chefdentreprise.com
 *
 * Workflow :
 *   1. POST /tabs                   → création tab
 *   2. POST /tabs/:id/navigate      → navigation
 *   3. POST /tabs/:id/wait          → attente body chargé
 *   4. GET  /tabs/:id/snapshot      → HTML + texte rendu
 *   5. DELETE /tabs/:id             → cleanup (best effort)
 *
 * Env : CAMOFOX_URL (défaut http://localhost:9377)
 */

import axios from 'axios';

const DEFAULT_URL = 'http://localhost:9377';
const CAMOFOX_TIMEOUT = 45000; // navigation peut être lente sur les sites bots
const WAIT_TIMEOUT = 20000;

// Domains où le fallback Camofox vaut la peine — ailleurs, fetch standard.
export const PAYWALL_DOMAINS = new Set([
  'lesechos.fr',
  'lefigaro.fr',
  'lemonde.fr',
  'challenges.fr',
  'latribune.fr',
  'leparisien.fr',
  'capital.fr',
  'chefdentreprise.com',
  'usinenouvelle.com',
  'lopinion.fr',
  'liberation.fr',
  'lepoint.fr',
  'bfmtv.com',
  'franceinfo.fr',
  'sudouest.fr',
]);

export function getCamofoxUrl() {
  return process.env.CAMOFOX_URL || DEFAULT_URL;
}

/**
 * Vérifie que Camofox est joignable et prêt. Retourne { available, detail }.
 */
export async function checkCamofox() {
  try {
    const resp = await axios.get(`${getCamofoxUrl()}/health`, { timeout: 3000 });
    const ok = resp.data?.ok && resp.data?.browserConnected;
    return { available: !!ok, detail: resp.data };
  } catch (err) {
    return { available: false, detail: err.message };
  }
}

/**
 * True si l'URL appartient à un domaine où Camofox vaut le coup.
 */
export function isPaywallUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return PAYWALL_DOMAINS.has(host);
  } catch {
    return false;
  }
}

/**
 * Fetch une URL via Camofox. Retourne { url, title, text, html, error }.
 * Retourne null si Camofox indisponible (le caller doit fallback sur fetch standard).
 */
export async function fetchViaCamofox(url, options = {}) {
  const base = getCamofoxUrl();
  let tabId = null;

  try {
    // 1. Créer un tab isolé (session éphémère)
    const tabResp = await axios.post(
      `${base}/tabs`,
      { sessionId: `intelwatch-${Date.now()}` },
      { timeout: 10000 },
    );
    tabId = tabResp.data?.tabId || tabResp.data?.id;
    if (!tabId) {
      return { url, title: '', text: '', html: '', error: 'no tabId returned' };
    }

    // 2. Navigate
    await axios.post(
      `${base}/tabs/${tabId}/navigate`,
      { url, waitUntil: 'domcontentloaded' },
      { timeout: CAMOFOX_TIMEOUT },
    );

    // 3. Wait for body — best effort
    try {
      await axios.post(
        `${base}/tabs/${tabId}/wait`,
        { selector: 'body', timeout: WAIT_TIMEOUT },
        { timeout: WAIT_TIMEOUT + 2000 },
      );
    } catch {
      // pas critique, on tente quand même le snapshot
    }

    // 4. Snapshot — renvoie { html, text, title, url }
    const snapResp = await axios.get(
      `${base}/tabs/${tabId}/snapshot`,
      { timeout: 10000, params: { format: 'text+html' } },
    );
    const snap = snapResp.data || {};

    return {
      url: snap.url || url,
      title: snap.title || '',
      text: (snap.text || '').trim(),
      html: snap.html || '',
      error: null,
    };
  } catch (err) {
    return {
      url,
      title: '',
      text: '',
      html: '',
      error: err.response?.data?.error || err.message || 'camofox fetch failed',
    };
  } finally {
    if (tabId) {
      axios.delete(`${base}/tabs/${tabId}`, { timeout: 3000 }).catch(() => {});
    }
  }
}

/**
 * Batch fetch : limite concurrency pour ne pas saturer le browser headless.
 * @param {string[]} urls
 * @param {object} options { concurrency=2 }
 */
export async function fetchViaCamofoxBatch(urls, options = {}) {
  const concurrency = options.concurrency || 2;
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(u => fetchViaCamofox(u, options)));
    results.push(...batchResults);
  }
  return results;
}
