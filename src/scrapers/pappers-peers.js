/**
 * Pappers Peers scraper (MH5) — peer search by NAF for median multiples.
 *
 * Circuit breaker doctrine (cf. ~/.claude/CLAUDE.md §I/O & Concurrence) :
 *   - Pool de concurrence 4 max (Promise.all chunked)
 *   - Cache disque ~/.intelwatch/cache/pappers-peers/{naf}.json TTL 7j
 *   - Purge entrées poisonnées `{_empty:true}` au load
 *   - Fail-soft sur 429/401/timeout — log + return cache stale OR []
 *   - Aucun retry storm
 *   - api.pappers.fr uniquement (no SSRF)
 */

import axios from 'axios';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PAPPERS_API = 'https://api.pappers.fr/v1';
const ALLOWED_HOST = 'api.pappers.fr';
const CACHE_DIR = join(homedir(), '.intelwatch', 'cache', 'pappers-peers');
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const POOL_SIZE = 4;
const PER_PAGE = 25;

function getApiKey() {
  return process.env.PAPPERS_API_KEY || null;
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(naf) {
  const safe = String(naf).replace(/[^A-Za-z0-9._-]/g, '_');
  return join(CACHE_DIR, `${safe}.json`);
}

/**
 * Load cache for a NAF. Auto-purge `{_empty:true}` poison (cf. memory
 * feedback_pappers_cache_poison.md — recurrent issue 10/05 + 12/05).
 * Returns { data, stale, fromCache } or null.
 */
function loadCache(naf) {
  try {
    const file = cachePath(naf);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw && raw._empty === true) {
      // Poison entry — drop it
      try { writeFileSync(file, JSON.stringify({ _purged: true, _purgedAt: Date.now() })); } catch { /* ignore */ }
      return null;
    }
    if (!raw || !Array.isArray(raw.peers)) return null;
    const age = Date.now() - (raw._cachedAt || 0);
    const stale = age > CACHE_TTL_MS;
    return { data: raw.peers, stale, fromCache: true };
  } catch (err) {
    console.error('pappers-peers cache load error', { naf, err: err.message });
    return null;
  }
}

function saveCache(naf, peers) {
  try {
    ensureCacheDir();
    writeFileSync(cachePath(naf), JSON.stringify({ peers, _cachedAt: Date.now() }));
  } catch (err) {
    console.error('pappers-peers cache write error', { naf, err: err.message });
  }
}

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === ALLOWED_HOST;
  } catch {
    return false;
  }
}

/**
 * Chunk an array into groups of `size`.
 */
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch latest financials for a single SIREN. Returns null on failure.
 * Caller is responsible for concurrency control.
 */
async function fetchPeerDetail(apiKey, siren) {
  const url = `${PAPPERS_API}/entreprise`;
  if (!isAllowedUrl(url)) {
    console.error('pappers-peers SSRF guard blocked URL', { url });
    return null;
  }
  try {
    const resp = await axios.get(url, {
      params: { api_token: apiKey, siren },
      timeout: 10000,
    });
    const d = resp.data || {};
    const fins = d.finances || [];
    const last = fins[0] || {};
    const prev = fins[1] || {};
    const ca = last.chiffre_affaires ?? null;
    const prevCa = prev.chiffre_affaires ?? null;
    const croissance = (ca != null && prevCa != null && prevCa > 0)
      ? ((ca - prevCa) / prevCa) * 100
      : null;
    return {
      siren: d.siren || siren,
      name: d.nom_entreprise || d.denomination || null,
      ca,
      ebitda: last.excedent_brut_exploitation ?? null,
      margeEbitda: last.taux_marge_EBITDA ?? null,
      roe: last.rentabilite_fonds_propres ?? null,
      croissance,
    };
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 401) {
      console.error('Pappers peers rate-limited or unauth on detail fetch', { siren, status });
      // Propagate via thrown sentinel so caller can short-circuit
      const e = new Error('pappers_breaker_trip');
      e.status = status;
      throw e;
    }
    console.error('pappers-peers detail fetch failed', { siren, status: status || 'unknown', err: err.message });
    return null;
  }
}

/**
 * Search peers by NAF code.
 *
 * @param {string} naf       — NAF code (e.g. "2932Z")
 * @param {string} sirenSelf — SIREN to exclude from results
 * @param {Object} [opts]
 * @param {number} [opts.limit=10] — Top N by CA desc
 * @returns {Promise<Array<{siren,name,ca,ebitda,margeEbitda,roe,croissance}>>}
 */
export async function pappersSearchPeers(naf, sirenSelf, opts = {}) {
  const limit = opts.limit || 10;
  if (!naf) {
    console.error('pappers-peers called without NAF code');
    return [];
  }

  // 1. Cache fresh ? Use it.
  const cached = loadCache(naf);
  if (cached && !cached.stale) {
    return cached.data.filter(p => p.siren !== sirenSelf).slice(0, limit);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('pappers-peers no PAPPERS_API_KEY — returning cache stale or []', { naf });
    if (cached) return cached.data.filter(p => p.siren !== sirenSelf).slice(0, limit);
    return [];
  }

  // 2. Search by NAF
  const searchUrl = `${PAPPERS_API}/recherche`;
  if (!isAllowedUrl(searchUrl)) {
    console.error('pappers-peers SSRF guard blocked search URL', { url: searchUrl });
    return [];
  }

  let candidates = [];
  try {
    const resp = await axios.get(searchUrl, {
      params: {
        api_token: apiKey,
        code_naf: naf,
        par_page: PER_PAGE,
        precision: 'standard',
      },
      timeout: 15000,
    });
    const results = resp.data.resultats || resp.data.entreprises || [];
    candidates = results
      .filter(r => r.siren && r.siren !== sirenSelf)
      .map(r => ({
        siren: r.siren,
        name: r.nom_entreprise || r.denomination || null,
      }));
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 401) {
      console.error('Pappers peers rate-limited or unauth, fallback empty', { naf, status });
      if (cached) return cached.data.filter(p => p.siren !== sirenSelf).slice(0, limit);
      return [];
    }
    console.error('pappers-peers search failed, fallback empty', { naf, status: status || 'unknown', err: err.message });
    if (cached) return cached.data.filter(p => p.siren !== sirenSelf).slice(0, limit);
    return [];
  }

  if (candidates.length === 0) {
    saveCache(naf, []);
    return [];
  }

  // 3. Fetch detail per peer — chunked pool of POOL_SIZE (max 4 concurrent)
  const enriched = [];
  let breakerTripped = false;

  for (const batch of chunk(candidates, POOL_SIZE)) {
    if (breakerTripped) break;
    const settled = await Promise.allSettled(
      batch.map(c => fetchPeerDetail(apiKey, c.siren))
    );
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled' && s.value) {
        // Preserve name from search if detail returned null name
        if (!s.value.name) s.value.name = batch[i].name;
        enriched.push(s.value);
      } else if (s.status === 'rejected' && s.reason?.message === 'pappers_breaker_trip') {
        breakerTripped = true;
        console.error('Pappers peers breaker tripped, stopping further fetches', { naf, status: s.reason.status });
        break;
      }
    }
  }

  if (breakerTripped && enriched.length === 0) {
    if (cached) return cached.data.filter(p => p.siren !== sirenSelf).slice(0, limit);
    return [];
  }

  // 4. Sort by CA desc, take top N
  const ranked = enriched
    .filter(p => p.siren !== sirenSelf)
    .sort((a, b) => (b.ca || 0) - (a.ca || 0));

  // Cache the full enriched set (not just top N — narrow on read)
  if (!breakerTripped) saveCache(naf, ranked);

  return ranked.slice(0, limit);
}
