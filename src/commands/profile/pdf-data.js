import { formatEuro } from './helpers.js';
import { buildGrowthAnalysis, buildForwardLooking } from './scoring.js';
import { getLanguage } from '../../utils/i18n.js';

/**
 * Build the structured data object for PDF report generation.
 */
export function buildPdfData({ identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives, subsidiariesData, pressResults, aiAnalysis, codeBuiltMaHistory, scrapedMaContent, siren }) {
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
    aiCompetitors: aiAnalysis?.competitors || [],
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
        ca: financialHistory?.[0]?.ca != null ? fmtEuro(financialHistory[0].ca) : 'N/A',
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
      bodacc: (bodacc || []).slice(0, 15).map(b => ({
        date: b.date || '—', type: b.type || '—',
        description: (b.description && b.description.length > 140) ? b.description.substring(0, 140) + '...' : (b.description || ''),
        url: b.url || null,
      })),
      procedures: (proceduresCollectives || []).map(p => ({
        type: p.type || '—', date: p.date || '—', description: p.description || '',
      })),
      press: pressMentions.length ? {
        total: pressMentions.length,
        positive: pressMentions.filter(m => m.sentiment === 'positive').length,
        neutral: pressMentions.filter(m => m.sentiment === 'neutral').length,
        negative: pressMentions.filter(m => m.sentiment === 'negative').length,
        mentions: pressMentions.slice(0, 20),
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
