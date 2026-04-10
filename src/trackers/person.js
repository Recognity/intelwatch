import { newsSearch, webSearch, searchSocial } from '../scrapers/searxng-search.js';
import { analyzeSentiment, categorizeMention } from '../utils/sentiment.js';

export async function runPersonCheck(tracker) {
  const { personName, org } = tracker;
  const query = org ? `"${personName}" "${org}"` : `"${personName}"`;

  const mentions = [];

  // 1. News search
  const news = await newsSearch(personName, { timeRange: 'month' });
  for (const r of news.results) {
    // Filter by org if provided (keep results that mention org or have no org context)
    if (org) {
      const text = (r.title + ' ' + r.snippet).toLowerCase();
      if (!text.includes(org.toLowerCase())) continue;
    }
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet);
    mentions.push({
      source: 'news',
      url: r.url,
      domain: r.domain || r.source,
      title: r.title,
      snippet: r.snippet?.substring(0, 300),
      age: r.age,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      category: categorizeMention(r.url, r.title, r.snippet),
    });
  }

  // 2. Web search for recent mentions
  await new Promise(r => setTimeout(r, 500));
  const web = await webSearch(query, { timeRange: 'week' });
  for (const r of web.results) {
    if (mentions.some(m => m.url === r.url)) continue;
    const sentiment = analyzeSentiment(r.title + ' ' + r.snippet);
    mentions.push({
      source: 'web',
      url: r.url,
      domain: r.domain,
      title: r.title,
      snippet: r.snippet?.substring(0, 300),
      age: r.age,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      category: categorizeMention(r.url, r.title, r.snippet),
    });
  }

  // 3. Social search (X, Reddit, LinkedIn)
  await new Promise(r => setTimeout(r, 500));
  const social = await searchSocial(query, ['twitter', 'reddit', 'linkedin']);
  const socialMentions = {};
  for (const [platform, results] of Object.entries(social.byPlatform || {})) {
    socialMentions[platform] = results.slice(0, 5).map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet?.substring(0, 200),
      age: r.age,
    }));
  }

  const sentimentBreakdown = {
    positive: mentions.filter(m => m.sentiment === 'positive' || m.sentiment === 'slightly_positive').length,
    neutral: mentions.filter(m => m.sentiment === 'neutral').length,
    negative: mentions.filter(m => m.sentiment === 'negative' || m.sentiment === 'slightly_negative').length,
  };

  return {
    type: 'person',
    trackerId: tracker.id,
    personName,
    org: org || null,
    checkedAt: new Date().toISOString(),
    mentions: mentions.slice(0, 30),
    mentionCount: mentions.length,
    socialMentions,
    socialCount: social.results.length,
    sentimentBreakdown,
    error: (news.error && web.error) ? news.error : null,
  };
}

export function diffPersonSnapshots(prev, curr) {
  const changes = [];

  if (!prev) {
    changes.push({
      type: 'new',
      field: 'tracker',
      value: `Initial snapshot — ${curr.mentionCount} mentions found`,
    });
    return changes;
  }

  const prevUrls = new Set((prev.mentions || []).map(m => m.url));

  for (const mention of (curr.mentions || [])) {
    if (!prevUrls.has(mention.url)) {
      const sentLabel = mention.sentiment === 'negative' || mention.sentiment === 'slightly_negative' ? '⚠ ' : '';
      changes.push({
        type: 'new',
        field: 'mention',
        value: `${sentLabel}[${mention.category}] ${mention.title?.slice(0, 80)} — ${mention.domain}`,
      });
    }
  }

  const prevCount = prev.mentionCount || 0;
  const currCount = curr.mentionCount || 0;
  if (currCount !== prevCount) {
    changes.push({
      type: 'changed',
      field: 'mentionCount',
      value: `Mention count: ${prevCount} → ${currCount}`,
    });
  }

  // Social count changes
  const prevSocial = prev.socialCount || 0;
  const currSocial = curr.socialCount || 0;
  if (currSocial !== prevSocial && (prevSocial > 0 || currSocial > 0)) {
    changes.push({
      type: 'changed',
      field: 'socialMentions',
      value: `Social mentions: ${prevSocial} → ${currSocial}`,
    });
  }

  return changes;
}
