## [1.7.2] - 2026-05-15

### Added — Stack OSINT subtile (priorité différenciation vs Sinequa)

- **JudiLibre** (`src/scrapers/judilibre.js`) — décisions de justice anonymisées (Cour de cassation + cours d'appel + TJ) via l'API PISTE de la Cour de cassation. Recherche multi-canal raison sociale + dirigeants, dédup par id, tri date desc. Section dédiée dans le PDF de DD. Auth : `KeyId` simple (clé PISTE freemium après inscription). Env : `JUDILIBRE_KEY_ID`.
- **INPI marques + brevets** (`src/scrapers/inpi.js`) — recherche `data.inpi.fr` par SIREN du titulaire. Marques avec classes Nice, brevets avec n° publication. Auth : JWT login/password (cache 1h intra-session). Env : `INPI_USERNAME`, `INPI_PASSWORD`.
- **Pipeline profile** — JudiLibre + INPI fetchés en parallèle de la découverte concurrents, non-bloquants si keys absentes. PDF expose `c.judilibre.decisions` et `c.inpi.{marques,brevets}` rendues comme tableaux dédiés dans `intel-report.js` (shared-pdf).
- **6 nouveaux tests** (`test/judilibre-inpi.test.js`) sur la dégradation gracieuse sans clés. 254 tests passent.
- **`~/.intelwatch/.env`** : entrées BYOK documentées + commentées pour `JUDILIBRE_KEY_ID` et `INPI_USERNAME/PASSWORD`.

### Doc

- README mis à jour avec les 5 sources OSINT FR (Pappers, Exa, Brave, JudiLibre, INPI) et les paths d'inscription pour chaque BYOK.

## [1.7.1] - 2026-05-15

### Fixed
- **Bug #1 — Group Structure shows wrong CA/capital (holdings)**: la card *Company Identity / Activity* utilisait `identity.capital` et `financialHistory[0].ca` (entité mère seule) au lieu du consolidé. Désormais `consolidatedFinances[0].ca` et `consolidatedFinances[0].capitauxPropres` sont utilisés en priorité, avec fallback automatique sur l'entité quand aucun consolidé n'existe (PME pure). Vérifié sur NOVARES GROUP (814811592) → 1.12 Md€ consolidé, et sur SPAG (321591067, PME) → fallback OK.
- **Bug #2 — Press search retourne 0 résultats**: ajout de Brave Search comme 3e provider en parallèle (Exa + Brave + SearxNG). Cascade non-bloquante : un provider qui échoue ne casse plus la collecte. Chargement automatique de `~/.intelwatch/.env` au démarrage (sans ça, les clés sauvegardées par `intelwatch setup` ne sont jamais lues). Vérifié NOVARES → 20 Exa + 16 Brave = 36 mentions.
- **Bug #3 — M&A timeline n'a que 1-2 entries**: `buildMaHistoryFromCode` ingère désormais BODACC (capital_increase chronologiques avec dédup, dénomination changes, distress signals) en plus des articles scrappés et des filiales off-brand. NOVARES passe de 1 à 10 entries M&A déterministes.
- **Bug #4 — Competitors section liste la cible elle-même**: l'IA hallucinait parfois la cible dans `aiCompetitors`. Ajout d'un filtre strict SIREN + nom, et d'un fallback automatique sur `competitorCandidates.registry` (Pappers /recherche par NAF + fourchette CA) quand l'IA renvoie moins de 5 concurrents. La découverte de candidats est désormais TOUJOURS lancée (plus seulement sous `--ai`).

### Added
- **Brave Search provider** (`src/scrapers/brave-search.js`) — BYOK freemium 2000 req/mo, fallback presse fiable quand SearxNG public est down.
- **`~/.intelwatch/.env` autoloader** dans `bin/intelwatch.js` — clés sauvegardées par `setup` désormais lues à chaque run, shell env vars override toujours.
- **3 fichiers de tests E2E** : `brave-search.test.js`, `profile-pdf-data.test.js`, `profile-ma-history.test.js` (12 nouveaux tests, 248 total).
- **README — section "Press & Web search providers"** : 3 paths documentés (Exa BYOK / Brave BYOK / SearXNG self-host), avec snippet Docker pour self-host Vulcain.

### Internal
- `buildPdfData` accepte maintenant un nouveau paramètre `competitorCandidates` pour permettre la fallback registry.
- `buildMaHistoryFromCode` accepte un 3e paramètre optionnel `bodacc` (backward compatible).
- Découverte concurrents extraite du bloc `--ai`, exécutée en mode best-effort dès le profil complet.

## [1.3.2] - 2026-03-21
### Added
- **Google Gemini Provider**: Full support for Gemini models via Google API (`GEMINI_API_KEY` or `GOOGLE_API_KEY`) for Due Diligence AI analysis

### Fixed
- **BODACC Limit**: Reduced BODACC publication injection from 50 to 5 entries for AI context to drastically reduce token usage and prevent truncation
- **M&A Output**: Reduced AI verbosity on health scores by enforcing strict bullet points constraints
- **MaxTokens Override**: Removed hardcoded `maxTokens=1000` default and bumped to `8192` to allow full M&A history to generate without arbitrary cutoff
- **Group Structure Render**: Fixed logic that accidentally injected Private Equity shareholders (like BPIFrance) into the subsidiaries array

# CHANGELOG - v1.2 Draft

## Version 1.2.0 (en développement)

### 🐛 Bug Fixes
- **[✅ DONE]** Fix forces/faiblesses vides en terminal - problème de parsing JSON de la réponse AI
  - Amélioration de la fonction `extractAIJSON` avec validation et conversion automatique
  - Ajout de debug mode avec `DEBUG_AI=1` pour diagnostiquer les réponses AI
  - Gestion des formats string/object pour strengths/weaknesses
- **[✅ DONE]** Robustesse du scraping (timeouts, retries, user-agent rotation)
  - Module `fetcher.js` déjà implémenté avec retry et backoff exponential
- **[✅ DONE]** Meilleur error handling (messages clairs, pas de stack traces en prod)
  - Nouveau module `error-handler.js` avec gestion globale des erreurs
  - Messages user-friendly en production, stack traces seulement en debug
  - Gestion spécialisée des erreurs réseau, HTTP, FS, AI API

### ✨ New Features
- **[✅ DONE]** Export JSON/CSV structuré pour commandes `check`, `digest`, `report`, et `profile`
  - Module `export.js` avec formatage intelligent par type de commande
  - Options `--export json|csv` et `--output <file>` ajoutées
  - Support des structures complexes avec aplatissement pour CSV
- **[✅ DONE]** Option globale `--lang fr` (PDF + AI prompts in French)
  - Module `i18n.js` avec labels multilingues (en/fr)
  - Prompts AI adaptés selon la langue
  - Affichage des forces/faiblesses/risques en français
- **[REPORTÉ v1.3]** Section transactions comparables (M&A/fundraising des concurrents avec liens articles)

### 🔧 Improvements
- **[✅ DONE]** Détection technologique : ajout de 20+ nouvelles technologies
  - Passé de 35 à 56 technologies (+21)
  - Frameworks modernes : Nuxt, Svelte, Astro, Remix  
  - CMS headless : Strapi, Contentful, Sanity, Prismic
  - Hosting : Vercel, Netlify, analytics : Plausible, Fathom
  - Build tools : Vite, CSS frameworks : Tailwind, Bootstrap
- **[REPORTÉ v1.3]** Amélioration qualité rapports HTML/PDF (formatage, lisibilité)
- **[REPORTÉ v1.3]** Géographie des implantations (scraping site web entreprise)

### 📊 Audit Code Effectué
- **Architecture** : entrée CLI propre via commander.js, modulaire et extensible
- **Tests** : 40 tests passent toujours, aucune régression introduite
- **Stack technique** : ESM, Node 18+, dépendances à jour, zero vulnérabilité
- **Qualité code** : structure commands/, utils/, scrapers/, ai/ respectée
- **Version** : CLI mise à jour de 1.0.0 → 1.1.6 dans index.js
- **Error handling** : gestion globale des erreurs, messages user-friendly
- **Performance** : fetcher.js déjà optimisé avec retry/backoff
- **Robustesse** : validation des entrées, parsing JSON amélioré

### 🆕 Nouveaux Modules Ajoutés
- `src/utils/export.js` — Export JSON/CSV avec formatage intelligent
- `src/utils/i18n.js` — Internationalisation (en/fr) 
- `src/utils/error-handler.js` — Gestion d'erreurs globale et user-friendly

### 📈 Statistiques Finales
- **Couverture fonctionnalités** : 4/5 demandées implémentées (80%)
- **Technologies détectées** : 35 → 56 (+60% d'amélioration)
- **Nouvelles options CLI** : `--lang`, `--export`, `--output`
- **Commandes améliorées** : `check`, `digest`, `report`, `profile`
- **Zero breaking change** : compatibilité complète maintenue

### 🎯 Prêt pour Production
- Tests complets OK
- Documentation inline à jour
- Error handling robuste 
- Compatibilité Node.js 18+ maintenue
- Aucune nouvelle dépendance npm ajoutée# Changelog

All notable changes to this project will be documented in this file.

## [1.1.6] - 2026-03-04

### Fixed
- Chart label positioning: top labels no longer overlap bars
- SVG chart renders full-width in PDF

## [1.1.5] - 2026-03-03

### Changed
- Dual-zone financial chart: full-width rendering, revenue zone + income/EBITDA zone
- KPI labels switched to English
- Emoji cleanup throughout PDF (removed redundant decorators)

### Added
- Press revenue estimates: Brave Search enrichment for subsidiary financial data when Pappers data is stale

## [1.1.4] - 2026-03-03

### Added
- **Financial Trend chart** — dual-zone SVG: revenue bars (top) + income & EBITDA bars (bottom)
- **Organic vs external growth** — code-built yearly breakdown, compares consolidated CA growth with known acquisition dates
- **Press revenue estimates** — cross-references press mentions for subsidiary revenue data
- **Sign fix** — negative results display correctly in charts and tables

## [1.1.3] - 2026-03-03

### Added
- PDF redesign: intelligence cabinet style with SVG inline icons (18 monoline icons)
- BODACC enriched descriptions (capital changes, governance details, filing types)
- BODACC clickable links to bodacc.fr for each publication
- FLI code-built revenue target override (picks highest announced figure from articles)
- Revenue Growth YoY all years from consolidated finances (code-built)
- Last Deposited vs Announced comparison in Forward-Looking Indicators
- Stale financials auto-refresh via Pappers API direct

### Fixed
- Cover page header/footer overlap (disabled Puppeteer displayHeaderFooter)
- Page margins increased for better readability
- Page breaks: Subsidiaries and Directors tables start on new pages
- BODACC URL format corrected (was 404, now uses correct bodacc.fr format)
- FLI acquisitions with empty targets no longer shown
- Revenue chart top labels no longer cropped
- Group Structure organigramme includes off-brand subsidiaries

## [1.1.2] - 2026-03-03

### Added
- **Financial KPIs / Valuation Metrics** — EBITDA, net debt, fonds propres, BFR, ROE, marge nette, capacité autofinancement from Pappers API
- **Revenue Trend SVG chart** — inline bar chart in PDF, pure SVG, no external libs
- **M&A History code-built** — regex extraction from articles, off-brand subs auto-injected, AI writes descriptions only (zero hallucinated dates)
- **Group Structure organigramme** — shareholders → target → top 7 subsidiaries (branded + off-brand, sorted by CA)
- **FLI code-built revenue target** — scans all articles for highest announced target, overrides AI
- **Revenue Growth YoY all years** — code-built from consolidated finances (not just AI's single row)
- **Stale financials auto-refresh** — Pappers API direct for subsidiaries with data > 2 years old
- **Stale year warning** — red ⚠️ badge on subsidiaries with outdated financial data
- **Off-brand subsidiary detection** — branded vs acquired split in AI prompt + organigramme
- **Article scraping for M&A depth** — top 5 articles (2000 chars each) injected into AI prompt
- **Key date extraction** — regex code-side extracts dates from articles, authoritative for M&A timeline

### Fixed
- Revenue chart top labels cropped (added padding)
- Forward-Looking Indicators empty table (code-built override when AI misses data)
- Stale financials routine now uses Pappers API instead of Brave (more reliable)
- Subsidiary filter in organigramme now includes off-brand entities


## [1.1.0] — 2026-03-02 (in progress)

### Added
- **discover** — Automatic competitor discovery from a URL (analyzes site, searches similar businesses)
- **track person** — New tracker type for people and public figures (press + social mentions)
- Social media monitoring via Brave Search (Twitter/X, Reddit, LinkedIn)
- Pappers API integration (BYOK) — French company data (SIREN, CA, dirigeants, effectifs)

## [1.0.0] — 2026-03-02

### Added
- Initial release
- **track competitor** — Track a competitor website (tech stack, pages, SEO, security, press)
- **track keyword** — Track a keyword in search engine results (SERP positions)
- **track brand** — Track brand mentions across press and web
- **list** — List all active trackers
- **remove** — Remove a tracker
- **check** — Fetch fresh snapshots for all or specific trackers
- **digest** — Summary of recent changes across all trackers
- **diff** — Compare two snapshots of the same tracker
- **report** — Generate a full intelligence report in markdown
- **history** — View snapshot history for a tracker
- **compare** — Side-by-side comparison of multiple competitors
- **notify** — Send alerts when significant changes are detected
- **ai-summary** — AI-powered intelligence brief from tracker data (BYOK)
- **pitch** — AI-generated competitive sales pitch against a tracked competitor (BYOK)
- Deep site analysis: tech detection, page crawl, key pages, job listings, social profiles
- Press & reputation monitoring via Brave Search API (with Google scraping fallback)
- Sentiment analysis (French + English) for press mentions
- BYOK AI: supports OpenAI (`gpt-4o-mini` default) and Anthropic (`claude-3-5-haiku-latest`)
- Cost tracking for AI operations

### Fixed
- Array headers bug in tech-detect.js
- Anthropic model name updated to `claude-3-5-haiku-latest`

## [1.3.0] - 2026-03-21
### Added
- Pro License Paywall: Gated advanced features (PDF/XLS export, Deep Profile, International OSINT).
- Stripe Payment Link integration for Intelwatch Pro subscriptions.
- International Smart Routing: `.fr` hits Pappers, international hits Apollo/Clearbit/OpenCorporates.
- France Handoff: International companies based in France are handed off to Pappers for deeper financial data.
- Reddit JSON API & HackerNews Algolia integration for digital OSINT and sentiment tracking.
- M&A Deep Dorks: Restricts Brave Search queries to specialized PE/M&A news sources (cfnews, lesechos, fusacq, etc.)
- Export capabilities unified under `--export <json|csv|xls|pdf>` flag.

### Fixed
- M&A History PDF generation bug: Stopped truncating AI timeline events, full timeline is now preserved.
- Group Structure Classification: Prevented PE Funds (BPIFrance, IK Partners, etc.) from being improperly categorized as operational subsidiaries in the AI due diligence report.
- Fixed `pdfData` passthrough bug that caused empty PDF exports.

### v1.3.1 (2026-03-21)
- **Bug Fix**: Fixed an issue where PDF exports could contain empty Group Structure and M&A History sections leading to ugly page breaks.
- **Bug Fix**: Preserved AI-generated subsidiaries when registry fallback has missing revenue data.
- **Bug Fix**: Fixed PDF context scope throwing an undefined error when exporting via the `--export pdf` flag instead of the legacy `--format` option.
