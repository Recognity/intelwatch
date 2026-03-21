# CHANGELOG-DRAFT — intelwatch v1.3.0

## ✨ New Features

### International Provider Architecture (`src/providers/`)
- **Provider Registry** (`registry.js`) — adapts company data source based on domain TLD
  - `.fr` → Pappers (full French company data)
  - `.com`, `.de`, `.uk`, etc. → OpenCorporates (180+ jurisdictions)
  - Clearbit available as BYOK enrichment layer (domain → sector, size, revenue, tech)
- **Auto-detection** : `detectCountry()` maps TLD to ISO country code, `resolveProvider()` picks the best provider
- **Unified API** : `searchCompany()`, `getCompanyProfile()`, `getSubsidiaries()`, `lookupCompany()` — same interface, any provider
- **License-integrated** : full profile = Pro only, subsidiaries = Pro only, preview mode for Free tier
- **Pappers provider** (`pappers.js`) — thin adapter wrapping existing `scrapers/pappers.js`
- **OpenCorporates provider** (`opencorporates.js`) — real API integration with free tier (500 req/month, no key needed) + BYOK for higher limits
- **Clearbit provider** (`clearbit.js`) — scaffold with real API integration (BYOK: `CLEARBIT_API_KEY`)
- Competitor tracker refactored: uses `lookupCompany()` instead of direct Pappers import → works for any TLD
- Backward compat: `pappers` key still present in competitor snapshots for existing data

### Freemium License Gate
- **Centralized `src/license.js`** — single module for all Pro/Free tier logic
- License detection: `INTELWATCH_PRO_KEY` env → `INTELWATCH_LICENSE_KEY` env → `~/.intelwatch-license` file
- **Free tier:** JSON + CSV (50 rows), Reddit/HN (5 results), Pappers preview only
- **Pro tier:** JSON + CSV + XLS + PDF (unlimited), Reddit/HN (100), full profiles + subsidiaries

### Export System (CSV, XLS, PDF)
- `handleExport()` with license-aware gating — XLS/PDF throw `LICENSE_REQUIRED`
- CSV capped at 50 rows on Free tier with warning

### Reddit & Hacker News Mentions
- `src/scrapers/reddit-hn.js` — Reddit JSON API + HN Algolia API
- Results capped per license tier (Free: 5, Pro: 100)
- Brand tracker fetches Google News + Reddit + HN in parallel

## 🐛 Bug Fixes
- `handleError()` crash on null/undefined — graceful handling added
- Provider registry returns `tier`/`isPreview` even when provider unavailable

## 🧪 Tests — 136 pass, 0 fail (was 40)
- `test/providers.test.js` — 31 tests: detectCountry (11 TLDs), resolveProvider (5), listProviders (3), interface compliance (3), searchCompany (3), getCompanyProfile (2), getSubsidiaries license gate (1), individual provider availability (3)
- `test/license.test.js` — 19 tests
- `test/export.test.js` — 33 tests (incl. LICENSE_REQUIRED gates)
- `test/i18n.test.js` — 6 tests
- `test/error-handler.test.js` — 5 tests
- `test/reddit-hn.test.js` — 4 tests
