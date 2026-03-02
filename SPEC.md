# intelwatch — Competitive Intelligence CLI

## Overview
Track competitors, keywords, and brand mentions from the terminal. No expensive SaaS — just a CLI that watches the web for you.

## Tech Stack
- **Runtime:** Node.js (>=18)
- **CLI:** Commander.js
- **HTTP:** axios
- **HTML parsing:** cheerio
- **Storage:** JSON files in `~/.intelwatch/` (trackers, snapshots, history)
- **Output:** chalk + cli-table3
- **Package name:** `intelwatch`
- **Binary name:** `intelwatch`
- **License:** MIT

## Data Storage
```
~/.intelwatch/
├── config.yml           # Global config (notification settings, etc.)
├── trackers.json        # All active trackers
├── snapshots/           # Historical snapshots
│   ├── competitor-xyz-2026-03-01.json
│   └── keyword-audit-seo-2026-03-01.json
└── reports/             # Generated reports
```

## Commands

### Tracker Management

#### `intelwatch track competitor <url> [--name <alias>]`
Creates a competitor tracker. On each check, captures:
- Page count (crawl sitemap or homepage links)
- New/removed pages since last check
- Pricing page content (detects price changes)
- Technology stack (detect via headers, meta tags, scripts: WordPress, Shopify, React, etc.)
- Job postings page (if /careers or /jobs exists — count open positions)
- Social links found on site
- Meta description / title changes on key pages (homepage, pricing, about)

#### `intelwatch track keyword <keyword> [--engine google]`
Creates a keyword tracker. On each check:
- Scrapes Google search results (first 20 results) for the keyword
- Records positions: which domains rank where
- Detects new entrants and exits
- Tracks featured snippet holder
- Note: uses web scraping with respectful delays and proper user-agent

#### `intelwatch track brand <name>`
Creates a brand mention tracker. On each check:
- Searches Google for the brand name (last 24h results using tbs=qdr:d)
- Searches Google News
- Detects new mentions
- Categorizes: press, blog, forum, social, review
- Sentiment hint: checks if mention page title/snippet contains negative words

#### `intelwatch list`
Lists all active trackers with last check time and status.

#### `intelwatch remove <tracker-id>`
Removes a tracker.

### Checking & Reports

#### `intelwatch check [--tracker <id>]`
Runs checks for all trackers (or one specific). Compares with last snapshot and stores new snapshot.
- Shows what changed since last check
- Color-coded: 🟢 new info, 🟡 changed, 🔴 removed/negative

#### `intelwatch digest`
Summary of ALL changes across all trackers since last digest.
Output: compact table with most important changes per tracker.

#### `intelwatch diff <tracker-id> [--days <n>]`
Detailed diff for one tracker. Default: compare last 2 snapshots.
`--days 7`: compare with snapshot from 7 days ago.

#### `intelwatch report [--format md|html|json] [--output file]`
Full intelligence report combining all trackers.
- Competitor section: who did what
- Keyword section: position changes
- Brand section: new mentions
- Scoring: threat level per competitor (based on activity)
- Default: markdown to stdout

#### `intelwatch history <tracker-id> [--limit <n>]`
Show historical snapshots for a tracker. Trend over time.

### Notifications

#### `intelwatch notify --setup`
Interactive setup for notifications:
- Webhook URL (Slack, Discord, etc.)
- Email (via SMTP config)
- Which events trigger notifications (new competitor page, rank change, brand mention)

Notifications config stored in `~/.intelwatch/config.yml`:
```yaml
notifications:
  webhook: https://hooks.slack.com/services/xxx
  events:
    - competitor.new_page
    - competitor.price_change
    - keyword.position_change
    - brand.new_mention
```

### Compare

#### `intelwatch compare <tracker1> <tracker2>`
Side-by-side comparison of two competitor trackers.
- Tech stack diff
- Content volume diff
- Activity level comparison

## Project Structure
```
intelwatch/
├── package.json
├── README.md
├── bin/
│   └── intelwatch.js
├── src/
│   ├── index.js               # Commander setup
│   ├── storage.js             # JSON file storage (trackers, snapshots)
│   ├── config.js              # Config management
│   ├── trackers/
│   │   ├── competitor.js      # Competitor tracking logic
│   │   ├── keyword.js         # Keyword/SERP tracking
│   │   └── brand.js           # Brand mention tracking
│   ├── commands/
│   │   ├── track.js           # track competitor/keyword/brand
│   │   ├── check.js           # check command
│   │   ├── digest.js          # digest command
│   │   ├── diff.js            # diff command
│   │   ├── report.js          # report generation
│   │   ├── history.js         # history command
│   │   ├── compare.js         # compare command
│   │   ├── notify.js          # notification setup
│   │   └── list.js            # list/remove trackers
│   ├── scrapers/
│   │   ├── google.js          # Google SERP scraper
│   │   ├── google-news.js     # Google News scraper
│   │   └── site-analyzer.js   # Site page/tech/pricing analyzer
│   ├── report/
│   │   ├── markdown.js
│   │   ├── html.js
│   │   └── json.js
│   └── utils/
│       ├── fetcher.js         # HTTP with retries, user-agent rotation, delays
│       ├── parser.js          # HTML parsing helpers
│       ├── display.js         # Table formatting
│       ├── sentiment.js       # Basic sentiment (positive/negative word lists)
│       └── tech-detect.js     # Technology detection rules
├── data/
│   ├── tech-signatures.json   # Known tech signatures (headers, scripts, meta)
│   ├── negative-words-en.json
│   ├── negative-words-fr.json
│   ├── positive-words-en.json
│   └── positive-words-fr.json
└── test/
    ├── storage.test.js
    ├── tech-detect.test.js
    └── sentiment.test.js
```

## Technology Detection Rules (tech-signatures.json)
Detect technologies by:
- Response headers (X-Powered-By, Server, etc.)
- Meta tags (generator)
- Script sources (react, vue, jquery, analytics, etc.)
- CSS classes / IDs (wp-content, shopify, wix, etc.)
- Known paths (/wp-admin/, /cdn-cgi/, etc.)

Include at least 30 common technologies:
WordPress, Shopify, Wix, Squarespace, Webflow, React, Vue, Angular, Next.js, Nuxt, 
jQuery, Bootstrap, Tailwind, Google Analytics, Google Tag Manager, Facebook Pixel,
HubSpot, Mailchimp, Cloudflare, nginx, Apache, Vercel, Netlify, PHP, Python/Django,
Ruby on Rails, Node.js/Express, Stripe, Intercom, Hotjar

## Constraints
- Plain JS, ESM modules, no build step
- NO external APIs (everything via web scraping)
- Respectful scraping: 1-2s delay between requests, rotate user-agents
- Google scraping: accept that it may get rate-limited; handle gracefully with retry + backoff
- All data local (no cloud, no accounts)
- Graceful degradation: if a check partially fails, save what worked

## Done Criteria
- `intelwatch track competitor https://example.com` creates a tracker
- `intelwatch track keyword "audit SEO"` creates a keyword tracker
- `intelwatch track brand "Recognity"` creates a brand tracker
- `intelwatch check` runs all checks and shows changes
- `intelwatch digest` shows summary
- `intelwatch report --format html` generates a professional report
- `intelwatch compare` works between two competitors
- All commands handle errors gracefully
- README with usage examples
- Tests pass
- Clean git commit
