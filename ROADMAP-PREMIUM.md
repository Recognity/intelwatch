# Intelwatch Deep Profile — Roadmap Premium

## Current (v1.1.x — Shipped)
- [x] Identity + finances 5 ans + consolidé groupe
- [x] Filiales via recherche-dirigeants + CA/résultat
- [x] Représentants / actionnariat
- [x] BODACC 50 publications + presse filtrée (homonymes exclus)
- [x] `--ai` : summary, forces/faiblesses, concurrents mid-market, M&A, risk, health score 0-100
- [x] Badges confiance (`confirmed_registry` / `confirmed_press` / `unconfirmed`)
- [x] Recherche M&A ciblée (acquisition/rachat/entrée au capital)
- [x] Cache local Pappers 7 jours (identity + subsidiaries + individual sub data)
- [x] PDF Recognity-branded clean white (anglais)
- [x] Growth Analysis (organic vs external, YoY %)
- [x] Forward-Looking Indicators (announced vs deposited, code-built override AI)
- [x] "Go Further" page — liens vers sources premium non scrapables
- [x] **Group Structure organigramme** — shareholders → target → top 7 subsidiaries (branded + off-brand)
- [x] **M&A History code-built** — regex extraction from articles, off-brand subs auto-injected, AI writes descriptions only → zero hallucinated dates
- [x] **Financial KPIs / Valuation Metrics** — EBITDA, net debt, fonds propres, BFR, ROE, marge nette, capacité autofinancement (Pappers API)
- [x] **Revenue Trend SVG chart** — inline bar chart, pure SVG, no external libs
- [x] **Stale financials auto-refresh** — Pappers API direct (not Brave), cache updated, max 5 subs
- [x] **Off-brand subsidiary detection** — branded vs acquired split, used in AI prompt + organigramme
- [x] **Article scraping for M&A depth** — top 5 articles (2000 chars), content injected into AI
- [x] **Key date extraction from articles** — regex code-side, authoritative dates
- [x] **FLI code-built revenue target** — scans all articles, picks highest announced target, overrides AI
- [x] **Stale year warning** — red ⚠️ badge on subsidiaries with data > 2 years old

## v1.2 — Next Release
- [ ] Fix forces/faiblesses vides en terminal (parsing JSON)
- [ ] Export JSON/CSV structuré
- [ ] `--lang fr` option (PDF + AI prompts in French)
- [ ] Comparable transactions section (competitors' M&A/fundraising with article links)
- [ ] Geographic implantations scraping from company website
- [ ] Cross-reference press/journalists across sections
- [ ] Commit + npm publish as `intelwatch@1.2.0`

## V2 — Pro ($49/mo)
- [ ] `intelwatch compare SIREN1 SIREN2` — côte à côte
- [ ] **INPI integration** — brevets & marques du groupe (gratuit, data.inpi.fr)
- [ ] **OpenCorporates** — filiales internationales (gratuit)
- [ ] **Annuaire Entreprises / data.gouv** — données complémentaires
- [ ] Freemium gate (3 profiles/jour) + license key
- [ ] `--preview` mode limité (identity + dernier exercice)
- [ ] **BODACC détaillé enrichi** — timeline types d'actes, augmentations capital

## V3 — Deep Profile ($299/mo)
- [ ] **Graphe de liens** — visualisation SVG/HTML du réseau (Pappers graph-style)
- [ ] **Scoring propriétaire** — credit score entreprise avec benchmark sectoriel
- [ ] **Alertes watch** — `intelwatch watch SIREN` → email/webhook si BODACC, presse, changement financier
- [ ] **Multi-rapports** — batch profile sur liste de SIRENs, comparaison consolidée
- [ ] **Scoring gouvernance** — mandats croisés, conflits d'intérêts potentiels

## V4 — Enterprise (custom pricing)
- [ ] **Infogreffe API** — comptes annuels détaillés, annexes, rapports CAC (3.80€/doc BYOK)
- [ ] **SEMrush / DataForSEO** — BYOK, keywords/backlinks/domain authority
- [ ] **LinkedIn Sales Navigator** — organigramme réel, recrutements (BYOK)
- [ ] **CFNEWS / MergerMarket** — deals comparables, multiples sectoriels (BYOK)
- [ ] Dashboard web (HTML statique shareable)
- [ ] API REST pour intégration dans outils clients

## Sources — Intégrabilité

| Source | Gratuit | Scrapable | Roadmap |
|--------|---------|-----------|---------|
| Pappers | ✅ (BYOK) | ✅ API | v1.0 ✅ |
| Brave Search | ✅ (BYOK) | ✅ API | v1.0 ✅ |
| INPI (brevets/marques) | ✅ | ✅ data.inpi.fr | V2 |
| OpenCorporates | ✅ | ✅ | V2 |
| Annuaire Entreprises | ✅ | ✅ data.gouv | V2 |
| BODACC détaillé | ✅ | ✅ bodacc.fr | V2 |
| Infogreffe | ❌ 3.80€/doc | API payante | V4 |
| FIBEN (Banque de France) | ❌ réservé | ❌ | ❌ (Go Further) |
| Tribunal de Commerce | ❌ 2-5€/extrait | ❌ | ❌ (Go Further) |
| LinkedIn Sales Nav | ❌ ~80€/mo | ⚠️ risqué | V4 (BYOK) |
| CFNEWS | ❌ ~200€/mo | ❌ | ❌ (Go Further) |
| MergerMarket | ❌ ~1000€/mo | ❌ | ❌ (Go Further) |

## Pricing
| Tier | Prix | Limites | Features |
|------|------|---------|----------|
| Free | 0€ | 3 profiles/jour, `--preview` | Identity + last year only |
| Pro | 49€/mo | Illimité | Full profile + AI + PDF + export + INPI + compare |
| Deep Profile | 299€/mo | Illimité | Tout Pro + graphe + alertes + batch + scoring |
| Enterprise | Custom | Custom | Tout Deep + Infogreffe + SEMrush + API REST |

## Coût par rapport
- Pappers API : ~5-10 crédits/profile (identity + filiales + stale refresh)
- OpenAI gpt-4o-mini : ~$0.005/profile
- Brave Search : ~4-6 requêtes/profile (mentions + M&A + stale search)
- **Coût total estimé : ~$0.10-0.20/profile**
- Break-even Pro (49€) : ~250 profiles/mois
- Break-even Deep (299€) : client fait >15 profiles/mois → rentable vs analyste junior

## Cibles
- Cabinets M&A (Louis Merville / KTR Partners — beta testeur)
- Avocats d'affaires
- Fonds PE / VC (due diligence)
- Compliance / KYC
- Journalistes investigation
- Assureurs (risk assessment)
- CFO / DAF (veille concurrentielle)
