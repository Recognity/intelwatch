/**
 * OpenCorporates Provider — International company data.
 *
 * API: https://api.opencorporates.com/v0.4/
 * Free tier: 500 req/month, basic data (name, jurisdiction, status, incorporation date)
 * Pro tier (BYOK): full data, officers, filings, statements
 *
 * This is a scaffold with real API integration for search and basic profile.
 * Full enrichment (officers, filings) can be added incrementally.
 */

import { fetch } from '../utils/fetcher.js';

const OC_API = 'https://api.opencorporates.com/v0.4';

function getApiKey() {
  return process.env.OPENCORPORATES_API_KEY || null;
}

const opencorporatesProvider = {
  name: 'opencorporates',
  country: 'INTL',
  description: 'OpenCorporates — International company registry (180+ jurisdictions)',

  /**
   * OpenCorporates has a free tier (no key needed, 500/month).
   * With API key → higher limits + more data.
   */
  isAvailable() {
    // Always available (free tier exists), but limited without key
    return true;
  },

  /**
   * Search companies by name.
   * @param {string} query
   * @param {{ count?: number, jurisdiction?: string }} options
   * @returns {Promise<{ results: Array, error: string|null }>}
   */
  async search(query, options = {}) {
    try {
      const params = new URLSearchParams({ q: query });
      if (options.jurisdiction) params.set('jurisdiction_code', options.jurisdiction);
      if (options.count) params.set('per_page', String(Math.min(options.count, 30)));
      const apiKey = getApiKey();
      if (apiKey) params.set('api_token', apiKey);

      const resp = await fetch(`${OC_API}/companies/search?${params}`, {
        headers: { Accept: 'application/json' },
        timeout: 15000,
      });

      const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const companies = data?.results?.companies || [];

      const results = companies.map(({ company: c }) => ({
        name: c.name,
        companyNumber: c.company_number,
        jurisdiction: c.jurisdiction_code,
        status: c.current_status,
        incorporationDate: c.incorporation_date,
        companyType: c.company_type,
        registeredAddress: c.registered_address_in_full,
        url: c.opencorporates_url,
        source: 'opencorporates',
      }));

      return { results, error: null };
    } catch (err) {
      return { results: [], error: err.message };
    }
  },

  /**
   * Get company profile by jurisdiction + company number.
   * @param {string} identifier — format: "jurisdiction/company_number" e.g. "gb/12345678"
   * @param {{ preview?: boolean }} options
   * @returns {Promise<{ data: object|null, error: string|null }>}
   */
  async getProfile(identifier, options = {}) {
    try {
      // Identifier can be "gb/12345678" or just a company number
      const path = identifier.includes('/') ? identifier : `us_${identifier}`;
      const params = new URLSearchParams();
      const apiKey = getApiKey();
      if (apiKey) params.set('api_token', apiKey);

      const resp = await fetch(`${OC_API}/companies/${path}?${params}`, {
        headers: { Accept: 'application/json' },
        timeout: 15000,
      });

      const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const c = data?.results?.company;

      if (!c) return { data: null, error: 'Company not found' };

      const profile = {
        name: c.name,
        companyNumber: c.company_number,
        jurisdiction: c.jurisdiction_code,
        status: c.current_status,
        incorporationDate: c.incorporation_date,
        dissolutionDate: c.dissolution_date,
        companyType: c.company_type,
        registeredAddress: c.registered_address_in_full,
        previousNames: (c.previous_names || []).map(pn => pn.company_name),
        agentName: c.agent_name,
        agentAddress: c.agent_address,
        url: c.opencorporates_url,
        source: 'opencorporates',
        // Officers and filings available with Pro key
        officerCount: c.number_of_employees || null,
        ...(options.preview ? {} : {
          officers: (c.officers || []).map(o => ({
            name: o.officer?.name,
            position: o.officer?.position,
            startDate: o.officer?.start_date,
            endDate: o.officer?.end_date,
          })),
          filings: (c.filings || []).slice(0, 20).map(f => ({
            title: f.filing?.title,
            date: f.filing?.date,
            type: f.filing?.filing_type,
            url: f.filing?.opencorporates_url,
          })),
        }),
      };

      return { data: profile, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  },

  /**
   * Subsidiary lookup — not directly supported by OC free tier.
   * Returns empty with a note.
   */
  async getSubsidiaries(parentName, parentId, options = {}) {
    return {
      subsidiaries: [],
      error: 'OpenCorporates does not provide subsidiary data in the free tier. Use a jurisdiction-specific provider for subsidiary analysis.',
    };
  },

  /**
   * Quick lookup for competitor tracker.
   */
  async lookup(companyName) {
    const result = await this.search(companyName, { count: 1 });
    if (result.results.length > 0) {
      return result.results[0];
    }
    return null;
  },
};

export default opencorporatesProvider;
