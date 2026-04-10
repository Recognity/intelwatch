import chalk from 'chalk';
import { fetch } from '../utils/fetcher.js';
import { load, extractMeta } from '../utils/parser.js';
import { webSearch } from '../scrapers/searxng-search.js';
import { callAI, hasAIKey } from '../ai/client.js';
import { createTracker } from '../storage.js';
import { header, section, success, warn, error } from '../utils/display.js';

export async function runDiscover(url, options) {
  let normalizedUrl = url;
  if (!normalizedUrl.startsWith('http')) normalizedUrl = 'https://' + normalizedUrl;

  try { new URL(normalizedUrl); } catch {
    error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  header(`🔍 Discovering competitors for: ${normalizedUrl}`);

  // ── Step 1: Analyze target site ────────────────────────────────────────────
  console.log(chalk.gray('  Analyzing target site...'));

  const siteInfo = { title: '', description: '', keywords: [], services: [], location: null };

  try {
    const response = await fetch(normalizedUrl, { retries: 2, delay: 1000 });
    const $ = load(response.data);
    const meta = extractMeta($);

    siteInfo.title = meta.title || '';
    siteInfo.description = meta.description || '';

    const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
    siteInfo.keywords = metaKeywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 10);

    $('h1, h2, h3').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 3 && text.length < 100) siteInfo.services.push(text);
    });
    siteInfo.services = siteInfo.services.slice(0, 10);

    const pageText = $.text();
    const locationMatch = pageText.match(
      /\b(Paris|Lyon|Marseille|Bordeaux|Toulouse|Nantes|Lille|Strasbourg|France|London|Berlin|New York|San Francisco|Amsterdam|Madrid|Barcelona)\b/i
    );
    if (locationMatch) siteInfo.location = locationMatch[0];
  } catch (err) {
    warn(`Could not fetch target site: ${err.message}. Proceeding with URL-based discovery...`);
  }

  const hostname = new URL(normalizedUrl).hostname.replace('www.', '');
  const brandName = siteInfo.title.split(/[-|:]/)[0].trim() || hostname.split('.')[0];

  console.log(chalk.gray(`  Brand   : ${brandName}`));
  if (siteInfo.description) console.log(chalk.gray(`  Desc    : ${siteInfo.description.substring(0, 100)}`));
  if (siteInfo.location) console.log(chalk.gray(`  Location: ${siteInfo.location}`));

  // ── Step 2: Generate search queries ────────────────────────────────────────
  let queries = buildQueries(brandName, siteInfo);

  if (options.ai && hasAIKey()) {
    console.log(chalk.gray('  Using AI to generate smarter queries...'));
    try {
      const aiQueries = await generateAIQueries(brandName, siteInfo);
      if (aiQueries.length > 0) queries = aiQueries;
    } catch {}
  }

  section('  Search queries:');
  for (const q of queries) console.log(chalk.gray(`    · ${q}`));

  // ── Step 3: Run searches and collect candidates ─────────────────────────────
  console.log('\n' + chalk.gray('  Searching for competitors...'));
  const candidates = new Map();

  for (const query of queries) {
    await new Promise(r => setTimeout(r, 600));
    const { results, error: searchError } = await webSearch(query, { count: 20 });
    if (searchError) {
      warn(`  Search error for "${query}": ${searchError}`);
      continue;
    }

    for (const r of results) {
      const domain = r.domain;
      if (!domain || domain === hostname) continue;
      // Skip aggregators, directories, and social networks
      if (/wikipedia|linkedin|facebook|twitter|x\.com|youtube|yelp|trustpilot|pagesjaunes|societe\.com|pappers|capterra|g2\.com|glassdoor/i.test(domain)) continue;

      if (!candidates.has(domain)) {
        candidates.set(domain, {
          domain,
          url: r.url.match(/^https?:\/\/[^/]+/)?.[0] || `https://${domain}`,
          name: r.title?.split(/[-|:]/)[0].trim() || domain,
          snippet: r.snippet || '',
          appearances: 0,
          queries: [],
        });
      }

      const c = candidates.get(domain);
      c.appearances++;
      c.queries.push(query);
    }
  }

  if (candidates.size === 0) {
    warn('No competitors found. Check that SEARXNG_URL or SERPER_API_KEY is set and the URL is reachable.');
    return;
  }

  // ── Step 4: Score candidates ────────────────────────────────────────────────
  let scored = [...candidates.values()].map(c => {
    let score = 0;

    // More query appearances = stronger signal
    score += Math.min(c.appearances * 15, 45);

    // Domain extension match (e.g., both .fr)
    const targetExt = hostname.split('.').pop();
    const candExt = c.domain.split('.').pop();
    if (candExt === targetExt) score += 10;

    // Location match in snippet
    if (siteInfo.location && c.snippet.toLowerCase().includes(siteInfo.location.toLowerCase())) {
      score += 10;
    }

    // Service/keyword overlap in snippet
    const relevantTerms = [
      ...siteInfo.keywords,
      ...siteInfo.services.map(s => s.toLowerCase().split(/\s+/).slice(0, 2).join(' ')),
    ];
    for (const term of relevantTerms) {
      if (term.length > 3 && c.snippet.toLowerCase().includes(term.toLowerCase())) {
        score += 5;
      }
    }

    return {
      ...c,
      score: Math.min(score, 100),
      whyMatch: buildWhyMatch(c, siteInfo, hostname),
    };
  });

  // ── Step 5: Optional AI scoring ────────────────────────────────────────────
  if (options.ai && hasAIKey() && scored.length > 0) {
    console.log(chalk.gray('  Using AI for smarter relevance scoring...'));
    try {
      scored = await scoreWithAI(scored, siteInfo, brandName);
    } catch {
      scored = scored.sort((a, b) => b.score - a.score).slice(0, 15);
    }
  } else {
    scored = scored.sort((a, b) => b.score - a.score).slice(0, 15);
  }

  // ── Step 6: Display results ────────────────────────────────────────────────
  section(`\n  ${scored.length} competitors discovered:`);
  console.log('');

  for (let i = 0; i < scored.length; i++) {
    const c = scored[i];
    const rank = chalk.cyan(`#${i + 1}`);
    const bar = scoreBar(c.score);
    console.log(`  ${rank} ${chalk.white.bold(c.name)} ${chalk.gray(`(${c.domain})`)}`);
    console.log(`     ${bar} ${chalk.yellow(`${c.score}%`)} similarity`);
    console.log(`     ${chalk.gray(c.url)}`);
    if (c.whyMatch) console.log(`     ${chalk.gray('→')} ${chalk.gray(c.whyMatch)}`);
    console.log('');
  }

  // ── Step 7: Auto-track top results ─────────────────────────────────────────
  if (options.autoTrack) {
    const topN = scored.slice(0, 5);
    section(`  Auto-tracking top ${topN.length} competitors...`);
    for (const c of topN) {
      try {
        const { tracker, created } = createTracker('competitor', { url: c.url, name: c.name });
        if (created) {
          success(`  Created tracker: ${tracker.id} (${c.name})`);
        } else {
          warn(`  Already tracked: ${tracker.id} (${c.name})`);
        }
      } catch {}
    }
    console.log(chalk.gray('\n  Run `intelwatch check` to fetch initial snapshots.'));
  } else {
    console.log(chalk.gray('  Tip: use --auto-track to automatically create trackers for the top 5.'));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildQueries(brandName, siteInfo) {
  const queries = [];

  // Alternative / competitor framing
  queries.push(`alternative to ${brandName}`);

  // Description-based query
  if (siteInfo.description) {
    const shortDesc = siteInfo.description.split(/[.!?]/)[0].substring(0, 80);
    queries.push(shortDesc);
  } else {
    queries.push(`${brandName} competitor`);
  }

  // Main service heading
  if (siteInfo.services.length > 0) {
    queries.push(siteInfo.services[0].substring(0, 60));
  }

  // Location + service
  if (siteInfo.location && siteInfo.services.length > 0) {
    queries.push(`${siteInfo.services[0].substring(0, 40)} ${siteInfo.location}`);
  }

  // Top keywords
  if (siteInfo.keywords.length >= 2) {
    queries.push(siteInfo.keywords.slice(0, 3).join(' '));
  }

  return queries.slice(0, 5);
}

async function generateAIQueries(brandName, siteInfo) {
  const systemPrompt = 'You are a competitive intelligence expert. Output only valid JSON.';
  const userPrompt = `Generate 5 web search queries to find direct competitors of this business.

Brand: ${brandName}
Description: ${siteInfo.description || 'unknown'}
Top services/headings: ${siteInfo.services.slice(0, 5).join(', ') || 'unknown'}
Keywords: ${siteInfo.keywords.join(', ') || 'unknown'}
Location: ${siteInfo.location || 'unknown'}

Return ONLY a JSON array of 5 search query strings. Example: ["query one", "query two", ...]`;

  const raw = await callAI(systemPrompt, userPrompt, { max_tokens: 300 });
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]).filter(q => typeof q === 'string').slice(0, 5);
  } catch {
    return [];
  }
}

async function scoreWithAI(candidates, siteInfo, brandName) {
  const simplified = candidates.slice(0, 20).map(c => ({
    domain: c.domain,
    name: c.name,
    snippet: c.snippet?.substring(0, 150),
    appearances: c.appearances,
  }));

  const systemPrompt = 'You are a competitive intelligence analyst. Output only valid JSON.';
  const userPrompt = `Score these companies as potential competitors to "${brandName}".
Target description: ${siteInfo.description?.substring(0, 200) || 'unknown'}

Candidates:
${JSON.stringify(simplified, null, 2)}

Return ONLY a JSON array: [{"domain": "...", "score": 0-100, "reason": "short reason"}]
Sort by score descending.`;

  const raw = await callAI(systemPrompt, userPrompt, { max_tokens: 1000 });
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('No JSON in AI response');

  const aiScores = JSON.parse(match[0]);
  return candidates
    .map(c => {
      const ai = aiScores.find(a => a.domain === c.domain);
      return {
        ...c,
        score: ai?.score ?? c.score,
        whyMatch: ai?.reason || c.whyMatch,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function buildWhyMatch(candidate, siteInfo, targetHostname) {
  const reasons = [];
  if (candidate.appearances > 1) reasons.push(`appeared in ${candidate.appearances} queries`);
  if (siteInfo.location && candidate.snippet.toLowerCase().includes(siteInfo.location.toLowerCase())) {
    reasons.push(`same location (${siteInfo.location})`);
  }
  const targetExt = targetHostname.split('.').pop();
  const candExt = candidate.domain.split('.').pop();
  if (candExt === targetExt) reasons.push(`.${candExt} domain`);
  return reasons.join(', ') || 'matched search queries';
}

function scoreBar(score) {
  const filled = Math.round(score / 10);
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(10 - filled));
}
