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

export function analyzeSentiment(text, lang = 'auto') {
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

  const score = positiveHits.length - negativeHits.length;
  let label;
  if (score > 1) label = 'positive';
  else if (score < -1) label = 'negative';
  else if (negativeHits.length > 0) label = 'slightly_negative';
  else if (positiveHits.length > 0) label = 'slightly_positive';
  else label = 'neutral';

  return { score, label, positiveHits: positiveHits.slice(0, 5), negativeHits: negativeHits.slice(0, 5) };
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
