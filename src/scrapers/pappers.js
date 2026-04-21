/**
 * Pappers Scraper — MCP-backed.
 *
 * All API calls go through the Pappers MCP server.
 * No direct HTTP requests, no hardcoded API keys or URLs.
 *
 * MCP tools expected on the Pappers server:
 *   - pappers_search          { q, per_page }         → { resultats|entreprises }
 *   - pappers_get_entreprise  { siren }               → full company object
 *   - pappers_recherche_dirigeants { q, per_page }    → { resultats }
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { callMcpTool } from '../mcp/client.js';
import { isMcpConfigured } from '../mcp/config.js';

const MCP_SERVER = 'pappers';

/**
 * Check if the Pappers MCP server is configured.
 * Legacy compat: providers call this to check availability.
 * Now backed by MCP config instead of PAPPERS_API_KEY env var.
 */
export function hasPappersKey() {
  return isMcpConfigured(MCP_SERVER);
}

// ── Circuit Breaker ─────────────────────────────────────────────────────────
// Stops hammering the MCP server after repeated failures.
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  open: false,
  THRESHOLD: 3,
  COOLDOWN: 60_000,

  record() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.THRESHOLD) {
      this.open = true;
      console.error(`[pappers] Circuit breaker OPEN after ${this.failures} failures. Cooldown ${this.COOLDOWN / 1000}s.`);
    }
  },

  recordSuccess() {
    if (this.failures > 0) {
      this.failures = 0;
      this.open = false;
    }
  },

  canRequest() {
    if (!this.open) return true;
    if (Date.now() - this.lastFailure > this.COOLDOWN) {
      this.open = false;
      this.failures = Math.max(0, this.failures - 1);
      return true;
    }
    return false;
  },
};

/**
 * Wrapped MCP tool call with circuit breaker.
 */
async function pappersCall(toolName, args, label) {
  if (!circuitBreaker.canRequest()) {
    return { data: null, error: 'Pappers circuit breaker open — MCP server temporarily unavailable', cbBlocked: true };
  }

  try {
    const data = await callMcpTool(MCP_SERVER, toolName, args);
    circuitBreaker.recordSuccess();
    return { data, error: null };
  } catch (err) {
    circuitBreaker.record();
    const msg = err.message || 'MCP call failed';
    console.error(`[pappers] ${label || toolName} failed: ${msg}`);
    return { data: null, error: msg };
  }
}

// ── BODACC distress classification ──────────────────────────────────────────

const BODACC_DISTRESS_PATTERNS = {
  redressement_judiciaire: /redressement\s*judiciaire|plan\s*de\s*redressement/i,
  liquidation_judiciaire: /liquidation\s*judiciaire/i,
  sauvegarde: /proc[eé]dure\s*de\s*sauvegarde|sauvegarde\s*acc[eé]l[eé]r[eé]e/i,
  plan_cession: /plan\s*de\s*cession|cession\s*(?:totale|partielle)/i,
  cessation_paiements: /cessation\s*(?:de[s]?\s*)?paiement/i,
  dissolution: /dissolution/i,
  radiation: /radiation/i,
  jugement_ouverture: /jugement\s*d.ouverture/i,
  jugement_cloture: /jugement\s*de?\s*cl[oô]ture/i,
  conversion: /conversion\s*(?:en|de)\s*(?:liquidation|redressement)/i,
};

const BODACC_TYPE_CATEGORIES = {
  comptes: /d[eé]p[oô]t\s*(?:des?\s*)?comptes|comptes\s*annuels/i,
  creation: /cr[eé]ation|immatriculation/i,
  modification: /modification|transfert|changement/i,
  vente: /vente|cession\s*de\s*fonds/i,
  fusion: /fusion|apport\s*partiel|scission/i,
  capital: /augmentation\s*(?:de\s*)?capital|r[eé]duction\s*(?:de\s*)?capital/i,
};

function classifyBodacc(pub) {
  const text = [pub.type, pub.description, pub.administration, pub.acte?.descriptif]
    .filter(Boolean).join(' ');

  let distressType = null;
  let severity = 'info';

  for (const [type, pattern] of Object.entries(BODACC_DISTRESS_PATTERNS)) {
    if (pattern.test(text)) {
      distressType = type;
      break;
    }
  }

  if (distressType) {
    const SEVERITY_MAP = {
      liquidation_judiciaire: 'critical',
      cessation_paiements: 'critical',
      conversion: 'high',
      redressement_judiciaire: 'high',
      plan_cession: 'high',
      sauvegarde: 'medium',
      jugement_ouverture: 'medium',
      dissolution: 'medium',
      radiation: 'medium',
      jugement_cloture: 'low',
    };
    severity = SEVERITY_MAP[distressType] || 'medium';
  }

  let category = 'other';
  for (const [cat, pattern] of Object.entries(BODACC_TYPE_CATEGORIES)) {
    if (pattern.test(text)) {
      category = cat;
      break;
    }
  }

  return {
    distressType,
    category: distressType ? 'procedure' : category,
    severity,
    isDistress: !!distressType,
  };
}

/**
 * Search companies by name via MCP.
 */
export async function pappersSearchByName(name, options = {}) {
  if (!isMcpConfigured(MCP_SERVER)) return { results: [], error: 'Pappers MCP server not configured' };

  const { data, error } = await pappersCall('pappers_search', {
    q: name,
    per_page: options.count || 5,
  }, `search(${name})`);

  if (error) return { results: [], error };
  return { results: data?.resultats || data?.entreprises || [], error: null };
}

/**
 * Get company details by SIREN via MCP.
 */
export async function pappersGetBySiren(siren) {
  if (!isMcpConfigured(MCP_SERVER)) return { data: null, error: 'Pappers MCP server not configured' };

  const { data, error } = await pappersCall('pappers_get_entreprise', { siren }, `get(${siren})`);

  if (error) return { data: null, error };
  return { data, error: null };
}

/**
 * Main lookup: search by name, then fetch detail by SIREN.
 */
export async function pappersLookup(companyName) {
  if (!isMcpConfigured(MCP_SERVER)) return null;

  const search = await pappersSearchByName(companyName);
  if (search.error || search.results.length === 0) return null;

  const top = search.results[0];
  const siren = top.siren;

  if (!siren) return formatPappersResult(top);

  const detail = await pappersGetBySiren(siren);
  if (detail.error || !detail.data) return formatPappersResult(top);

  return formatPappersDetail(detail.data);
}

/**
 * Get full M&A dossier for a company by SIREN.
 */
export async function pappersGetFullDossier(siren) {
  const cached = getCached(siren);
  if (cached) return { data: cached, error: null, fromCache: true };

  if (!isMcpConfigured(MCP_SERVER)) return { data: null, error: 'Pappers MCP server not configured' };

  const { data: d, error } = await pappersCall('pappers_get_entreprise', { siren }, `dossier(${siren})`);

  if (error || !d) return { data: null, error: error || 'Empty response' };

  // Financial history — last 5 years
  const financialHistory = (d.finances || []).slice(0, 5).map(f => ({
    annee: f.annee,
    ca: f.chiffre_affaires ?? null,
    resultat: f.resultat ?? null,
    capitauxPropres: f.capitaux_propres ?? null,
    effectif: f.effectif ?? null,
    ebitda: f.excedent_brut_exploitation ?? null,
    margeEbitda: f.taux_marge_EBITDA ?? null,
    dettesFinancieres: f.dettes_financieres ?? null,
    tresorerie: f.tresorerie ?? null,
    fondsPropres: f.fonds_propres ?? null,
    bfr: f.BFR ?? null,
    ratioEndettement: f.ratio_endettement ?? null,
    autonomieFinanciere: f.autonomie_financiere ?? null,
    rentabiliteFP: f.rentabilite_fonds_propres ?? null,
    margeNette: f.marge_nette ?? null,
    capaciteAutofinancement: f.capacite_autofinancement ?? null,
  }));

  // UBO — bénéficiaires effectifs
  const ubo = (d.beneficiaires_effectifs || []).map(b => ({
    nom: b.nom,
    prenom: b.prenom,
    dateNaissance: b.date_de_naissance_formate || b.date_naissance || null,
    nationalite: b.nationalite || null,
    pourcentageParts: b.pourcentage_parts ?? null,
    pourcentageVotes: b.pourcentage_votes ?? null,
  }));

  // BODACC publications — last 50 with M&A distress classification
  const bodacc = (d.publications_bodacc || []).slice(0, 50).map(p => {
    const parts = [];
    if (p.description && p.description !== p.type) parts.push(p.description);
    if (p.administration) parts.push(p.administration);
    if (p.capital) parts.push(`Capital: ${(p.capital / 1e3).toFixed(0)}K€`);
    if (p.date_cloture) parts.push(`Clôture: ${p.date_cloture}`);
    if (p.type_depot) parts.push(p.type_depot);
    if (p.activite) parts.push(p.activite);
    const actes = (p.acte?.actes_publies || []).map(a => a.type_acte).filter(Boolean);
    if (actes.length) parts.push(actes.join(', '));

    const bodaccLetter = p.bodacc || (p.type?.toLowerCase().includes('comptes') ? 'C' : 'B');
    const bodaccUrl = p.numero_parution && p.numero_annonce
      ? `https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:${bodaccLetter}${p.numero_parution}${p.numero_annonce}`
      : null;

    const classification = classifyBodacc(p);

    return {
      date: p.date,
      type: p.type,
      tribunal: p.greffe || p.tribunal || null,
      numero: p.numero_annonce || null,
      description: parts.length ? parts.join('. ') : p.type || null,
      details: p.acte?.descriptif || null,
      url: bodaccUrl,
      capital: p.capital || null,
      rcs: p.rcs || null,
      distressType: classification.distressType,
      category: classification.category,
      severity: classification.severity,
      isDistress: classification.isDistress,
      administration: p.administration || null,
      actesTypes: actes.length ? actes : null,
    };
  });

  // Dirigeants with their mandats in other companies
  const dirigeants = (d.dirigeants || []).map(dir => ({
    nom: dir.nom,
    prenom: dir.prenom,
    role: dir.fonction,
    dateNomination: dir.date_prise_de_poste || null,
    dateNaissance: dir.date_de_naissance_formate || null,
    nationalite: dir.nationalite || null,
    mandats: (dir.entreprises_dirigees || []).map(e => ({
      siren: e.siren,
      denomination: e.denomination || e.nom_entreprise || null,
      role: e.fonction || null,
      etat: e.etat || null,
    })),
  }));

  // Procédures collectives
  const proceduresCollectives = (d.procedures_collectives || []).map(p => {
    const typeNorm = (p.type || '').toLowerCase();
    let procedureCategory = 'other';
    let severity = 'medium';

    if (/liquidation/.test(typeNorm)) {
      procedureCategory = 'liquidation';
      severity = 'critical';
    } else if (/redressement/.test(typeNorm)) {
      procedureCategory = 'redressement';
      severity = 'high';
    } else if (/sauvegarde/.test(typeNorm)) {
      procedureCategory = 'sauvegarde';
      severity = 'medium';
    } else if (/plan\s*de\s*cession/.test(typeNorm)) {
      procedureCategory = 'cession';
      severity = 'high';
    }

    return {
      date: p.date_effet || p.date || null,
      type: p.type || null,
      jugement: p.nature_jugement || null,
      tribunal: p.tribunal || null,
      procedureCategory,
      severity,
      dateDebut: p.date_debut || null,
      dateFin: p.date_fin || null,
      administrateur: p.administrateur || null,
      mandataire: p.mandataire_judiciaire || null,
    };
  });

  // Company identity
  const identity = {
    siren: d.siren,
    siret: d.siege?.siret || null,
    name: d.nom_entreprise || d.denomination || null,
    dateCreation: d.date_creation || null,
    nafCode: d.code_naf || null,
    nafLabel: d.libelle_code_naf || null,
    formeJuridique: d.forme_juridique || null,
    effectifs: d.tranche_effectif || d.effectif || null,
    adresse: d.siege?.adresse_ligne_1 || d.siege?.adresse || null,
    ville: d.siege?.ville || null,
    codePostal: d.siege?.code_postal || null,
    capital: d.capital ?? null,
    capitalMonnaie: d.devise_capital || 'EUR',
    website: d.site_internet || d.domaine_de_messagerie || null,
    status: d.etat === 'actif' ? 'Actif' : (d.etat || 'Inconnu'),
    dateRadiation: d.date_radiation || null,
    objetSocial: d.objet_social || null,
    tvaIntra: d.numero_tva_intracommunautaire || null,
    rcs: d.numero_rcs || null,
    greffe: d.greffe || null,
    conventionCollective: d.conventions_collectives?.[0]?.nom || null,
    effectifTexte: d.effectif || null,
  };

  // Consolidated financials (group level)
  const consolidatedFinances = (d.finances_consolidees || []).slice(0, 5).map(f => ({
    annee: f.annee,
    ca: f.chiffre_affaires ?? null,
    resultat: f.resultat ?? null,
    capitauxPropres: f.capitaux_propres ?? null,
    effectif: f.effectif ?? null,
    ebitda: f.excedent_brut_exploitation ?? null,
    margeEbitda: f.taux_marge_EBITDA ?? null,
    dettesFinancieres: f.dettes_financieres ?? null,
    tresorerie: f.tresorerie ?? null,
    fondsPropres: f.fonds_propres ?? null,
    bfr: f.BFR ?? null,
    ratioEndettement: f.ratio_endettement ?? null,
    autonomieFinanciere: f.autonomie_financiere ?? null,
    rentabiliteFP: f.rentabilite_fonds_propres ?? null,
    margeNette: f.marge_nette ?? null,
    capaciteAutofinancement: f.capacite_autofinancement ?? null,
  }));

  // Representants
  const representants = (d.representants || []).map(r => ({
    nom: r.nom_complet || r.denomination || [r.prenom, r.nom].filter(Boolean).join(' ') || '?',
    qualite: r.qualite || '',
    siren: r.siren || null,
    personneMorale: !!r.personne_morale,
  }));

  // Etablissements
  const etablissements = (d.etablissements || []).map(e => ({
    siret: e.siret,
    type: e.type_etablissement,
    adresse: [e.adresse_ligne_1, e.code_postal, e.ville].filter(Boolean).join(' '),
    actif: !e.etablissement_cesse,
  }));

  const result = { identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives };
  setCache(siren, result);
  return { data: result, error: null };
}

function formatPappersResult(r) {
  return {
    siren: r.siren,
    siret: r.siret,
    name: r.nom_entreprise || r.denomination,
    dateCreation: r.date_creation,
    nafCode: r.code_naf,
    nafLabel: r.libelle_code_naf,
    city: r.siege?.ville,
    postalCode: r.siege?.code_postal,
    effectifs: null,
    ca: null,
    caYear: null,
    resultat: null,
    dirigeants: [],
    formeJuridique: r.forme_juridique || null,
  };
}

function formatPappersDetail(d) {
  const dirigeants = (d.dirigeants || []).slice(0, 5).map(p => ({
    nom: p.nom,
    prenom: p.prenom,
    role: p.fonction,
    dateNomination: p.date_prise_de_poste,
  }));

  const lastFin = (d.finances || [])[0] || {};

  return {
    siren: d.siren,
    siret: d.siege?.siret,
    name: d.nom_entreprise || d.denomination,
    dateCreation: d.date_creation,
    nafCode: d.code_naf,
    nafLabel: d.libelle_code_naf,
    city: d.siege?.ville,
    postalCode: d.siege?.code_postal,
    effectifs: d.tranche_effectif || d.effectif || null,
    ca: lastFin.chiffre_affaires || null,
    caYear: lastFin.annee || null,
    resultat: lastFin.resultat || null,
    dirigeants,
    formeJuridique: d.forme_juridique || null,
  };
}

/**
 * Search for subsidiaries/related entities via MCP.
 */
export async function pappersSearchSubsidiaries(parentName, parentSiren) {
  if (!isMcpConfigured(MCP_SERVER)) return { subsidiaries: [], error: 'Pappers MCP server not configured' };

  // Check cache
  const subsCacheKey = `subs_${parentSiren}`;
  const cachedSubs = getCached(subsCacheKey);
  if (cachedSubs?.subsidiaries) {
    return { subsidiaries: cachedSubs.subsidiaries, total: cachedSubs.total || cachedSubs.subsidiaries.length, error: null, fromCache: true };
  }

  const searchName = parentName.replace(/\s*(GRP|SAS|SARL|SA|SCI|EURL|GROUP|GROUPE|HOLDING|SNC|SASU)\s*/gi, ' ').trim();
  const nameNorm = searchName.toLowerCase();

  // ── Strategy 1: recherche-dirigeants via MCP ──
  try {
    const { data, error } = await pappersCall('pappers_recherche_dirigeants', {
      q: searchName,
      per_page: 20,
    }, `recherche-dirigeants(${searchName})`);

    if (error) {
      console.error(`[pappers] recherche-dirigeants failed: ${error} — falling back to name-search`);
    } else {
      const resultats = data?.resultats || [];
      const subsidiaryMap = new Map();

      for (const r of resultats) {
        const dirigeantSiren = r.siren || '';
        const dirigeantName = (r.nom_entreprise || r.denomination || r.nom_complet || '').toLowerCase().trim();
        const isParent = (dirigeantSiren === parentSiren) || (dirigeantName === nameNorm) || (dirigeantName === searchName.toLowerCase());
        if (!isParent) continue;

        for (const e of (r.entreprises || [])) {
          if (e.siren && e.siren !== parentSiren && !subsidiaryMap.has(e.siren)) {
            subsidiaryMap.set(e.siren, e);
          }
        }
      }

      if (subsidiaryMap.size > 0) {
        const entities = Array.from(subsidiaryMap.values()).slice(0, 30);
        const subsidiaries = await fetchSubsidiaryDetails(entities);
        setCache(subsCacheKey, { subsidiaries, total: subsidiaryMap.size });
        return { subsidiaries, total: subsidiaryMap.size, error: null };
      }
    }
  } catch (err) {
    console.error(`[pappers] recherche-dirigeants unexpected error: ${err.message} — falling back to name-search`);
  }

  // ── Strategy 2: name-search fallback via MCP ──
  const { data, error } = await pappersCall('pappers_search', {
    q: searchName,
    per_page: 20,
  }, `search-subs(${searchName})`);

  if (error) return { subsidiaries: [], error };

  const entities = (data?.entreprises || data?.resultats || [])
    .filter(e => e.siren !== parentSiren);

  const subsidiaries = await fetchSubsidiaryDetails(entities);
  setCache(subsCacheKey, { subsidiaries, total: subsidiaries.length });
  return { subsidiaries, error: null };
}

/**
 * Batch fetch subsidiary details via MCP — parallel with concurrency limit.
 */
async function fetchSubsidiaryDetails(entities) {
  // Step 1: Batch read all cache entries upfront
  const cacheEntries = new Map();
  for (const e of entities) {
    cacheEntries.set(e.siren, getCached(e.siren));
  }

  // Step 2: Separate cached vs uncached entities
  const cached = [];
  const uncached = [];
  for (const e of entities) {
    const entry = cacheEntries.get(e.siren);
    if (entry?.identity) {
      cached.push({ entity: e, data: reconstructFromCache(entry, e) });
    } else {
      uncached.push(e);
    }
  }

  // Step 3: Parallel MCP calls for uncached entities (concurrency limit of 5)
  const CONCURRENCY = 5;
  const fetched = [];
  for (let i = 0; i < uncached.length; i += CONCURRENCY) {
    if (!circuitBreaker.canRequest()) {
      console.error('[pappers] Circuit breaker open — skipping remaining subsidiary fetches');
      for (let j = i; j < uncached.length; j++) {
        fetched.push({ entity: uncached[j], apiData: null });
      }
      break;
    }

    const batch = uncached.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (e) => {
        const data = await callMcpTool(MCP_SERVER, 'pappers_get_entreprise', { siren: e.siren });
        circuitBreaker.recordSuccess();
        return { entity: e, apiData: data };
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        fetched.push(result.value);
      } else {
        circuitBreaker.record();
        const idx = results.indexOf(result);
        fetched.push({ entity: batch[idx], apiData: null });
      }
    }
  }

  // Step 4: Batch cache write
  for (const { entity, apiData } of fetched) {
    if (!apiData) continue;
    setCache(entity.siren, {
      identity: { name: apiData.nom_entreprise, nafCode: apiData.code_naf, nafLabel: apiData.libelle_code_naf, ville: apiData.siege?.ville, effectifTexte: apiData.effectif, dateCreation: apiData.date_creation },
      financialHistory: (apiData.finances || []).map(f => ({ ca: f.chiffre_affaires, resultat: f.resultat, annee: f.annee })),
      _subCache: true,
    });
  }

  // Step 5: Build subsidiary list
  const subsidiaries = [];
  for (const { entity, data } of cached) {
    subsidiaries.push(buildSubsidiaryEntry(entity, data));
  }
  for (const { entity, apiData } of fetched) {
    if (apiData) {
      subsidiaries.push(buildSubsidiaryEntry(entity, apiData));
    } else {
      subsidiaries.push({
        siren: entity.siren,
        name: entity.nom_entreprise || entity.denomination || '?',
        ville: entity.siege?.ville || '',
        ca: null, resultat: null, effectif: '', annee: null, status: '?',
      });
    }
  }

  subsidiaries.sort((a, b) => (b.ca || 0) - (a.ca || 0));
  return subsidiaries;
}

function reconstructFromCache(cached, entity) {
  return {
    nom_entreprise: cached.identity.name,
    code_naf: cached.identity.nafCode,
    libelle_code_naf: cached.identity.nafLabel,
    siege: { ville: cached.identity.ville },
    effectif: cached.identity.effectifTexte,
    entreprise_cessee: false,
    date_creation: cached.identity.dateCreation,
    finances: cached.financialHistory?.map(f => ({ chiffre_affaires: f.ca, resultat: f.resultat, annee: f.annee })) || [],
  };
}

function buildSubsidiaryEntry(entity, d) {
  const fin = (d.finances || [])[0] || {};
  return {
    siren: entity.siren,
    name: d.nom_entreprise || d.denomination || entity.nom_entreprise || '?',
    naf: d.code_naf || '',
    nafLabel: d.libelle_code_naf || '',
    ville: d.siege?.ville || '',
    effectif: d.effectif || '',
    ca: fin.chiffre_affaires ?? null,
    resultat: fin.resultat ?? null,
    annee: fin.annee || null,
    status: d.entreprise_cessee ? 'Cessée' : 'Active',
    dateCreation: d.date_creation || null,
  };
}

// ── In-memory cache + disk persistence ──────────────────────────────────────
const CACHE_DIR = join(homedir(), '.intelwatch', 'cache', 'pappers');
const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days
const memoryCache = new Map();

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function getCached(siren) {
  const mem = memoryCache.get(siren);
  if (mem) {
    if (Date.now() - mem._cachedAt > CACHE_TTL) {
      memoryCache.delete(siren);
      return null;
    }
    return mem;
  }

  try {
    const file = join(CACHE_DIR, `${siren}.json`);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - data._cachedAt > CACHE_TTL) return null;
    memoryCache.set(siren, data);
    return data;
  } catch (err) {
    console.error(`[pappers] Cache read error for ${siren}: ${err.message}`);
    return null;
  }
}

export function setCache(siren, data) {
  const entry = { ...data, _cachedAt: Date.now() };
  memoryCache.set(siren, entry);
  try {
    ensureCacheDir();
    writeFileSync(join(CACHE_DIR, `${siren}.json`), JSON.stringify(entry));
  } catch (err) {
    console.error(`[pappers] Cache write error for ${siren}: ${err.message}`);
  }
}
