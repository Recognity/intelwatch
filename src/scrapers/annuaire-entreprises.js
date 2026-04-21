/**
 * Annuaire Entreprises / data.gouv scraper.
 *
 * Free, no API key required.
 * API doc: https://api.recherche-entreprises.fr/docs
 * Base URL: https://recherche-entreprises.api.gouv.fr
 *
 * Provides: SIREN, SIRET, dirigeants, adresse, NAF, effectifs,
 *           nature juridique, finances (CA, resultat_net), catégorie entreprise.
 * Does NOT provide: UBO, BODACC, procédures collectives, consolidated finances,
 *                   mandats croisés des dirigeants, etablissements multiples détaillés.
 */

import axios from 'axios';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Annuaire Entreprises est toujours disponible (API publique data.gouv.fr, pas de clé).
 * Fonction exposée pour compatibilité avec les consommateurs qui conditionnaient l'usage
 * sur une config MCP (désormais facultative).
 */
export function hasAnnuaireConfig() {
  return true;
}
import { join } from 'path';
import { homedir } from 'os';

const ANNUAIRE_API = 'https://recherche-entreprises.api.gouv.fr';

// ── Local cache (7 days, same TTL as Pappers) ────────────────────────────────
const CACHE_DIR = join(homedir(), '.intelwatch', 'cache', 'annuaire-entreprises');
const CACHE_TTL = 7 * 24 * 3600 * 1000;

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function getCached(key) {
  try {
    const file = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Date.now() - data._cachedAt > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  try {
    ensureCacheDir();
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify({ ...data, _cachedAt: Date.now() }));
  } catch { /* silent */ }
}

// ── NAF code to label mapping (common codes) ─────────────────────────────────

const NAF_LABELS = {
  '01': 'Agriculture', '02': 'Sylviculture', '10': 'Industries alimentaires',
  '11': 'Boissons', '12': 'Tabac', '13': 'Textiles', '14': 'Habillement',
  '15': 'Cuir', '16': 'Bois', '17': 'Papier', '18': 'Imprimerie',
  '19': 'Coke et pétrole', '20': 'Produits chimiques', '21': 'Pharmacie',
  '22': 'Caoutchouc/Plastique', '23': 'Autres minéraux non métalliques',
  '24': 'Métallurgie', '25': 'Produits métalliques', '26': 'Informatique/Électronique',
  '27': 'Équipements électriques', '28': 'Machines', '29': 'Automobiles',
  '30': 'Autres transports', '31': 'Mobilier', '32': 'Autres industries',
  '33': 'Réparation machines', '35': 'Énergie', '36': 'Eau', '37': 'Collecte déchets',
  '38': 'Traitement déchets', '39': 'Dépollution', '41': 'Construction bâtiments',
  '42': 'Génie civil', '43': 'Travaux spécialisés', '45': 'Commerce auto',
  '46': 'Commerce de gros', '47': 'Commerce de détail', '49': 'Transport terrestre',
  '50': 'Transport maritime', '51': 'Transport aérien', '52': 'Entreposage',
  '53': 'Poste', '55': 'Hébergement', '56': 'Restauration', '58': 'Édition',
  '59': 'Cinéma/Vidéo', '60': 'Programmation/TV', '61': 'Télécommunications',
  '62': 'Programmation informatique', '63': 'Services information',
  '64': 'Services financiers', '65': 'Assurance', '66': 'Activités auxiliaires finance',
  '68': 'Immobilier', '69': 'Activités juridiques/comptables',
  '70': 'Conseil de gestion', '71': 'Architecture/Ingénierie',
  '72': 'Recherche scientifique', '73': 'Publicité/Conseil marketing',
  '74': 'Conseil en design', '75': 'Activités vétérinaires',
  '77': 'Location/bail', '78': 'Emploi', '79': 'Voyages',
  '80': 'Sécurité/enquête', '81': 'Services bâtiments/paysage',
  '82': 'Services administratifs', '84': 'Administration publique',
  '85': 'Enseignement', '86': 'Santé humaine', '87': 'Hébergement médicalisé',
  '88': 'Action sociale', '90': 'Arts', '91': 'Bibliothèques/Musées',
  '92': 'Jeux/Loisirs', '93': 'Sports', '94': 'Associations',
  '95': 'Réparation ménage', '96': 'Services personnels', '97': 'Ménages employeurs',
  '98': 'Activités indifférenciées', '99': 'Extraterritorial',
};

// ── Effectif tranche mapping ────────────────────────────────────────────────

const EFFECTIF_TRANCHE_MAP = {
  '00': '0 salarié',
  '01': '1-2 salariés',
  '02': '3-5 salariés',
  '03': '6-9 salariés',
  '11': '10-19 salariés',
  '12': '20-49 salariés',
  '21': '50-99 salariés',
  '22': '100-249 salariés',
  '31': '250-499 salariés',
  '32': '500-999 salariés',
  '41': '1 000-2 499 salariés',
  '42': '2 500-4 999 salariés',
  '51': '5 000-9 999 salariés',
  '52': '10 000+ salariés',
  'NN': 'Inconnu',
};

// ── Nature juridique mapping (common codes) ─────────────────────────────────

const NATURE_JURIDIQUE_MAP = {
  '1000': 'Entrepreneur individuel',
  '2110': 'Indivision',
  '2120': 'Société créée de fait',
  '2210': 'Société en nom collectif (SNC)',
  '2220': 'Société en commandite simple (SCS)',
  '2250': 'Société en participation',
  '2310': 'Société à responsabilité limitée (SARL)',
  '2320': 'Société à responsabilité limitée simplifiée (EURL)',
  '2385': 'SARL unipersonnelle',
  '2410': 'Société anonyme (SA)',
  '2420': 'Société anonyme à directoire',
  '2450': 'Société par actions simplifiée (SAS)',
  '2510': 'Société par actions simplifiée à associé unique (SASU)',
  '2520': 'SAS unipersonnelle',
  '2610': 'Société en commandite par actions (SCA)',
  '2710': 'Groupement d\'intérêt économique (GIE)',
  '2720': 'Groupement européen d\'intérêt économique (GEIE)',
  '3110': 'Société civile (SC)',
  '3150': 'Société civile immobilière (SCI)',
  '3205': 'Société d\'exercice libéral (SEL)',
  '3210': 'Société d\'exercice libéral à responsabilité limitée (SELARL)',
  '3220': 'Société d\'exercice libéral par actions simplifiée (SELAS)',
  '4110': 'Établissement public national',
  '4120': 'Établissement public local',
  '4140': 'Commune',
  '4150': 'Département',
  '4160': 'Région',
  '4210': 'Syndicat intercommunal',
  '5198': 'Société coopérative (SCOP)',
  '5499': 'Société à responsabilité limitée (SARL)', // commonly mapped
  '5710': 'Caisse d\'épargne',
  '6202': 'Fonds commun de placement',
  '6411': 'Société d\'investissement à capital variable (SICAV)',
  '6511': 'Société de crédit agricole',
  '6542': 'Caisse de crédit municipal',
  '7112': 'Association déclarée',
  '7120': 'Association non déclarée',
  '7210': 'Syndicat de salariés',
  '7220': 'Syndicat patronal',
  '7312': 'Ordre professionnel',
  '7412': 'Mutuelle',
  '7499': 'Organisme social',
  '8110': 'Établissement d\'enseignement privé',
  '8150': 'Établissement sanitaire privé',
  '8510': 'Régime général de la Sécurité sociale',
  '8520': 'Régime agricole',
  '9220': 'Société de la loi de 1901',
};

function getNafLabel(nafCode) {
  if (!nafCode) return null;
  const prefix = nafCode.split('.')[0];
  return NAF_LABELS[prefix] || null;
}

function getEffectifLabel(trancheCode) {
  if (!trancheCode) return null;
  return EFFECTIF_TRANCHE_MAP[trancheCode] || `Tranche ${trancheCode}`;
}

function getNatureJuridiqueLabel(code) {
  if (!code) return null;
  return NATURE_JURIDIQUE_MAP[code] || `Code ${code}`;
}

/**
 * Search companies by name on Annuaire Entreprises.
 * @param {string} name
 * @param {{ count?: number }} options
 * @returns {Promise<{ results: Array, error: string|null }>}
 */
export async function annuaireSearchByName(name, options = {}) {
  try {
    const resp = await axios.get(`${ANNUAIRE_API}/search`, {
      params: {
        q: name,
        per_page: options.count || 10,
        mtm_campaign: 'intelwatch',
      },
      timeout: 10000,
    });
    const results = (resp.data.results || []).map(r => formatSearchResult(r));
    return { results, error: null, total_results: resp.data.total_results || 0 };
  } catch (err) {
    const msg = err.response?.status === 429
      ? 'Rate limit exceeded (Annuaire Entreprises). Retry later.'
      : err.message;
    return { results: [], error: msg };
  }
}

/**
 * Get company details by SIREN via Annuaire Entreprises search.
 * Note: the API doesn't have a dedicated SIREN endpoint — we use the search endpoint
 * with the SIREN as query, which returns exact match at position 0.
 * @param {string} siren
 * @returns {Promise<{ data: object|null, error: string|null }>}
 */
export async function annuaireGetBySiren(siren) {
  // Check cache
  const cached = getCached(siren);
  if (cached) return { data: cached, error: null, fromCache: true };

  try {
    const resp = await axios.get(`${ANNUAIRE_API}/search`, {
      params: {
        q: siren,
        per_page: 1,
        mtm_campaign: 'intelwatch',
      },
      timeout: 10000,
    });

    const results = resp.data.results || [];
    if (results.length === 0) {
      return { data: null, error: `SIREN ${siren} non trouvé sur l'Annuaire Entreprises.` };
    }

    const data = formatProfile(results[0]);
    setCache(siren, data);
    return { data, error: null };
  } catch (err) {
    if (err.response?.status === 404) {
      return { data: null, error: `SIREN ${siren} non trouvé.` };
    }
    return { data: null, error: err.message };
  }
}

/**
 * Get full company dossier by SIREN.
 * Returns a normalized structure compatible with the Pappers dossier format
 * so that the profile command can render it seamlessly.
 * @param {string} siren
 * @returns {Promise<{ data: object|null, error: string|null, fromCache?: boolean }>}
 */
export async function annuaireGetFullDossier(siren) {
  const cached = getCached(`dossier_${siren}`);
  if (cached) return { data: cached, error: null, fromCache: true };

  try {
    const resp = await axios.get(`${ANNUAIRE_API}/search`, {
      params: {
        q: siren,
        per_page: 1,
        mtm_campaign: 'intelwatch',
      },
      timeout: 10000,
    });

    const results = resp.data.results || [];
    if (results.length === 0) {
      return { data: null, error: `SIREN ${siren} non trouvé sur l'Annuaire Entreprises.` };
    }

    const raw = results[0];
    const data = buildDossier(raw);
    setCache(`dossier_${siren}`, data);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Quick lookup for competitor tracker (name → basic company info).
 * @param {string} companyName
 * @returns {Promise<object|null>}
 */
export async function annuaireLookup(companyName) {
  const { results, error } = await annuaireSearchByName(companyName, { count: 1 });
  if (error || results.length === 0) return null;

  const top = results[0];
  const siren = top.siren;
  if (!siren) return top;

  const detail = await annuaireGetBySiren(siren);
  if (detail.error || !detail.data) return top;
  return detail.data;
}

// ── Formatters ───────────────────────────────────────────────────────────────

/**
 * Format a search result (lightweight, for search listing).
 */
function formatSearchResult(r) {
  return {
    siren: r.siren,
    siret: r.siege?.siret || null,
    nom_entreprise: r.nom_raison_sociale || r.nom_complet,
    denomination: r.nom_raison_sociale || r.nom_complet,
    date_creation: r.date_creation || null,
    code_naf: r.activite_principale || null,
    libelle_code_naf: r.activite_principale ? getNafLabel(r.activite_principale) : null,
    forme_juridique: getNatureJuridiqueLabel(r.nature_juridique) || null,
    siege: {
      ville: r.siege?.libelle_commune || null,
      code_postal: r.siege?.code_postal || null,
      adresse: r.siege?.adresse || null,
    },
    tranche_effectif: getEffectifLabel(r.tranche_effectif_salarie) || null,
    etat: r.etat_administratif === 'A' ? 'actif' : 'fermé',
    categorie_entreprise: r.categorie_entreprise || null,
    source: 'annuaire-entreprises',
  };
}

/**
 * Format a single company profile (for getProfile).
 * Normalized to match the interface expected by the provider/consumers.
 */
function formatProfile(r) {
  const siege = r.siege || {};
  const finances = r.finances || {};
  const finYears = Object.keys(finances).sort((a, b) => b - a);

  // Latest financials
  const lastFinYear = finYears[0] || null;
  const lastFin = lastFinYear ? finances[lastFinYear] : {};

  return {
    siren: r.siren,
    siret: siege.siret || null,
    name: r.nom_raison_sociale || r.nom_complet,
    dateCreation: r.date_creation || null,
    nafCode: r.activite_principale || null,
    nafLabel: getNafLabel(r.activite_principale) || null,
    formeJuridique: getNatureJuridiqueLabel(r.nature_juridique) || null,
    effectifs: getEffectifLabel(r.tranche_effectif_salarie) || null,
    adresse: [siege.numero_voie, siege.type_voie, siege.libelle_voie].filter(Boolean).join(' ') || null,
    ville: siege.libelle_commune || null,
    codePostal: siege.code_postal || null,
    capital: r.capital_social ?? (r.capital ?? null),
    capitalMonnaie: 'EUR',
    website: null, // Not available in Annuaire API
    status: r.etat_administratif === 'A' ? 'Actif' : 'Fermé',
    categorieEntreprise: r.categorie_entreprise || null,
    dirigeants: (r.dirigeants || []).filter(d => d.nom || d.prenoms).map(d => ({
      nom: d.nom || null,
      prenom: d.prenoms || null,
      role: d.qualite || null,
      dateNomination: null,
      dateNaissance: d.annee_de_naissance || d.date_de_naissance || null,
      nationalite: d.nationalite || null,
      type: d.type_dirigeant || null,
      mandats: [],
    })),
    ca: lastFin.ca ?? null,
    caYear: lastFinYear ? parseInt(lastFinYear, 10) : null,
    resultat: lastFin.resultat_net ?? null,
    finances: finYears.slice(0, 5).map(year => ({
      annee: parseInt(year, 10),
      ca: finances[year].ca ?? null,
      resultat: finances[year].resultat_net ?? null,
    })),
    source: 'annuaire-entreprises',
    _fallback: true,
  };
}

/**
 * Build a full dossier compatible with the Pappers dossier structure.
 * This allows the profile.js command to render data identically regardless
 * of whether it came from Pappers or the Annuaire Entreprises fallback.
 */
function buildDossier(r) {
  const siege = r.siege || {};
  const finances = r.finances || {};

  // Identity block (matches Pappers identity structure)
  const identity = {
    siren: r.siren,
    siret: siege.siret || null,
    name: r.nom_raison_sociale || r.nom_complet,
    dateCreation: r.date_creation || null,
    nafCode: r.activite_principale || null,
    nafLabel: getNafLabel(r.activite_principale) || null,
    formeJuridique: getNatureJuridiqueLabel(r.nature_juridique) || null,
    effectifs: getEffectifLabel(r.tranche_effectif_salarie) || null,
    adresse: [siege.numero_voie, siege.type_voie, siege.libelle_voie].filter(Boolean).join(' ') || null,
    ville: siege.libelle_commune || null,
    codePostal: siege.code_postal || null,
    capital: r.capital_social ?? (r.capital ?? null),
    capitalMonnaie: 'EUR',
    website: null,
    status: r.etat_administratif === 'A' ? 'Actif' : 'Fermé',
    dateRadiation: r.date_fermeture || null,
    // Extra fields
    objetSocial: null,
    tvaIntra: null,
    rcs: null,
    greffe: null,
    conventionCollective: null,
    effectifTexte: getEffectifLabel(r.tranche_effectif_salarie) || null,
    categorieEntreprise: r.categorie_entreprise || null,
  };

  // Financial history (sorted by year desc)
  const finYears = Object.keys(finances).sort((a, b) => b - a);
  const financialHistory = finYears.slice(0, 5).map(year => ({
    annee: parseInt(year, 10),
    ca: finances[year].ca ?? null,
    resultat: finances[year].resultat_net ?? null,
    capitauxPropres: null,
    effectif: null,
    ebitda: null,
    margeEbitda: null,
    dettesFinancieres: null,
    tresorerie: null,
    fondsPropres: null,
    bfr: null,
    ratioEndettement: null,
    autonomieFinanciere: null,
    rentabiliteFP: null,
    margeNette: null,
    capaciteAutofinancement: null,
  }));

  // Dirigeants (no mandats from Annuaire API)
  const dirigeants = (r.dirigeants || []).filter(d => d.nom || d.prenoms).map(d => ({
    nom: d.nom || null,
    prenom: d.prenoms || null,
    role: d.qualite || null,
    dateNomination: null,
    dateNaissance: d.annee_de_naissance || d.date_de_naissance || null,
    nationalite: d.nationalite || null,
    mandats: [],
  }));

  // Fields not available from Annuaire API — return empty but valid structures
  const ubo = [];
  const bodacc = [];
  const proceduresCollectives = [];
  const representants = [];
  const etablissements = [];
  const consolidatedFinances = [];

  const result = {
    identity,
    financialHistory,
    consolidatedFinances,
    ubo,
    bodacc,
    dirigeants,
    representants,
    etablissements,
    proceduresCollectives,
    source: 'annuaire-entreprises',
    _fallback: true,
    _fallbackNote: 'Données issues de l\'Annuaire Entreprises (data.gouv.fr). Données financières limitées (CA, résultat net). UBO, BODACC, procédures collectives et mandats croisés non disponibles via cette source gratuite.',
  };

  return result;
}

// Re-export cache helpers for potential use by the provider
export { getCached, setCache };
