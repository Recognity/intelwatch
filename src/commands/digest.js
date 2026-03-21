import chalk from 'chalk';
import { loadTrackers, loadLatestSnapshot, listSnapshots, loadSnapshot } from '../storage.js';
import { diffCompetitorSnapshots } from '../trackers/competitor.js';
import { diffKeywordSnapshots } from '../trackers/keyword.js';
import { diffBrandSnapshots } from '../trackers/brand.js';
import { createTable, header, section, trackerTypeIcon, warn } from '../utils/display.js';
import { hasAIKey, callAI, getAIConfig } from '../ai/client.js';
import { exportToJSON, exportToCSV, formatForExport } from '../utils/export.js';
import { setLanguage, getLanguage } from '../utils/i18n.js';

export async function runDigest(options = {}) {
  // Set language from global option
  if (options.parent?.opts()?.lang) {
    setLanguage(options.parent.opts().lang);
  }

  const trackers = loadTrackers();
  const digestData = []; // Pour l'export

  if (trackers.length === 0) {
    warn('No trackers configured. Use `intelwatch track` to add one.');
    return;
  }

  header('📊 Intelligence Digest');
  console.log(chalk.gray(`Generated: ${new Date().toLocaleString()}\n`));

  const table = createTable(['Tracker', 'Type', 'Changes', 'Summary']);
  let totalChanges = 0;

  for (const tracker of trackers) {
    const snapshots = listSnapshots(tracker.id);

    if (snapshots.length === 0) {
      table.push([
        chalk.cyan(tracker.id.slice(0, 25)),
        trackerTypeIcon(tracker.type),
        chalk.gray('—'),
        chalk.gray('No snapshots yet'),
      ]);
      continue;
    }

    const latest = loadSnapshot(snapshots[snapshots.length - 1].filepath);
    const prev = snapshots.length > 1 ? loadSnapshot(snapshots[snapshots.length - 2].filepath) : null;

    let changes = [];
    if (tracker.type === 'competitor') changes = diffCompetitorSnapshots(prev, latest);
    else if (tracker.type === 'keyword') changes = diffKeywordSnapshots(prev, latest);
    else if (tracker.type === 'brand') changes = diffBrandSnapshots(prev, latest);

    // Use stored changes if available and no prev
    if (!prev && latest.changes) {
      changes = latest.changes;
    }

    const target = tracker.name || tracker.keyword || tracker.brandName || tracker.id;
    const changeStr = changes.length > 0
      ? chalk.yellow(String(changes.length))
      : chalk.gray('0');

    const summary = changes.length > 0
      ? changes.slice(0, 2).map(c => c.value?.slice(0, 40) || c.field).join('; ')
      : chalk.gray('no changes');

    table.push([
      chalk.cyan(target.slice(0, 25)),
      trackerTypeIcon(tracker.type) + ' ' + tracker.type,
      changeStr,
      summary.slice(0, 50),
    ]);

    // Data pour export
    digestData.push({
      trackerId: tracker.id,
      name: target,
      type: tracker.type,
      changes: changes,
      changesCount: changes.length,
      lastCheck: latest.timestamp || latest.createdAt,
      summary: summary.length > 50 ? summary.slice(0, 47) + '...' : summary,
      status: latest.error ? 'error' : 'active'
    });

    totalChanges += changes.length;
  }

  console.log(table.toString());
  console.log('');

  if (totalChanges > 0) {
    console.log(chalk.yellow(`⚡ ${totalChanges} total change(s) across all trackers.`));
    console.log(chalk.gray('Run `intelwatch diff <tracker-id>` for details on any tracker.'));
  } else {
    console.log(chalk.green('✓ No significant changes detected across all trackers.'));
  }

  console.log(chalk.gray('\nRun `intelwatch report --format html` for a full report.'));

  // ── AI enhancement (optional) ─────────────────────────────────────────────
  if (hasAIKey()) {
    await runAIDigestSummary(trackers);
  } else {
    console.log(chalk.gray('\nTip: set OPENAI_API_KEY or ANTHROPIC_API_KEY for AI-powered digest analysis.'));
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  if (options.export) {
    try {
      const formatted = formatForExport(digestData, 'digest');
      
      if (options.export.toLowerCase() === 'json') {
        const result = exportToJSON(formatted, options.output);
        console.log(chalk.green(`\n  ✅ ${result}\n`));
      } else if (options.export.toLowerCase() === 'csv') {
        const result = exportToCSV(formatted, options.output);
        console.log(chalk.green(`\n  ✅ ${result}\n`));
      } else {
        console.log(chalk.yellow(`\n  ⚠️  Unsupported export format: ${options.export}. Use 'json' or 'csv'.\n`));
      }
    } catch (e) {
      console.error(chalk.red(`\n  ❌ Export failed: ${e.message}\n`));
    }
  }
}

async function runAIDigestSummary(trackers) {
  const competitors = trackers.filter(t => t.type === 'competitor');
  if (competitors.length === 0) return;

  const aiConfig = getAIConfig();
  section('\n🤖 AI Digest Analysis');
  console.log(chalk.gray(`Provider: ${aiConfig.provider} / ${aiConfig.model}\n`));

  // Build a compact snapshot of all competitors for a combined analysis
  const competitorData = [];
  for (const tracker of competitors) {
    const snapshots = listSnapshots(tracker.id);
    if (snapshots.length === 0) continue;

    const latest = loadSnapshot(snapshots[snapshots.length - 1].filepath);
    const prev = snapshots.length > 1 ? loadSnapshot(snapshots[snapshots.length - 2].filepath) : null;
    const changes = diffCompetitorSnapshots(prev, latest);

    competitorData.push({ tracker, latest, changes });
  }

  if (competitorData.length === 0) {
    console.log(chalk.gray('  No competitor snapshots available for AI analysis.\n'));
    return;
  }

  try {
    const analysis = await generateDigestAnalysis(competitorData);
    console.log(analysis + '\n');
  } catch (err) {
    console.log(chalk.red(`  AI error: ${err.message}\n`));
  }
}

async function generateDigestAnalysis(competitorData) {
  const systemPrompt =
    'You are a competitive intelligence analyst producing a concise weekly digest. ' +
    'Be specific, actionable, and brief. Write in plain English prose. ' +
    'Focus on what changed and what it means strategically.';

  const summaries = competitorData.map(({ tracker, latest, changes }) => {
    const name = tracker.name || tracker.url;
    const changesText = changes.length > 0
      ? changes.slice(0, 5).map(c => `${c.type}: ${c.field} — ${c.value}`).join('; ')
      : 'no changes detected';

    const pressNote = latest.press?.totalCount
      ? ` Press: ${latest.press.totalCount} mentions (${latest.press.sentimentBreakdown?.negative || 0} negative).`
      : '';

    const jobsNote = latest.jobs?.estimatedOpenings
      ? ` Hiring: ~${latest.jobs.estimatedOpenings} openings.`
      : '';

    return `${name}: changes=[${changesText}]${pressNote}${jobsNote}`;
  }).join('\n');

  const userPrompt =
    `Weekly competitive digest for ${competitorData.length} competitor(s):\n\n` +
    `${summaries}\n\n` +
    `Provide:\n` +
    `1. **Overall Assessment** (2-3 sentences): What's the most important competitive development this week?\n` +
    `2. **Threat Levels**: For each competitor, one line: "[Name]: [LOW/MEDIUM/HIGH] — [reason]"\n` +
    `3. **Recommended Actions**: 2-3 bullet points of what to do right now\n` +
    `4. **Team One-liner**: One sentence to forward to your team summarizing the week\n\n` +
    `Be concise and specific.`;

  return await callAI(systemPrompt, userPrompt, { maxTokens: 600 });
}
