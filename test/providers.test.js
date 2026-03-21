import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { _resetCache } from '../src/license.js';

import {
  detectCountry,
  resolveProvider,
  registerProvider,
  listProviders,
  searchCompany,
  getCompanyProfile,
  getSubsidiaries,
  isSirenOrSiret,
  isFrenchCountry,
  mergeWithPappers,
} from '../src/providers/registry.js';

// Register providers
import pappersProvider from '../src/providers/pappers.js';
import opencorporatesProvider from '../src/providers/opencorporates.js';
import clearbitProvider from '../src/providers/clearbit.js';
import apolloProvider from '../src/providers/apollo.js';

registerProvider('pappers', pappersProvider);
registerProvider('opencorporates', opencorporatesProvider);
registerProvider('clearbit', clearbitProvider);
registerProvider('apollo', apolloProvider);

describe('Provider Registry', () => {
  afterEach(() => {
    delete process.env.INTELWATCH_PRO_KEY;
    _resetCache();
  });

  // ── detectCountry ────────────────────────────────────────────────────────

  describe('detectCountry', () => {
    test('.fr → FR', () => {
      assert.equal(detectCountry('https://www.example.fr'), 'FR');
    });

    test('.fr without protocol', () => {
      assert.equal(detectCountry('example.fr'), 'FR');
    });

    test('.co.uk → GB', () => {
      assert.equal(detectCountry('https://company.co.uk'), 'GB');
    });

    test('.uk → GB', () => {
      assert.equal(detectCountry('https://company.uk'), 'GB');
    });

    test('.de → DE', () => {
      assert.equal(detectCountry('https://firma.de'), 'DE');
    });

    test('.com → INTL', () => {
      assert.equal(detectCountry('https://company.com'), 'INTL');
    });

    test('.io → INTL', () => {
      assert.equal(detectCountry('https://startup.io'), 'INTL');
    });

    test('.us → US', () => {
      assert.equal(detectCountry('https://company.us'), 'US');
    });

    test('.jp → JP', () => {
      assert.equal(detectCountry('https://company.jp'), 'JP');
    });

    test('unknown TLD → INTL', () => {
      assert.equal(detectCountry('https://company.xyz'), 'INTL');
    });

    test('.co.uk takes precedence over .uk', () => {
      // Both .co.uk and .uk map to GB, but .co.uk should match first
      assert.equal(detectCountry('https://example.co.uk'), 'GB');
    });
  });

  // ── resolveProvider ──────────────────────────────────────────────────────

  describe('resolveProvider', () => {
    test('.fr → pappers', () => {
      const { providerName, country } = resolveProvider('https://recognity.fr');
      assert.equal(providerName, 'pappers');
      assert.equal(country, 'FR');
    });

    test('.com → opencorporates fallback (no Apollo/Clearbit keys)', () => {
      delete process.env.APOLLO_API_KEY;
      delete process.env.CLEARBIT_API_KEY;
      const { providerName, country } = resolveProvider('https://stripe.com');
      assert.equal(providerName, 'opencorporates');
      assert.equal(country, 'INTL');
    });

    test('.com → apollo when APOLLO_API_KEY is set', () => {
      process.env.APOLLO_API_KEY = 'test-apollo-key';
      const { providerName, country } = resolveProvider('https://stripe.com');
      assert.equal(providerName, 'apollo');
      assert.equal(country, 'INTL');
      delete process.env.APOLLO_API_KEY;
    });

    test('.com → clearbit when CLEARBIT_API_KEY set (no Apollo)', () => {
      delete process.env.APOLLO_API_KEY;
      process.env.CLEARBIT_API_KEY = 'test-clearbit-key';
      const { providerName, country } = resolveProvider('https://stripe.com');
      assert.equal(providerName, 'clearbit');
      assert.equal(country, 'INTL');
      delete process.env.CLEARBIT_API_KEY;
    });

    test('.de → opencorporates fallback (no DE-specific provider)', () => {
      delete process.env.APOLLO_API_KEY;
      delete process.env.CLEARBIT_API_KEY;
      const { providerName, country } = resolveProvider('https://siemens.de');
      assert.equal(providerName, 'opencorporates');
      assert.equal(country, 'DE');
    });

    test('.co.uk → opencorporates fallback', () => {
      delete process.env.APOLLO_API_KEY;
      delete process.env.CLEARBIT_API_KEY;
      const { providerName } = resolveProvider('https://company.co.uk');
      assert.equal(providerName, 'opencorporates');
    });

    test('resolved provider object exists', () => {
      const { provider } = resolveProvider('https://example.fr');
      assert.ok(provider);
      assert.equal(typeof provider.search, 'function');
      assert.equal(typeof provider.getProfile, 'function');
      assert.equal(typeof provider.isAvailable, 'function');
    });
  });

  // ── listProviders ────────────────────────────────────────────────────────

  describe('listProviders', () => {
    test('returns all registered providers', () => {
      const list = listProviders();
      assert.ok(list.length >= 4);
      const names = list.map(p => p.name);
      assert.ok(names.includes('pappers'));
      assert.ok(names.includes('opencorporates'));
      assert.ok(names.includes('clearbit'));
      assert.ok(names.includes('apollo'));
    });

    test('each provider has availability status', () => {
      const list = listProviders();
      for (const p of list) {
        assert.equal(typeof p.available, 'boolean');
        assert.ok(Array.isArray(p.countries));
      }
    });

    test('pappers is mapped to FR', () => {
      const pappers = listProviders().find(p => p.name === 'pappers');
      assert.ok(pappers.countries.includes('FR'));
    });
  });

  // ── Provider interface ───────────────────────────────────────────────────

  describe('Provider interface compliance', () => {
    const providers = [pappersProvider, opencorporatesProvider, clearbitProvider, apolloProvider];

    for (const provider of providers) {
      test(`${provider.name} has required methods`, () => {
        assert.equal(typeof provider.isAvailable, 'function');
        assert.equal(typeof provider.search, 'function');
        assert.equal(typeof provider.getProfile, 'function');
        assert.equal(typeof provider.name, 'string');
      });
    }
  });

  // ── searchCompany ────────────────────────────────────────────────────────

  describe('searchCompany', () => {
    test('returns license required without Pro for .fr', async () => {
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      const result = await searchCompany('Test Company', 'https://test.fr');
      assert.equal(result.provider, 'pappers');
      assert.equal(result.country, 'FR');
      assert.equal(result.licenseRequired, true);
    });

    test('uses opencorporates for .com (fallback, no Apollo/Clearbit keys)', async () => {
      delete process.env.APOLLO_API_KEY;
      delete process.env.CLEARBIT_API_KEY;
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      const result = await searchCompany('Stripe', 'https://stripe.com');
      assert.equal(result.provider, 'opencorporates');
      assert.equal(result.country, 'INTL');
    });

    test('returns license error for .fr without Pro', async () => {
      delete process.env.PAPPERS_API_KEY;
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      const result = await searchCompany('Test', 'https://test.fr');
      assert.ok(result.provider === 'pappers');
      assert.ok(result.licenseRequired === true, 'Should require license for Pappers');
    });

    test('returns provider name and country for .fr with Pro', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      _resetCache();
      const result = await searchCompany('Test Company', 'https://test.fr');
      assert.equal(result.provider, 'pappers');
      assert.equal(result.country, 'FR');
    });
  });

  // ── getCompanyProfile ────────────────────────────────────────────────────

  describe('getCompanyProfile', () => {
    test('returns licenseRequired without Pro for enrichment providers', async () => {
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      const result = await getCompanyProfile('123456789', 'https://company.fr');
      assert.equal(result.tier, 'free');
      assert.equal(result.isPreview, true);
      assert.equal(result.licenseRequired, true);
    });

    test('allows full profile with Pro license', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      _resetCache();
      const result = await getCompanyProfile('123456789', 'https://company.fr');
      assert.equal(result.tier, 'pro');
      assert.equal(result.isPreview, false);
    });
  });

  // ── getSubsidiaries ──────────────────────────────────────────────────────

  describe('getSubsidiaries', () => {
    test('throws LICENSE_REQUIRED without Pro', async () => {
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      await assert.rejects(
        () => getSubsidiaries('Parent', '123', 'https://parent.fr'),
        (err) => {
          assert.equal(err.code, 'LICENSE_REQUIRED');
          return true;
        }
      );
    });
  });
});

describe('Individual Providers', () => {
  describe('Pappers', () => {
    test('isAvailable depends on PAPPERS_API_KEY', () => {
      delete process.env.PAPPERS_API_KEY;
      assert.equal(pappersProvider.isAvailable(), false);
      process.env.PAPPERS_API_KEY = 'test';
      assert.equal(pappersProvider.isAvailable(), true);
      delete process.env.PAPPERS_API_KEY;
    });
  });

  describe('OpenCorporates', () => {
    test('always available (free tier)', () => {
      assert.equal(opencorporatesProvider.isAvailable(), true);
    });
  });

  describe('Clearbit', () => {
    test('isAvailable depends on CLEARBIT_API_KEY', () => {
      delete process.env.CLEARBIT_API_KEY;
      assert.equal(clearbitProvider.isAvailable(), false);
      process.env.CLEARBIT_API_KEY = 'test';
      assert.equal(clearbitProvider.isAvailable(), true);
      delete process.env.CLEARBIT_API_KEY;
    });
  });

  describe('Apollo', () => {
    test('isAvailable depends on APOLLO_API_KEY', () => {
      delete process.env.APOLLO_API_KEY;
      assert.equal(apolloProvider.isAvailable(), false);
      process.env.APOLLO_API_KEY = 'test';
      assert.equal(apolloProvider.isAvailable(), true);
      delete process.env.APOLLO_API_KEY;
    });

    test('has required provider interface', () => {
      assert.equal(typeof apolloProvider.search, 'function');
      assert.equal(typeof apolloProvider.getProfile, 'function');
      assert.equal(typeof apolloProvider.getSubsidiaries, 'function');
      assert.equal(typeof apolloProvider.lookup, 'function');
      assert.equal(apolloProvider.name, 'apollo');
      assert.equal(apolloProvider.country, 'INTL');
    });

    test('search returns error without API key', async () => {
      delete process.env.APOLLO_API_KEY;
      const result = await apolloProvider.search('Test');
      assert.ok(result.error);
      assert.equal(result.results.length, 0);
    });

    test('getProfile returns error without API key', async () => {
      delete process.env.APOLLO_API_KEY;
      const result = await apolloProvider.getProfile('stripe.com');
      assert.ok(result.error);
      assert.equal(result.data, null);
    });

    test('getSubsidiaries returns empty', async () => {
      const result = await apolloProvider.getSubsidiaries();
      assert.deepEqual(result.subsidiaries, []);
    });

    test('lookup returns null without API key', async () => {
      delete process.env.APOLLO_API_KEY;
      const result = await apolloProvider.lookup('stripe.com');
      assert.equal(result, null);
    });
  });
});

// ── Smart Routing: SIREN/SIRET + France Handoff ────────────────────────────

describe('Smart Routing', () => {

  // ── isSirenOrSiret ─────────────────────────────────────────────────────

  describe('isSirenOrSiret', () => {
    test('9 digits = SIREN', () => {
      assert.equal(isSirenOrSiret('123456789'), true);
    });

    test('14 digits = SIRET', () => {
      assert.equal(isSirenOrSiret('12345678901234'), true);
    });

    test('10 digits = invalid (not SIREN nor SIRET)', () => {
      assert.equal(isSirenOrSiret('1234567890'), false);
    });

    test('8 digits = too short', () => {
      assert.equal(isSirenOrSiret('12345678'), false);
    });

    test('15 digits = too long', () => {
      assert.equal(isSirenOrSiret('123456789012345'), false);
    });

    test('with letters = not SIREN', () => {
      assert.equal(isSirenOrSiret('12345678A'), false);
    });

    test('empty string', () => {
      assert.equal(isSirenOrSiret(''), false);
    });

    test('null/undefined', () => {
      assert.equal(isSirenOrSiret(null), false);
      assert.equal(isSirenOrSiret(undefined), false);
    });

    test('whitespace-padded SIREN', () => {
      assert.equal(isSirenOrSiret('  123456789  '), true);
    });
  });

  // ── isFrenchCountry ────────────────────────────────────────────────────

  describe('isFrenchCountry', () => {
    test('"France" → true', () => {
      assert.equal(isFrenchCountry('France'), true);
    });

    test('"FR" → true', () => {
      assert.equal(isFrenchCountry('FR'), true);
    });

    test('"fr" → true', () => {
      assert.equal(isFrenchCountry('fr'), true);
    });

    test('"France (Metropolitan)" → true', () => {
      assert.equal(isFrenchCountry('France (Metropolitan)'), true);
    });

    test('"Germany" → false', () => {
      assert.equal(isFrenchCountry('Germany'), false);
    });

    test('"United States" → false', () => {
      assert.equal(isFrenchCountry('United States'), false);
    });

    test('null → false', () => {
      assert.equal(isFrenchCountry(null), false);
    });

    test('empty string → false', () => {
      assert.equal(isFrenchCountry(''), false);
    });
  });

  // ── mergeWithPappers ───────────────────────────────────────────────────

  describe('mergeWithPappers', () => {
    test('Pappers overwrites intl fields', () => {
      const intl = { name: 'Vadato', sector: 'Tech', source: 'apollo', techStack: ['React'] };
      const pappers = { name: 'VADATO SAS', siren: '123456789', sector: 'Développement web' };
      const merged = mergeWithPappers(intl, pappers);

      assert.equal(merged.name, 'VADATO SAS');
      assert.equal(merged.siren, '123456789');
      assert.equal(merged.sector, 'Développement web');
    });

    test('preserves intl-only fields (techStack, linkedin)', () => {
      const intl = { name: 'Vadato', techStack: ['React', 'Node'], linkedin: 'https://linkedin.com/vadato', source: 'apollo' };
      const pappers = { name: 'VADATO SAS', siren: '123456789' };
      const merged = mergeWithPappers(intl, pappers);

      assert.deepEqual(merged.techStack, ['React', 'Node']);
      assert.equal(merged.linkedin, 'https://linkedin.com/vadato');
    });

    test('source = pappers+apollo', () => {
      const intl = { name: 'Test', source: 'apollo' };
      const pappers = { name: 'TEST SAS' };
      const merged = mergeWithPappers(intl, pappers);

      assert.equal(merged.source, 'pappers+apollo');
      assert.equal(merged._handoff, 'france_detected');
    });

    test('null pappersData → returns intl with _handoff flag', () => {
      const intl = { name: 'Test', source: 'apollo' };
      const merged = mergeWithPappers(intl, null);

      assert.equal(merged.name, 'Test');
      assert.equal(merged._handoff, 'pappers_failed');
    });

    test('null intlData → returns pappers data', () => {
      const pappers = { name: 'TEST SAS', siren: '123456789' };
      const merged = mergeWithPappers(null, pappers);

      assert.equal(merged.name, 'TEST SAS');
      assert.equal(merged.source, 'pappers');
    });
  });

  // ── SIREN/SIRET Direct Routing (searchCompany) ────────────────────────

  describe('SIREN/SIRET Direct Routing', () => {
    afterEach(() => {
      delete process.env.INTELWATCH_PRO_KEY;
      delete process.env.PAPPERS_API_KEY;
      _resetCache();
    });

    test('SIREN query routes to pappers regardless of domain', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.PAPPERS_API_KEY = 'test';
      _resetCache();
      // Even with a .com domain, SIREN should route to pappers
      const result = await searchCompany('123456789', 'https://vadato.io');
      assert.equal(result.provider, 'pappers');
      assert.equal(result.country, 'FR');
      assert.equal(result._routing, 'siren_direct');
    });

    test('SIRET query routes to pappers', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.PAPPERS_API_KEY = 'test';
      _resetCache();
      const result = await searchCompany('12345678901234', 'https://startup.io');
      assert.equal(result.provider, 'pappers');
      assert.equal(result._routing, 'siren_direct');
    });

    test('SIREN without Pro license → licenseRequired', async () => {
      delete process.env.INTELWATCH_PRO_KEY;
      _resetCache();
      const result = await searchCompany('123456789', 'https://whatever.com');
      assert.equal(result.provider, 'pappers');
      assert.equal(result.licenseRequired, true);
    });

    test('SIREN with Pro but no PAPPERS_API_KEY → API key error', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      delete process.env.PAPPERS_API_KEY;
      _resetCache();
      const result = await searchCompany('123456789', 'https://whatever.com');
      assert.equal(result.provider, 'pappers');
      assert.ok(result.error);
      assert.ok(result.error.includes('not configured'));
    });

    test('getCompanyProfile with SIREN → pappers direct', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.PAPPERS_API_KEY = 'test';
      _resetCache();
      const result = await getCompanyProfile('123456789', 'https://something.io');
      assert.equal(result.provider, 'pappers');
      assert.equal(result.country, 'FR');
      assert.equal(result._routing, 'siren_direct');
    });
  });

  // ── France Handoff (mock Apollo → Pappers) ─────────────────────────────

  describe('France Handoff', () => {
    // Store originals to restore
    let originalApolloGetProfile;
    let originalPappersSearch;
    let originalPappersGetProfile;

    afterEach(() => {
      delete process.env.INTELWATCH_PRO_KEY;
      delete process.env.APOLLO_API_KEY;
      delete process.env.PAPPERS_API_KEY;
      _resetCache();
      // Restore original methods
      if (originalApolloGetProfile) apolloProvider.getProfile = originalApolloGetProfile;
      if (originalPappersSearch) pappersProvider.search = originalPappersSearch;
      if (originalPappersGetProfile) pappersProvider.getProfile = originalPappersGetProfile;
    });

    test('Apollo profile with country=France triggers Pappers handoff', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.APOLLO_API_KEY = 'test-apollo';
      process.env.PAPPERS_API_KEY = 'test-pappers';
      _resetCache();

      // Mock Apollo getProfile → returns French company
      originalApolloGetProfile = apolloProvider.getProfile;
      apolloProvider.getProfile = async () => ({
        data: {
          name: 'Vadato',
          domain: 'vadato.io',
          sector: 'Technology',
          country: 'France',
          location: 'Paris, Île-de-France, France',
          techStack: ['React', 'Node.js'],
          linkedin: 'https://linkedin.com/company/vadato',
          source: 'apollo',
        },
        error: null,
      });

      // Mock Pappers search → finds SIREN
      originalPappersSearch = pappersProvider.search;
      pappersProvider.search = async () => ({
        results: [{ name: 'VADATO SAS', siren: '987654321' }],
        error: null,
      });

      // Mock Pappers getProfile → returns deep French data
      originalPappersGetProfile = pappersProvider.getProfile;
      pappersProvider.getProfile = async () => ({
        data: {
          name: 'VADATO SAS',
          siren: '987654321',
          sector: 'Activités de programmation informatique',
          ca: '150000',
          bodacc: [{ type: 'Création', date: '2020-01-15' }],
          source: 'pappers',
        },
        error: null,
      });

      const result = await getCompanyProfile('vadato.io', 'https://vadato.io');

      // Should be merged: pappers+apollo
      assert.equal(result._routing, 'france_handoff');
      assert.equal(result.provider, 'pappers+apollo');
      assert.equal(result.country, 'FR');
      assert.equal(result.data.siren, '987654321');
      assert.equal(result.data.name, 'VADATO SAS'); // Pappers overwrites
      assert.deepEqual(result.data.techStack, ['React', 'Node.js']); // Intl preserved
      assert.equal(result.data.linkedin, 'https://linkedin.com/company/vadato'); // Intl preserved
      assert.equal(result.data._handoff, 'france_detected');
    });

    test('Apollo profile with country=US → no handoff', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.APOLLO_API_KEY = 'test-apollo';
      _resetCache();

      originalApolloGetProfile = apolloProvider.getProfile;
      apolloProvider.getProfile = async () => ({
        data: {
          name: 'Stripe',
          domain: 'stripe.com',
          country: 'United States',
          source: 'apollo',
        },
        error: null,
      });

      const result = await getCompanyProfile('stripe.com', 'https://stripe.com');

      assert.equal(result.provider, 'apollo');
      assert.equal(result.country, 'INTL');
      assert.ok(!result._routing); // No handoff
      assert.equal(result.data.name, 'Stripe');
    });

    test('Apollo profile with country=FR triggers handoff', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.APOLLO_API_KEY = 'test-apollo';
      process.env.PAPPERS_API_KEY = 'test-pappers';
      _resetCache();

      originalApolloGetProfile = apolloProvider.getProfile;
      apolloProvider.getProfile = async () => ({
        data: {
          name: 'Doctolib',
          country: 'FR',
          source: 'apollo',
        },
        error: null,
      });

      originalPappersSearch = pappersProvider.search;
      pappersProvider.search = async () => ({
        results: [{ name: 'DOCTOLIB SAS', siren: '111222333' }],
        error: null,
      });

      originalPappersGetProfile = pappersProvider.getProfile;
      pappersProvider.getProfile = async () => ({
        data: {
          name: 'DOCTOLIB SAS',
          siren: '111222333',
          ca: '500000000',
          source: 'pappers',
        },
        error: null,
      });

      const result = await getCompanyProfile('doctolib.com', 'https://doctolib.com');

      assert.equal(result._routing, 'france_handoff');
      assert.equal(result.data.siren, '111222333');
      assert.equal(result.data.ca, '500000000');
    });

    test('Handoff graceful when Pappers search returns no match', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.APOLLO_API_KEY = 'test-apollo';
      process.env.PAPPERS_API_KEY = 'test-pappers';
      _resetCache();

      originalApolloGetProfile = apolloProvider.getProfile;
      apolloProvider.getProfile = async () => ({
        data: {
          name: 'SomeStartup',
          country: 'France',
          source: 'apollo',
        },
        error: null,
      });

      originalPappersSearch = pappersProvider.search;
      pappersProvider.search = async () => ({
        results: [],
        error: null,
      });

      const result = await getCompanyProfile('somestartup.io', 'https://somestartup.io');

      // Should NOT crash — graceful degradation
      assert.ok(!result._routing); // No handoff since Pappers couldn't find it
      assert.equal(result.data.name, 'SomeStartup');
      assert.equal(result.data._handoff, 'pappers_no_match');
    });

    test('Handoff graceful when Pappers is unavailable', async () => {
      process.env.INTELWATCH_PRO_KEY = 'test';
      process.env.APOLLO_API_KEY = 'test-apollo';
      delete process.env.PAPPERS_API_KEY; // Pappers not configured
      _resetCache();

      originalApolloGetProfile = apolloProvider.getProfile;
      apolloProvider.getProfile = async () => ({
        data: {
          name: 'FrenchStartup',
          country: 'France',
          source: 'apollo',
        },
        error: null,
      });

      const result = await getCompanyProfile('frenchstartup.io', 'https://frenchstartup.io');

      // Should return Apollo data with handoff flag
      assert.ok(!result._routing);
      assert.equal(result.data.name, 'FrenchStartup');
      assert.equal(result.data._handoff, 'pappers_unavailable');
    });
  });
});
