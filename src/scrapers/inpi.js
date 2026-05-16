/**
 * INPI — marques déposées par SIREN (data.inpi.fr).
 *
 * Auth : JWT via POST /api/sso/login → access_token (Bearer header).
 * Endpoint : POST /api/marques/_search avec corps JSON (Elasticsearch DSL).
 *
 * Env vars :
 *   INPI_USERNAME       — login data.inpi.fr (email)
 *   INPI_PASSWORD       — mot de passe data.inpi.fr
 *   INPI_BASE_URL       — override (par défaut https://data.inpi.fr)
 *
 * Notes :
 *   - INPI référence les marques depuis 1976 pour les dépôts français.
 *   - La recherche par SIREN ne renvoie QUE les marques où le déposant a
 *     déclaré son SIREN au dépôt — taux de couverture ~80 % sur les PM.
 *   - Token JWT valide 1h, cache mémoire intra-session.
 *
 * Docs : https://data.inpi.fr/content/editorial/apis_entreprises_doc
 */

import axios from 'axios';

const DEFAULT_BASE = 'https://data.inpi.fr';
const INPI_TIMEOUT = 12000;

let _tokenCache = null; // { token, expiresAt }

function getCredentials() {
  const username = process.env.INPI_USERNAME;
  const password = process.env.INPI_PASSWORD;
  if (!username || !password) return null;
  return { username, password };
}

function getBaseUrl() {
  return process.env.INPI_BASE_URL || DEFAULT_BASE;
}

export function hasInpiCredentials() {
  return !!getCredentials();
}

async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 60_000) {
    return _tokenCache.token;
  }
  const creds = getCredentials();
  if (!creds) return null;

  try {
    const resp = await axios.post(
      `${getBaseUrl()}/api/sso/login`,
      { username: creds.username, password: creds.password },
      {
        timeout: INPI_TIMEOUT,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      },
    );
    const token = resp.data?.access_token || resp.data?.token;
    if (!token) return null;
    // Tokens JWT INPI valides ~1h
    _tokenCache = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return token;
  } catch (err) {
    console.error(`[inpi] Login failed: ${err.response?.status || err.message}`);
    return null;
  }
}

function authClient(token) {
  return axios.create({
    baseURL: getBaseUrl(),
    timeout: INPI_TIMEOUT,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
}

/**
 * Recherche les marques déposées par un SIREN.
 *
 * @param {string} siren — SIREN 9 chiffres
 * @param {object} options — { limit=20 }
 * @returns {{ marques: Array, total: number, error: string|null }}
 */
export async function searchMarquesBySiren(siren, options = {}) {
  const creds = getCredentials();
  if (!creds) return { marques: [], total: 0, error: 'INPI_USERNAME/INPI_PASSWORD not set' };

  const token = await getToken();
  if (!token) return { marques: [], total: 0, error: 'INPI auth failed' };

  const limit = Math.min(options.limit || 20, 100);
  // ES DSL — filtre sur SIREN du titulaire actuel
  const body = {
    size: limit,
    sort: [{ 'depot.date.date': { order: 'desc' } }],
    query: {
      bool: {
        filter: [
          { term: { 'titulaireActuel.siren': siren } },
        ],
      },
    },
  };

  try {
    const c = authClient(token);
    const resp = await c.post('/api/marques/_search', body);
    const hits = resp.data?.hits?.hits || [];
    const total = resp.data?.hits?.total?.value ?? resp.data?.hits?.total ?? hits.length;
    const marques = hits.map(h => {
      const s = h._source || h;
      return {
        depotNumber: s.depot?.numNational || s.numeroNational || h._id || null,
        title: s.libellesMarques?.[0]?.libelle
          || s.libelleMarque
          || s.marque?.libelle
          || s.title
          || null,
        depositDate: s.depot?.date?.date || s.depotDate || null,
        publicationDate: s.publication?.date?.date || null,
        status: s.statut || s.status || null,
        classes: (s.classifications?.classes || s.classes || []).map(c => c.numero || c).filter(Boolean),
        owner: s.titulaireActuel?.denomination || s.proprietaire || null,
        ownerSiren: s.titulaireActuel?.siren || siren,
        url: s.depot?.numNational
          ? `https://data.inpi.fr/marques/${s.depot.numNational}`
          : null,
      };
    });
    return { marques, total, error: null };
  } catch (err) {
    const status = err.response?.status;
    const msg = status === 401
      ? 'INPI 401 — token expiré ou identifiants invalides'
      : status === 429
        ? 'INPI rate-limited (429)'
        : (err.response?.data?.message || err.message || 'INPI marques search failed');
    return { marques: [], total: 0, error: msg };
  }
}

/**
 * Récupère les brevets déposés par un SIREN (best-effort — la couverture
 * brevets via SIREN est moins complète que marques).
 */
export async function searchBrevetsBySiren(siren, options = {}) {
  const creds = getCredentials();
  if (!creds) return { brevets: [], total: 0, error: 'INPI credentials not set' };

  const token = await getToken();
  if (!token) return { brevets: [], total: 0, error: 'INPI auth failed' };

  const limit = Math.min(options.limit || 10, 50);
  const body = {
    size: limit,
    sort: [{ 'datesAndStatus.depositDate': { order: 'desc' } }],
    query: {
      bool: {
        filter: [
          { term: { 'parties.applicant.siren': siren } },
        ],
      },
    },
  };

  try {
    const c = authClient(token);
    const resp = await c.post('/api/brevets/_search', body);
    const hits = resp.data?.hits?.hits || [];
    const total = resp.data?.hits?.total?.value ?? resp.data?.hits?.total ?? hits.length;
    const brevets = hits.map(h => {
      const s = h._source || h;
      return {
        publicationNumber: s.publicationNumber || s.numeroPublication || h._id || null,
        title: s.title?.fr || s.title || null,
        depositDate: s.datesAndStatus?.depositDate || s.depotDate || null,
        status: s.datesAndStatus?.statusLabel || s.status || null,
        applicants: (s.parties?.applicants || []).map(a => a.denomination || a.name).filter(Boolean),
        url: s.publicationNumber
          ? `https://data.inpi.fr/brevets/${s.publicationNumber}`
          : null,
      };
    });
    return { brevets, total, error: null };
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'INPI brevets search failed';
    return { brevets: [], total: 0, error: msg };
  }
}
