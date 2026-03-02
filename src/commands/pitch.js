import { writeFileSync } from 'fs';
import chalk from 'chalk';
import { getTracker, loadLatestSnapshot } from '../storage.js';
import { header, error, warn } from '../utils/display.js';
import { callAI, hasAIKey, getAIConfig } from '../ai/client.js';

export async function runPitch(competitorId, options = {}) {
  if (!hasAIKey()) {
    error('No AI API key configured.');
    console.log(chalk.gray('Set OPENAI_API_KEY or ANTHROPIC_API_KEY env var, or add to ~/.intelwatch/config.yml'));
    process.exit(1);
  }

  const tracker = getTracker(competitorId);
  if (!tracker) {
    error(`Tracker not found: ${competitorId}`);
    process.exit(1);
  }

  if (tracker.type !== 'competitor') {
    error('pitch only works with competitor trackers.');
    process.exit(1);
  }

  const snapshot = loadLatestSnapshot(competitorId);
  if (!snapshot) {
    warn(`No snapshot for ${competitorId}. Run \`intelwatch check\` first.`);
    return;
  }

  const competitorName = tracker.name || tracker.url;
  const yourSite = options.for || 'your product';
  const format = options.format || 'md';

  const aiConfig = getAIConfig();
  header(`📝 Competitive Pitch: ${yourSite} vs ${competitorName}`);
  console.log(chalk.gray(`Provider: ${aiConfig.provider} / ${aiConfig.model}\n`));

  let pitch;
  try {
    pitch = await generatePitch(tracker, snapshot, yourSite, format);
  } catch (err) {
    error(`AI error: ${err.message}`);
    process.exit(1);
  }

  console.log('\n' + pitch + '\n');

  if (options.output) {
    writeFileSync(options.output, pitch, 'utf8');
    console.log(chalk.green(`✓ Pitch saved to ${options.output}`));
  }
}

async function generatePitch(tracker, snapshot, yourSite, format) {
  const competitorName = tracker.name || tracker.url;

  const systemPrompt =
    'You are a sales strategist and competitive intelligence expert. ' +
    'Generate crisp, data-backed competitive pitch documents. ' +
    'Be specific about weaknesses you can exploit. Use the actual data points provided. ' +
    'Be direct and sales-ready — this document may be shared with prospects or internal teams. ' +
    'Only reference data that was actually provided. Do not invent statistics.';

  const context = buildPitchContext(competitorName, snapshot);
  const outputFormat = format === 'html' ? 'HTML' : 'Markdown';

  const userPrompt =
    `Generate a competitive pitch document: "${yourSite}" vs "${competitorName}".\n\n` +
    `Competitor data:\n${context}\n\n` +
    `Write in ${outputFormat} with these sections:\n\n` +
    `1. Executive Summary — 2-3 sentences on why ${yourSite} is the better choice\n` +
    `2. Competitor Weaknesses — specific, data-backed points from the data provided\n` +
    `3. Your Advantages — frame based on their weaknesses (say "where they struggle, you excel")\n` +
    `4. Talking Points — 3-5 bullet points to use with prospects\n` +
    `5. Data Snapshot — table of key metrics\n\n` +
    `Use actual numbers from the data. Omit sections that have no supporting data.`;

  return await callAI(systemPrompt, userPrompt, { maxTokens: 1200 });
}

function buildPitchContext(name, snap) {
  const lines = [];

  lines.push(`Competitor: ${name}`);
  lines.push(`URL: ${snap.url}`);
  lines.push(`Pages indexed: ${snap.pageCount || 0}`);

  if (snap.techStack?.length) {
    lines.push(`Tech stack: ${snap.techStack.map(t => `${t.name} (${t.category})`).join(', ')}`);
  }

  if (snap.performance) {
    const p = snap.performance;
    lines.push(`Page speed: load ${p.loadTime}ms, TTFB ${p.ttfb}ms`);
  }

  if (snap.security) {
    const s = snap.security;
    const issues = [];
    if (!s.hsts) issues.push('missing HSTS');
    if (!s.httpsRedirect) issues.push('no HTTPS redirect');
    if (!s.xFrameOptions) issues.push('no X-Frame-Options');
    if (!s.contentSecurityPolicy) issues.push('no CSP header');
    if (issues.length) lines.push(`Security issues: ${issues.join(', ')}`);
    else lines.push('Security: all common headers present');
  }

  if (snap.seoSignals) {
    const seo = snap.seoSignals;
    const signals = [];
    if (seo.missingAlt > 0) signals.push(`${seo.missingAlt} images without alt text`);
    if (seo.htmlSize) signals.push(`${Math.round(seo.htmlSize / 1024)}KB uncompressed HTML`);
    if (seo.brokenLinks > 0) signals.push(`${seo.brokenLinks} broken links`);
    if (signals.length) lines.push(`SEO weaknesses: ${signals.join(', ')}`);
  }

  if (snap.pricing?.prices?.length) {
    lines.push(`Pricing: ${snap.pricing.prices.slice(0, 8).join(', ')}`);
  } else {
    lines.push('Pricing: not publicly listed');
  }

  if (snap.jobs?.estimatedOpenings) {
    lines.push(`Hiring: ~${snap.jobs.estimatedOpenings} open positions`);
  }

  if (snap.press?.articles?.length) {
    const p = snap.press;
    lines.push(
      `Press coverage: ${p.totalCount} mentions ` +
      `(${p.sentimentBreakdown?.positive || 0} positive, ${p.sentimentBreakdown?.negative || 0} negative)`
    );
    const negatives = p.articles
      .filter(a => a.sentiment === 'negative' || a.sentiment === 'slightly_negative')
      .slice(0, 3);
    if (negatives.length) {
      lines.push(`Negative coverage: ${negatives.map(a => `"${a.title}"`).join('; ')}`);
    }
  }

  if (snap.reputation?.platforms?.length) {
    lines.push(`Customer ratings: ${snap.reputation.platforms.map(p => `${p.platform} ${p.rating}/5`).join(', ')}`);
  }

  if (snap.meta?.title) {
    lines.push(`Their positioning: "${snap.meta.title}"`);
  }

  if (snap.socialLinks) {
    const platforms = Object.keys(snap.socialLinks);
    if (platforms.length) lines.push(`Social presence: ${platforms.join(', ')}`);
  }

  return lines.join('\n');
}
