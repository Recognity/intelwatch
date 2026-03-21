import { scrapeNewsMentions } from '../scrapers/google-news.js';
import { searchReddit, searchHackerNews } from '../scrapers/reddit-hn.js';
import { isPro, printProUpgrade } from '../license.js';

export async function runBrandCheck(tracker) {
  const { brandName } = tracker;

  // Fetch from all sources in parallel
  const [mentionData, redditResults, hnResults] = await Promise.all([
    scrapeNewsMentions(brandName),
    searchReddit(brandName, { limit: 15, timeFilter: 'month' }).catch(() => []),
    searchHackerNews(brandName, { limit: 15 }).catch(() => []),
  ]);

  // Convert Reddit results to mention format
  const redditMentions = redditResults.map(r => ({
    title: r.title,
    url: r.url,
    domain: 'reddit.com',
    category: r.subreddit,
    source: 'reddit',
    sentiment: scoreSentiment(r.title + ' ' + r.selftext),
    score: r.score,
    numComments: r.numComments,
    author: r.author,
    date: r.createdAt,
  }));

  // Convert HN results to mention format
  const hnMentions = hnResults.map(r => ({
    title: r.title,
    url: r.hnUrl,
    domain: 'news.ycombinator.com',
    category: 'hackernews',
    source: 'hackernews',
    sentiment: 'neutral',
    score: r.points,
    numComments: r.numComments,
    author: r.author,
    date: r.createdAt,
  }));

  const allMentions = [...(mentionData.mentions || []), ...redditMentions, ...hnMentions];

  return {
    type: 'brand',
    trackerId: tracker.id,
    brandName,
    checkedAt: new Date().toISOString(),
    mentions: allMentions,
    mentionCount: allMentions.length,
    sources: {
      googleNews: (mentionData.mentions || []).length,
      reddit: redditMentions.length,
      hackerNews: hnMentions.length,
    },
    error: mentionData.error || null,
    tier: isPro() ? 'pro' : 'free',
  };
}

/**
 * Simple sentiment scorer for Reddit/HN text.
 */
function scoreSentiment(text) {
  if (!text) return 'neutral';
  const lower = text.toLowerCase();
  const positive = ['great', 'awesome', 'excellent', 'love', 'best', 'amazing', 'good', 'fantastic', 'recommend', 'impressed'];
  const negative = ['bad', 'terrible', 'worst', 'hate', 'awful', 'horrible', 'scam', 'avoid', 'disappointed', 'broken', 'bug'];

  let score = 0;
  for (const word of positive) { if (lower.includes(word)) score++; }
  for (const word of negative) { if (lower.includes(word)) score--; }

  if (score >= 2) return 'positive';
  if (score === 1) return 'slightly_positive';
  if (score <= -2) return 'negative';
  if (score === -1) return 'slightly_negative';
  return 'neutral';
}

export function diffBrandSnapshots(prev, curr) {
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
      const sentLabel = mention.sentiment === 'negative' || mention.sentiment === 'slightly_negative'
        ? '⚠ ' : '';
      changes.push({
        type: 'new',
        field: 'mention',
        value: `${sentLabel}[${mention.category}] ${mention.title?.slice(0, 80)} — ${mention.domain}`,
        mention,
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

  return changes;
}

export function getMentionSummary(snapshot) {
  const mentions = snapshot.mentions || [];
  const byCategory = {};
  const bySentiment = {};

  for (const m of mentions) {
    byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    bySentiment[m.sentiment] = (bySentiment[m.sentiment] || 0) + 1;
  }

  return {
    total: mentions.length,
    byCategory,
    bySentiment,
    negativeMentions: mentions.filter(m => m.sentiment === 'negative' || m.sentiment === 'slightly_negative'),
    positiveMentions: mentions.filter(m => m.sentiment === 'positive' || m.sentiment === 'slightly_positive'),
  };
}
