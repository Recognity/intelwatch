/**
 * Company Data Provider Registry.
 *
 * Routes company lookups to the right provider based on TLD / country.
 * Each provider implements the same interface (see BaseProvider).
 *
 * Routing:
 *   SIREN/SIRET  → Pappers (direct, numeric 9-14 digits)
 *   .fr          → Pappers (France, full data)
 *   .co.uk, .uk  → OpenCorporates (UK, basic)
 *   .com, .io, … → International provider (Apollo / Clearbit / OpenCorporates)
 *                   ↳ if country = France → handoff to Pappers for deep data
 *   fallback     → OpenCorporates
 *
 * License gate:
 *   Free tier:   --preview only (identity + last year financials)
 *   Pro tier:    full profile, subsidiaries, M&A, financials history
 */

import { isPro, requirePro, getLimits, gatePro } from '../license.js';

// Providers that require Pro license for any API call
// Note: 'pappers' is Pro-only, but 'annuaire-entreprises' is free — used as FR fallback
const PRO_ONLY_PROVIDERS = new Set(['pappers', 'apollo', 'clearbit']);

// ── TLD → Country mapping ────────────────────────────────────────────────────

const TLD_COUNTRY_MAP = {
  '.fr':    'FR',
  '.co.uk': 'GB',
  '.uk':    'GB',
  '.de':    'DE',
  '.es':    'ES',
  '.it':    'IT',
  '.nl':    'NL',
  '.be':    'BE',
  '.ch':    'CH',
  '.pt':    'PT',
  '.at':    'AT',
  '.ie':    'IE',
  '.se':    'SE',
  '.no':    'NO',
  '.dk':    'DK',
  '.fi':    'FI',
  '.pl':    'PL',
  '.com':   'INTL',
  '.org':   'INTL',
  '.net':   'INTL',
  '.io':    'INTL',
  '.co':    'INTL',
  '.ai':    'INTL',
  '.us':    'US',
  '.ca':    'CA',
  '.au':    'AU',
  '.nz':    'NZ',
  '.jp':    'JP',
  '.cn':    'CN',
  '.in':    'IN',
  '.br':    'BR',
};

// ── Provider → Country mapping ───────────────────────────────────────────────

const PROVIDER_MAP = {
  'FR':   'pappers',
  // All others → apollo for enrichment (extensible: add 'GB': 'companieshouse', etc.)
};

// France-specific fallback chain: Pappers (deep, paid) → Annuaire Entreprises (basic, free)
const FR_FALLBACK_CHAIN = ['pappers', 'annuaire-entreprises'];

// Fallback chain for international domains (tried in order, first available wins)
const INTL_FALLBACK_CHAIN = ['apollo', 'clearbit', 'opencorporates'];

// ── SIREN/SIRET Detection ────────────────────────────────────────────────────

const SIREN_SIRET_RE = /^\d{9}(\d{5})?$/;

/**
 * Check if a query is a SIREN (9 digits) or SIRET (14 digits).
 * @param {string} query
 * @returns {boolean}
 */
export function isSirenOrSiret(query) {
  return SIREN_SIRET_RE.test((query || '').trim());
}

// ── France Country Detection (for handoff) ───────────────────────────────────

const FRANCE_VARIANTS = new Set([
  'france', 'fr', 'france (metropolitan)', 'france métropolitaine',
  'france, metropolitan', 'république française',
]);

/**
 * Detect if a country value indicates France.
 * @param {string|null|undefined} country
 * @returns {boolean}
 */
export function isFrenchCountry(country) {
  if (!country) return false;
  return FRANCE_VARIANTS.has(country.trim().toLowerCase());
}

/**
 * Extract the country from an international provider profile response.
 * Supports various field shapes: country, headquarters.country, location containing France.
 * @param {object} profile — the data object from a provider response
 * @returns {string|null}
 */
function extractCountryFromProfile(profile) {
  if (!profile) return null;
  if (profile.country) return profile.country;
  if (profile.headquarters?.country) return profile.headquarters.country;
  if (profile.geo?.country) return profile.geo.country;
  if (typeof profile.location === 'string' && /\bfrance\b/i.test(profile.location)) {
    return 'France';
  }
  return null;
}

/**
 * Extract company name from an international provider profile.
 * @param {object} profile
 * @returns {string|null}
 */
function extractCompanyName(profile) {
  if (!profile) return null;
  return profile.name || profile.legalName || profile.companyName || null;
}

/**
 * Merge international provider data with Pappers data.
 * Pappers values overwrite international ones when defined (deeper French data).
 * International-only fields (techStack, social, etc.) are preserved.
 * @param {object} intlData — from Apollo/Clearbit/OpenCorporates
 * @param {object} pappersData — from Pappers
 * @returns {object}
 */
export function mergeWithPappers(intlData, pappersData) {
  if (!pappersData) return { ...intlData, _handoff: 'pappers_failed' };
  if (!intlData) return { ...pappersData, source: 'pappers' };

  const merged = { ...intlData };

  // Pappers overwrites for deeper French data
  for (const [key, value] of Object.entries(pappersData)) {
    if (value !== null && value !== undefined && value !== '') {
      merged[key] = value;
    }
  }

  // Preserve international-only enrichment fields that Pappers doesn't have
  const intlOnlyFields = ['techStack', 'tags', 'linkedin', 'twitter', 'facebook', 'logo', 'estimatedRevenue', 'raised', 'subIndustry'];
  for (const field of intlOnlyFields) {
    if (intlData[field] && (!pappersData[field] || (Array.isArray(pappersData[field]) && pappersData[field].length === 0))) {
      merged[field] = intlData[field];
    }
  }

  merged.source = 'pappers+' + (intlData.source || 'international');
  merged._handoff = 'france_detected';

  return merged;
}

/**
 * Attempt France handoff: query Pappers with the company name from an international profile.
 * Returns merged data if France detected, otherwise returns original data unchanged.
 * @param {object} intlProfileData — the data field from international provider response
 * @param {object} options — { preview }
 * @returns {Promise<{ data: object, handoff: boolean }>}
 */
async function attemptFranceHandoff(intlProfileData, options = {}) {
  const country = extractCountryFromProfile(intlProfileData);

  if (!isFrenchCountry(country)) {
    return { data: intlProfileData, handoff: false };
  }

  // French company detected on international TLD — get deep data from Pappers
  const pappersProvider = providers['pappers'];
  if (pappersProvider && pappersProvider.isAvailable()) {
    const companyName = extractCompanyName(intlProfileData);
    if (!companyName) {
      return {
        data: { ...intlProfileData, _handoff: 'no_company_name' },
        handoff: false,
      };
    }

    try {
      // Search Pappers by company name to find the SIREN
      const searchResult = await pappersProvider.search(companyName, { count: 1 });
      const topResult = searchResult?.results?.[0];

      if (!topResult?.siren) {
        return {
          data: { ...intlProfileData, _handoff: 'pappers_no_match' },
          handoff: false,
        };
      }

      // Get full Pappers profile by SIREN
      const isPreview = options.preview || false;
      const pappersProfile = isPreview
        ? await pappersProvider.getProfile(topResult.siren, { preview: true })
        : await pappersProvider.getProfile(topResult.siren, { preview: false });

      // Check for 401 → try Annuaire Entreprises fallback
      if (pappersProfile.error && /401|unauthorized|forbidden|key/i.test(pappersProfile.error)) {
        return await attemptAnnuaireFallback(intlProfileData, companyName);
      }

      const pappersData = pappersProfile?.data;
      const merged = mergeWithPappers(intlProfileData, pappersData);
      return { data: merged, handoff: true };
    } catch {
      return await attemptAnnuaireFallback(intlProfileData, extractCompanyName(intlProfileData));
    }
  }

  // Pappers unavailable → try Annuaire Entreprises fallback
  return await attemptAnnuaireFallback(intlProfileData, extractCompanyName(intlProfileData));
}

/**
 * Attempt France handoff via Annuaire Entreprises (free fallback).
 * @param {object} intlProfileData
 * @param {string|null} companyName
 * @returns {Promise<{ data: object, handoff: boolean }>}
 */
async function attemptAnnuaireFallback(intlProfileData, companyName) {
  const annuaireProvider = providers['annuaire-entreprises'];
  if (!annuaireProvider || !companyName) {
    return {
      data: { ...intlProfileData, _handoff: companyName ? 'annuaire_unavailable' : 'no_company_name' },
      handoff: false,
    };
  }

  try {
    const searchResult = await annuaireProvider.search(companyName, { count: 1 });
    const topResult = searchResult?.results?.[0];

    if (!topResult?.siren) {
      return {
        data: { ...intlProfileData, _handoff: 'annuaire_no_match' },
        handoff: false,
      };
    }

    const annuaireProfile = await annuaireProvider.getProfile(topResult.siren, { preview: true });
    const annuaireData = annuaireProfile?.data;

    if (!annuaireData) {
      return {
        data: { ...intlProfileData, _handoff: 'annuaire_no_data' },
        handoff: false,
      };
    }

    const merged = mergeWithPappers(intlProfileData, annuaireData);
    merged.source = 'annuaire-entreprises+' + (intlProfileData.source || 'international');
    merged._handoff = 'annuaire_fallback';
    return { data: merged, handoff: true };
  } catch {
    return {
      data: { ...intlProfileData, _handoff: 'annuaire_error' },
      handoff: false,
    };
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

const providers = {};

/**
 * Register a provider by name.
 * @param {string} name — e.g. 'pappers', 'opencorporates', 'clearbit'
 * @param {object} provider — must implement { search, getProfile, getSubsidiaries, isAvailable }
 */
export function registerProvider(name, provider) {
  providers[name] = provider;
}

/**
 * Detect country code from a domain or TLD.
 * @param {string} domainOrUrl
 * @returns {string} ISO country code or 'INTL'
 */
export function detectCountry(domainOrUrl) {
  let hostname;
  try {
    hostname = new URL(domainOrUrl.startsWith('http') ? domainOrUrl : `https://${domainOrUrl}`).hostname;
  } catch {
    hostname = domainOrUrl;
  }

  // Match longest TLD first (e.g. .co.uk before .uk)
  const sorted = Object.keys(TLD_COUNTRY_MAP).sort((a, b) => b.length - a.length);
  for (const tld of sorted) {
    if (hostname.endsWith(tld)) {
      return TLD_COUNTRY_MAP[tld];
    }
  }
  return 'INTL';
}

/**
 * Get the best provider for a domain/country.
 * For France: tries Pappers first, falls back to Annuaire Entreprises (free).
 * For international: uses the INTL_FALLBACK_CHAIN.
 * @param {string} domainOrUrl
 * @returns {{ provider: object|null, providerName: string, country: string }}
 */
export function resolveProvider(domainOrUrl) {
  const country = detectCountry(domainOrUrl);

  // France: try Pappers first, fallback to Annuaire Entreprises
  if (country === 'FR') {
    for (const name of FR_FALLBACK_CHAIN) {
      const p = providers[name];
      if (p && p.isAvailable()) {
        return { provider: p, providerName: name, country };
      }
    }
    // Last resort: annuaire-entreprises is always available, but be explicit
    const fallback = providers['annuaire-entreprises'];
    return { provider: fallback || null, providerName: 'annuaire-entreprises', country };
  }

  const mapped = PROVIDER_MAP[country];
  if (mapped && providers[mapped]) {
    return { provider: providers[mapped], providerName: mapped, country };
  }

  // International: try fallback chain, pick first available
  for (const name of INTL_FALLBACK_CHAIN) {
    const p = providers[name];
    if (p && p.isAvailable()) {
      return { provider: p, providerName: name, country };
    }
  }

  // Last resort: opencorporates (always available)
  const fallback = providers['opencorporates'] || null;
  return { provider: fallback, providerName: 'opencorporates', country };
}

/**
 * High-level: search for a company across the right provider.
 * Supports SIREN/SIRET direct routing and France handoff for international TLDs.
 * @param {string} query — company name or identifier
 * @param {string} domainOrUrl — domain to determine country
 * @param {object} options — { count, preview }
 */
export async function searchCompany(query, domainOrUrl, options = {}) {
  // ── SIREN/SIRET direct routing → France (Pappers → Annuaire Entreprises fallback) ──
  if (isSirenOrSiret(query)) {
    const country = 'FR';

    // Try Pappers first (if Pro + key available)
    const pappersP = providers['pappers'];
    if (isPro() && pappersP && pappersP.isAvailable()) {
      const results = await pappersP.search(query, options);
      // Check for 401 or auth errors → fallback
      if (results.error && /401|unauthorized|forbidden|key/i.test(results.error)) {
        // Pappers 401 — fall through to Annuaire Entreprises
      } else {
        return { ...results, provider: 'pappers', country, _routing: 'siren_direct' };
      }
    }

    // Fallback: Annuaire Entreprises (free, always available)
    const annuaireP = providers['annuaire-entreprises'];
    if (annuaireP) {
      const results = await annuaireP.search(query, options);
      return {
        ...results,
        provider: 'annuaire-entreprises',
        country,
        _routing: 'siren_direct_fallback',
        _fallbackNote: 'Pappers non disponible, données issues de l\'Annuaire Entreprises (data.gouv.fr)',
      };
    }

    // Neither provider available
    if (!isPro()) {
      return {
        results: [],
        provider: 'pappers',
        country,
        error: `Business Data (pappers) requires an Intelwatch Pro license. Annuaire Entreprises fallback not registered.`,
        licenseRequired: true,
      };
    }

    return {
      results: [],
      provider: 'pappers',
      country,
      error: `No France provider available. Pappers API key not configured and Annuaire Entreprises not registered.`,
    };
  }

  const { provider, providerName, country } = resolveProvider(domainOrUrl);

  // License gate: enrichment providers are Pro-only
  if (PRO_ONLY_PROVIDERS.has(providerName) && !isPro()) {
    return {
      results: [],
      provider: providerName,
      country,
      error: `Business Data (${providerName}) requires an Intelwatch Pro license.`,
      licenseRequired: true,
    };
  }

  if (!provider) {
    return {
      results: [],
      provider: providerName,
      country,
      error: `No provider configured for ${providerName}. Set up ${providerName} credentials.`,
    };
  }

  if (!provider.isAvailable()) {
    return {
      results: [],
      provider: providerName,
      country,
      error: `${providerName} API key not configured.`,
    };
  }

  const results = await provider.search(query, options);
  return { ...results, provider: providerName, country };
}

/**
 * High-level: get a company profile (license-gated).
 * Supports SIREN/SIRET direct routing and France handoff for international TLDs.
 * @param {string} identifier — SIREN, domain, company number, etc.
 * @param {string} domainOrUrl — domain to determine country
 * @param {object} options — { preview }
 */
export async function getCompanyProfile(identifier, domainOrUrl, options = {}) {
  // ── SIREN/SIRET direct routing → France (Pappers → Annuaire Entreprises fallback) ──
  if (isSirenOrSiret(identifier)) {
    const country = 'FR';
    const tier = isPro() ? 'pro' : 'free';
    const isPreview = options.preview || !isPro();

    // Try Pappers first (if Pro + key available)
    const pappersP = providers['pappers'];
    if (isPro() && pappersP && pappersP.isAvailable()) {
      const profile = await pappersP.getProfile(identifier, { ...options, preview: isPreview });
      // Check for 401 or auth errors → fallback
      if (profile.error && /401|unauthorized|forbidden|key/i.test(profile.error)) {
        // Pappers 401 — fall through to Annuaire Entreprises
      } else {
        return {
          ...profile,
          provider: 'pappers',
          country,
          tier,
          isPreview,
          _routing: 'siren_direct',
        };
      }
    }

    // Fallback: Annuaire Entreprises (free, no license required)
    const annuaireP = providers['annuaire-entreprises'];
    if (annuaireP) {
      const profile = await annuaireP.getProfile(identifier, { ...options, preview: true });
      return {
        ...profile,
        provider: 'annuaire-entreprises',
        country,
        tier: 'free',
        isPreview: true,
        _routing: 'siren_direct_fallback',
        _fallbackNote: profile.data?._fallbackNote || 'Pappers non disponible, profil issu de l\'Annuaire Entreprises (data.gouv.fr). Données financières limitées (CA, résultat net). UBO, BODACC et mandats croisés non disponibles.',
      };
    }

    // Neither provider available
    if (!isPro()) {
      return {
        data: null,
        provider: 'pappers',
        country,
        tier,
        isPreview: true,
        error: `Business Data (pappers) requires an Intelwatch Pro license. Annuaire Entreprises fallback not registered.`,
        licenseRequired: true,
      };
    }

    return {
      data: null,
      provider: 'pappers',
      country,
      tier,
      isPreview,
      error: `No France provider available. Pappers API key not configured and Annuaire Entreprises not registered.`,
    };
  }

  const { provider, providerName, country } = resolveProvider(domainOrUrl);

  const tier = isPro() ? 'pro' : 'free';
  const isPreview = options.preview || !isPro();

  // License gate: enrichment providers are Pro-only
  if (PRO_ONLY_PROVIDERS.has(providerName) && !isPro()) {
    return {
      data: null,
      provider: providerName,
      country,
      tier,
      isPreview: true,
      error: `Business Data (${providerName}) requires an Intelwatch Pro license.`,
      licenseRequired: true,
    };
  }

  if (!provider) {
    return {
      data: null,
      provider: providerName,
      country,
      tier,
      isPreview,
      error: `No provider configured for ${providerName}.`,
    };
  }

  if (!provider.isAvailable()) {
    return {
      data: null,
      provider: providerName,
      country,
      tier,
      isPreview,
      error: `${providerName} API key not configured.`,
    };
  }

  // Get profile from international provider
  const profile = await provider.getProfile(identifier, { ...options, preview: isPreview });

  // ── France Handoff: if international provider detects France, enrich with Pappers ──
  if (profile?.data && country !== 'FR') {
    const { data: enrichedData, handoff } = await attemptFranceHandoff(profile.data, { preview: isPreview });
    if (handoff) {
      return {
        ...profile,
        data: enrichedData,
        provider: 'pappers+' + providerName,
        country: 'FR',
        tier,
        isPreview,
        _routing: 'france_handoff',
      };
    }
    // Even if handoff failed, annotate data with the reason (pappers_unavailable, etc.)
    if (enrichedData?._handoff) {
      return {
        ...profile,
        data: enrichedData,
        provider: providerName,
        country,
        tier,
        isPreview,
      };
    }
  }

  return {
    ...profile,
    provider: providerName,
    country,
    tier,
    isPreview,
  };
}

/**
 * High-level: get subsidiaries (Pro only).
 */
export async function getSubsidiaries(parentName, parentId, domainOrUrl, options = {}) {
  requirePro('Subsidiary analysis');
  const { provider, providerName, country } = resolveProvider(domainOrUrl);

  if (!provider?.getSubsidiaries) {
    return { subsidiaries: [], provider: providerName, country, error: `${providerName} does not support subsidiary lookup.` };
  }

  return { ...(await provider.getSubsidiaries(parentName, parentId, options)), provider: providerName, country };
}

/**
 * High-level: quick lookup for competitor tracker (company name → basic info).
 */
export async function lookupCompany(companyName, domainOrUrl) {
  const { provider, providerName, country } = resolveProvider(domainOrUrl);

  if (!provider?.lookup) {
    return null;
  }

  if (!provider.isAvailable()) return null;

  try {
    return await provider.lookup(companyName);
  } catch {
    return null;
  }
}

/**
 * List all registered providers and their status.
 */
export function listProviders() {
  return Object.entries(providers).map(([name, p]) => ({
    name,
    available: p.isAvailable(),
    countries: Object.entries(PROVIDER_MAP)
      .filter(([, pName]) => pName === name)
      .map(([country]) => country),
  }));
}
