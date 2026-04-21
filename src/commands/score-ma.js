import chalk from 'chalk';
import { callAI, hasAIKey, getAIConfig, checkOllamaHealth } from '../ai/client.js';
import { header, section, error, warn, success } from '../utils/display.js';
import { resolveFRProvider } from './profile/provider.js';
import { fetchCompanyDossier } from './profile/fetching.js';
import { computeGrowthData, buildAIPromptContext } from './profile/scoring.js';
import { formatEuro } from './profile/helpers.js';

/**
 * Prescriptive M&A scoring command.
 * Scores a target company for M&A attractiveness using Open Data (BODACC/Siren)
 * via Pappers API or free Annuaire Entreprises fallback, then runs local LLM scoring.
 *
 * Usage: intelwatch score-ma <siren-or-name> [--sector <niche>] [--json]
 */
export async function runScoreMA(sirenOrName, options = {}) {
  const aiConfig = getAIConfig();

  header(`🎯 M&A Prescriptive Scoring — ${sirenOrName}`);
  console.log(chalk.gray(`AI: ${aiConfig?.provider || 'none'} / ${aiConfig?.model || '?'}\n`));

  // ── Step 1: Check local LLM health ──────────────────────────────────────
  if (aiConfig?.provider === 'ollama') {
    console.log(chalk.gray(`  Checking Ollama health at ${aiConfig.host}...`));
    const health = await checkOllamaHealth(aiConfig.host);
    if (!health.healthy) {
      error(`Ollama unreachable at ${aiConfig.host}: ${health.error}`);
      console.log(chalk.gray('  Ensure `ollama serve` is running, or set OLLAMA_HOST to your instance.'));
      process.exit(1);
    }
    success(`  Ollama OK — models: ${health.models.join(', ')}`);
    if (!health.models.includes(aiConfig.model)) {
      warn(`  Model ${aiConfig.model} not found. Available: ${health.models.join(', ')}`);
      process.exit(1);
    }
  }

  // ── Step 2: Fetch company data from Open Data ──────────────────────────
  console.log(chalk.gray('  Fetching company dossier from Open Data...'));
  const frProvider = resolveFRProvider();

  let data, siren, isFallback;
  try {
    const result = await fetchCompanyDossier(sirenOrName, frProvider, options);
    data = result.data;
    siren = result.siren;
    isFallback = result.isFallback;
  } catch (err) {
    error(`Failed to fetch company data: ${err.message}`);
    process.exit(1);
  }

  if (isFallback) {
    warn('  Using Annuaire Entreprises fallback — limited financial data available.');
  }

  const { identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants,
          representants, proceduresCollectives } = data;

  // ── Step 3: Build distress signals ─────────────────────────────────────
  const distressSignals = [];
  const procTypes = proceduresCollectives?.map(p => p.type) || [];
  if (procTypes.length > 0) {
    distressSignals.push({
      type: 'collective_procedure',
      severity: 'critical',
      details: procTypes.join(', '),
    });
  }

  const bodaccDistress = (bodacc || []).filter(b => b.isDistress);
  for (const b of bodaccDistress) {
    distressSignals.push({
      type: b.distressType || 'bodacc_alert',
      severity: b.severity || 'high',
      details: b.description || '',
    });
  }

  // Revenue decline detection
  if (financialHistory?.length >= 2) {
    const sorted = [...financialHistory].sort((a, b) => (b.annee || 0) - (a.annee || 0));
    if (sorted[0]?.ca && sorted[1]?.ca && sorted[0].ca < sorted[1].ca * 0.85) {
      distressSignals.push({
        type: 'revenue_decline',
        severity: 'high',
        details: `CA dropped from ${formatEuro(sorted[1].ca)} (${sorted[1].annee}) to ${formatEuro(sorted[0].ca)} (${sorted[0].annee})`,
      });
    }
  }

  // ── Step 4: Compute financial indicators ─────────────────────────────────
  const finSource = consolidatedFinances?.length ? consolidatedFinances : financialHistory;
  const latestFin = finSource?.length ? [...finSource].sort((a, b) => (b.annee || 0) - (a.annee || 0))[0] : null;

  const indicators = {
    revenue: latestFin?.ca || 0,
    revenueYear: latestFin?.annee || '?',
    netIncome: latestFin?.resultat || 0,
    equity: latestFin?.capitauxPropres || 0,
    employeeCount: identity.effectifs || '?',
    creationDate: identity.dateCreation || '?',
    form: identity.formeJuridique || '?',
    naf: identity.nafCode || '?',
    nafLabel: identity.nafLabel || '?',
  };

  // ── Step 5: Display raw signals ─────────────────────────────────────────
  section('  📊 Company Profile');
  console.log(`  ${chalk.white.bold(identity.name || siren)} — ${indicators.form}`);
  console.log(`  NAF: ${indicators.naf} ${indicators.nafLabel}`);
  console.log(`  Created: ${indicators.creationDate} · Effectifs: ${indicators.employeeCount}`);
  if (latestFin) {
    console.log(`  CA (${indicators.revenueYear}): ${formatEuro(indicators.revenue)}`);
    console.log(`  Résultat: ${formatEuro(indicators.netIncome)}`);
    if (indicators.equity) console.log(`  Capitaux propres: ${formatEuro(indicators.equity)}`);
  }

  if (distressSignals.length > 0) {
    section('  🔴 Distress Signals');
    for (const ds of distressSignals) {
      const sevColor = ds.severity === 'critical' ? chalk.red : ds.severity === 'high' ? chalk.yellow : chalk.gray;
      console.log(`  ${sevColor(`[${ds.severity.toUpperCase()}]`)} ${ds.type}: ${ds.details}`);
    }
  } else {
    section('  🟢 No Distress Signals');
  }

  // ── Step 6: Run AI prescriptive scoring ─────────────────────────────────
  section('  🤖 AI Prescriptive M&A Scoring');
  console.log(chalk.gray(`  Running scoring via ${aiConfig?.provider}/${aiConfig?.model}...\n`));

  const systemPrompt =
    `You are an M&A analyst specializing in mid-market French companies. Score this target for M&A attractiveness.
Return ONLY valid JSON with this structure:
{
  "maScore": 0-100,
  "acquisitionViability": "high|medium|low|avoid",
  "strategicRationale": "1-2 sentence rationale",
  "riskFactors": ["risk1", "risk2", ...],
  "opportunities": ["opp1", "opp2", ...],
  "recommendedApproach": "hostile|friendly|wait|pass",
  "estimatedValuation": "range in M€ if data permits, or null",
  "keyNegotiationPoints": ["point1", "point2", ...],
  "distressPremium": true/false,
  "timeline": "immediate|6months|1year|monitor"
}

Scoring criteria:
- Revenue size & trajectory (growth = +, decline = -)
- Profitability (positive net income = +)
- Distress signals (procedures, BODACC alerts = massive discount)
- Market position (NAF sector attractiveness)
- Governance complexity (few owners = easier deal)
- Financial transparency (audited accounts = +)

Be conservative. A company in procédure collective should score < 20 regardless of other factors.`;

  const finData = finSource?.length
    ? finSource.map(f => `${f.annee}: CA=${f.ca != null ? formatEuro(f.ca) : 'N/A'}, Résultat=${f.resultat != null ? formatEuro(f.resultat) : 'N/A'}`).join('\n')
    : 'Non disponible';

  const uboStr = (ubo || []).map(b => `${b.prenom || ''} ${b.nom || ''}: ${b.pourcentageParts || '?'}%`).join(', ') || 'Non déclaré';
  const dirStr = (dirigeants || []).map(d => `${d.prenom || ''} ${d.nom || ''} (${d.role || '?'})`).join(', ') || 'Non disponible';
  const sector = options.sector || indicators.nafLabel || 'unknown';

  const userPrompt =
    `Score M&A target: ${identity.name || siren} (SIREN: ${identity.siren || siren})
Sector: ${sector}
Form: ${indicators.form}
Created: ${indicators.creationDate}, Effectifs: ${indicators.employeeCount}

FINANCIAL HISTORY:
${finData}

BENEFICIAL OWNERS: ${uboStr}
EXECUTIVES: ${dirStr}

DISTRESS SIGNALS:
${distressSignals.length ? distressSignals.map(d => `- [${d.severity}] ${d.type}: ${d.details}`).join('\n') : 'None detected'}

BODACC PUBLICATIONS:
${(bodacc || []).slice(0, 10).map(b => `- [${b.date || '?'}] ${b.type}: ${b.description || ''}`).join('\n') || 'None'}

Provide the M&A score JSON.`;

  let scoreResult;
  try {
    const raw = await callAI(systemPrompt, userPrompt, { maxTokens: 2048 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      error('AI returned non-JSON response');
      console.log(chalk.gray(raw));
      process.exit(1);
    }
    scoreResult = JSON.parse(jsonMatch[0]);
  } catch (err) {
    error(`AI scoring failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 7: Render results ─────────────────────────────────────────────
  const scoreColor = scoreResult.maScore >= 70 ? chalk.green : scoreResult.maScore >= 40 ? chalk.yellow : chalk.red;
  const viabColor = {
    high: chalk.green,
    medium: chalk.yellow,
    low: chalk.red,
    avoid: chalk.red.bold,
  }[scoreResult.acquisitionViability] || chalk.gray;

  console.log(`  ${chalk.bold('M&A Score:')} ${scoreColor(scoreResult.maScore + '/100')}`);
  console.log(`  ${chalk.bold('Viability:')} ${viabColor(scoreResult.acquisitionViability?.toUpperCase())}`);
  console.log(`  ${chalk.bold('Rationale:')} ${scoreResult.strategicRationale}`);
  if (scoreResult.estimatedValuation) {
    console.log(`  ${chalk.bold('Est. Valuation:')} ${scoreResult.estimatedValuation}`);
  }
  console.log(`  ${chalk.bold('Approach:')} ${scoreResult.recommendedApproach}`);
  console.log(`  ${chalk.bold('Timeline:')} ${scoreResult.timeline}`);
  if (scoreResult.distressPremium) {
    console.log(`  ${chalk.bold('Distress Premium:')} ${chalk.red('YES — target under financial stress')}`);
  }

  if (scoreResult.riskFactors?.length) {
    console.log(`\n  ${chalk.bold('Risk Factors:')}`);
    for (const r of scoreResult.riskFactors) console.log(`    ${chalk.red('●')} ${r}`);
  }

  if (scoreResult.opportunities?.length) {
    console.log(`\n  ${chalk.bold('Opportunities:')}`);
    for (const o of scoreResult.opportunities) console.log(`    ${chalk.green('●')} ${o}`);
  }

  if (scoreResult.keyNegotiationPoints?.length) {
    console.log(`\n  ${chalk.bold('Key Negotiation Points:')}`);
    for (const p of scoreResult.keyNegotiationPoints) console.log(`    ${chalk.cyan('●')} ${p}`);
  }

  // ── Step 8: JSON output if requested ────────────────────────────────────
  if (options.json) {
    const output = {
      siren: identity.siren || siren,
      name: identity.name,
      sector,
      ...indicators,
      distressSignals,
      maScore: scoreResult,
      scoredAt: new Date().toISOString(),
      provider: aiConfig?.provider,
      model: aiConfig?.model,
    };
    const { writeFileSync } = await import('fs');
    const outPath = options.output || `score-ma-${siren || 'result'}.json`;
    writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\n  ${chalk.green('✓')} JSON saved to ${outPath}`);
  }

  console.log('');
}
