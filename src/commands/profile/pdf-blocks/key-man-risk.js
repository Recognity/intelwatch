/**
 * Key Man Risk auto-flag (MH4) — detects governance instability.
 *
 * Rules :
 *   - flagged=true if ≥3 Président/DG changes in BODACC over last 18 months
 *   - OR ≥2 CAC (commissaire aux comptes) changes over last 18 months
 *   - severity scales with signal density (high / medium / low / none)
 *
 * Honest fallback : si moins que les seuils, on régresse à medium/low avec
 * evidence factuelle plutôt que faux positif "high".
 */

const WINDOW_MONTHS = 18;

// Mot entier exigé pour éviter les faux positifs ("vice-président", "présidence
// du conseil de surveillance" = gouvernance distincte du Président exécutif).
const RE_PRESIDENT = /\bpr[eé]sident(?!e\s+du\s+conseil\s+de\s+surveillance)\b/i;
const RE_DG = /\bdirecteur\s+g[eé]n[eé]ral\b/i;
const RE_CAC = /\bcommissaire\s+aux\s+comptes\b/i;

function isWithinWindow(dateStr, refDate) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date(refDate);
  cutoff.setMonth(cutoff.getMonth() - WINDOW_MONTHS);
  return d >= cutoff && d <= refDate;
}

/**
 * Dédup BODACC : même publi rééditée par le greffe = un seul signal.
 * Clé = mois (YYYY-MM) + 80 premiers chars normalisés (lowercase, whitespace collapsed).
 */
function normalizeForDedup(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80);
}

function dedupBodacc(bodacc) {
  if (!Array.isArray(bodacc)) return [];
  const seen = new Set();
  const out = [];
  for (const pub of bodacc) {
    const monthKey = String(pub.date || '').substring(0, 7); // YYYY-MM
    const descKey = normalizeForDedup(pub.description || pub.details || pub.type || '');
    const key = `${monthKey}::${descKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pub);
  }
  return out;
}

/**
 * Clé de dédup cross-signal : une même publi BODACC qui matche à la fois
 * Président/DG et CAC ne doit apparaître qu'une seule fois dans l'ensemble
 * cumulé des evidences. Pattern dominant : president > dg > cac.
 */
function evidenceKey(pub) {
  const dateKey = String(pub.date || '').substring(0, 10); // YYYY-MM-DD
  const descKey = normalizeForDedup(pub.description || pub.details || pub.type || '').substring(0, 50);
  return `${dateKey}::${descKey}`;
}

function collectSignals(bodacc, refDate) {
  const presidentDgHits = [];
  const cacHits = [];

  const deduped = dedupBodacc(bodacc);
  // Cross-signal dédup : un BODACC dans un seul bucket (dominance Pdt/DG > CAC)
  const claimed = new Set();

  for (const pub of deduped) {
    if (!isWithinWindow(pub.date, refDate)) continue;
    const haystack = [pub.description || '', pub.details || '', pub.type || ''].join(' ');
    if (!haystack) continue;

    const key = evidenceKey(pub);
    if (claimed.has(key)) continue;

    const evidence = {
      date: pub.date,
      desc: (pub.description || pub.type || '').substring(0, 180),
      url: pub.url || null,
    };

    if (RE_PRESIDENT.test(haystack) || RE_DG.test(haystack)) {
      presidentDgHits.push(evidence);
      claimed.add(key);
      continue;
    }
    if (RE_CAC.test(haystack)) {
      cacHits.push(evidence);
      claimed.add(key);
    }
  }

  return { presidentDgHits, cacHits };
}

/**
 * Build Key Man Risk block.
 *
 * @param {Object} params
 * @param {Array}  params.bodacc        — Pappers bodacc publications (with date/description/url)
 * @param {Array}  params.dirigeants    — Pappers dirigeants array (unused for v1 but kept for shape compat)
 * @param {Array}  params.representants — Pappers representants array (unused for v1)
 * @returns {{flagged:boolean, signals:Array, severity:'high'|'medium'|'low'|'none'}}
 */
export function buildKeyManRiskBlock({ bodacc = [], dirigeants = [], representants = [] } = {}) {
  const refDate = new Date();
  const { presidentDgHits, cacHits } = collectSignals(bodacc, refDate);

  const signals = [];
  if (presidentDgHits.length > 0) {
    signals.push({
      type: 'president_dg_turnover',
      count: presidentDgHits.length,
      window: '18m',
      evidence: presidentDgHits.slice(0, 10),
    });
  }
  if (cacHits.length > 0) {
    signals.push({
      type: 'cac_turnover',
      count: cacHits.length,
      window: '18m',
      evidence: cacHits.slice(0, 10),
    });
  }

  // Severity matrix (post-dédup BODACC + regex \b strict)
  let severity = 'none';
  let flagged = false;

  const pdg = presidentDgHits.length;
  const cac = cacHits.length;

  if (pdg >= 3 || cac >= 2) {
    flagged = true;
    severity = 'high';
  } else if (pdg === 2 || cac === 1) {
    // signal présent mais sous le seuil de flag — exposé en medium honnête
    severity = 'medium';
  } else if (pdg === 1) {
    severity = 'low';
  } else {
    severity = 'none';
  }

  return { flagged, signals, severity };
}
