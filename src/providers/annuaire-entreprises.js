/**
 * Annuaire Entreprises Provider — France only, MCP-backed.
 *
 * Wraps the src/scrapers/annuaire-entreprises.js into the provider interface.
 * This is the zero-cost fallback when Pappers is unavailable or returns 401.
 *
 * Data available:
 *   ✓ SIREN, SIRET, nom, NAF, nature juridique, adresse, effectifs
 *   ✓ Dirigeants (nom, prénom, qualité)
 *   ✓ Finances (CA, résultat net par année)
 *   ✓ Catégorie entreprise (PME/ETI/GE)
 *   ✗ UBO, BODACC, procédures collectives, mandats croisés, finances consolidées
 */

import {
  annuaireSearchByName,
  annuaireGetBySiren,
  annuaireGetFullDossier,
  annuaireLookup,
  hasAnnuaireConfig,
} from '../scrapers/annuaire-entreprises.js';

const annuaireEntreprisesProvider = {
  name: 'annuaire-entreprises',
  country: 'FR',
  description: 'Annuaire Entreprises (data.gouv.fr) — French company registry via MCP server',

  /**
   * Check if the Annuaire MCP server is configured.
   */
  isAvailable() {
    return hasAnnuaireConfig();
  },

  /**
   * Search companies by name.
   * @param {string} query
   * @param {{ count?: number }} options
   * @returns {Promise<{ results: Array, error: string|null }>}
   */
  async search(query, options = {}) {
    return annuaireSearchByName(query, options);
  },

  /**
   * Get company profile by SIREN.
   * @param {string} siren
   * @param {{ preview?: boolean }} options
   * @returns {Promise<{ data: object|null, error: string|null, fromCache?: boolean }>}
   */
  async getProfile(siren, options = {}) {
    if (options.preview) {
      return annuaireGetBySiren(siren);
    }
    // Full dossier
    return annuaireGetFullDossier(siren);
  },

  /**
   * Get subsidiaries — not available from Annuaire Entreprises.
   * Returns empty with a descriptive note.
   * @param {string} parentName
   * @param {string} parentSiren
   * @param {object} options
   * @returns {Promise<{ subsidiaries: Array, error: string|null }>}
   */
  async getSubsidiaries(parentName, parentSiren, options = {}) {
    return {
      subsidiaries: [],
      error: 'La recherche de filiales n\'est pas disponible via l\'Annuaire Entreprises. Utilisez Pappers pour cette fonctionnalité.',
    };
  },

  /**
   * Quick lookup for competitor tracker (name → basic company info).
   * @param {string} companyName
   * @returns {Promise<object|null>}
   */
  async lookup(companyName) {
    return annuaireLookup(companyName);
  },
};

export default annuaireEntreprisesProvider;
