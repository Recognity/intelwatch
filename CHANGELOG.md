# Changelog

All notable changes to this project will be documented in this file.
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
