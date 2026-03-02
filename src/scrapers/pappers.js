import axios from 'axios';

const PAPPERS_API = 'https://api.pappers.fr/v1';

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
    return { results: resp.data.resultats || [], error: null };
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
