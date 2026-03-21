# intelwatch

> **Zero friction. Full context.**
> Competitive intelligence, M&A due diligence, and OSINT directly from your terminal.

![Intelwatch Mockup](https://recognity.odoo.com/web/image/website/1/logo?unique=1)

**Intelwatch** bridges the gap between hacker OSINT and B2B Sales/M&A data. It executes complex financial data aggregation, technology stack detection, and AI-powered due diligence in seconds. No dashboards, no bloated UI. Just pure data.

## Installation

```bash
npm install -g intelwatch
# or run directly without installing:
npx intelwatch profile kpmg.fr --ai
```

**Requirements:** Node.js >=18

## 🚀 The Flagship Feature: Due Diligence

Generate a comprehensive M&A/PE due diligence report in seconds. Intelwatch uses Smart Routing to fetch the best data based on the company's location (Pappers for France, Apollo/Clearbit/OpenCorporates for International).

```bash
# Generate a deep profile with AI Due Diligence
intelwatch profile doctolib.fr --ai

# Export directly to a premium PDF report (Pro feature)
intelwatch profile kpmg.fr --ai --export pdf

# Export data to Excel or CSV
intelwatch profile "Acme Corp" --export xls
```

**What it extracts:**
- **Financials:** Revenue, net result, consolidated data, and growth analysis.
- **Group Structure:** Shareholders, PE sponsors, and subsidiaries tree.
- **Governance & M&A:** Board members, BODACC legal publications, and historical M&A timeline.
- **OSINT & Reputation:** Recent press mentions, Reddit/Hacker News discussions, and sentiment scoring.
- **Tech Stack:** Detection of 50+ technologies (CMS, Frameworks, Analytics, CDNs).
- **AI Analysis:** Executive summary, Strengths & Weaknesses, Competitor identification, and Risk flags.

---

## 🛠️ Core Commands

### 1. Market & Competitor Discovery
Discover actual competitors for any website using web search and AI scoring.

```bash
intelwatch discover https://mycompany.com --export csv
```

### 2. Track Competitors & Keywords
Set up local trackers to monitor competitor websites, technology changes, and Google SERP rankings over time.

```bash
intelwatch track competitor https://acme.com --name "Acme Corp"
intelwatch track keyword "audit SEO" --engine google
intelwatch track brand "Recognity"
```

### 3. Check & Digest
Run your trackers and see what changed since the last snapshot.

```bash
intelwatch check
intelwatch digest
intelwatch diff acme-com --days 7
```

### 4. AI Briefs & Sales Pitches
Generate AI-powered competitive briefs and sales pitches against your tracked competitors.

```bash
intelwatch ai-summary
intelwatch pitch acme-com
```

---

## 💎 Pro License ($49/mo)

Intelwatch operates on a freemium model. The **Free Tier** allows standard OSINT, basic company profiles, and CSV exports.

The **Pro Tier** unlocks:
- 📄 **Premium PDF & Excel (XLS) exports**
- 🤖 **AI Due Diligence Reports** (Health score, Risks, M&A timelines)
- 🌍 **International Routing** (Apollo & Clearbit integrations)
- 🕵️ **Deep OSINT** (Reddit & Hacker News tracking)

**Activate your license:**
```bash
intelwatch auth YOUR_LICENSE_KEY
```
*(Get your key at [recognity.fr/tools/intelwatch](https://recognity.fr/tools/intelwatch))*

---

## ⚙️ Configuration & API Keys

Intelwatch brings your own keys (BYOK) for maximum privacy and limit-less scaling. Set these in your environment variables (`~/.bashrc` or `~/.zshrc`):

```bash
# Required for AI Features (Choose one)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-proj-..."

# Required for Web Search & Discovery
export BRAVE_SEARCH_API_KEY="BSAeG..."

# Required for deep French corporate data
export PAPPERS_API_KEY="86c0dcc..."

# Required for deep International corporate data (Pro)
export APOLLO_API_KEY="..."
```

*(You can also use a `.env` file in your working directory).*

## 🔒 Privacy & Architecture

- **Local-first**: All tracker data, snapshots, and configurations are stored locally in `~/.intelwatch/`.
- **No intermediary servers**: The CLI talks directly to the data providers (Pappers, Apollo, Brave, Anthropic/OpenAI). We do not see your API keys or your searches.
- **Smart Routing**: `registry.js` automatically detects French companies (via SIREN/SIRET or country code) and routes them to Pappers, while international companies gracefully fallback to Apollo and OpenCorporates.

## License

MIT
