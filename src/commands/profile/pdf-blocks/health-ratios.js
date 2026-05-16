import { formatEuro } from '../helpers.js';

/**
 * Health Score block — 6 named financial ratios vs benchmark + BFR drift + Cash Runway.
 *
 * Critique pour Millard ICFOA : il veut "Net Debt/EBITDA 7.8× nommé" avec seuil 3.5×.
 * NOVARES FY2024 doit afficher Net Debt/EBITDA ≥7× status='red'.
 *
 * Convention Recognity :
 *  - Division par zéro / donnée manquante → { value: '—', status: 'unknown' }, PAS de silent catch.
 *  - Pas de mutation des inputs.
 *  - aiHealthScore (0-100) si fourni l'emporte ; sinon score dérivé du nombre de status 'red'/'yellow'.
 */

// ── Utils ──────────────────────────────────────────────────────────────────

/** Source data : préfère consolidatedFinances[0] si non vide, sinon financialHistory[0]. */
function pickLatest(consolidatedFinances, financialHistory) {
  if (Array.isArray(consolidatedFinances) && consolidatedFinances.length > 0) {
    return { latest: consolidatedFinances[0], scope: 'consolidé', source: consolidatedFinances };
  }
  if (Array.isArray(financialHistory) && financialHistory.length > 0) {
    return { latest: financialHistory[0], scope: 'social', source: financialHistory };
  }
  return { latest: null, scope: 'aucun', source: [] };
}

function unknownRatio(name, benchmark, reason) {
  return { name, value: '—', benchmark, status: 'unknown', evidence: reason };
}

/** Number divide guard — explicit unknown if denom is 0 / NaN / null. */
function safeDiv(num, denom) {
  if (num == null || denom == null) return null;
  if (!Number.isFinite(num) || !Number.isFinite(denom)) return null;
  if (denom === 0) return null;
  return num / denom;
}

function fmtMultiple(n) {
  return `${n.toFixed(1).replace('.', ',')}×`;
}

function fmtPct(n, digits = 1) {
  return `${n.toFixed(digits).replace('.', ',')}%`;
}

// ── Ratios calculators ─────────────────────────────────────────────────────

/** Net Debt / EBITDA — seuil ICFOA 3.5× pour distressed M&A. */
function calcNetDebtOverEbitda(latest, scope) {
  const debt = latest.dettesFinancieres;
  const cash = latest.tresorerie;
  const ebitda = latest.ebitda;
  const year = latest.annee || latest.year || '—';

  if (debt == null || ebitda == null) {
    return unknownRatio('Net Debt / EBITDA', '≤3,5×', `Donnée manquante (dettesFinancieres ou ebitda absents, FY${year} ${scope})`);
  }
  const netDebt = debt - (cash || 0);
  const ratio = safeDiv(netDebt, ebitda);
  if (ratio == null) {
    return unknownRatio('Net Debt / EBITDA', '≤3,5×', `EBITDA nul (FY${year} ${scope}) — ratio non calculable`);
  }
  // EBITDA négatif = signal critique : le ratio devient négatif mais le risque est rouge.
  // Seuils ICFOA standard : ≤3,5× green · 3,5<r≤7 yellow · >7 red.
  let status;
  if (ebitda < 0) status = 'red';
  else if (ratio > 7) status = 'red';
  else if (ratio > 3.5) status = 'yellow';
  else status = 'green';

  return {
    name: 'Net Debt / EBITDA',
    value: fmtMultiple(ratio),
    benchmark: '≤3,5×',
    status,
    evidence: `(dettesFinancieres ${formatEuro(debt)} − trésorerie ${formatEuro(cash || 0)}) / EBITDA ${formatEuro(ebitda)} (FY${year} ${scope})`,
  };
}

/** ROE = Résultat net / Capitaux propres — benchmark ≥8%. */
function calcROE(latest, scope) {
  const ni = latest.resultat;
  const equity = latest.fondsPropres;
  const year = latest.annee || latest.year || '—';
  if (ni == null || equity == null) {
    return unknownRatio('ROE', '≥8%', `Donnée manquante (résultat ou fonds propres, FY${year} ${scope})`);
  }
  const ratio = safeDiv(ni, equity);
  if (ratio == null) {
    return unknownRatio('ROE', '≥8%', `Fonds propres nuls (FY${year} ${scope})`);
  }
  const pct = ratio * 100;
  let status;
  if (equity < 0) status = 'red'; // capitaux propres négatifs : situation critique
  else if (pct >= 8) status = 'green';
  else if (pct >= 0) status = 'yellow';
  else status = 'red';
  return {
    name: 'ROE',
    value: fmtPct(pct),
    benchmark: '≥8%',
    status,
    evidence: `Résultat ${formatEuro(ni)} / Fonds propres ${formatEuro(equity)} (FY${year} ${scope})`,
  };
}

/** BFR / CA — benchmark ≤15%. Calcule aussi yoyDriftPct = (BFR_n − BFR_n-1) / CA_n * 100. */
function calcBfrOverCa(source, scope) {
  if (!source.length) {
    return { ratio: unknownRatio('BFR / CA', '≤15%', 'Aucune donnée financière'), drift: null };
  }
  const latest = source[0];
  const prior = source[1] || null;
  const year = latest.annee || latest.year || '—';

  if (latest.bfr == null || latest.ca == null) {
    return {
      ratio: unknownRatio('BFR / CA', '≤15%', `BFR ou CA manquant (FY${year} ${scope})`),
      drift: null,
    };
  }
  const ratio = safeDiv(latest.bfr, latest.ca);
  if (ratio == null) {
    return {
      ratio: unknownRatio('BFR / CA', '≤15%', `CA nul (FY${year} ${scope})`),
      drift: null,
    };
  }
  const pct = ratio * 100;
  let status;
  if (pct > 25) status = 'red';
  else if (pct > 15) status = 'yellow';
  else status = 'green';

  // YoY drift
  let yoyDriftPct = null;
  if (prior && prior.bfr != null && latest.ca) {
    const drift = safeDiv(latest.bfr - prior.bfr, latest.ca);
    if (drift != null) yoyDriftPct = drift * 100;
  }

  return {
    ratio: {
      name: 'BFR / CA',
      value: fmtPct(pct),
      benchmark: '≤15%',
      status,
      evidence: `BFR ${formatEuro(latest.bfr)} / CA ${formatEuro(latest.ca)} (FY${year} ${scope})`,
      yoyDriftPct,
    },
    drift: { latest, prior, yoyDriftPct, scope },
  };
}

/** Debt / Equity — benchmark ≤1,5. */
function calcDebtOverEquity(latest, scope) {
  const debt = latest.dettesFinancieres;
  const equity = latest.fondsPropres;
  const year = latest.annee || latest.year || '—';
  if (debt == null || equity == null) {
    return unknownRatio('Debt / Equity', '≤1,5', `Dettes ou fonds propres manquants (FY${year} ${scope})`);
  }
  const ratio = safeDiv(debt, equity);
  if (ratio == null) {
    return unknownRatio('Debt / Equity', '≤1,5', `Fonds propres nuls (FY${year} ${scope})`);
  }
  let status;
  if (equity < 0) status = 'red';
  else if (ratio > 1.5) status = 'red';
  else if (ratio > 1.0) status = 'yellow';
  else status = 'green';
  return {
    name: 'Debt / Equity',
    value: fmtMultiple(ratio),
    benchmark: '≤1,5',
    status,
    evidence: `Dettes financières ${formatEuro(debt)} / Fonds propres ${formatEuro(equity)} (FY${year} ${scope})`,
  };
}

/** Autonomie financière = Fonds propres / Total bilan approximé (CA + dettes + équity). */
function calcAutonomieFinanciere(latest, scope) {
  const year = latest.annee || latest.year || '—';
  // Use directly if provided (Pappers fournit autonomieFinanciere en %).
  if (latest.autonomieFinanciere != null && Number.isFinite(latest.autonomieFinanciere)) {
    const pct = latest.autonomieFinanciere;
    let status;
    if (pct >= 30) status = 'green';
    else if (pct >= 15) status = 'yellow';
    else status = 'red';
    return {
      name: 'Autonomie financière',
      value: fmtPct(pct),
      benchmark: '≥30%',
      status,
      evidence: `Ratio Pappers autonomieFinanciere (FY${year} ${scope})`,
    };
  }
  // Fallback : equity / (equity + debt)
  const equity = latest.fondsPropres;
  const debt = latest.dettesFinancieres;
  if (equity == null || debt == null) {
    return unknownRatio('Autonomie financière', '≥30%', `Fonds propres ou dettes manquants (FY${year} ${scope})`);
  }
  const total = equity + debt;
  const ratio = safeDiv(equity, total);
  if (ratio == null) {
    return unknownRatio('Autonomie financière', '≥30%', `Total fonds propres + dettes nul (FY${year} ${scope})`);
  }
  const pct = ratio * 100;
  let status;
  if (equity < 0) status = 'red';
  else if (pct >= 30) status = 'green';
  else if (pct >= 15) status = 'yellow';
  else status = 'red';
  return {
    name: 'Autonomie financière',
    value: fmtPct(pct),
    benchmark: '≥30%',
    status,
    evidence: `Fonds propres ${formatEuro(equity)} / (Fonds propres + Dettes ${formatEuro(total)}) (FY${year} ${scope})`,
  };
}

/** Cash runway en mois : trésorerie / (|résultat mensuel|) si déficitaire. */
function calcCashRunway(latest, scope) {
  const cash = latest.tresorerie;
  const ni = latest.resultat;
  const year = latest.annee || latest.year || '—';

  if (cash == null || ni == null) {
    return {
      ratio: unknownRatio('Cash runway', '≥12 mois', `Trésorerie ou résultat manquant (FY${year} ${scope})`),
      months: null,
      isProfitable: null,
    };
  }
  if (ni >= 0) {
    return {
      ratio: {
        name: 'Cash runway',
        value: 'N/A — bénéficiaire',
        benchmark: '≥12 mois',
        status: 'green',
        evidence: `Résultat ${formatEuro(ni)} positif (FY${year} ${scope}) — pas de burn`,
      },
      months: null,
      isProfitable: true,
    };
  }
  const monthlyBurn = Math.abs(ni) / 12;
  const months = safeDiv(cash, monthlyBurn);
  if (months == null) {
    return {
      ratio: unknownRatio('Cash runway', '≥12 mois', `Burn mensuel nul malgré perte (FY${year} ${scope})`),
      months: null,
      isProfitable: false,
    };
  }
  let status;
  if (months >= 12) status = 'green';
  else if (months >= 6) status = 'yellow';
  else status = 'red';

  return {
    ratio: {
      name: 'Cash runway',
      value: `${months.toFixed(1).replace('.', ',')} mois`,
      benchmark: '≥12 mois',
      status,
      evidence: `Trésorerie ${formatEuro(cash)} / (|résultat| ${formatEuro(Math.abs(ni))} / 12) (FY${year} ${scope})`,
    },
    months,
    isProfitable: false,
  };
}

// ── Narratives ─────────────────────────────────────────────────────────────

function buildBfrDriftNarrative(driftCtx) {
  if (!driftCtx || driftCtx.yoyDriftPct == null) {
    return 'BFR drift YoY non calculable (un seul exercice disponible ou donnée manquante).';
  }
  const { latest, prior, yoyDriftPct, scope } = driftCtx;
  const yearN = latest.annee || latest.year;
  const yearP = prior?.annee || prior?.year;
  const sign = yoyDriftPct > 0 ? '+' : '';
  const tone = yoyDriftPct > 5 ? 'dégradation marquée'
    : yoyDriftPct > 2 ? 'tension'
    : yoyDriftPct < -2 ? 'amélioration'
    : 'stabilité';
  return `BFR ${scope} passé de ${formatEuro(prior.bfr)} (FY${yearP}) à ${formatEuro(latest.bfr)} (FY${yearN}), drift ${sign}${yoyDriftPct.toFixed(1).replace('.', ',')} pts de CA — signal de ${tone} du cycle d'exploitation.`;
}

function buildCashRunwayNarrative(runwayCtx, latest, scope) {
  if (!runwayCtx) return 'Cash runway non évaluable — données financières absentes.';
  const year = latest?.annee || latest?.year || '—';
  if (runwayCtx.isProfitable) {
    return `Résultat ${scope} FY${year} bénéficiaire (${formatEuro(latest.resultat)}) — pas de scénario de burn à court terme.`;
  }
  if (runwayCtx.months == null) {
    return 'Cash runway non calculable (donnée manquante ou burn nul).';
  }
  const m = runwayCtx.months;
  const verdict = m < 6 ? 'horizon critique sous 6 mois'
    : m < 12 ? 'horizon tendu sous 12 mois'
    : 'horizon confortable au-delà de 12 mois';
  return `À perte FY${year} (${formatEuro(latest.resultat)}) et trésorerie ${formatEuro(latest.tresorerie)}, runway estimé ${m.toFixed(1).replace('.', ',')} mois — ${verdict}.`;
}

// ── Score / Color ──────────────────────────────────────────────────────────

function deriveScoreAndColor(ratios, aiHealthScore) {
  // Guard "PME vide" : si ≥4 ratios sur 6 sont unknown, on refuse de scorer.
  // La gauge SVG côté template gère isUnknown → "—" + "Données insuffisantes".
  // Ce check court-circuite y compris aiHealthScore : l'IA ne peut pas inventer
  // un score sain quand le socle de ratios est trop creux.
  const unknownCount = ratios.reduce((acc, r) => acc + (r.status === 'unknown' ? 1 : 0), 0);
  if (unknownCount >= 4) {
    return { score: null, color: 'unknown' };
  }

  // 1. Score : si l'IA en a fourni un (0-100), on le respecte.
  let score;
  if (Number.isFinite(aiHealthScore) && aiHealthScore >= 0 && aiHealthScore <= 100) {
    score = Math.round(aiHealthScore);
  } else {
    // Score dérivé : start at 100, chaque red = −20, chaque yellow = −10, unknown = −5.
    const counts = { red: 0, yellow: 0, green: 0, unknown: 0 };
    for (const r of ratios) counts[r.status] = (counts[r.status] || 0) + 1;
    score = Math.max(0, Math.min(100, 100 - counts.red * 20 - counts.yellow * 10 - counts.unknown * 5));
  }

  let color;
  if (score >= 70) color = 'green';
  else if (score >= 40) color = 'yellow';
  else color = 'red';

  return { score, color };
}

// ── Main export ────────────────────────────────────────────────────────────

export function buildHealthScoreBlock({ financialHistory = [], consolidatedFinances = [], aiHealthScore = null } = {}) {
  const { latest, scope, source } = pickLatest(consolidatedFinances, financialHistory);

  // No data → return a fully unknown block, no throw.
  if (!latest) {
    const ratios = [
      unknownRatio('Net Debt / EBITDA', '≤3,5×', 'Aucune donnée financière'),
      unknownRatio('ROE', '≥8%', 'Aucune donnée financière'),
      { ...unknownRatio('BFR / CA', '≤15%', 'Aucune donnée financière'), yoyDriftPct: null },
      unknownRatio('Debt / Equity', '≤1,5', 'Aucune donnée financière'),
      unknownRatio('Autonomie financière', '≥30%', 'Aucune donnée financière'),
      unknownRatio('Cash runway', '≥12 mois', 'Aucune donnée financière'),
    ];
    const { score, color } = deriveScoreAndColor(ratios, aiHealthScore);
    return {
      score,
      color,
      ratios,
      bfrDriftNarrative: 'BFR drift non évaluable — aucune donnée financière disponible.',
      cashRunwayNarrative: 'Cash runway non évaluable — aucune donnée financière disponible.',
    };
  }

  const netDebtEbitda = calcNetDebtOverEbitda(latest, scope);
  const roe = calcROE(latest, scope);
  const { ratio: bfrRatio, drift: bfrDriftCtx } = calcBfrOverCa(source, scope);
  const debtEquity = calcDebtOverEquity(latest, scope);
  const autonomie = calcAutonomieFinanciere(latest, scope);
  const { ratio: cashRunwayRatio, ...runwayCtx } = calcCashRunway(latest, scope);

  const ratios = [netDebtEbitda, roe, bfrRatio, debtEquity, autonomie, cashRunwayRatio];

  const bfrDriftNarrative = buildBfrDriftNarrative(bfrDriftCtx);
  const cashRunwayNarrative = buildCashRunwayNarrative(runwayCtx, latest, scope);
  const { score, color } = deriveScoreAndColor(ratios, aiHealthScore);

  return {
    score,
    color,
    ratios,
    bfrDriftNarrative,
    cashRunwayNarrative,
  };
}
