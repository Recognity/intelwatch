/**
 * JudiLibre — décisions de justice anonymisées (Cour de cassation + appel + TJ).
 *
 * API publique gratuite après inscription sur https://piste.gouv.fr (PISTE).
 * Signal MAJEUR pour DD : litiges majeurs d'une cible ou d'un dirigeant.
 *
 * Auth : header `KeyId: <piste-api-key>` (clé sandbox ou prod).
 * Endpoint :
 *   GET https://api.piste.gouv.fr/cassation/judilibre/v1.0/search
 *       ?query=<NOM>&page_size=10&jurisdiction=cc,ca,tj
 *
 * Réponse :
 *   { total, results: [{ id, jurisdiction, chamber, formation, date_decision,
 *                        publication, solution, summary, zones, themes }] }
 *
 * Env vars :
 *   JUDILIBRE_KEY_ID    — clé API PISTE (header KeyId)
 *   JUDILIBRE_BASE_URL  — override (par défaut api.piste.gouv.fr/cassation/judilibre/v1.0)
 *
 * Docs : https://piste.gouv.fr · https://github.com/Cour-de-cassation/judilibre-search
 */

import axios from 'axios';

const DEFAULT_BASE = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0';
const JUDILIBRE_TIMEOUT = 12000;

function getKeyId() {
  return process.env.JUDILIBRE_KEY_ID || null;
}

function getBaseUrl() {
  return process.env.JUDILIBRE_BASE_URL || DEFAULT_BASE;
}

export function hasJudilibreKey() {
  return !!getKeyId();
}

function client() {
  const key = getKeyId();
  if (!key) return null;
  return axios.create({
    baseURL: getBaseUrl(),
    timeout: JUDILIBRE_TIMEOUT,
    headers: {
      'KeyId': key,
      'Accept': 'application/json',
    },
  });
}

/**
 * Recherche full-text des décisions par nom de société ou dirigeant.
 *
 * Note : JudiLibre est anonymisé côté personnes physiques. Les noms de
 * sociétés (PM) restent généralement présents. Pour les dirigeants
 * personnes physiques, la recherche peut renvoyer 0 résultat même si
 * une décision existe — c'est par design (RGPD / anonymisation
 * pseudonymisée).
 *
 * @param {string} q — raison sociale ou nom dirigeant
 * @param {object} options — { pageSize=10, jurisdictions=null, chambers=null }
 * @returns {{ decisions: Array, total: number, error: string|null }}
 */
export async function searchDecisions(q, options = {}) {
  const c = client();
  if (!c) return { decisions: [], total: 0, error: 'JUDILIBRE_KEY_ID not set' };

  const params = {
    query: q,
    page_size: Math.min(options.pageSize || 10, 50),
    page: options.page || 0,
  };
  if (options.jurisdictions) params.jurisdiction = options.jurisdictions; // 'cc,ca,tj'
  if (options.chambers) params.chamber = options.chambers;
  if (options.dateStart) params.date_start = options.dateStart; // YYYY-MM-DD
  if (options.dateEnd) params.date_end = options.dateEnd;

  try {
    const resp = await c.get('/search', { params });
    const results = resp.data?.results || [];
    const decisions = results.map(r => ({
      id: r.id,
      jurisdiction: r.jurisdiction || null,           // cc, ca, tj
      chamber: r.chamber || null,                     // civ1, soc, com, crim, mixt
      formation: r.formation || null,
      date: r.date_decision || r.decision_date || null,
      publication: r.publication || null,
      solution: r.solution || null,                   // cassation, rejet, etc.
      summary: r.summary || extractSummaryFromZones(r) || null,
      themes: r.themes || [],
      url: r.id ? `https://www.courdecassation.fr/decision/${r.id}` : null,
    }));
    return {
      decisions,
      total: resp.data?.total || decisions.length,
      took: resp.data?.took || null,
      error: null,
    };
  } catch (err) {
    const status = err.response?.status;
    const msg = status === 401
      ? 'JudiLibre 401 — vérifier JUDILIBRE_KEY_ID (sandbox vs prod)'
      : status === 429
        ? 'JudiLibre rate-limited (429)'
        : (err.response?.data?.message || err.message || 'JudiLibre search failed');
    return { decisions: [], total: 0, error: msg };
  }
}

/**
 * Recherche multi-canal pour une cible : raison sociale + dirigeants si fournis.
 * Dédup par id de décision. Tri par date décroissante.
 *
 * @param {string} brandName
 * @param {string[]} dirigeantNames — noms personnes physiques (souvent anonymisés)
 * @returns {{ decisions: Array, total: number, errors: string[] }}
 */
export async function searchForTarget(brandName, dirigeantNames = []) {
  if (!hasJudilibreKey()) {
    return { decisions: [], total: 0, errors: ['JUDILIBRE_KEY_ID not set'] };
  }

  const queries = [brandName, ...dirigeantNames.slice(0, 3)].filter(Boolean);
  const results = await Promise.allSettled(
    queries.map(q => searchDecisions(q, { pageSize: 10 }))
  );

  const seen = new Set();
  const all = [];
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      if (r.value.error) errors.push(`"${queries[i]}": ${r.value.error}`);
      for (const d of r.value.decisions) {
        if (d.id && !seen.has(d.id)) {
          seen.add(d.id);
          all.push({ ...d, matchedQuery: queries[i] });
        }
      }
    } else {
      errors.push(`"${queries[i]}": ${r.reason?.message || 'unknown'}`);
    }
  }
  all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { decisions: all, total: all.length, errors };
}

function extractSummaryFromZones(decision) {
  if (!decision.zones || !decision.text) return null;
  // Fallback : tenter d'extraire le bloc "motivations" ou "moyens"
  const z = decision.zones.motivations || decision.zones.moyens;
  if (z && Array.isArray(z) && z.length === 2 && typeof decision.text === 'string') {
    return decision.text.substring(z[0], Math.min(z[1], z[0] + 400));
  }
  return null;
}
