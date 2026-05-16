import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../../data');

let wordLists = null;

function loadWordLists() {
  if (wordLists) return wordLists;
  wordLists = {
    negativeEn: JSON.parse(readFileSync(join(dataDir, 'negative-words-en.json'), 'utf8')),
    negativeFr: JSON.parse(readFileSync(join(dataDir, 'negative-words-fr.json'), 'utf8')),
    positiveEn: JSON.parse(readFileSync(join(dataDir, 'positive-words-en.json'), 'utf8')),
    positiveFr: JSON.parse(readFileSync(join(dataDir, 'positive-words-fr.json'), 'utf8')),
  };
  return wordLists;
}

// Lexique distress FR — pondéré ×1.5 dans le scoring sentiment. Capte les
// signaux faibles de restructuration que les lexiques généralistes ratent
// (cf. audit OSINT review 15/05 — NOVARES press classait "procédure
// collective", "grève", "sauvé in extremis" en neutral).
const DISTRESS_FR = [
  'procédure collective', 'procedure collective', 'redressement judiciaire',
  'liquidation judiciaire', 'sauvegarde', 'conciliation', 'mandat ad hoc',
  'plan de continuation', 'plan de cession', 'plan social', 'pse',
  'cessation de paiement', 'cessation des paiements',
  'grève', 'greve', 'grève illimitée',
  'fermeture du site', 'fermeture de l\'usine', 'fermeture de site',
  'sauvé in extremis', 'sauve in extremis', 'sauvé à la dernière minute',
  'au bord du dépôt de bilan', 'au bord du depot de bilan',
  'repris par', 'racheté par', 'rachete par', 'va changer de mains',
  'dépôt de bilan', 'depot de bilan',
  'restructuration financière', 'restructuration financiere',
  'difficultés financières', 'difficultes financieres',
  'pertes massives', 'perte massive',
  'suppression de postes', 'suppression d\'emplois',
];

// Domaines qui = annonces légales / signaux distress structurels.
const DISTRESS_DOMAINS = [
  'annonces-legales.lefigaro.fr',
  'annonces-legales.com',
  'lexpansion.lexpress.fr',
  'bodacc.fr',
  'jal-officiel.com',
];

function detectDistressSignals(lower, domain) {
  const hits = [];
  for (const k of DISTRESS_FR) {
    if (lower.includes(k)) hits.push(k);
  }
  const domainBoost = domain && DISTRESS_DOMAINS.some(d => domain.includes(d));
  return { hits, domainBoost };
}

export function analyzeSentiment(text, lang = 'auto', context = {}) {
  if (!text) return { score: 0, label: 'neutral', positiveHits: [], negativeHits: [] };

  const lists = loadWordLists();
  const lower = text.toLowerCase();

  const negativeLists = lang === 'fr'
    ? [lists.negativeFr]
    : lang === 'en'
    ? [lists.negativeEn]
    : [lists.negativeEn, lists.negativeFr];

  const positiveLists = lang === 'fr'
    ? [lists.positiveFr]
    : lang === 'en'
    ? [lists.positiveEn]
    : [lists.positiveEn, lists.positiveFr];

  const negativeHits = [];
  for (const list of negativeLists) {
    for (const word of list) {
      if (lower.includes(word.toLowerCase()) && !negativeHits.includes(word)) {
        negativeHits.push(word);
      }
    }
  }

  const positiveHits = [];
  for (const list of positiveLists) {
    for (const word of list) {
      if (lower.includes(word.toLowerCase()) && !positiveHits.includes(word)) {
        positiveHits.push(word);
      }
    }
  }

  // Boost distress (lexique restructuring FR) : pondère négatif ×1.5
  const distress = detectDistressSignals(lower, context.domain || '');
  const distressWeight = distress.hits.length * 1.5 + (distress.domainBoost ? 2 : 0);

  const score = positiveHits.length - negativeHits.length - distressWeight;
  let label;
  if (score >= 2) label = 'positive';
  else if (score <= -2) label = 'negative';
  else if (distress.hits.length > 0 || distress.domainBoost) label = 'negative';
  else if (negativeHits.length > 0) label = 'slightly_negative';
  else if (positiveHits.length > 0) label = 'slightly_positive';
  else label = 'neutral';

  return {
    score,
    label,
    positiveHits: positiveHits.slice(0, 5),
    negativeHits: [...negativeHits, ...distress.hits].slice(0, 5),
    distressHits: distress.hits,
  };
}

export function sentimentEmoji(label) {
  switch (label) {
    case 'positive': return '😊';
    case 'slightly_positive': return '🙂';
    case 'neutral': return '😐';
    case 'slightly_negative': return '😕';
    case 'negative': return '😞';
    default: return '❓';
  }
}

export function categorizeMention(url, title, snippet) {
  const text = `${url} ${title} ${snippet}`.toLowerCase();

  if (/techcrunch|wired|reuters|bloomberg|bbc|forbes|businessinsider|wsj|nytimes|lemonde|lefigaro/.test(text)) {
    return 'press';
  }
  if (/reddit|hacker news|news\.ycombinator|forum|community|discussion|ask\./.test(text)) {
    return 'forum';
  }
  if (/twitter|x\.com|linkedin|facebook|instagram|tiktok|youtube/.test(text)) {
    return 'social';
  }
  if (/trustpilot|g2\.com|capterra|getapp|review|avis|rating/.test(text)) {
    return 'review';
  }
  return 'blog';
}
