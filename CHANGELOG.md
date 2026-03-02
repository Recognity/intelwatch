# Changelog

All notable changes to this project will be documented in this file.

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
