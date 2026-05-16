import { formatEuro } from './helpers.js';
import { buildGrowthAnalysis, buildForwardLooking } from './scoring.js';
import { getLanguage } from '../../utils/i18n.js';

/**
 * Build the structured data object for PDF report generation.
 */
export function buildPdfData({ identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives, subsidiariesData, pressResults, aiAnalysis, codeBuiltMaHistory, scrapedMaContent, siren, competitorCandidates, judilibreDecisions, inpiMarques, inpiBrevets }) {
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
  // Pour "Capital" : si on a un consolidé, on affiche les capitaux propres
  // consolidés (vue groupe), sinon le capital social de la mère.
  const groupCapital = latestConsolidated?.capitauxPropres ?? latestConsolidated?.fondsPropres ?? identity.capital ?? null;
  const groupCapitalIsConsolidated = !!(latestConsolidated?.capitauxPropres ?? latestConsolidated?.fondsPropres);

  return {
    aiSummary: aiAnalysis?.executiveSummary || null,
    groupStructure: (() => {
      const gs = aiAnalysis?.groupStructure || {};
      const pappersSubs = (subsidiariesData || [])
        .filter(s => s.ca && s.ca > 0)
        .sort((a, b) => (b.ca || 0) - (a.ca || 0))
        .slice(0, 7)
        .map(s => ({ entity: s.name, revenue: `${(s.ca / 1e6).toFixed(1)} M€${s.annee ? ' (' + s.annee + ')' : ''}` }));
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
        capital: groupCapital != null
          ? `${fmtEuro(groupCapital)}${groupCapitalIsConsolidated ? ' (CP consolidés)' : ''}`
          : 'N/A',
        ca: groupCa != null
          ? `${fmtEuro(groupCa)}${groupCaYear ? ` (${groupCaYear}${groupCaIsConsolidated ? ' consolidé' : ''})` : ''}`
          : 'N/A',
        effectifs: identity.effectifs || 'N/A',
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
