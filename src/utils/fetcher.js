import axios from 'axios';

// ── Debug ─────────────────────────────────────────────────────────────────────
const debug = (...args) => {
  if (process.env.DEBUG_FETCHER) console.log('[fetcher]', ...args);
};

// ── User-Agent rotation ────────────────────────────────────────────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Utilitaires ────────────────────────────────────────────────────────────
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Domaines protégés (Cloudflare / anti-bot lourd) ────────────────────────
const PROTECTED_DOMAINS = [
  'pappers.fr', 'societe.com', 'verif.com', 'score3.fr', 'manageo.fr',
  'infogreffe.fr', 'ellisphere.com', 'creditsafe.com',
];

export function isProtectedDomain(url) {
  try {
    const { hostname } = new URL(url);
    return PROTECTED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ── Camofox configuration (env-driven) ────────────────────────────────────
const CAMOFOX_BASE = process.env.CAMOFOX_BASE || 'http://localhost:9377';
const CAMOFOX_USER_ID = process.env.CAMOFOX_USER_ID || 'intelwatch';
const CAMOFOX_SESSION_KEY = process.env.CAMOFOX_SESSION_KEY || 'default';
const CAMOFOX_WAIT_MS = parseInt(process.env.CAMOFOX_WAIT_MS || '7000', 10);
const CAMOFOX_MAX_TABS = parseInt(process.env.CAMOFOX_MAX_TABS || '3', 10);

// ── Tab semaphore ─────────────────────────────────────────────────────────
// Limits concurrent Camofox tabs to prevent resource exhaustion.
let activeTabs = 0;
const tabQueue = [];

function acquireTab() {
  if (activeTabs < CAMOFOX_MAX_TABS) {
    activeTabs++;
    return Promise.resolve();
  }
  return new Promise(resolve => tabQueue.push(resolve));
}

function releaseTab() {
  activeTabs--;
  if (tabQueue.length > 0) {
    activeTabs++;
    tabQueue.shift()();
  }
}

// ── Adaptive wait ─────────────────────────────────────────────────────────
// Lighter sites resolve faster; heavy CF challenges need more time.
const DOMAIN_WAIT_OVERRIDES = {
  'societe.com': 10000,
  'verif.com': 10000,
  'pappers.fr': 8000,
  'infogreffe.fr': 10000,
};

function getWaitMs(url) {
  try {
    const { hostname } = new URL(url);
    for (const [domain, ms] of Object.entries(DOMAIN_WAIT_OVERRIDES)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return ms;
    }
  } catch { /* use default */ }
  return CAMOFOX_WAIT_MS;
}

// ── Health check cache ────────────────────────────────────────────────────
// Avoids per-request health checks — cache for 30s.
let healthCheckResult = { ok: false, ts: 0 };
const HEALTH_CHECK_TTL = 30_000;

async function isCamofoxAvailable() {
  if (healthCheckResult.ok && Date.now() - healthCheckResult.ts < HEALTH_CHECK_TTL) {
    return true;
  }
  try {
    await axios.get(`${CAMOFOX_BASE}/health`, { timeout: 3000 });
    healthCheckResult = { ok: true, ts: Date.now() };
    return true;
  } catch {
    healthCheckResult = { ok: false, ts: Date.now() };
    debug('camofox indisponible sur', CAMOFOX_BASE);
    return false;
  }
}

export async function camofoxFetch(url, options = {}) {
  const { timeout = 30000 } = options;

  if (!(await isCamofoxAvailable())) {
    throw new Error(`Camofox unavailable at ${CAMOFOX_BASE} — cannot bypass protection for ${url}`);
  }

  await acquireTab();
  let tabId;
  try {
    const createRes = await axios.post(`${CAMOFOX_BASE}/tabs`, {
      userId: CAMOFOX_USER_ID,
      sessionKey: CAMOFOX_SESSION_KEY,
      url,
    }, { timeout });

    tabId = createRes.data?.tabId || createRes.data?.id;
    if (!tabId) throw new Error('Camofox: no tabId returned from POST /tabs');

    const waitMs = getWaitMs(url);
    debug('camofox tab created:', tabId, '— waiting', waitMs, 'ms for', url);

    await sleep(waitMs);

    const snapRes = await axios.get(`${CAMOFOX_BASE}/tabs/${tabId}/snapshot`, {
      params: { userId: CAMOFOX_USER_ID },
      timeout,
    });

    // Validate snapshot response
    if (snapRes.status >= 400) {
      throw new Error(`Camofox snapshot returned ${snapRes.status} for ${url}`);
    }
    const html = typeof snapRes.data === 'string' ? snapRes.data : '';
    if (html.length < 100) {
      console.error(`[camofox] Suspiciously short snapshot (${html.length} chars) for ${url}`);
    }

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
    if (tabId) {
      try {
        await axios.delete(`${CAMOFOX_BASE}/tabs/${tabId}`, {
          params: { userId: CAMOFOX_USER_ID },
          timeout: 5000,
        });
        debug('camofox tab cleaned up:', tabId);
      } catch (err) {
        console.error(`[camofox] Tab cleanup failed for ${tabId}: ${err.message}`);
      }
    }
    releaseTab();
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

  if (forceCamofox) {
    return camofoxFetch(url, options);
  }

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
        debug(`429 rate limited for ${url}, retry-after=${retryAfter}s`);
        if (attempt < retries) {
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new Error(`Rate limited (429) after ${retries} attempts`);
      }

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
      debug(`Camofox fallback for ${url} (needsCamofox=${needsCamofox}, protected=${protected_})`);
      return await camofoxFetch(url, options);
    } catch (camofoxErr) {
      console.error(`[fetcher] Camofox fallback failed for ${url}: ${camofoxErr.message}`);
      if (lastError) throw lastError;
      throw camofoxErr;
    }
  }

  if (lastError) throw lastError;
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
