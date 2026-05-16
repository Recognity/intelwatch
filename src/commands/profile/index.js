import chalk from 'chalk';
import { pappersSearchSubsidiaries } from '../../scrapers/pappers.js';
import { callAI, hasAIKey } from '../../ai/client.js';
import { section, warn } from '../../utils/display.js';
import { setLanguage, getLanguage } from '../../utils/i18n.js';
import { isPro } from '../../license.js';
// Lazy-loaded: generatePDF is imported dynamically in the PDF export section below
import { handleExport } from '../../utils/export.js';

import { resolveFRProvider, handleLicenseGating } from './provider.js';
import { fetchCompanyDossier, fetchPressData, scrapeDeepMaContent, refreshStaleSubsidiaries } from './fetching.js';
import { computeGrowthData, buildAIPromptContext, mergeMaHistory } from './scoring.js';
import { renderIdentity, renderPreview, renderFullSections, renderDigitalFootprint, renderSubsidiaries, renderPressSummary, renderAIAnalysis } from './display.js';
import { extractAIJSON, buildMaHistoryFromCode } from './helpers.js';
import { buildAIPrompts } from './prompts.js';
import { buildPdfData } from './pdf-data.js';

export async function runMA(sirenOrName, options) {
  const isPreview = !!options.preview;
  const frProvider = resolveFRProvider();
  const isFallbackProvider = frProvider.providerName === 'annuaire-entreprises';

  if (options.parent?.opts()?.lang) {
    setLanguage(options.parent.opts().lang);
  }

  handleLicenseGating(frProvider, options);

  // ── Fetch company dossier ─────────────────────────────────────────────────
  const { data, siren, isFallback } = await fetchCompanyDossier(sirenOrName, frProvider, options);
  if (isFallback) {
    const { identity, financialHistory, dirigeants } = data;
    renderIdentity(identity, siren, true);
    renderPreview(data, { isFallbackProvider: true });
    return;
  }

  const { identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives } = data;

  // ── Header + Identity ─────────────────────────────────────────────────────
  renderIdentity(identity, siren, isFallbackProvider);

  // ── Preview mode ──────────────────────────────────────────────────────────
  if (isPreview || isFallbackProvider) {
    renderPreview(data, { isFallbackProvider });
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //   FULL MODE (licensed users)
  // ══════════════════════════════════════════════════════════════════════════

  renderFullSections(data);

  // ── Digital footprint ─────────────────────────────────────────────────────
  await renderDigitalFootprint(identity);

  // ── Subsidiaries / Related entities ──────────────────────────────────────
  let subsidiariesData = [];
  if (identity.name) {
    const brandName2 = (identity.name || '').replace(/\s*(GRP|SAS|SARL|SA|SCI|EURL|GROUP|GROUPE|HOLDING|SNC|SASU)\s*/gi, ' ').trim();
    section(`  🏭 Filiales / Entités liées`);
    console.log(chalk.gray(`  Searching for "${brandName2}" entities...`));
    try {
      const { subsidiaries, fromCache: subsFromCache } = await pappersSearchSubsidiaries(identity.name, identity.siren);
      subsidiariesData = subsidiaries;
      renderSubsidiaries(subsidiaries, subsFromCache);
    } catch (e) {
      warn(`     Subsidiary search failed: ${e.message}`);
    }
  }

  // ── Press & mentions ───────────────────────────────────────────────────────
  let pressResults = [];
  let companyArticles = [];
  let press = { mentions: [], mentionCount: 0 };
  const brandName = (identity.name || '').replace(/\s*(GRP|SAS|SARL|SA|SCI|EURL|GROUP|GROUPE|HOLDING|SNC|SASU)\s*/gi, ' ').trim() || identity.name;
  if (identity.name) {
    section('  📣 Presse & réputation');
    console.log(chalk.gray(`  Searching mentions for "${identity.name}"...`));
    try {
      const pressData = await fetchPressData(identity, siren, brandName);
      pressResults = pressData.pressResults;
      companyArticles = pressData.companyArticles;
      press = pressData.press;
      renderPressSummary(press, pressResults);
    } catch (e) {
      warn(`     Press search failed: ${e.message}`);
    }
  }

  // ── Scrape content of top M&A articles ──────────────────────────────────
  let scrapedMaContent = await scrapeDeepMaContent(pressResults);
  for (const art of companyArticles) {
    scrapedMaContent.push(art);
  }

  // ── Build M&A timeline IN CODE ──────────────────────────────────────────
  const parentBrandForMa = (identity.name || '')
    .replace(/\s*(GRP|SAS|SARL|SA|SCI|EURL|GROUP|GROUPE|HOLDING|SNC|SASU)\s*/gi, ' ')
    .trim().toLowerCase().split(' ')[0];
  const offBrandSubsForMa = subsidiariesData.filter(
    s => !s.name?.toLowerCase().includes(parentBrandForMa)
  );
  const codeBuiltMaHistory = buildMaHistoryFromCode(scrapedMaContent, offBrandSubsForMa, bodacc || []);
  if (codeBuiltMaHistory.length) console.log(chalk.gray(`  📋 M&A timeline (${codeBuiltMaHistory.length} entries): ${codeBuiltMaHistory.map(e => `${e.target?.substring(0,15)} [${e.date}]`).join(', ')}`));

  // ── OSINT enrichments en parallèle : décisions de justice + marques INPI ──
  // Tous deux BYOK (JUDILIBRE_KEY_ID, INPI_USERNAME/PASSWORD).
  // Non-bloquant : ne casse pas le profil si l'API n'est pas configurée.
  let judilibreDecisions = [];
  let inpiMarques = [];
  let inpiBrevets = [];
  try {
    const [judilibreMod, inpiMod] = await Promise.all([
      import('../../scrapers/judilibre.js'),
      import('../../scrapers/inpi.js'),
    ]);
    const dirigeantNames = (dirigeants || []).slice(0, 3).map(d => {
      const first = d.prenom || '';
      const last = d.nom || d.denomination || '';
      return `${first} ${last}`.trim();
    }).filter(Boolean);

    const tasks = [];
    if (judilibreMod.hasJudilibreKey()) {
      section('  🏛️  Décisions de justice (JudiLibre)');
      tasks.push(judilibreMod.searchForTarget(identity.name || '', dirigeantNames));
    } else {
      tasks.push(Promise.resolve({ decisions: [], total: 0, errors: ['JUDILIBRE_KEY_ID non défini'] }));
    }
    if (inpiMod.hasInpiCredentials()) {
      tasks.push(inpiMod.searchMarquesBySiren(siren, { limit: 30 }));
      tasks.push(inpiMod.searchBrevetsBySiren(siren, { limit: 10 }));
    } else {
      tasks.push(Promise.resolve({ marques: [], total: 0, error: 'INPI credentials non définis' }));
      tasks.push(Promise.resolve({ brevets: [], total: 0, error: 'INPI credentials non définis' }));
    }
    const [jud, marqRes, brevRes] = await Promise.all(tasks);
    judilibreDecisions = jud.decisions || [];
    inpiMarques = marqRes.marques || [];
    inpiBrevets = brevRes.brevets || [];

    if (judilibreMod.hasJudilibreKey()) {
      console.log(chalk.gray(`    ${judilibreDecisions.length} décisions trouvées${jud.errors?.length ? ' (erreurs: ' + jud.errors.length + ')' : ''}`));
    }
    if (inpiMod.hasInpiCredentials()) {
      section('  ®️  IP — INPI marques / brevets');
      console.log(chalk.gray(`    ${inpiMarques.length} marques · ${inpiBrevets.length} brevets${marqRes.error ? ' (marques: ' + marqRes.error + ')' : ''}${brevRes.error ? ' (brevets: ' + brevRes.error + ')' : ''}`));
    }
  } catch (e) {
    warn(`     OSINT enrichment failed: ${e.message}`);
  }

  // ── Competitor discovery (always — used by AI prompt and PDF fallback) ──
  // Lance la découverte concurrents en parallèle d'autres étapes pour ne pas
  // alourdir la critical path. Le résultat sert au prompt AI ET de fallback
  // direct dans le PDF si l'IA est désactivée ou renvoie une liste vide.
  const consolidatedCa = consolidatedFinances?.[0]?.ca
    || financialHistory?.[0]?.ca || null;
  let competitorCandidates = { registry: [], press: [] };
  try {
    section('  🎯 Découverte concurrents');
    const { fetchCompetitorCandidates } = await import('./fetching.js');
    competitorCandidates = await fetchCompetitorCandidates(identity, consolidatedCa);
    console.log(chalk.gray(
      `    Candidats: ${competitorCandidates.registry.length} pairs Pappers registry, ${competitorCandidates.press.length} mentions presse`
    ));
  } catch (e) {
    warn(`     Competitor discovery failed: ${e.message}`);
  }

  // ── AI Analysis ───────────────────────────────────────────────────────────
  let aiAnalysis = null;
  if (options.ai) {
    section('  🤖 Analyse IA — Due Diligence');
    if (!hasAIKey() && !options.uncensored) {
      warn('     No AI provider. Vulcain Ollama (192.168.1.30:11434) should be auto-detected.');
      warn('     Or set OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY.');
    } else {
      console.log(chalk.gray('  Generating AI due diligence analysis (JSON)...'));
      try {
        const { rawGrowthData, growthDataSource } = computeGrowthData(consolidatedFinances, financialHistory);

        // Refresh stale subsidiary financials in parallel
        await refreshStaleSubsidiaries(subsidiariesData, consolidatedFinances);

        const promptCtx = buildAIPromptContext({
          identity, financialHistory, consolidatedFinances, dirigeants, ubo, bodacc,
          representants, proceduresCollectives, subsidiariesData, pressResults,
          scrapedMaContent, codeBuiltMaHistory, rawGrowthData, growthDataSource,
          competitorCandidates,
        });

        const { systemPrompt, userPrompt } = buildAIPrompts(identity, siren, promptCtx, codeBuiltMaHistory, options);

        const raw = await callAI(systemPrompt, userPrompt, { maxTokens: 8192, uncensored: options.uncensored });
        aiAnalysis = extractAIJSON(raw);

        if (aiAnalysis) {
          aiAnalysis.maHistory = mergeMaHistory(codeBuiltMaHistory, aiAnalysis);
          renderAIAnalysis(aiAnalysis);
        } else {
          console.log('\n' + chalk.white(raw) + '\n');
        }
      } catch (e) {
        warn(`     AI analysis failed: ${e.message}`);
      }
    }
  }

  // ── PDF / Export ──────────────────────────────────────────────────────────
  let pdfData = null;
  if (options.format === 'pdf' || options.export === 'pdf') {
    pdfData = buildPdfData({
      identity, financialHistory, consolidatedFinances, ubo, bodacc,
      dirigeants, representants, etablissements, proceduresCollectives,
      subsidiariesData, pressResults, aiAnalysis, codeBuiltMaHistory,
      scrapedMaContent, siren, competitorCandidates,
      judilibreDecisions, inpiMarques, inpiBrevets,
    });

    try {
      const { generatePDF } = await import('@recognity/pdf-report');
      await generatePDF({
        type: 'intel-report',
        title: `Deep Profile — ${identity.name || siren}`,
        subtitle: `Company due diligence report · ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        output: options.output || `profile-${siren}.pdf`,
        branding: {
          company: 'Recognity',
          footer: 'Powered by Recognity · recognity.fr',
          colors: { primary: '#0a0a0a', accent: '#c8a961' },
        },
        data: pdfData,
      });
      console.log(chalk.green(`\n  ✅ PDF report saved to ${options.output || `profile-${siren}.pdf`}\n`));
    } catch (e) {
      warn(`  PDF generation failed: ${e.message}`);
    }
  }

  if (options.export) {
    try {
      const profileData = {
        siren, identity, financialHistory,
        subsidiaries: subsidiariesData, aiAnalysis,
        groupStructure: aiAnalysis?.groupStructure,
        summary: `${identity.name || siren} — ${identity.formeJuridique || ''}, ${identity.nafLabel || ''}. Created ${identity.dateCreation || '?'}.`,
        executiveSummary: aiAnalysis?.executiveSummary,
        strengths: aiAnalysis?.strengths || [],
        weaknesses: aiAnalysis?.weaknesses || [],
        competitors: aiAnalysis?.competitors || [],
        healthScore: aiAnalysis?.healthScore,
        riskAssessment: aiAnalysis?.riskAssessment,
        exportedAt: new Date().toISOString(),
        language: getLanguage()
      };

      const result = await handleExport(options.export, profileData, {
        pdfData,
        output: options.output,
        commandType: 'profile',
        pdfOptions: {
          type: 'intel-report',
          title: `Profile — ${identity.name || siren}`,
        },
      });
      console.log(chalk.green(`\n  ✅ ${result}\n`));
    } catch (e) {
      console.error(chalk.red(`\n  ❌ Export failed: ${e.message}\n`));
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  console.log('');
  const today = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  console.log(chalk.gray(`  Source : Pappers.fr — ${today}`));
  console.log('');
}

