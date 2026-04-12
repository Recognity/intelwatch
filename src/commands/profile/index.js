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
  const codeBuiltMaHistory = buildMaHistoryFromCode(scrapedMaContent, offBrandSubsForMa);
  if (codeBuiltMaHistory.length) console.log(chalk.gray(`  📋 M&A timeline (${codeBuiltMaHistory.length} entries): ${codeBuiltMaHistory.map(e => `${e.target?.substring(0,15)} [${e.date}]`).join(', ')}`));

  // ── AI Analysis ───────────────────────────────────────────────────────────
  let aiAnalysis = null;
  if (options.ai) {
    section('  🤖 Analyse IA — Due Diligence');
    if (!hasAIKey() && !options.uncensored) {
      warn('     No AI API key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
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
      scrapedMaContent, siren,
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

