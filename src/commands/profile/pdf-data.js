import { formatEuro } from './helpers.js';
import { buildGrowthAnalysis, buildForwardLooking } from './scoring.js';
import { getLanguage } from '../../utils/i18n.js';
import { buildExecutiveSummaryBlock } from './pdf-blocks/executive-summary.js';
import { buildProvenanceFooterBlock } from './pdf-blocks/provenance-footer.js';
import { buildHealthScoreBlock } from './pdf-blocks/health-ratios.js';
import { buildKeyManRiskBlock } from './pdf-blocks/key-man-risk.js';
import { buildPeerMultiplesBlock } from './pdf-blocks/peer-multiples.js';

// Mapping codes tranches d'effectif INSEE → libellés lisibles.
// Référence : https://www.insee.fr/fr/information/2028195
const INSEE_TRANCHE = {
  '00': '0 salarié', '01': '1–2 salariés', '02': '1–2 salariés',
  '03': '3–5 salariés', '11': '6–9 salariés', '12': '10–19 salariés',
  '21': '20–49 salariés', '22': '50–99 salariés',
  '31': '100–199 salariés', '32': '200–249 salariés',
  '41': '250–499 salariés', '42': '500–999 salariés',
  '51': '1 000–1 999 salariés', '52': '2 000–4 999 salariés',
  '53': '5 000–9 999 salariés', '54': '10 000 salariés et plus',
  'NN': 'Non employeur', null: null,
};

function labelEffectifs(raw, isGroupHolding) {
  if (!raw) return 'N/A';
  const label = INSEE_TRANCHE[String(raw).padStart(2, '0')] || String(raw);
  return isGroupHolding ? `${label} (holding only)` : label;
}

/**
 * Build the structured data object for PDF report generation.
 */
export function buildPdfData({ identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives, subsidiariesData, pressResults, aiAnalysis, codeBuiltMaHistory, scrapedMaContent, siren, competitorCandidates, judilibreDecisions, inpiMarques, inpiBrevets, capitalTrajectory, peerMultiples }) {
  const fmtEuro = (n) => {
    if (n == null) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}${(abs/1e9).toFixed(2)}B€`;
    if (abs >= 1e6) return `${sign}${(abs/1e6).toFixed(1)}M€`;
    if (abs >= 1e3) return `${sign}${Math.round(abs/1e3)}K€`;
    return `${sign}${abs}€`;
  };

  const pressMentions = [];
  if (pressResults?.length) {
    pressResults.forEach(m => {
      pressMentions.push({ title: m.title || '', source: m.domain || m.source || '', url: m.url || '', sentiment: m.sentiment || 'neutral' });
    });
  }

  const growthAnalysis = buildGrowthAnalysis(aiAnalysis?.growthAnalysis, consolidatedFinances, codeBuiltMaHistory, subsidiariesData);
  const forwardLooking = buildForwardLooking(aiAnalysis?.forwardLooking, scrapedMaContent, consolidatedFinances);

  // Group-level KPIs : préfère le consolidé quand dispo (holdings type NOVARES,
  // sinon les cards Identity/Activity exposent les chiffres de l'entité mère
  // seule, ce qui sous-évalue massivement les groupes).
  const hasConsolidated = Array.isArray(consolidatedFinances) && consolidatedFinances.length > 0;
  const latestConsolidated = hasConsolidated ? consolidatedFinances[0] : null;
  const groupCa = latestConsolidated?.ca ?? financialHistory?.[0]?.ca ?? null;
  const groupCaYear = latestConsolidated?.annee ?? financialHistory?.[0]?.annee ?? null;
  const groupCaIsConsolidated = !!latestConsolidated?.ca;
  // "Capital" = capital social juridique de la holding (BODACC/Pappers).
  // Les capitaux propres consolidés sont exposés séparément en
  // `capitauxPropresConsolides` pour ne pas mélanger deux concepts différents
  // sous le même label dans l'Identity card.
  const consolidatedEquity = latestConsolidated?.capitauxPropres ?? latestConsolidated?.fondsPropres ?? null;

  // ── Structured blocks (MH1/MH3/MH4/MH7) ───────────────────────────────────
  // MH7 — dérive `signals` à partir des publications BODACC pour requalifier
  // le Cash runway en présence d'une procédure préventive (conciliation L.611-10,
  // sauvegarde, mandat ad hoc) ou d'une procédure collective (RJ/LJ).
  // Évite la contradiction "47 mois GREEN" + "conciliation CRITICAL" sur NOVARES.
  const distressBodacc = Array.isArray(bodacc) ? bodacc.filter((b) => b && b.isDistress) : [];
  const preprocedureTypes = new Set(['conciliation', 'sauvegarde', 'mandat_ad_hoc']);
  const hasConciliation = distressBodacc.some((b) => b.distressType === 'conciliation');
  const hasPreprocedure = distressBodacc.some((b) => preprocedureTypes.has(b.distressType));
  const healthSignals = { distress: { conciliation: hasConciliation }, preprocedure: hasPreprocedure };

  const healthScoreBlock = buildHealthScoreBlock({
    financialHistory,
    consolidatedFinances,
    aiHealthScore: aiAnalysis?.healthScore,
    signals: healthSignals,
  });
  const keyManRisk = buildKeyManRiskBlock({ bodacc, dirigeants, representants });
  const executiveSummary = buildExecutiveSummaryBlock({
    healthScore: healthScoreBlock?.score,
    riskAssessment: aiAnalysis?.riskAssessment,
    capitalTrajectory,
    bodacc,
    keyManRisk,
    ratios: healthScoreBlock?.ratios,
    aiSummary: aiAnalysis?.executiveSummary,
    identity,
  });
  const provenanceFooter = buildProvenanceFooterBlock({
    pressMentions: pressResults,
    bodacc,
    judilibre: judilibreDecisions,
    inpi: { marques: inpiMarques, brevets: inpiBrevets },
    consolidatedFinances,
    dirigeants,
  });

  return {
    executiveSummary,
    provenanceFooter,
    healthScoreBlock,
    keyManRisk,
    peerMultiples: peerMultiples || null,
    aiSummary: aiAnalysis?.executiveSummary || null,
    kpiSourceLabel: hasConsolidated ? 'consolidé' : 'entité',
    kpiSourceYear: latestConsolidated?.annee ?? financialHistory?.[0]?.annee ?? null,
    capitalTrajectory: capitalTrajectory || null,
    groupStructure: (() => {
      const gs = aiAnalysis?.groupStructure || {};
      // Inclus TOUTES les filiales Pappers, pas seulement celles avec CA>0.
      // Beaucoup de filiales opérationnelles (international, management
      // vehicles, holdings de détention) n'ont pas de CA publié — les omettre
      // vide la page Group Structure. Tri : CA desc, puis effectif, puis nom.
      const allSubs = (subsidiariesData || [])
        .filter(s => s.name && s.name.trim())
        .sort((a, b) => {
          const caDiff = (b.ca || 0) - (a.ca || 0);
          if (caDiff !== 0) return caDiff;
          const effA = a.effectif ? 1 : 0;
          const effB = b.effectif ? 1 : 0;
          if (effB !== effA) return effB - effA;
          return (a.name || '').localeCompare(b.name || '');
        })
        .slice(0, 9);
      const pappersSubs = allSubs.map(s => {
        let revenue = null;
        if (s.ca && s.ca > 0) {
          revenue = `${(s.ca / 1e6).toFixed(1)} M€${s.annee ? ' (' + s.annee + ')' : ''}`;
        } else if (s.ville) {
          revenue = s.ville;
        } else if (s.status && s.status !== 'Active') {
          revenue = s.status;
        }
        return { entity: s.name, revenue };
      });
      if (pappersSubs.length > 0) gs.subsidiaries = pappersSubs;
      return gs;
    })(),
    aiCompetitors: (() => {
      const aiList = aiAnalysis?.competitors || [];
      // Filtre les "concurrents" qui sont en réalité la cible elle-même
      // (NAF/nom strict match — l'IA hallucine parfois).
      const targetName = (identity.name || '').toLowerCase().trim();
      const targetSiren = String(identity.siren || '');
      const aiFiltered = aiList.filter(c => {
        const cName = String(c.name || '').toLowerCase().trim();
        const cSiren = String(c.siren || '');
        if (cSiren && cSiren === targetSiren) return false;
        if (cName && targetName && (cName === targetName || cName.includes(targetName) || targetName.includes(cName))) return false;
        return true;
      });
      if (aiFiltered.length >= 5) return aiFiltered;
      // Fallback : si l'IA n'a pas (assez) rempli, complète avec le registre Pappers
      const registry = competitorCandidates?.registry || [];
      const aiSirens = new Set(aiFiltered.map(c => String(c.siren || '')).filter(Boolean));
      const aiNames = new Set(aiFiltered.map(c => String(c.name || '').toLowerCase()));
      const fromRegistry = registry
        .filter(r => !aiSirens.has(String(r.siren || '')) && !aiNames.has((r.name || '').toLowerCase()))
        .slice(0, 8 - aiFiltered.length)
        .map(r => ({
          name: r.name,
          siren: r.siren,
          source: 'pappers_registry',
          reason: `Pair Pappers NAF ${r.naf}${r.ville ? ' · ' + r.ville : ''}`,
          estimatedRevenue: r.ca != null ? `${(r.ca / 1e6).toFixed(1)}M€${r.caYear ? ' (' + r.caYear + ')' : ''}` : 'N/A',
          summary: `Concurrent identifié par proximité NAF (${r.naf}) et fourchette CA${r.caYear ? ' année ' + r.caYear : ''}. ${r.ville ? 'Basé à ' + r.ville + '.' : ''}`,
        }));
      return [...aiFiltered, ...fromRegistry];
    })(),
    maHistory: (aiAnalysis?.maHistory?.length ? aiAnalysis.maHistory : codeBuiltMaHistory) || [],
    riskAssessment: aiAnalysis?.riskAssessment || null,
    healthScore: aiAnalysis?.healthScore || null,
    growthAnalysis,
    forwardLooking,
    competitors: [{
      name: identity.name || siren,
      url: identity.website || 'N/A',
      tech: [identity.formeJuridique, identity.nafLabel, identity.nafCode].filter(Boolean),
      social: {},
      pappers: {
        siren: identity.siren,
        siret: identity.siret,
        forme: identity.formeJuridique,
        creation: identity.dateCreation,
        naf: identity.nafCode ? identity.nafCode + ' — ' + identity.nafLabel : null,
        capital: identity.capital != null ? fmtEuro(identity.capital) : 'N/A',
        ...(hasConsolidated && consolidatedEquity != null
          ? { capitauxPropresConsolides: `${fmtEuro(consolidatedEquity)}${latestConsolidated?.annee ? ` (${latestConsolidated.annee})` : ''}` }
          : {}),
        ca: groupCa != null
          ? `${fmtEuro(groupCa)}${groupCaYear ? ` (${groupCaYear}${groupCaIsConsolidated ? ' consolidé' : ''})` : ''}`
          : 'N/A',
        effectifs: labelEffectifs(identity.effectifs, hasConsolidated),
        adresse: [identity.adresse, identity.codePostal, identity.ville].filter(Boolean).join(' '),
        dirigeants: dirigeants?.map(d => {
          const name = d.nom || d.denomination || '?';
          const role = d.qualite || '';
          return role ? `${name} (${role})` : name;
        }).slice(0, 10) || [],
      },
      consolidatedFinances: (consolidatedFinances || []).map(f => ({
        year: f.annee, annee: f.annee,
        revenue: f.ca != null ? fmtEuro(f.ca) : '—',
        netIncome: f.resultat != null ? fmtEuro(f.resultat) : '—',
        ca: f.ca, resultat: f.resultat, ebitda: f.ebitda, margeEbitda: f.margeEbitda,
        dettesFinancieres: f.dettesFinancieres, tresorerie: f.tresorerie,
        fondsPropres: f.fondsPropres ?? f.capitauxPropres, bfr: f.bfr,
        ratioEndettement: f.ratioEndettement, autonomieFinanciere: f.autonomieFinanciere,
        rentabiliteFP: f.rentabiliteFP, margeNette: f.margeNette,
        capaciteAutofinancement: f.capaciteAutofinancement,
      })),
      representants: (representants || []).slice(0, 15).map(r => ({
        name: r.nom, role: r.qualite, type: r.personneMorale ? 'Corporate' : 'Individual', siren: r.siren,
      })),
      etablissements: (etablissements || []).filter(e => e.actif !== false).map(e => ({
        siret: e.siret, type: e.type, address: e.adresse, active: e.actif,
      })),
      objetSocial: identity.objetSocial, tvaIntra: identity.tvaIntra,
      rcs: identity.rcs, conventionCollective: identity.conventionCollective,
      financialHistory: (financialHistory || []).map(f => ({
        year: f.annee, annee: f.annee,
        revenue: f.ca != null ? fmtEuro(f.ca) : '—',
        netIncome: f.resultat != null ? fmtEuro(f.resultat) : '—',
        equity: f.capitauxPropres != null ? fmtEuro(f.capitauxPropres) : '—',
        employees: f.effectif || '—',
        ca: f.ca, resultat: f.resultat, ebitda: f.ebitda, margeEbitda: f.margeEbitda,
        dettesFinancieres: f.dettesFinancieres, tresorerie: f.tresorerie,
        fondsPropres: f.fondsPropres ?? f.capitauxPropres, bfr: f.bfr,
        ratioEndettement: f.ratioEndettement, autonomieFinanciere: f.autonomieFinanciere,
        rentabiliteFP: f.rentabiliteFP, margeNette: f.margeNette,
        capaciteAutofinancement: f.capaciteAutofinancement,
      })),
      ubo: (ubo || []).map(u => ({
        name: [u.prenom, u.nom].filter(Boolean).join(' ') || u.denomination || '?',
        share: u.pourcentage ? `${u.pourcentage}%` : 'N/A',
        nationality: u.nationalite || '',
      })),
      bodacc: (bodacc || []).slice(0, 20).map(b => ({
        date: b.date || '—', type: b.type || '—',
        description: (b.description && b.description.length > 140) ? b.description.substring(0, 140) + '...' : (b.description || ''),
        url: b.url || null,
        distressType: b.distressType || null,
        category: b.category || 'other',
        severity: b.severity || 'info',
        isDistress: b.isDistress || false,
      })),
      procedures: (proceduresCollectives || []).map(p => ({
        type: p.type || '—', date: p.date || '—', description: p.description || '',
        procedureCategory: p.procedureCategory || 'other',
        severity: p.severity || 'medium',
        administrateur: p.administrateur || null,
        mandataire: p.mandataire || null,
      })),
      press: pressMentions.length ? {
        total: pressMentions.length,
        positive: pressMentions.filter(m => m.sentiment === 'positive').length,
        neutral: pressMentions.filter(m => m.sentiment === 'neutral').length,
        negative: pressMentions.filter(m => m.sentiment === 'negative').length,
        mentions: pressMentions.slice(0, 20),
      } : undefined,
      judilibre: (judilibreDecisions && judilibreDecisions.length) ? {
        total: judilibreDecisions.length,
        decisions: judilibreDecisions.slice(0, 15).map(d => ({
          id: d.id,
          jurisdiction: d.jurisdiction || '—',
          chamber: d.chamber || '',
          date: d.date || '—',
          solution: d.solution || '—',
          summary: (d.summary || '').substring(0, 220),
          matchedQuery: d.matchedQuery || null,
          url: d.url,
        })),
      } : undefined,
      inpi: ((inpiMarques && inpiMarques.length) || (inpiBrevets && inpiBrevets.length)) ? {
        marques: (inpiMarques || []).slice(0, 15).map(m => ({
          title: m.title || '—',
          depotNumber: m.depotNumber,
          depositDate: m.depositDate || '—',
          status: m.status || '—',
          classes: (m.classes || []).slice(0, 6).join(', ') || '—',
          url: m.url,
        })),
        brevets: (inpiBrevets || []).slice(0, 10).map(b => ({
          title: b.title || '—',
          publicationNumber: b.publicationNumber,
          depositDate: b.depositDate || '—',
          status: b.status || '—',
          url: b.url,
        })),
      } : undefined,
      subsidiaries: subsidiariesData.filter(s => s.ca != null).map(s => ({
        name: s.name, ville: s.ville,
        revenue: s.ca != null ? fmtEuro(s.ca) : '—',
        netIncome: s.resultat != null ? fmtEuro(s.resultat) : '—',
        employees: s.effectif || '—', year: s.annee || '—', status: s.status || '—',
      })),
      strengths: aiAnalysis?.strengths || [],
      weaknesses: aiAnalysis?.weaknesses || [],
      summary: `${identity.name || siren} — ${identity.formeJuridique || ''}, ${identity.nafLabel || ''}. Created ${identity.dateCreation || '?'}. ${financialHistory?.length ? `Financial history: ${financialHistory.length} years available.` : 'No financial data available.'} ${subsidiariesData.length ? `Group of ${subsidiariesData.length} entities.` : ''}`,
    }]
  };
}
