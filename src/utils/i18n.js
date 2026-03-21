// Internationalization utilities

const labels = {
  en: {
    forces: 'Strengths',
    faiblesses: 'Weaknesses',
    executiveSummary: 'Executive Summary',
    riskLevel: 'Risk Level',
    healthScore: 'Health Score',
    competitors: 'Identified Competitors',
    growthAnalysis: 'Growth Analysis',
    forwardLooking: 'Forward-Looking Indicators',
    groupStructure: 'Group Structure',
    financialHistory: 'Financial History',
    maHistory: 'M&A History',
    pressHits: 'Press Mentions',
    bodaccEvents: 'BODACC Events',
    subsidiaries: 'Subsidiaries',
    representatives: 'Legal Representatives',
    confidence: {
      confirmed_registry: 'Registry Confirmed',
      confirmed_press: 'Press Confirmed',
      unconfirmed: 'Unconfirmed'
    },
    risk: {
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      critical: 'CRITICAL'
    }
  },
  fr: {
    forces: 'Forces',
    faiblesses: 'Faiblesses',
    executiveSummary: 'Résumé Exécutif',
    riskLevel: 'Niveau de Risque',
    healthScore: 'Score de Santé',
    competitors: 'Concurrents Identifiés',
    growthAnalysis: 'Analyse de Croissance',
    forwardLooking: 'Indicateurs Prospectifs',
    groupStructure: 'Structure de Groupe',
    financialHistory: 'Historique Financier',
    maHistory: 'Historique M&A',
    pressHits: 'Mentions Presse',
    bodaccEvents: 'Événements BODACC',
    subsidiaries: 'Filiales',
    representatives: 'Représentants Légaux',
    confidence: {
      confirmed_registry: 'Confirmé Registre',
      confirmed_press: 'Confirmé Presse',
      unconfirmed: 'Non Confirmé'
    },
    risk: {
      low: 'FAIBLE',
      medium: 'MOYEN',
      high: 'ÉLEVÉ',
      critical: 'CRITIQUE'
    }
  }
};

const aiPrompts = {
  en: {
    dueDiligenceSystem: `You are an expert M&A analyst specialized in mid-market due diligence. Analyze the company data provided and return ONLY valid JSON according to the requested schema. No text before or after the JSON. No markdown blocks. Be factual, sourced, no speculation. ALL text output (summaries, strengths, weaknesses, descriptions) MUST be in English.`,
    
    competitorRules: `COMPETITORS: identify competitors whose FRANCE revenue is in the 0.5x to 2x range of the target's consolidated revenue. For example if target makes €62M, competitors should be between €30M and €125M revenue IN FRANCE (not worldwide). NEVER cite worldwide/global revenue — always France revenue. NEVER Big 4 (KPMG, Deloitte, EY, PwC). NEVER Mazars (>€1B worldwide), Fiducial (>€2B worldwide) unless their France revenue is comparable. For a mid-market French accounting firm at €62M, think rather: In Extenso (~€60-70M France), Baker Tilly (~€60M France), RSM (~€55M France), Grant Thornton (~€60-80M France), Crowe (~€40M France).`,
    
    strengthsWeaknessesRules: `- Minimum 3 strengths and 3 weaknesses
- Each must be 2-3 sentences with specific numbers, dates, or facts
- No generic statements
- Reference specific data from the provided information`
  },
  fr: {
    dueDiligenceSystem: `Vous êtes un analyste M&A expert spécialisé dans la due diligence mid-market. Analysez les données d'entreprise fournies et retournez UNIQUEMENT du JSON valide selon le schéma demandé. Pas de texte avant ou après le JSON. Pas de blocs markdown. Soyez factuel, sourcé, sans spéculation. TOUTES les sorties textuelles (résumés, forces, faiblesses, descriptions) DOIVENT être en français.`,
    
    competitorRules: `CONCURRENTS : identifiez des concurrents dont le CA FRANCE est dans la fourchette 0.5x à 2x du CA consolidé de la cible. Par exemple si la cible fait 62M€, les concurrents doivent être entre 30M€ et 125M€ de CA EN FRANCE (pas mondial). JAMAIS citer un CA mondial/global — toujours le CA France. JAMAIS les Big 4 (KPMG, Deloitte, EY, PwC). JAMAIS Mazars (>1B€ mondial), Fiducial (>2B€ mondial) sauf si leur CA France est comparable. Pour un cabinet comptable mid-market français à 62M€, pensez plutôt : In Extenso (~60-70M€ France), Baker Tilly (~60M€ France), RSM (~55M€ France), Grant Thornton (~60-80M€ France), Crowe (~40M€ France).`,
    
    strengthsWeaknessesRules: `- Minimum 3 forces et 3 faiblesses
- Chacune doit faire 2-3 phrases avec des chiffres, dates ou faits spécifiques
- Pas d'affirmations génériques
- Référencer des données spécifiques des informations fournies`
  }
};

let currentLanguage = 'en';

/**
 * Set the current language
 */
export function setLanguage(lang) {
  if (lang && (lang === 'en' || lang === 'fr')) {
    currentLanguage = lang;
  }
}

/**
 * Get current language
 */
export function getLanguage() {
  return currentLanguage;
}

/**
 * Get a translated label
 */
export function t(key, fallback = key) {
  const keys = key.split('.');
  let value = labels[currentLanguage];
  
  for (const k of keys) {
    if (value && typeof value === 'object' && value[k]) {
      value = value[k];
    } else {
      return fallback;
    }
  }
  
  return value || fallback;
}

/**
 * Get AI prompt text in current language
 */
export function getPrompt(key) {
  return aiPrompts[currentLanguage]?.[key] || aiPrompts.en[key] || '';
}

/**
 * Get localized date format
 */
export function formatDate(date, options = {}) {
  const locale = currentLanguage === 'fr' ? 'fr-FR' : 'en-US';
  return new Date(date).toLocaleDateString(locale, options);
}

/**
 * Get localized number format
 */
export function formatNumber(num, options = {}) {
  const locale = currentLanguage === 'fr' ? 'fr-FR' : 'en-US';
  return new Intl.NumberFormat(locale, options).format(num);
}

/**
 * Format currency in current locale
 */
export function formatCurrency(amount, currency = 'EUR') {
  const locale = currentLanguage === 'fr' ? 'fr-FR' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency
  }).format(amount);
}