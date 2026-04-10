import axios from 'axios';

// ── Debug stub (remplacer par logger réel en prod) ──────────────────────────
const debug = (...args) => {
  if (process.env.DEBUG_FETCHER) console.log('[fetcher]', ...args);
};

// ── User-Agent rotation ────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Utilitaires ────────────────────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Domaines protégés (Cloudflare / anti-bot lourd) ────────────────────────
const PROTECTED_DOMAINS = ['pappers.fr', 'societe.com', 'verif.com', 'score3.fr', 'manageo.fr'];

export function isProtectedDomain(url) {
  try {
    const { hostname } = new URL(url);
    return PROTECTED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ── Camofox (anti-bot bypass local) ────────────────────────────────────────
const CAMOFOX_BASE = 'http://localhost:9377';
const CAMOFOX_USER_ID = 'intelwatch';
const CAMOFOX_SESSION_KEY = 'default';
const CAMOFOX_WAIT_MS = 7000;

export async function camofoxFetch(url, options = {}) {
  const { timeout = 30000 } = options;

  // Vérifier disponibilité Camofox
  let healthCheck;
  try {
    healthCheck = await axios.get(`${CAMOFOX_BASE}/health`, { timeout: 2000 });
  } catch {
    debug('camofox indisponible sur', CAMOFOX_BASE);
    throw new Error(`Camofox unavailable at ${CAMOFOX_BASE} — cannot bypass protection for ${url}`);
  }

  let tabId;
  try {
    // POST /tabs — ouvrir onglet navigateur
    const createRes = await axios.post(`${CAMOFOX_BASE}/tabs`, {
      userId: CAMOFOX_USER_ID,
      sessionKey: CAMOFOX_SESSION_KEY,
      url,
    }, { timeout });

    tabId = createRes.data?.tabId || createRes.data?.id;
    if (!tabId) throw new Error('Camofox: no tabId returned from POST /tabs');

    debug('camofox tab created:', tabId, '— waiting', CAMOFOX_WAIT_MS, 'ms');

    // Attente résolution challenge CF
    await sleep(CAMOFOX_WAIT_MS);

    // GET /tabs/{tabId}/snapshot — récupérer HTML rendu
    const snapRes = await axios.get(`${CAMOFOX_BASE}/tabs/${tabId}/snapshot`, {
      params: { userId: CAMOFOX_USER_ID },
      timeout,
    });

    // Wrapper dans un format compatible response Axios
    return {
      status: snapRes.status,
      statusText: snapRes.statusText,
      headers: snapRes.headers,
      data: snapRes.data,
      config: snapRes.config,
      request: snapRes.request,
      _camofox: true,
    };
  } finally {
    // Toujours cleanup, même en cas d'erreur
    if (tabId) {
      try {
        await axios.delete(`${CAMOFOX_BASE}/tabs/${tabId}`, {
          params: { userId: CAMOFOX_USER_ID },
          timeout: 5000,
        });
        debug('camofox tab cleaned up:', tabId);
      } catch (err) {
        debug('camofox cleanup failed for tab', tabId, err.message);
      }
    }
  }
}

// ── Fetch principal (Axios + fallback Camofox) ─────────────────────────────
export async function fetch(url, options = {}) {
  const {
    retries = 3,
    delay = 1500,
    timeout = 15000,
    headers = {},
    forceCamofox = false,
  } = options;

  // Mode force : court-circuiter Axios, aller direct Camofox
  if (forceCamofox) {
    return camofoxFetch(url, options);
  }

  // Domaine protégé connu : tentative Axios puis fallback si 403
  const protected_ = isProtectedDomain(url);

  const config = {
    url,
    method: options.method || 'GET',
    timeout,
    headers: {
      'User-Agent': randomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      ...headers,
    },
    maxRedirects: 5,
    validateStatus: status => status < 500,
  };

  let lastError;
  let needsCamofox = false;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        const backoff = delay * Math.pow(2, attempt - 2);
        await sleep(backoff);
      }

      const response = await axios(config);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '60', 10);
        if (attempt < retries) {
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new Error(`Rate limited (429) after ${retries} attempts`);
      }

      // 403 = signature Cloudflare → fallback Camofox
      if (response.status === 403) {
        debug('403 détecté pour', url, '— fallback camofox');
        needsCamofox = true;
        break;
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(delay);
      }
    }
  }

  // Fallback Camofox si 403 ou domaine protégé (et Axios a échoué)
  if (needsCamofox || (protected_ && lastError)) {
    try {
      return await camofoxFetch(url, options);
    } catch (camofoxErr) {
      // Camofox indisponible → propager l'erreur Axios originale
      debug('camofox fallback échoué:', camofoxErr.message);
      if (lastError) throw lastError;
      throw camofoxErr;
    }
  }

  if (lastError) throw lastError;

  // Ne devrait jamais arriver, mais sécurité
  throw new Error(`fetch failed for ${url}`);
}

// ── Fetch avec jitter ───────────────────────────────────────────────────────
export async function fetchWithDelay(url, options = {}) {
  const minDelay = options.minDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 2000;
  const jitter = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
  await sleep(jitter);
  return fetch(url, options);
}
