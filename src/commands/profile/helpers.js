import chalk from 'chalk';

/**
 * Extract and validate JSON from AI response text.
 * Handles direct JSON, markdown fences, and embedded JSON blocks.
 */
export function extractAIJSON(text) {
  if (!text) {
    console.error('❌ Empty AI response received');
    return null;
  }

  if (process.env.DEBUG_AI) {
    console.log('🔍 Raw AI response:', text.substring(0, 200) + '...');
  }

  // Try three strategies: direct parse, stripped markdown, regex extract
  const strategies = [
    () => JSON.parse(text),
    () => JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()),
    () => { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('no match'); },
  ];

  for (const strategy of strategies) {
    try {
      const parsed = strategy();
      if (parsed && typeof parsed === 'object') {
        normalizeStrengthsWeaknesses(parsed);
      }
      return parsed;
    } catch (e) {
      if (process.env.DEBUG_AI) console.log('JSON parse attempt failed:', e.message);
    }
  }

  console.error('❌ Failed to parse AI response as JSON. Run with DEBUG_AI=1 for details.');
  return null;
}

function normalizeStrengthsWeaknesses(parsed) {
  for (const key of ['strengths', 'weaknesses']) {
    if (parsed[key] && !Array.isArray(parsed[key])) {
      parsed[key] = [];
    }
    if (parsed[key]) {
      parsed[key] = parsed[key].map(s =>
        typeof s === 'string' ? { text: s, confidence: 'unconfirmed' } : s
      );
    }
  }
}

export function printRow(label, value, coloredValue) {
  const padded = label.padEnd(16);
  const display = coloredValue ?? (value != null ? chalk.white(value) : chalk.gray('—'));
  console.log(chalk.gray(`     ${padded}: `) + display);
}

export function formatNum(n) {
  return Number(n).toLocaleString('fr-FR');
}

export function formatEuro(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2).replace('.', ',')} Md€`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')} M€`;
  if (abs >= 1_000) return `${sign}${formatNum(Math.round(abs / 1_000))} K€`;
  return `${sign}${formatNum(abs)} €`;
}

/**
 * Build M&A history IN CODE from scraped articles + off-brand subsidiaries
 * + BODACC publications (capital increases, dénomination changes, etc).
 * Returns entries with authoritative dates — AI only adds descriptions.
 */
export function buildMaHistoryFromCode(scrapedMaContent, offBrandSubs, bodacc = []) {
  const MONTH_MAP = {
    'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
    'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
    'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12',
  };
  const OP_TYPE_MAP = {
    'intégration': 'merger', 'acquisition': 'acquisition', 'rachat': 'acquisition',
    'rapprochement': 'merger', 'entrée au capital': 'capital_increase',
    'levée': 'fundraising', 'fusion': 'merger', 'cession': 'cession',
  };

  const entries = [];
  const seen = new Set();

  for (const art of scrapedMaContent) {
    const text = (art.content || '').toLowerCase();
    const sourceUrl = art.url;

    // Pattern 1: "OPTYPE de/du/avec/auprès de X en [MOIS] YYYY"
    const p1 = /(intégration|acquisition|rachat|rapprochement|entr[eé]e au capital|lev[eé]e|fusion)\s+(?:de |d'|du |avec |du cabinet |aupr[eè]s de )?([a-zéèêëàâçîïôùûüœæ0-9\s&'.,-]{2,35}?)\s+en\s+(?:(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+)?(20\d{2})/gi;
    let m;
    while ((m = p1.exec(text)) !== null) {
      const opRaw = m[1].toLowerCase().trim();
      const entity = m[2].trim().replace(/[,.]$/, '');
      const monthRaw = m[3];
      const year = m[4];
      const month = monthRaw ? MONTH_MAP[monthRaw.toLowerCase()] : null;
      const date = month ? `${year}-${month}` : year;
      let opType = 'acquisition';
      for (const [k, v] of Object.entries(OP_TYPE_MAP)) {
        if (opRaw.includes(k)) { opType = v; break; }
      }
      const key = `${entity.toLowerCase().substring(0, 15)}|${date}`;
      if (seen.has(key) || entity.length < 2) continue;
      seen.add(key);
      entries.push({ date, type: opType, target: entity, sourceUrl, confidence: 'confirmed_press', description: null });
    }

    // Pattern 2: "DD MOIS YYYY [description containing known entities]"
    const p2 = /(\d{1,2})\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre)\s+(20\d{2})\s+([^.\n]{10,80})/gi;
    while ((m = p2.exec(text)) !== null) {
      const snippet = m[4].trim();
      const knownEntities = ['ik partners', 'bpifrance', 'bpi france', 'zalis', 'exelmans', 'alcyon', 'bc conseil', 'mageia'];
      const foundEntity = knownEntities.find(e => snippet.includes(e));
      if (!foundEntity) continue;
      const month = MONTH_MAP[m[2].toLowerCase().replace(/é/g, 'e').replace(/û/g, 'u').replace(/è/g, 'e')
        || m[2].toLowerCase()];
      const date = `${m[3]}-${month}`;
      const typeGuess = /lev[eé]e|capital|fonds/i.test(snippet) ? 'capital_increase'
        : /rapprochement|intègre|rejoins/i.test(snippet) ? 'merger' : 'acquisition';
      const key = `${foundEntity}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ date, type: typeGuess, target: foundEntity, sourceUrl, confidence: 'confirmed_press', description: null });
    }
  }

  // ── BODACC : capital increases + dénomination changes (deterministic) ──
  // Pour les holdings (NOVARES, etc.), les augmentations de capital + les
  // modifs de dénomination/forme juridique constituent la trame factuelle
  // de l'histoire corporate. Bien plus fiable que parser de la prose presse.
  // Trie BODACC par date croissante pour que le suivi du capital soit chrono
  const bodaccChrono = [...bodacc].filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
  let lastCapitalGlobal = 0;
  for (const pub of bodaccChrono) {
    const date = pub.date;
    if (!date) continue;
    const desc = (pub.description || '').toLowerCase();
    const type = (pub.type || '').toLowerCase();

    // Capital increases — montant strictement supérieur au précédent (sinon re-dépôt)
    if (pub.capital && (desc.includes('capital') || type.includes('capital') || desc.includes('augmentation'))) {
      // Skip si pas de hausse ≥ 0.5% (re-filing du même capital social)
      if (lastCapitalGlobal > 0 && pub.capital <= lastCapitalGlobal * 1.005) continue;
      lastCapitalGlobal = pub.capital;
      const key = `capital|${date.substring(0, 7)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        date: date.substring(0, 7),
        type: 'capital_increase',
        target: `Capital ${(pub.capital / 1e3).toFixed(0)}K€`,
        sourceUrl: pub.url || null,
        confidence: 'confirmed_registry',
        description: null,
      });
    }

    // Dénomination changes (rename) — Mecaplast → NOVARES type events
    if (desc.includes('modification de la dénomination') || desc.includes('modification de la denomination')) {
      const key = `rename|${date.substring(0, 7)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        date: date.substring(0, 7),
        type: 'restructuration',
        target: 'Changement de dénomination',
        sourceUrl: pub.url || null,
        confidence: 'confirmed_registry',
        description: null,
      });
    }

    // Procédures collectives / sauvegarde (signal de restructuration)
    if (pub.isDistress) {
      const key = `distress|${date.substring(0, 7)}|${pub.distressType || pub.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        date: date.substring(0, 7),
        type: 'restructuration',
        target: `Procédure ${pub.distressType || pub.type || 'collective'}`,
        sourceUrl: pub.url || null,
        confidence: 'confirmed_registry',
        description: null,
      });
    }
  }

  // Add off-brand subsidiaries not already matched (confirmed_registry)
  for (const sub of offBrandSubs) {
    const subWords = (sub.name || '').toLowerCase().split(' ').filter(w => w.length > 2);
    const alreadyCovered = entries.some(e => {
      const entTarget = (e.target || '').toLowerCase();
      return subWords.some(w => entTarget.includes(w)) ||
        (e.target || '').toLowerCase().split(' ').some(w => w.length > 2 && (sub.name || '').toLowerCase().includes(w));
    });
    if (alreadyCovered || !sub.dateCreation) continue;
    const date = sub.dateCreation.substring(0, 7); // YYYY-MM
    const key = `${(sub.name || '').toLowerCase().substring(0, 15)}|registry`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ date, type: 'acquisition', target: sub.name, sourceUrl: null, confidence: 'confirmed_registry', description: null });
  }

  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return entries;
}
