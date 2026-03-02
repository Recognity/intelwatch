# intelwatch

> Competitive intelligence from the terminal. Track competitors, keywords, and brand mentions — no expensive SaaS required.

## Install

```bash
npm install -g intelwatch
# or from source:
npm link
```

**Requirements:** Node.js >=18

## Quick Start

```bash
# Add trackers
intelwatch track competitor https://competitor.com --name "Acme Corp"
intelwatch track keyword "audit SEO"
intelwatch track brand "Recognity"

# Run checks
intelwatch check

# See what changed
intelwatch digest

# Full report
intelwatch report --format html
```

## Commands

### Tracker Management

#### `intelwatch track competitor <url> [--name <alias>]`
Tracks a competitor website. Captures:
- Pages found (via link extraction)
- Pricing page content and price changes
- Technology stack (35+ technologies detected)
- Open job positions (/careers, /jobs)
- Social links
- Meta title/description changes on key pages

```bash
intelwatch track competitor https://acme.com --name "Acme"
intelwatch track competitor https://rival.io
```

#### `intelwatch track keyword <keyword> [--engine google]`
Tracks Google SERP rankings for a keyword. Records top 20 results, detects position changes, new entrants/exits, and featured snippet holders.

```bash
intelwatch track keyword "project management software"
intelwatch track keyword "audit SEO" --engine google
```

#### `intelwatch track brand <name>`
Tracks brand mentions across Google News and recent web results. Detects sentiment (positive/negative) and categorizes mentions (press, blog, forum, social, review).

```bash
intelwatch track brand "Recognity"
intelwatch track brand "My Company Name"
```

### Listing & Removing

```bash
intelwatch list                    # List all trackers
intelwatch remove <tracker-id>     # Remove a tracker
```

### Checking & Diffs

```bash
intelwatch check                   # Check all trackers
intelwatch check --tracker acme-com  # Check one tracker

intelwatch diff acme-com           # Compare last 2 snapshots
intelwatch diff acme-com --days 7  # Compare with 7 days ago
```

### Reports

```bash
intelwatch digest                        # Quick summary table
intelwatch report                        # Markdown report (stdout)
intelwatch report --format html          # HTML report (saved to ~/.intelwatch/reports/)
intelwatch report --format json          # JSON report (stdout)
intelwatch report --format md --output ./weekly.md  # Custom output file
```

### History & Comparison

```bash
intelwatch history acme-com              # Show snapshot history
intelwatch history acme-com --limit 10  # Last 10 snapshots

intelwatch compare acme-com rival-com    # Side-by-side comparison
```

### Notifications

```bash
intelwatch notify --setup    # Interactive setup (Slack, Discord webhook)
```

Notifications config is stored at `~/.intelwatch/config.yml`:

```yaml
notifications:
  webhook: https://hooks.slack.com/services/xxx/yyy/zzz
  events:
    - competitor.new_page
    - competitor.price_change
    - keyword.position_change
    - brand.new_mention
    - brand.negative_mention
```

## Data Storage

All data is stored locally in `~/.intelwatch/`:

```
~/.intelwatch/
├── config.yml           # Notification settings
├── trackers.json        # Active trackers
├── snapshots/           # Historical snapshots (JSON)
└── reports/             # Generated HTML reports
```

## Technology Detection

Detects 35+ technologies via headers, meta tags, scripts, HTML patterns:

| Category | Technologies |
|----------|-------------|
| CMS | WordPress, Drupal, Joomla |
| E-commerce | Shopify, Magento |
| Website Builder | Wix, Squarespace, Webflow |
| JS Framework | React, Vue.js, Angular, Next.js, Nuxt.js, Gatsby, Svelte |
| JS Library | jQuery |
| CSS Framework | Bootstrap, Tailwind CSS |
| Analytics | Google Analytics, Google Tag Manager, Facebook Pixel, Hotjar |
| CRM/Marketing | HubSpot, Mailchimp, Intercom |
| CDN/Security | Cloudflare |
| Web Server | nginx, Apache |
| Hosting | Vercel, Netlify |
| Backend | PHP, Django, Ruby on Rails, Node.js/Express |
| Payment | Stripe |

## Sentiment Analysis

English and French word lists for positive/negative detection in brand mentions. Categorizes mentions as: press, blog, forum, social, or review.

## Design Principles

- **No external APIs** — everything via respectful web scraping
- **Respectful scraping** — 1-2s delays, user-agent rotation, retry backoff
- **Graceful degradation** — saves what it can if a check partially fails
- **Local-first** — all data stays on your machine

## Tests

```bash
npm test
```

40 tests covering storage logic, technology detection, and sentiment analysis.

## License

MIT
