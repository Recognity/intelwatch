import chalk from 'chalk';
import { loadTrackers, getTracker, listSnapshots, loadSnapshot } from '../storage.js';
import { diffCompetitorSnapshots } from '../trackers/competitor.js';
import { header, section, error, warn } from '../utils/display.js';
import { callAI, hasAIKey, getAIConfig } from '../ai/client.js';

export async function runAISummary(options = {}) {
  if (!hasAIKey()) {
    error('No AI API key configured.');
    console.log(chalk.gray('Set OPENAI_API_KEY or ANTHROPIC_API_KEY env var, or add to ~/.intelwatch/config.yml:'));
    console.log(chalk.gray('  ai:\n    api_key: sk-xxx\n    provider: openai  # or anthropic'));
    process.exit(1);
  }

  let trackers;
  if (options.tracker) {
    const t = getTracker(options.tracker);
    if (!t) {
      error(`Tracker not found: ${options.tracker}`);
      process.exit(1);
    }
    trackers = [t];
  } else {
    trackers = loadTrackers().filter(t => t.type === 'competitor');
  }

  if (trackers.length === 0) {
    warn('No competitor trackers found. Use `intelwatch track competitor <url>` to add one.');
    return;
  }

  const aiConfig = getAIConfig();
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  header(`📊 Weekly Intelligence Brief — ${dateStr}`);
  console.log(chalk.gray(`Provider: ${aiConfig.provider} / ${aiConfig.model}\n`));

  for (const tracker of trackers) {
    const snapshots = listSnapshots(tracker.id);
    if (snapshots.length === 0) {
      console.log(chalk.yellow(`⚠ ${tracker.name || tracker.url}: No snapshots yet. Run \`intelwatch check\` first.\n`));
      continue;
    }

    const latest = loadSnapshot(snapshots[snapshots.length - 1].filepath);
    const prev = snapshots.length > 1 ? loadSnapshot(snapshots[snapshots.length - 2].filepath) : null;
    const changes = diffCompetitorSnapshots(prev, latest);

    const name = tracker.name || tracker.url;
    section(`${name}:`);

    try {
      const brief = await generateCompetitorBrief(tracker, latest, changes);
      console.log('\n' + brief + '\n');
    } catch (err) {
      console.log(chalk.red(`  AI error: ${err.message}\n`));
    }
  }
}

async function generateCompetitorBrief(tracker, snapshot, changes) {
  const name = tracker.name || tracker.url;

  const systemPrompt =
    'You are a competitive intelligence analyst. Write concise, actionable intelligence briefs. ' +
    'Be specific and data-driven, not vague. Write in plain English prose (no bullet lists). ' +
    'Keep the analysis to 2-4 sentences, then add one Recommendation sentence.';

  const context = buildSnapshotContext(snapshot, changes);

  const userPrompt =
    `Write an intelligence brief for competitor: ${name}\n\n` +
    `Data:\n${context}\n\n` +
    `Format exactly:\n` +
    `${name} ([domain]):\n` +
    `[2-4 sentence narrative covering their current state, recent activity, and notable signals. ` +
    `Reference specific data points — press headlines, tech stack issues, job growth, ratings.]\n\n` +
    `Recommendation: [1 sentence actionable advice for competing against them right now.]`;

  return await callAI(systemPrompt, userPrompt, { maxTokens: 450 });
}

function buildSnapshotContext(snap, changes) {
  const lines = [];

  lines.push(`URL: ${snap.url}`);
  lines.push(`Last checked: ${snap.checkedAt}`);
  lines.push(`Pages found: ${snap.pageCount || 0}`);

  if (snap.techStack?.length) {
    lines.push(`Tech stack: ${snap.techStack.map(t => t.name).join(', ')}`);
  }

  if (snap.jobs?.estimatedOpenings) {
    lines.push(`Open jobs: ~${snap.jobs.estimatedOpenings}`);
  }

  if (snap.pricing?.prices?.length) {
    lines.push(`Pricing: ${snap.pricing.prices.slice(0, 5).join(', ')}`);
  }

  if (snap.performance) {
    const p = snap.performance;
    lines.push(`Performance: load ${p.loadTime}ms, TTFB ${p.ttfb}ms`);
  }

  if (snap.security) {
    const s = snap.security;
    const issues = [];
    if (!s.hsts) issues.push('no HSTS');
    if (!s.httpsRedirect) issues.push('no HTTPS redirect');
    if (issues.length) lines.push(`Security issues: ${issues.join(', ')}`);
  }

  if (snap.seoSignals) {
    const seo = snap.seoSignals;
    const signals = [];
    if (seo.missingAlt > 0) signals.push(`${seo.missingAlt} images without alt`);
    if (seo.htmlSize) signals.push(`${Math.round(seo.htmlSize / 1024)}KB uncompressed HTML`);
    if (seo.brokenLinks > 0) signals.push(`${seo.brokenLinks} broken links`);
    if (signals.length) lines.push(`SEO signals: ${signals.join(', ')}`);
  }

  if (snap.press?.articles?.length) {
    const p = snap.press;
    lines.push(
      `Press mentions: ${p.totalCount} total ` +
      `(${p.sentimentBreakdown?.positive || 0} positive, ${p.sentimentBreakdown?.negative || 0} negative)`
    );
    const headlines = p.articles.slice(0, 3).map(a => `"${a.title}"`).join('; ');
    lines.push(`Recent headlines: ${headlines}`);
  }

  if (snap.reputation?.platforms?.length) {
    const ratings = snap.reputation.platforms.map(p => `${p.platform}: ${p.rating}/5`).join(', ');
    lines.push(`Ratings: ${ratings}`);
  }

  if (changes.length > 0) {
    const changeSummary = changes.slice(0, 8).map(c => `  ${c.type}: ${c.field} — ${c.value}`).join('\n');
    lines.push(`\nRecent changes:\n${changeSummary}`);
  } else {
    lines.push('Recent changes: none detected');
  }

  return lines.join('\n');
}
