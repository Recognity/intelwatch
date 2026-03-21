/**
 * Apollo Provider — International company enrichment (BYOK).
 *
 * API: https://apolloapi.io/developers
 * Requires APOLLO_API_KEY.
 *
 * Provides:
 *   - Domain → company enrichment (name, sector, employee count, revenue, tech)
 *   - Good for .com / international where Pappers doesn't work
 *   - Complements Clearbit with similar enrichment capabilities
 *
 * All Apollo queries are Pro-only (license gate in registry.js).
 */

import { fetch } from '../utils/fetcher.js';

const APOLLO_API = 'https://api.apollo.io/v1';

function getApiKey() {
  return process.env.APOLLO_API_KEY || null;
}

const apolloProvider = {
  name: 'apollo',
  country: 'INTL',
  description: 'Apollo.io — Domain-based company enrichment (sector, size, tech, revenue)',

  isAvailable() {
    return !!getApiKey();
  },

  /**
   * Search companies by name or domain.
   * @param {string} query
   * @param {{ count?: number }} options
   * @returns {Promise<{ results: Array, error: string|null }>}
   */
  async search(query, options = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { results: [], error: 'APOLLO_API_KEY not set.' };
    }

    try {
      const body = {
        q_organization_name: query,
        per_page: Math.min(options.count || 10, 25),
      };

      const resp = await fetch(`${APOLLO_API}/mixed_companies/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey,
        },
        data: JSON.stringify(body),
        timeout: 15000,
      });

      const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const orgs = data?.organizations || [];

      const results = orgs.map(c => ({
        name: c.name,
        domain: c.primary_domain,
        sector: c.industry,
        employeeRange: c.estimated_num_employees ? `${c.estimated_num_employees}` : null,
        estimatedRevenue: c.annual_revenue_printed,
        description: c.short_description,
        foundedYear: c.founded_year,
        location: [c.city, c.state, c.country].filter(Boolean).join(', '),
        country: c.country,
        logo: c.logo_url,
        url: c.website_url || (c.primary_domain ? `https://${c.primary_domain}` : null),
        linkedin: c.linkedin_url,
        phone: c.phone,
        source: 'apollo',
      }));

      return { results, error: null };
    } catch (err) {
      return { results: [], error: err.message };
    }
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
      return { data: null, error: 'APOLLO_API_KEY not set.' };
    }

    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

      const resp = await fetch(`${APOLLO_API}/organizations/enrich`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'X-Api-Key': apiKey,
        },
        params: { domain: cleanDomain },
        timeout: 15000,
      });

      const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
      const c = data?.organization;

      if (!c) {
        return { data: null, error: 'Company not found on Apollo' };
      }

      const profile = {
        name: c.name,
        legalName: c.name,
        domain: c.primary_domain || cleanDomain,
        sector: c.industry,
        subIndustry: c.sub_industry,
        employeeRange: c.estimated_num_employees ? `${c.estimated_num_employees}` : null,
        estimatedRevenue: c.annual_revenue_printed,
        raised: c.total_funding_printed,
        description: c.short_description,
        foundedYear: c.founded_year,
        location: [c.city, c.state, c.country].filter(Boolean).join(', '),
        country: c.country,
        logo: c.logo_url,
        techStack: c.current_technologies?.map(t => t.name) || [],
        tags: c.keywords || [],
        url: c.website_url || `https://${cleanDomain}`,
        linkedin: c.linkedin_url,
        twitter: c.twitter_url,
        facebook: c.facebook_url,
        phone: c.phone,
        source: 'apollo',
      };

      return { data: profile, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  },

  /**
   * No subsidiary data from Apollo.
   */
  async getSubsidiaries() {
    return {
      subsidiaries: [],
      error: 'Apollo does not provide subsidiary data.',
    };
  },

  /**
   * Quick lookup by domain.
   */
  async lookup(companyNameOrDomain) {
    if (!this.isAvailable()) return null;
    const domain = companyNameOrDomain.includes('.')
      ? companyNameOrDomain
      : `${companyNameOrDomain.toLowerCase().replace(/\s+/g, '')}.com`;
    const result = await this.getProfile(domain, { preview: true });
    return result.data;
  },
};

export default apolloProvider;
