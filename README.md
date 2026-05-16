# intelwatch

> **Zero friction. Full context.**
> Competitive intelligence, M&A due diligence, and OSINT directly from your terminal.

![Intelwatch Mockup](https://recognity.odoo.com/web/image/website/1/logo?unique=1)

**Intelwatch** bridges the gap between hacker OSINT and B2B Sales/M&A data. It executes complex financial data aggregation, technology stack detection, and AI-powered due diligence in seconds. No dashboards, no bloated UI. Just pure data.

## Installation

```bash
npm install -g intelwatch
intelwatch setup

# or run directly without installing:
npx intelwatch profile kpmg.fr --ai
```

**Requirements:** Node.js >=18

## 🚀 The Flagship Feature: Due Diligence

Generate a comprehensive M&A/PE due diligence report in seconds. Intelwatch uses Smart Routing to fetch the best data based on the company's location (Pappers for France, Apollo/Clearbit/OpenCorporates for International).

### what's new in 1.7.4 — Golden Team validation

The DD PDF now ships **7 must-have blocks** validated by a full Golden Team session (expert métier → manager → dev × 3 → designer → reviewer → validateur) :

- **Executive Summary page 1** — Investment Thesis (2-3 phrases) + Top 3 Red Flags ordonnés par severity + Recommendation tranchée (`distressed_ma` / `watchlist` / `pass`) dès la première page.
- **Health Score gauge + 6 ratios financiers nommés** — SVG gauge demi-cercle 0-100 + Net Debt/EBITDA (seuil distress 3.5×), ROE, BFR/CA, Debt/Equity, Autonomie financière, Cash Runway. Chaque ratio color-coded avec verdict.
- **3 SVG inline charts** — Capital Trajectory step-line (évolution BODACC), Press Sentiment timeline 24 mois (negative/neutral/positive stacked), Health Gauge demi-cercle. Tout inline, zéro hotlink.
- **Key Man Risk auto-flag** — Détection ≥3 changements Président OU ≥2 CAC sur 18 mois glissants, regex `\b`-bounded strict + dédup BODACC.
- **Peer Median Multiples** — Median EV/EBITDA + EV/Revenue + Price/Book sur peers same-NAF via Pappers. Pool concurrent 4 workers, cache disque 7 jours, fail-soft sur 429/401 (pas de retry storm), guard SSRF IP privées.
- **BFR drift YoY + Cash Runway narrative** — Mois de runway restant à burn rate constant + alerte si BFR drift > 20% YoY.
- **Provenance Footer** — Sources listées (Pappers, BODACC, INSEE, Judilibre, INPI, press) + badge "100% public sources · TDM-compliant" en pied de PDF.

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

Intelwatch brings your own keys (BYOK) for maximum privacy and limit-less scaling. Keys are read in this order :

1. Shell environment (`~/.bashrc` / `~/.zshrc`) — wins over the file
2. `~/.intelwatch/.env` — auto-loaded at every startup (created by `intelwatch setup`)

```bash
# Required for AI Features (Choose one)
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-proj-..."
export GEMINI_API_KEY="AIza..."

# Required for deep French corporate data
export PAPPERS_API_KEY="86c0dcc..."
```

### Press & Web search providers (3 paths, any combination)

Intelwatch queries the three providers in parallel for press / M&A mentions. Configure at least one — the other two stay as fallback.

| Provider     | Mode          | Setup                                                             |
|--------------|---------------|-------------------------------------------------------------------|
| **Exa.ai**   | BYOK (freemium ~$10 free credits) | `export EXA_API_KEY="01733295-..."` — semantic search, best on French M&A press |
| **Brave**    | BYOK (freemium 2000 req/mo)       | `export BRAVE_API_KEY="BSAeG..."` — keyword API, robust news search |
| **SearXNG**  | self-host **OR** public instance  | `export SEARXNG_URL="http://192.168.1.30:8888"` — zero recurring cost. Leave empty to auto-discover public instances. |

**Recommandation Recognity stack** : `EXA_API_KEY` + `BRAVE_API_KEY` couvre 90 % des cas. Pour un déploiement on-prem, déploie SearXNG en Docker sur Vulcain (192.168.1.30) :

```bash
# On Vulcain (192.168.1.30)
docker run -d --name searxng -p 8888:8080 \
  -e BASE_URL=http://192.168.1.30:8888 \
  searxng/searxng:latest

# Then in ~/.intelwatch/.env
SEARXNG_URL="http://192.168.1.30:8888"
```

### OSINT subtile — différenciation DD vs Sinequa

Sources spécialisées branchées dans la section Deep Profile (BYOK, gracieuses si absentes).

| Source | Signal | Setup |
|---|---|---|
| **JudiLibre** | Décisions de justice anonymisées (Cour cass + CA + TJ) — litiges majeurs sur la cible ou ses dirigeants | Inscription [piste.gouv.fr](https://piste.gouv.fr) → souscrire JudiLibre → `JUDILIBRE_KEY_ID` |
| **INPI marques** | Portefeuille de marques déposées par SIREN — signal IP, classes Nice, expansion produit | Compte gratuit [data.inpi.fr](https://data.inpi.fr) → `INPI_USERNAME` + `INPI_PASSWORD` |
| **INPI brevets** | Brevets déposés par SIREN — signal R&D et technologie | Mêmes credentials INPI |

### Optional providers

```bash
# International corporate data (Pro)
export APOLLO_API_KEY="..."
# Camofox paywall fetcher (Recognity-internal)
export CAMOFOX_BASE="http://localhost:9377"
# Vulcain Ollama (zero-cost AI extraction)
export OLLAMA_HOST="http://192.168.1.30:11434"
export OLLAMA_MODEL="qwen2.5:7b"
```

## 🔒 Privacy & Architecture

- **Local-first**: All tracker data, snapshots, and configurations are stored locally in `~/.intelwatch/`.
- **No intermediary servers**: The CLI talks directly to the data providers (Pappers, Apollo, Brave, Anthropic/OpenAI). We do not see your API keys or your searches.
- **Smart Routing**: `registry.js` automatically detects French companies (via SIREN/SIRET or country code) and routes them to Pappers, while international companies gracefully fallback to Apollo and OpenCorporates.

## License

MIT
