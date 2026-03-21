/**
 * Clearbit Provider — International company enrichment (BYOK).
 *
 * API: https://dashboard.clearbit.com/docs
 * Requires CLEARBIT_API_KEY.
 *
 * Provides:
 *   - Domain → company enrichment (name, sector, employee count, revenue range, tech stack)
 *   - Good for .com / international where Pappers doesn't work
 *   - Complements OpenCorporates (OC = registry data, Clearbit = market data)
 *
 * This is a scaffold ready for BYOK integration.
 */

import { fetch } from '../utils/fetcher.js';

const CLEARBIT_API = 'https://company.clearbit.com/v2';

function getApiKey() {
  return process.env.CLEARBIT_API_KEY || null;
}

const clearbitProvider = {
  name: 'clearbit',
  country: 'INTL',
  description: 'Clearbit — Domain-based company enrichment (sector, size, tech, revenue)',

  isAvailable() {
    return !!getApiKey();
  },

  /**
   * Search is not the primary Clearbit use case — use domain enrichment instead.
   * Falls back to domain lookup if query looks like a domain.
   */
  async search(query, options = {}) {
    // Clearbit's primary API is domain-based, not name-based
    if (query.includes('.')) {
      // Looks like a domain — use enrichment
      const profile = await this.getProfile(query);
      if (profile.data) {
        return { results: [profile.data], error: null };
      }
    }

    return {
      results: [],
      error: 'Clearbit requires a domain for lookup. Try with a domain (e.g., company.com).',
    };
  },

  /**
   * Get company profile by domain.
   * @param {string} domain — e.g. "stripe.com"
   * @param {{ preview?: boolean }} options
   * @returns {Promise<{ data: object|null, error: string|null }>}
   */
  async getProfile(domain, options = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { data: null, error: 'CLEARBIT_API_KEY not set.' };
    }

    try {
      // Clean domain
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

      const resp = await fetch(`${CLEARBIT_API}/companies/find?domain=${cleanDomain}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        timeout: 15000,
      });

      if (resp.status === 404) {
        return { data: null, error: 'Company not found on Clearbit' };
      }

      const c = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;

      const profile = {
        name: c.name,
        legalName: c.legalName,
        domain: c.domain,
        sector: c.category?.sector,
        industry: c.category?.industry,
        subIndustry: c.category?.subIndustry,
        employeeRange: c.metrics?.employeesRange,
        estimatedRevenue: c.metrics?.estimatedAnnualRevenue,
        raised: c.metrics?.raised,
        description: c.description,
        foundedYear: c.foundedYear,
        location: c.geo ? `${c.geo.city}, ${c.geo.country}` : null,
        country: c.geo?.country,
        logo: c.logo,
        techStack: c.tech || [],
        tags: c.tags || [],
        url: `https://${c.domain}`,
        linkedin: c.linkedin?.handle ? `https://linkedin.com/company/${c.linkedin.handle}` : null,
        twitter: c.twitter?.handle ? `https://twitter.com/${c.twitter.handle}` : null,
        facebook: c.facebook?.handle ? `https://facebook.com/${c.facebook.handle}` : null,
        source: 'clearbit',
      };

      return { data: profile, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  },

  /**
   * No subsidiary data from Clearbit.
   */
  async getSubsidiaries() {
    return {
      subsidiaries: [],
      error: 'Clearbit does not provide subsidiary data.',
    };
  },

  /**
   * Quick lookup by domain.
   */
  async lookup(companyNameOrDomain) {
    if (!this.isAvailable()) return null;
    // Best used with domains
    const domain = companyNameOrDomain.includes('.')
      ? companyNameOrDomain
      : `${companyNameOrDomain.toLowerCase().replace(/\s+/g, '')}.com`;
    const result = await this.getProfile(domain, { preview: true });
    return result.data;
  },
};

export default clearbitProvider;
