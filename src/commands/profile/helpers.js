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

  // Try four strategies. Last one salvages partial fields even when JSON
  // is truncated (Gemini 3.1 Pro returns cut-off JSON beyond maxTokens —
  // cf. memory `project_gemini_31_pro_degradation`).
  const strategies = [
    () => JSON.parse(text),
    () => JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()),
    () => { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('no match'); },
    // Salvage : extract top-level string fields even from truncated/broken JSON
    () => salvagePartialJSON(text),
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

/**
 * Salvage les champs string top-level d'un JSON tronqué ou cassé. Permet
 * de récupérer au moins l'executiveSummary quand l'IA coupe à maxTokens.
 * Ne traite que les champs strings simples (pas d'objets/arrays imbriqués).
 */
function salvagePartialJSON(text) {
  const result = {};
  const fields = [
    'executiveSummary', 'aiComment', 'description', 'summary',
    'recoLabel', 'narrative',
  ];
  for (const field of fields) {
    // Regex multi-line, gère échappements \" et \\
    const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const match = text.match(re);
    if (match && match[1]) {
      result[field] = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  if (Object.keys(result).length === 0) {
    throw new Error('salvage extracted nothing');
  }
  if (process.env.DEBUG_AI) console.log(`🩹 Salvaged ${Object.keys(result).length} fields from broken JSON`);
  return result;
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
  let lastCapitalDate = null;
  for (const pub of bodaccChrono) {
    const date = pub.date;
    if (!date) continue;
    const desc = (pub.description || '').toLowerCase();
    const type = (pub.type || '').toLowerCase();

    // Capital increases — montant strictement supérieur au précédent (sinon re-dépôt)
    if (pub.capital && (desc.includes('capital') || type.includes('capital') || desc.includes('augmentation'))) {
      // Skip si pas de hausse ≥ 0.5% (re-filing du même capital social)
      if (lastCapitalGlobal > 0 && pub.capital <= lastCapitalGlobal * 1.005) continue;
      const prevCapital = lastCapitalGlobal;
      const prevDate = lastCapitalDate;
      lastCapitalGlobal = pub.capital;
      lastCapitalDate = date;
      const key = `capital|${date.substring(0, 7)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        date: date.substring(0, 7),
        type: 'capital_increase',
        target: `Capital ${(pub.capital / 1e3).toFixed(0)}K€`,
        sourceUrl: pub.url || null,
        confidence: 'confirmed_registry',
        description: `Augmentation du capital social à ${(pub.capital / 1e3).toFixed(0)} K€${prevCapital > 0 ? ` (delta +${((pub.capital - prevCapital) / 1e3).toFixed(0)} K€ vs ${prevDate.substring(0, 7)})` : ' (création / capital initial)'}. Publication BODACC.`,
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
        description: "Changement de dénomination sociale enregistré au registre. Signal de repositionnement marque ou refonte d'identité corporate.",
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
        description: `Procédure ${pub.distressType?.replace('_', ' ') || pub.type}. Signal de restructuration ${pub.procedureCategory || 'judiciaire'}.`,
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
    entries.push({
      date,
      type: 'acquisition',
      target: sub.name,
      sourceUrl: null,
      confidence: 'confirmed_registry',
      description: `Filiale ${sub.name} acquise (créée ou rattachée le ${sub.dateCreation}). ${sub.ca ? `Activité ${(sub.ca / 1e6).toFixed(1)} M€ (${sub.annee}).` : ''}`,
    });
  }

  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return entries;
}

/**
 * Build capital trajectory narrative from BODACC publications.
 * Detects recap signals (LBO secondaire / nouvelle entrée investisseur) via
 * sauts massifs (≥50%) sur le capital social. Skip re-filings (<0.5%).
 * Renvoie { events, narrative, hasRecapSignal, maxDeltaPct } pour exposition PDF.
 */
export function buildCapitalTrajectory(bodacc = []) {
  // 1. Filtre + tri chrono
  const pubs = (bodacc || [])
    .filter(p => p && p.capital && p.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const events = [];
  let prevCapital = 0;
  let prevDate = null;

  for (const pub of pubs) {
    const capital = pub.capital;
    const date = pub.date;

    if (prevCapital === 0) {
      events.push({
        date,
        capital,
        deltaPct: null,
        deltaAbs: 0,
        pattern: 'capital_initial',
      });
      prevCapital = capital;
      prevDate = date;
      continue;
    }

    const deltaAbs = capital - prevCapital;
    const deltaPct = (capital / prevCapital - 1) * 100;

    // Skip re-filings (sub-0.5% jitter)
    if (Math.abs(deltaPct) < 0.5) continue;

    // Shell-seed reset : si on part d'un capital social ≤ 10 K€ (constitution
    // d'une coquille), le premier saut "réel" doit être marqué `capital_initial`
    // au lieu d'un % à 4 chiffres absurde — sinon le narrative dit "passé de
    // 1K€ à 454M€ soit 45 millions de pourcents", ce qui détruit la lecture.
    const isShellSeed = prevCapital <= 10_000 && capital > prevCapital * 100;
    if (isShellSeed) {
      events.push({ date, capital, deltaPct: null, deltaAbs, pattern: 'capital_initial' });
      prevCapital = capital;
      prevDate = date;
      continue;
    }

    let pattern;
    if (deltaPct >= 50) pattern = 'recap_signal';
    else if (deltaPct >= 10) pattern = 'augmentation_significative';
    else pattern = 'augmentation_mineure';

    events.push({ date, capital, deltaPct, deltaAbs, pattern });
    prevCapital = capital;
    prevDate = date;
  }

  // 3-4. Build narrative + flags
  let narrative;
  let hasRecapSignal = false;
  let maxDeltaPct = 0;
  let maxDeltaDate = null;

  for (const ev of events) {
    if (ev.pattern === 'recap_signal') hasRecapSignal = true;
    if (ev.deltaPct != null && ev.deltaPct > maxDeltaPct) {
      maxDeltaPct = ev.deltaPct;
      maxDeltaDate = ev.date;
    }
  }

  if (events.length >= 2) {
    // Base de référence : dernier `capital_initial` ou shell-seed plutôt que
    // tout premier event (constitution coquille avec 1 K€ fausse le %).
    const meaningfulStart = (() => {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].pattern === 'capital_initial') return events[i];
      }
      return events[0];
    })();
    const last = events[events.length - 1];
    const startCapital = meaningfulStart.capital;
    const totalPct = startCapital > 0
      ? ((last.capital / startCapital - 1) * 100).toFixed(0)
      : null;
    const startMonth = meaningfulStart.date.substring(0, 7);
    const endMonth = last.date.substring(0, 7);

    // Span en mois
    const [sy, sm] = startMonth.split('-').map(Number);
    const [ey, em] = endMonth.split('-').map(Number);
    const months = Math.max(1, (ey - sy) * 12 + (em - sm));
    const spanLabel = months >= 12 ? `${(months / 12).toFixed(1)} ans` : `${months} mois`;

    const recapPart = hasRecapSignal
      ? `Recap signal détecté : saut de ${maxDeltaPct.toFixed(0)}% en ${maxDeltaDate.substring(0, 7)}, pattern typique d'entrée d'investisseur (LBO secondaire ou augmentation de tour majeure).`
      : "Trajectoire d'augmentations progressives, pas de recap signal majeur.";

    const fmtK = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' M€' : (n / 1e3).toFixed(0) + ' K€';
    narrative = `Capital social passé de ${fmtK(startCapital)} (${startMonth}) à ${fmtK(last.capital)} (${endMonth})${totalPct != null ? `, soit ${totalPct}%` : ''} sur ${spanLabel}. ${recapPart}`;
  } else {
    narrative = 'Capital social inchangé sur la période observée.';
  }

  return { events, narrative, hasRecapSignal, maxDeltaPct };
}
