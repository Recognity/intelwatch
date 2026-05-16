// MH1 — Executive Summary block (PDF page 1)
//
// Pure in→out builder consumed by the intel-report renderer.
// Cohen-mode : taxi-scan 30s, iPhone SE 375px. Pas de console.log ici, c'est
// un builder, pas du CLI. Pas de catch silencieux : on log si on swallow.
//
// Contrat de sortie :
//   {
//     thesis: string (60 mots max),
//     topRedFlags: [{label, severity, evidence, sourceUrl}] (exactement 3, padding "—"),
//     recommendation: 'distressed_ma'|'watchlist'|'pass',
//     recoLabel: string FR
//   }
//
// Logique recommandation :
//   - score < 40 ET ≥ 2 distress signals → distressed_ma
//   - score 40..65 OU ≥ 1 procédure       → watchlist
//   - sinon                                → pass

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const FILLER_FLAG = Object.freeze({
  label: '—',
  severity: 'info',
  evidence: '—',
  sourceUrl: null,
});

const RECO_LABELS = {
  distressed_ma: 'Distressed M&A — pitch immédiat',
  watchlist:     'Watchlist — surveiller',
  pass:          'Pass — pas de signal actionnable',
};

/**
 * Compte les présidents distincts apparus dans la fenêtre `windowMonths`.
 * keyManRisk peut être fourni directement par le caller (préféré). Fallback :
 * sniff BODACC type=modification + qualité Président depuis la trame brute.
 */
function countPresidentsInWindow(keyManRisk, bodacc, windowMonths = 18) {
  if (keyManRisk && typeof keyManRisk.presidentsInWindow === 'number') {
    return {
      count: keyManRisk.presidentsInWindow,
      windowMonths: keyManRisk.windowMonths || windowMonths,
      evidence: keyManRisk.evidence || null,
      sourceUrl: keyManRisk.sourceUrl || null,
    };
  }

  if (!Array.isArray(bodacc) || bodacc.length === 0) {
    return { count: 0, windowMonths, evidence: null, sourceUrl: null };
  }

  // Fenêtre = max(date BODACC) - windowMonths
  const dates = bodacc
    .map((p) => p && p.date)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) {
    return { count: 0, windowMonths, evidence: null, sourceUrl: null };
  }
  const maxDate = dates[dates.length - 1];
  const [maxY, maxM] = maxDate.substring(0, 7).split('-').map(Number);
  const cutoffM = maxM - windowMonths;
  const cutoff = new Date(Date.UTC(maxY, cutoffM - 1, 1));

  const names = new Set();
  let firstEvidenceUrl = null;
  for (const pub of bodacc) {
    if (!pub || !pub.date) continue;
    const d = new Date(pub.date);
    if (Number.isNaN(d.getTime()) || d < cutoff) continue;
    const desc = String(pub.description || '').toLowerCase();
    if (!desc.includes('président') && !desc.includes('president')) continue;
    // pattern "président : <Nom>" ou "nomination de <Nom> en qualité de président"
    const m =
      desc.match(/pr[eé]sident\s*[:\-–]\s*([a-zà-ÿ' -]{3,60})/i) ||
      desc.match(/(?:nomination|d[eé]signation)\s+de\s+([a-zà-ÿ' -]{3,60})\s+en\s+qualit[eé]\s+de\s+pr[eé]sident/i);
    if (m && m[1]) {
      names.add(m[1].trim().toLowerCase().replace(/\s+/g, ' '));
      if (!firstEvidenceUrl) firstEvidenceUrl = pub.url || null;
    }
  }

  return {
    count: names.size,
    windowMonths,
    evidence: names.size > 0 ? `${names.size} dirigeants distincts au poste de Président sur ${windowMonths} mois (BODACC)` : null,
    sourceUrl: firstEvidenceUrl,
  };
}

/**
 * Compte les distress signals (BODACC isDistress=true + procédures).
 */
function countDistressSignals(bodacc) {
  if (!Array.isArray(bodacc)) return { count: 0, types: [], firstUrl: null };
  const distress = bodacc.filter((b) => b && b.isDistress);
  const types = Array.from(new Set(distress.map((d) => d.distressType || d.type).filter(Boolean)));
  return {
    count: distress.length,
    types,
    firstUrl: distress[0]?.url || null,
    firstDate: distress[0]?.date || null,
    firstType: distress[0]?.distressType || distress[0]?.type || null,
  };
}

/**
 * Net Debt / EBITDA ratio (group level si dispo).
 * Accepte ratios pré-calculé OU dérive depuis les chiffres consolidés.
 */
function computeLeverage(ratios) {
  if (!ratios) return null;
  if (typeof ratios.netDebtEbitda === 'number' && Number.isFinite(ratios.netDebtEbitda)) {
    return { value: ratios.netDebtEbitda, year: ratios.year || null };
  }
  const { netDebt, ebitda, dettesFinancieres, tresorerie } = ratios;
  const nd = typeof netDebt === 'number' ? netDebt : (typeof dettesFinancieres === 'number' ? dettesFinancieres - (tresorerie || 0) : null);
  if (typeof nd !== 'number' || typeof ebitda !== 'number' || ebitda <= 0) return null;
  return { value: nd / ebitda, year: ratios.year || null };
}

/**
 * Construit la thèse 60 mots max — phrase verdict actionnable.
 */
function buildThesis({ identity, healthScoreVal, distressSignals, presidentsInWindow, leverage, recapSignal, aiSummary }) {
  const name = (identity && identity.name) || 'La cible';
  const parts = [];

  if (healthScoreVal != null) {
    parts.push(`Score santé ${healthScoreVal}/100`);
  }

  const distressPieces = [];
  if (distressSignals.count > 0) {
    const typeLabel = (distressSignals.firstType || 'procédure').replace(/_/g, ' ');
    distressPieces.push(`${distressSignals.count} signal${distressSignals.count > 1 ? 's' : ''} distress (${typeLabel})`);
  }
  if (presidentsInWindow.count >= 3) {
    distressPieces.push(`${presidentsInWindow.count} présidents en ${presidentsInWindow.windowMonths}m`);
  }
  if (leverage && leverage.value > 5) {
    distressPieces.push(`Net Debt/EBITDA ${leverage.value.toFixed(1)}×`);
  }
  if (recapSignal) {
    distressPieces.push('recap signal capital');
  }

  let thesis;
  if (distressPieces.length >= 2) {
    thesis = `${name} : ${distressPieces.slice(0, 3).join(', ')}. ${parts.join('. ')}. Fenêtre distressed M&A ouverte — pitch immédiat (restructuring / conciliation L.611-10).`;
  } else if (distressPieces.length === 1) {
    thesis = `${name} : ${distressPieces[0]}. ${parts.join('. ')}. Watchlist : monitorer trimestriellement, prêt à pitcher si dégradation.`;
  } else if (aiSummary && typeof aiSummary === 'string') {
    // Fallback narratif AI (déjà condensé en amont)
    thesis = `${name} : ${aiSummary.replace(/\s+/g, ' ').trim()}`;
  } else {
    thesis = `${name} : pas de signal distress matériel. ${parts.join('. ')}. Pas d'angle actionnable pour Recognity sur la fenêtre observée.`;
  }

  // Hard cap 60 mots
  const words = thesis.split(/\s+/).filter(Boolean);
  if (words.length > 60) {
    return words.slice(0, 60).join(' ').replace(/[.,;:]$/, '') + '…';
  }
  return thesis;
}

/**
 * Construit la liste des red flags candidats, puis garde le top-3 par sévérité.
 */
function buildRedFlags({ distressSignals, presidentsInWindow, leverage, riskAssessment, bodacc }) {
  const candidates = [];

  // 1) Procédure collective / distress BODACC
  if (distressSignals.count > 0) {
    const typeLabel = (distressSignals.firstType || 'procédure').replace(/_/g, ' ');
    candidates.push({
      label: `Procédure ${typeLabel}`,
      severity: 'critical',
      evidence: `${distressSignals.count} publication${distressSignals.count > 1 ? 's' : ''} BODACC distress${distressSignals.firstDate ? ` (depuis ${distressSignals.firstDate})` : ''}`,
      sourceUrl: distressSignals.firstUrl,
    });
  }

  // 2) Churn présidence
  if (presidentsInWindow.count >= 3) {
    candidates.push({
      label: `${presidentsInWindow.count} présidents en ${presidentsInWindow.windowMonths} mois`,
      severity: presidentsInWindow.count >= 4 ? 'critical' : 'high',
      evidence: presidentsInWindow.evidence || 'Churn dirigeants détecté via BODACC',
      sourceUrl: presidentsInWindow.sourceUrl,
    });
  }

  // 3) Levier financier
  if (leverage && leverage.value > 7) {
    candidates.push({
      label: `Net Debt/EBITDA ${leverage.value.toFixed(1)}×`,
      severity: 'critical',
      evidence: `Levier >7× sur dernier exercice${leverage.year ? ` (${leverage.year})` : ''} — zone covenant breach`,
      sourceUrl: null,
    });
  } else if (leverage && leverage.value > 5) {
    candidates.push({
      label: `Net Debt/EBITDA ${leverage.value.toFixed(1)}×`,
      severity: 'high',
      evidence: `Levier élevé sur dernier exercice${leverage.year ? ` (${leverage.year})` : ''}`,
      sourceUrl: null,
    });
  }

  // 4) Flags AI riskAssessment — complète si on n'a pas atteint 3
  if (riskAssessment && Array.isArray(riskAssessment.flags)) {
    for (const f of riskAssessment.flags) {
      if (!f || !f.text) continue;
      candidates.push({
        label: String(f.text).split(/[.!?]/)[0].slice(0, 80),
        severity: f.severity || 'medium',
        evidence: String(f.text).slice(0, 180),
        sourceUrl: f.sourceUrl || null,
      });
    }
  }

  // 5) BODACC dernier événement matériel — backup
  if (candidates.length < 3 && Array.isArray(bodacc)) {
    const lastMaterial = bodacc.find((b) => b && b.severity && b.severity !== 'info');
    if (lastMaterial) {
      candidates.push({
        label: `BODACC : ${(lastMaterial.type || 'événement').slice(0, 40)}`,
        severity: lastMaterial.severity || 'medium',
        evidence: (lastMaterial.description || '').slice(0, 180) || '—',
        sourceUrl: lastMaterial.url || null,
      });
    }
  }

  // Dedupe par signature normalisée (cas "Procédure conciliation" vs
  // "BODACC : Procédure de conciliation" = même signal sous deux labels).
  // signature = lowercase, strip "bodacc :", strip "procédure (de) ", strip non-alphanumérique.
  const signatureOf = (label) =>
    String(label || '')
      .toLowerCase()
      .replace(/^bodacc\s*:\s*/i, '')
      .replace(/proc[eé]dure(\s+de)?\s*/gi, '')
      .replace(/[^a-z0-9]/g, '');

  const bySignature = new Map();
  for (const c of candidates) {
    const sig = signatureOf(c.label);
    if (!sig) {
      // signature vide (label purement ponctuation) — on garde tel quel sous une clé unique
      bySignature.set(`__raw__${bySignature.size}`, c);
      continue;
    }
    const prev = bySignature.get(sig);
    if (!prev) {
      bySignature.set(sig, c);
      continue;
    }
    // Conflit : garder le plus sévère
    const prevSev = SEVERITY_ORDER[prev.severity] || 0;
    const curSev = SEVERITY_ORDER[c.severity] || 0;
    if (curSev > prevSev) {
      bySignature.set(sig, c);
    }
  }
  const deduped = Array.from(bySignature.values());

  // Sort par sévérité desc
  deduped.sort((a, b) => (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0));

  // Pad à exactement 3
  const top = deduped.slice(0, 3);
  while (top.length < 3) top.push({ ...FILLER_FLAG });
  return top;
}

/**
 * Décision recommandation selon scoring + signals.
 *
 * Convention Recognity (validée Anthony) :
 *   - distressed_ma si (score ≤ 40 ET (≥1 procédure OU keyManRisk.flagged)) OU score ≤ 25
 *   - watchlist    si score 40..65 OU ≥1 procédure OU keyManRisk.flagged
 *   - pass         sinon
 *
 * Le `<= 40` (au lieu de `< 40`) est crucial : la borderline bascule rouge.
 * `OR keyManRisk.flagged` rattrape les cas score ambigu mais gouvernance cassée.
 */
function decideRecommendation({ healthScoreVal, distressSignals, presidentsInWindow, leverage, riskAssessment, keyManRisk }) {
  const hasProcedure = distressSignals.count >= 1;
  const keyManFlagged = !!(keyManRisk && keyManRisk.flagged);

  // Distressed M&A
  if (healthScoreVal != null && healthScoreVal <= 25) {
    return 'distressed_ma';
  }
  if (healthScoreVal != null && healthScoreVal <= 40 && (hasProcedure || keyManFlagged)) {
    return 'distressed_ma';
  }
  if (riskAssessment && riskAssessment.overall === 'critical' && hasProcedure) {
    return 'distressed_ma';
  }

  // Watchlist
  if (
    hasProcedure ||
    keyManFlagged ||
    (healthScoreVal != null && healthScoreVal >= 40 && healthScoreVal <= 65) ||
    (riskAssessment && riskAssessment.overall === 'high')
  ) {
    return 'watchlist';
  }

  return 'pass';
}

export function buildExecutiveSummaryBlock({
  healthScore,
  riskAssessment,
  capitalTrajectory,
  bodacc,
  keyManRisk,
  ratios,
  aiSummary,
  identity,
} = {}) {
  // healthScore peut être un number direct OU {score, breakdown}
  let healthScoreVal = null;
  try {
    if (typeof healthScore === 'number') {
      healthScoreVal = healthScore;
    } else if (healthScore && typeof healthScore.score === 'number') {
      healthScoreVal = healthScore.score;
    } else if (healthScore && healthScore.score != null) {
      const parsed = Number(healthScore.score);
      healthScoreVal = Number.isFinite(parsed) ? parsed : null;
    }
  } catch (err) {
    console.error('[executive-summary] healthScore parse failed:', err.message, { healthScore });
    healthScoreVal = null;
  }

  const distressSignals = countDistressSignals(bodacc);
  const presidentsInWindow = countPresidentsInWindow(keyManRisk, bodacc, 18);
  const leverage = computeLeverage(ratios);
  const recapSignal = !!(capitalTrajectory && capitalTrajectory.hasRecapSignal);

  const thesis = buildThesis({
    identity,
    healthScoreVal,
    distressSignals,
    presidentsInWindow,
    leverage,
    recapSignal,
    aiSummary,
  });

  const topRedFlags = buildRedFlags({
    distressSignals,
    presidentsInWindow,
    leverage,
    riskAssessment,
    bodacc,
  });

  const recommendation = decideRecommendation({
    healthScoreVal,
    distressSignals,
    presidentsInWindow,
    leverage,
    riskAssessment,
    keyManRisk,
  });

  return {
    thesis,
    topRedFlags,
    recommendation,
    recoLabel: RECO_LABELS[recommendation],
  };
}
