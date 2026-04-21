/**
 * Pappers Provider — France only.
 *
 * Wraps the existing src/scrapers/pappers.js into the provider interface.
 * This is a thin adapter, not a rewrite.
 */

import {
  hasPappersKey,
  pappersSearchByName,
  pappersGetFullDossier,
  pappersGetBySiren,
  pappersLookup,
  pappersSearchSubsidiaries,
} from '../scrapers/pappers.js';

const pappersProvider = {
  name: 'pappers',
  country: 'FR',
  description: 'Pappers.fr — French company registry (SIREN, financials, BODACC, M&A)',

  /**
   * Check if the Pappers MCP server is configured.
   */
  isAvailable() {
    return hasPappersKey();
  },

  /**
   * Search companies by name.
   * @param {string} query
   * @param {{ count?: number }} options
   * @returns {Promise<{ results: Array, error: string|null }>}
   */
  async search(query, options = {}) {
    return pappersSearchByName(query, options);
  },

  /**
   * Get full company profile by SIREN.
   * @param {string} siren
   * @param {{ preview?: boolean }} options
   * @returns {Promise<{ data: object|null, error: string|null, fromCache?: boolean }>}
   */
  async getProfile(siren, options = {}) {
    if (options.preview) {
      // Preview mode: basic SIREN lookup only (identity + last year)
      return pappersGetBySiren(siren);
    }
    // Full dossier: financials history, BODACC, subsidiaries, etc.
    return pappersGetFullDossier(siren);
  },

  /**
   * Get subsidiaries of a parent company.
   * @param {string} parentName
   * @param {string} parentSiren
   * @param {object} options
   * @returns {Promise<{ subsidiaries: Array, fromCache?: boolean }>}
   */
  async getSubsidiaries(parentName, parentSiren, options = {}) {
    return pappersSearchSubsidiaries(parentName, parentSiren);
  },

  /**
   * Quick lookup for competitor tracker (name → basic company info).
   * @param {string} companyName
   * @returns {Promise<object|null>}
   */
  async lookup(companyName) {
    return pappersLookup(companyName);
  },
};

export default pappersProvider;
