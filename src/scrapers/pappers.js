import axios from 'axios';

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

    // BODACC publications — last 10
    const bodacc = (d.publications_bodacc || []).slice(0, 10).map(p => ({
      date: p.date,
      type: p.type,
      tribunal: p.tribunal || null,
      numero: p.numero_annonce || null,
      description: p.acte?.actes_publies?.[0]?.type_acte || p.type || null,
    }));

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

    return {
      data: { identity, financialHistory, ubo, bodacc, dirigeants, proceduresCollectives, raw: d },
      error: null,
    };
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
