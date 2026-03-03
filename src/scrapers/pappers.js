import axios from 'axios';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PAPPERS_API = 'https://api.pappers.fr/v1';
const PAPPERS_API_V2 = 'https://api.pappers.fr/v2';

function getApiKey() {
  return process.env.PAPPERS_API_KEY || null;
}

export function hasPappersKey() {
  return !!getApiKey();
}

/**
 * Search companies by name on Pappers
 */
export async function pappersSearchByName(name, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) return { results: [], error: 'No PAPPERS_API_KEY set' };

  try {
    const resp = await axios.get(`${PAPPERS_API}/recherche`, {
      params: {
        api_token: apiKey,
        q: name,
        par_page: options.count || 5,
      },
      timeout: 10000,
    });
    return { results: resp.data.resultats || resp.data.entreprises || [], error: null };
  } catch (err) {
    return { results: [], error: err.message };
  }
}

/**
 * Get company details by SIREN
 */
export async function pappersGetBySiren(siren) {
  const apiKey = getApiKey();
  if (!apiKey) return { data: null, error: 'No PAPPERS_API_KEY set' };

  try {
    const resp = await axios.get(`${PAPPERS_API}/entreprise`, {
      params: { api_token: apiKey, siren },
      timeout: 10000,
    });
    return { data: resp.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Main lookup: search by name, then fetch detail by SIREN.
 * Returns null if no API key or no result found.
 */
export async function pappersLookup(companyName) {
  if (!getApiKey()) return null;

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
 * Returns parsed financial history, UBO, BODACC, dirigeants with mandats,
 * and collective procedures.
 */
export async function pappersGetFullDossier(siren) {
  // Check cache first
  const cached = getCached(siren);
  if (cached) return { data: cached, error: null, fromCache: true };

  const apiKey = getApiKey();
  if (!apiKey) return { data: null, error: 'No PAPPERS_API_KEY set' };

  try {
    const resp = await axios.get(`${PAPPERS_API}/entreprise`, {
      params: { api_token: apiKey, siren },
      timeout: 15000,
    });

    const d = resp.data;

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

    // BODACC publications — last 50 (captures M&A activity)
    const bodacc = (d.publications_bodacc || []).slice(0, 50).map(p => {
      const actes = (p.acte?.actes_publies || []).map(a => a.type_acte).filter(Boolean);
      return {
        date: p.date,
        type: p.type,
        tribunal: p.tribunal || null,
        numero: p.numero_annonce || null,
        description: actes.length ? actes.join(', ') : p.type || null,
        details: p.acte?.descriptif || p.acte?.capital || null,
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
    const proceduresCollectives = (d.procedures_collectives || []).map(p => ({
      date: p.date_effet || p.date || null,
      type: p.type || null,
      jugement: p.nature_jugement || null,
      tribunal: p.tribunal || null,
    }));

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

    // Representants (dirigeants + corporate entities with mandats)
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

    // Extra fields
    identity.objetSocial = d.objet_social || null;
    identity.tvaIntra = d.numero_tva_intracommunautaire || null;
    identity.rcs = d.numero_rcs || null;
    identity.greffe = d.greffe || null;
    identity.conventionCollective = d.conventions_collectives?.[0]?.nom || null;
    identity.effectifTexte = d.effectif || null;

      const result = { identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives };
      setCache(siren, result);
      return { data: result, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
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
 * Search for subsidiaries/related entities.
 * Strategy 1: recherche-dirigeants — finds companies where the parent acts as corporate director.
 * Strategy 2: name-search fallback.
 * Returns array of entities with their latest financials, sorted by CA desc.
 */
export async function pappersSearchSubsidiaries(parentName, parentSiren) {
  const apiKey = getApiKey();
  if (!apiKey) return { subsidiaries: [], error: 'No PAPPERS_API_KEY set' };

  // Check cache for subsidiary search results
  const subsCacheKey = `subs_${parentSiren}`;
  const cachedSubs = getCached(subsCacheKey);
  if (cachedSubs?.subsidiaries) {
    return { subsidiaries: cachedSubs.subsidiaries, total: cachedSubs.total || cachedSubs.subsidiaries.length, error: null, fromCache: true };
  }

  const searchName = parentName.replace(/\s*(GRP|SAS|SARL|SA|SCI|EURL|GROUP|GROUPE|HOLDING|SNC|SASU)\s*/gi, ' ').trim();
  const nameNorm = searchName.toLowerCase();

  // ── Strategy 1: recherche-dirigeants ──────────────────────────────────────
  // Finds companies where an entity named like the parent is listed as dirigeant
  try {
    const resp = await axios.get(`${PAPPERS_API}/recherche-dirigeants`, {
      params: { api_token: apiKey, q: searchName, par_page: 20 },
      timeout: 15000,
    });

    const resultats = resp.data.resultats || [];
    const subsidiaryMap = new Map();

    for (const r of resultats) {
      // Only match the PARENT entity as dirigeant (by SIREN if available, else exact name)
      const dirigeantSiren = r.siren || '';
      const dirigeantName = (r.nom_entreprise || r.denomination || r.nom_complet || '').toLowerCase().trim();
      
      // Strict filter: must be the parent SIREN, or exact parent name match
      const isParent = (dirigeantSiren === parentSiren) || (dirigeantName === nameNorm) || (dirigeantName === searchName.toLowerCase());
      if (!isParent) continue;

      for (const e of (r.entreprises || [])) {
        if (e.siren && e.siren !== parentSiren && !subsidiaryMap.has(e.siren)) {
          subsidiaryMap.set(e.siren, e);
        }
      }
    }

    if (subsidiaryMap.size > 0) {
      // Limit to 30 subsidiaries to save API credits
      const entities = Array.from(subsidiaryMap.values()).slice(0, 30);
      const subsidiaries = await fetchSubsidiaryDetails(apiKey, entities);
      // Cache subsidiary search results
      setCache(subsCacheKey, { subsidiaries, total: subsidiaryMap.size });
      return { subsidiaries, total: subsidiaryMap.size, error: null };
    }
  } catch (_) {
    // Fall through to name-search
  }

  // ── Strategy 2: name-search fallback ──────────────────────────────────────
  try {
    const resp = await axios.get(`${PAPPERS_API}/recherche`, {
      params: { api_token: apiKey, q: searchName, par_page: 20 },
      timeout: 15000,
    });

    const entities = (resp.data.entreprises || resp.data.resultats || [])
      .filter(e => e.siren !== parentSiren);

    const subsidiaries = await fetchSubsidiaryDetails(apiKey, entities);
    // Cache fallback search results too
    setCache(subsCacheKey, { subsidiaries, total: subsidiaries.length });
    return { subsidiaries, error: null };
  } catch (err) {
    return { subsidiaries: [], error: err.message };
  }
}

async function fetchSubsidiaryDetails(apiKey, entities) {
  const subsidiaries = [];
  for (const e of entities) {
    try {
      // Check cache first to save API credits
      const cached = getCached(e.siren);
      let d;
      if (cached?.identity) {
        // Reconstruct from cached full dossier
        d = { nom_entreprise: cached.identity.name, code_naf: cached.identity.nafCode, libelle_code_naf: cached.identity.nafLabel, siege: { ville: cached.identity.ville }, effectif: cached.identity.effectifTexte, entreprise_cessee: false, date_creation: cached.identity.dateCreation, finances: cached.financialHistory?.map(f => ({ chiffre_affaires: f.ca, resultat: f.resultat, annee: f.annee })) || [] };
      } else {
        const det = await axios.get(`${PAPPERS_API}/entreprise`, {
          params: { api_token: apiKey, siren: e.siren },
          timeout: 10000,
        });
        d = det.data;
        // Cache subsidiary data to avoid re-fetching
        setCache(e.siren, {
          identity: { name: d.nom_entreprise, nafCode: d.code_naf, nafLabel: d.libelle_code_naf, ville: d.siege?.ville, effectifTexte: d.effectif, dateCreation: d.date_creation },
          financialHistory: (d.finances || []).map(f => ({ ca: f.chiffre_affaires, resultat: f.resultat, annee: f.annee })),
          _subCache: true,
        });
      }
      const fin = (d.finances || [])[0] || {};
      subsidiaries.push({
        siren: e.siren,
        name: d.nom_entreprise || d.denomination || e.nom_entreprise || '?',
        naf: d.code_naf || '',
        nafLabel: d.libelle_code_naf || '',
        ville: d.siege?.ville || '',
        effectif: d.effectif || '',
        ca: fin.chiffre_affaires ?? null,
        resultat: fin.resultat ?? null,
        annee: fin.annee || null,
        status: d.entreprise_cessee ? 'Cessée' : 'Active',
        dateCreation: d.date_creation || null,
      });
    } catch (_) {
      subsidiaries.push({
        siren: e.siren,
        name: e.nom_entreprise || e.denomination || '?',
        ville: e.siege?.ville || '',
        ca: null, resultat: null, effectif: '', annee: null, status: '?',
      });
    }
  }
  subsidiaries.sort((a, b) => (b.ca || 0) - (a.ca || 0));
  return subsidiaries;
}

// ── Local cache to save API credits ──────────────────────────────────────────
const CACHE_DIR = join(homedir(), '.intelwatch', 'cache', 'pappers');
const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function getCached(siren) {
  try {
    const file = join(CACHE_DIR, `${siren}.json`);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - data._cachedAt > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

export function setCache(siren, data) {
  try {
    ensureCacheDir();
    writeFileSync(join(CACHE_DIR, `${siren}.json`), JSON.stringify({ ...data, _cachedAt: Date.now() }));
  } catch { /* silent */ }
}
