import { formatEuro } from './helpers.js';
import { getPrompt } from '../../utils/i18n.js';

/**
 * Build system + user prompts for the AI due diligence analysis.
 */
export function buildAIPrompts(identity, siren, ctx, codeBuiltMaHistory, options) {
  const systemPrompt = getPrompt('dueDiligenceSystem') + `

RÈGLES CRITIQUES :
1. HOLDING vs GROUPE : les données "entité" (effectifs, CA) sont celles de la HOLDING (société mère). Les données "consolidées" sont celles du GROUPE ENTIER. Ne confonds JAMAIS les deux. Si la holding a 5 salariés mais le groupe consolide 60M€ de CA, c'est un GRAND groupe. Base ton analyse sur les chiffres consolidés quand disponibles.
2. ${getPrompt('competitorRules')}
3. CROISEMENT PRESSE : la section PRESSE ci-dessous est taguée [EXA] (recherche sémantique), [SEARXNG] (recherche généraliste) et [FULL-TEXT] (contenu intégral via Camofox, priorité absolue). Utilise les snippets fournis pour :
   (a) identifier acquisitions, entrées PE, rachats, partenariats — INCLUS-LES dans groupStructure et maHistory avec l'URL source.
   (b) lire ENTRE LES LIGNES : litiges clients, pertes de marchés, restructurations, difficultés opérationnelles, départs de dirigeants, communication défensive, discours de rebond, non-renouvellement de contrats. Ces signaux faibles vont dans strengths/weaknesses avec confidence="confirmed_press" et sourceUrl.
   (c) repérer les changements de narratif entre dates (ex: "confiance en un rebond solide" 2 mois après une procédure collective = signal de restructuration en cours).
   (d) extraire les chiffres qualitatifs non couverts par Pappers : parts de marché, clients nommés, capacités de production, sites fermés/ouverts.
4. REPRÉSENTANTS : les personnes morales (PM) au capital sont souvent des fonds PE, des holdings familiales ou des véhicules d'investissement. Identifie-les et intègre-les dans la structure du groupe. Si tu reconnais un fonds PE connu (BPI France, IK Partners, Ardian, etc.), mentionne-le explicitement.
5. SCORING : évalue la santé financière sur le CA CONSOLIDÉ (pas holding). Échelle 0-100 : croissance CA consolidé, rentabilité consolidée, stabilité, diversification géographique/sectorielle, gouvernance.`;

  const userPrompt = `Analyse de due diligence pour ${identity.name} (SIREN: ${identity.siren})

=== IDENTITÉ ===
Forme: ${identity.formeJuridique || '?'}, NAF: ${identity.nafCode || '?'} — ${identity.nafLabel || '?'}
Création: ${identity.dateCreation || '?'}, Effectifs: ${identity.effectifs || '?'}
Capital: ${identity.capital != null ? formatEuro(identity.capital) : '?'}
Effectif holding: ${identity.effectifTexte || identity.effectifs || '?'} (ATTENTION: c'est la holding, pas le groupe)
Adresse: ${[identity.adresse, identity.codePostal, identity.ville].filter(Boolean).join(' ') || '?'}
Objet social: ${identity.objetSocial || 'Non disponible'}
Nombre de filiales identifiées: ${ctx.subsidiariesData?.length || 0}

=== DIRIGEANTS ===
${ctx.dirStr}

=== REPRÉSENTANTS / ACTIONNAIRES ===
${ctx.repStr}

=== BÉNÉFICIAIRES EFFECTIFS (UBO) ===
${ctx.uboStr}

=== FINANCES (entité) ===
${ctx.finSummary}

=== FINANCES CONSOLIDÉES (groupe) ===
${ctx.consFinSummary}

=== FILIALES / ENTITÉS LIÉES ===
${ctx.subsStr}

=== PUBLICATIONS BODACC (classified — distress signals flagged) ===
${ctx.bodaccStr}

=== PROCÉDURES COLLECTIVES (with severity & personnel) ===
${ctx.procStr}
NOTE: Procedures are classified by severity (critical/high/medium/low) and type (liquidation/redressement/sauvegarde/cession).
If distress signals exist, assess their impact on M&A attractiveness: is the company a distressed acquisition target? A recovery play? Consider timeline progression (sauvegarde → redressement → liquidation).

=== PRESSE (${ctx.pressResults?.length || 0} mentions) ===
${ctx.pressStr}

=== CONCURRENTS CANDIDATS — REGISTRE PAPPERS (${ctx.registryCompetitors?.length || 0} pairs FR avec même NAF) ===
${ctx.competitorRegistryStr}

=== CONCURRENTS CANDIDATS — MENTIONS PRESSE (via Exa) ===
${ctx.competitorPressStr}

=== SCRAPED M&A ARTICLES (press sources) ===
${ctx.scrapedMaContent?.filter(a => a.source !== 'company-website' && a.source !== 'linkedin').length
  ? ctx.scrapedMaContent.filter(a => a.source !== 'company-website' && a.source !== 'linkedin').map(a => `--- ${a.title} (${a.url}) ---\n${a.content}`).join('\n\n')
  : 'None scraped'}

=== COMPANY WEBSITE ARTICLES (from target's own blog/news) ===
${ctx.scrapedMaContent?.filter(a => a.source === 'company-website').length
  ? ctx.scrapedMaContent.filter(a => a.source === 'company-website').map(a => `--- ${a.title} (${a.url}) ---\n${a.content}`).join('\n\n')
  : 'None found'}

=== LINKEDIN MENTIONS ===
${ctx.scrapedMaContent?.filter(a => a.source === 'linkedin').length
  ? ctx.scrapedMaContent.filter(a => a.source === 'linkedin').map(a => `--- ${a.title} (${a.url}) ---\n${a.content}`).join('\n\n')
  : 'None found'}

=== PRE-BUILT M&A TIMELINE (use these entries, add descriptions only) ===
IMPORTANT: The following entries have AUTHORITATIVE dates extracted from press articles and registry data.
Your job is ONLY to add a 2-3 sentence description to each entry. Do NOT change dates, types, or targets. Do NOT add or remove entries. Copy all entries exactly into the maHistory array.

${codeBuiltMaHistory.length
  ? codeBuiltMaHistory.map((e, i) =>
      `[${i+1}] date:${e.date} | type:${e.type} | target:${e.target} | confidence:${e.confidence}${e.sourceUrl ? ' | source:'+e.sourceUrl : ''}`
    ).join('\n')
  : 'No pre-built entries (use best effort from articles)'}

=== CROISSANCE REVENUE ===
Source: ${ctx.growthDataSource}
${ctx.rawGrowthData.length ? ctx.rawGrowthData.map(g => `${g.period}: ${g.from} → ${g.to} (${g.growthPct})`).join('\n') : 'Données insuffisantes pour calculer la croissance'}

Retourne ce JSON exact (remplace les valeurs par l'analyse réelle) :
{
  "executiveSummary": "Write 4-6 detailed paragraphs (at least 300 words total) covering: company profile and history, governance and ownership structure, financial performance and trends (use consolidated figures), group structure and key subsidiaries, market positioning and competitive landscape. Be specific with numbers, names, and dates.",
  "groupStructure": {
    "description": "narrative description of ownership structure",
    "shareholders": [
      {"entity": "Shareholder/Fund name", "role": "Private Equity Fund|Co-investor|Holding", "stake": "majority|minority|XX%", "confidence": "confirmed_registry|confirmed_press", "sourceUrl": null}
    ],
    "target": {"entity": "TARGET COMPANY NAME", "role": "Target Company", "revenue": "62M€ (2024)"},
    "subsidiaries": [
      {"entity": "Key subsidiary name", "revenue": "XX M€ (YYYY)"}
    ]
  },
  "strengths": [
    {"text": "2-3 sentences describing the strength with specific numbers, dates, or facts. Not generic.", "confidence": "confirmed_registry|confirmed_press", "sourceUrl": null}
  ],
  "weaknesses": [
    {"text": "2-3 sentences describing the weakness with specific evidence. Not generic.", "confidence": "confirmed_registry|confirmed_press", "sourceUrl": null}
  ],
  "competitors": [
    {"name": "competitor name", "siren": "from Pappers list or null", "source": "pappers_registry|press_exa|adjacent_market", "reason": "why they are a direct competitor (2-3 sentences) — CRITICAL: explique ce qui les positionne sur le MÊME MARCHÉ PRODUIT (pas juste même NAF), point de contact avec la cible (clients communs, zone géo, segment)", "estimatedRevenue": "exact si dispo dans la liste registre, sinon fourchette", "summary": "3-4 sentences describing this competitor: activity, positioning vs target, relative size, any recent M&A/press signal"}
  ],
  "maHistory": [
    {"date": "YYYY-MM or YYYY", "type": "acquisition|cession|fusion|restructuration|capital_increase|creation", "target": "name of acquired/merged entity", "description": "2-3 sentences", "confidence": "confirmed_registry|confirmed_press|unconfirmed", "sourceUrl": "URL or null"}
  ],
  "riskAssessment": {
    "overall": "low|medium|high|critical",
    "flags": [
      {"severity": "low|medium|high|critical", "text": "risque identifié avec détail", "confidence": "confirmed_registry", "sourceUrl": null}
    ]
  },
  "healthScore": {
    "score": 75,
    "breakdown": {
      "growth": {"score": 80, "comment": "explication courte"},
      "profitability": {"score": 70, "comment": "explication courte"},
      "stability": {"score": 75, "comment": "explication courte"},
      "diversification": {"score": 60, "comment": "explication courte"},
      "governance": {"score": 50, "comment": "explication courte"}
    }
  },
  "growthAnalysis": {
    "consolidatedGrowth": [
      {"period": "2023→2024", "fromRevenue": "58.2M€", "toRevenue": "62.0M€", "growthPct": "6.5%", "organic": "~3%", "external": "~3.5%", "comment": "short description"}
    ],
    "growthQuality": "mixed",
    "aiComment": "Write 2-3 sentences analyzing growth quality."
  },
  "forwardLooking": {
    "announcedRevenue": null,
    "announcedHeadcount": null,
    "announcedAcquisitions": [],
    "projectedGrowth": null,
    "aiComment": "Write 2-3 sentences comparing announced/projected figures vs last deposited data."
  }
}

Règles: confidence="confirmed_registry" si la donnée vient des données Pappers fournies, "confirmed_press" + sourceUrl si d'un article de presse listé ci-dessus, "unconfirmed" sinon.

OBLIGATOIRE :
- ${getPrompt('strengthsWeaknessesRules')}
- CONCURRENTS : utilise PRIORITAIREMENT les candidats listés dans les sections "CONCURRENTS CANDIDATS — REGISTRE PAPPERS" et "CONCURRENTS CANDIDATS — MENTIONS PRESSE". Ne PAS inventer de concurrents. Si la liste Pappers a des SIREN, inclus le SIREN. Minimum 5 concurrents, ordre : d'abord les pairs Pappers de CA comparable, puis les concurrents presse qui apportent un angle différent (international, substitute, acteur émergent). Pour chaque concurrent, explique 2-3 phrases POURQUOI c'est un concurrent (même marché produit, même client type, même zone géo) — pas juste "même secteur NAF". Si la section "REGISTRE PAPPERS" contient seulement 1-2 pairs, c'est une niche — mentionne-le explicitement dans competitors et considère des substitutes/players adjacents.
- Le score de santé doit être basé sur les finances CONSOLIDÉES si disponibles
- BE EXTREMELY CONCISE. Use bullet points and short sentences. Max 30 words per field.
- Ne mentionne JAMAIS que la holding a peu d'employés comme faiblesse — c'est normal pour une holding, les employés sont dans les filiales
- maHistory: The PRE-BUILT M&A TIMELINE above contains ALL entries with AUTHORITATIVE dates and types.
  RULES:
  1) Copy ALL entries from PRE-BUILT M&A TIMELINE exactly (same date, type, target, confidence, sourceUrl).
  2) For each entry, write a 2-3 sentence description explaining: what happened, the strategic rationale, estimated deal context if known.
  3) Do NOT invent dates. Do NOT add entries not in the pre-built list. Do NOT remove entries.
  4) If pre-built list is empty, use best effort from articles (MINIMUM 5 entries).
  Each entry: date (YYYY or YYYY-MM), type, target, description (2-3 sentences), confidence, sourceUrl.
- growthAnalysis.consolidatedGrowth: use the "CROISSANCE REVENUE" data provided. For organic vs external split: External growth = revenue attributable to OFF-BRAND subsidiaries acquired during the period. Organic growth = total growth minus external growth.
- growthAnalysis.growthQuality: "organic-led" if >70% organic, "acquisition-led" if >70% external, "mixed" otherwise
- growthAnalysis.aiComment: list specific off-brand subsidiaries that contributed to external growth.
- forwardLooking: ALWAYS populate ALL fields in this section. This is MANDATORY.
  - announcedRevenue: Scan ALL scraped articles for ANY revenue figure for a FUTURE or RECENT year not yet in the registry. If found: {"amount": "100M€", "year": 2025, "confidence": "confirmed_press", "sourceUrl": "https://article-url"}. If NOT found: project from CAGR.
  - announcedAcquisitions: list ALL acquisitions mentioned in press/company articles that are announced, in progress, or recently completed.
  - projectedGrowth: ALWAYS fill this as a SHORT STRING like "+12% CAGR → ~70M€ projected 2025". NOT an object, just a string.
  - aiComment: 3-4 sentences comparing deposited vs announced/projected, discussing growth sustainability and outlook`;

  return { systemPrompt, userPrompt };
}
