import { scrapeNewsMentions } from '../scrapers/google-news.js';

export async function runBrandCheck(tracker) {
  const { brandName } = tracker;

  const mentionData = await scrapeNewsMentions(brandName);

  return {
    type: 'brand',
    trackerId: tracker.id,
    brandName,
    checkedAt: new Date().toISOString(),
    mentions: mentionData.mentions,
    mentionCount: mentionData.mentionCount,
    error: mentionData.error || null,
  };
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
