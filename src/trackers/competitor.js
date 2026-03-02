import { analyzeSite, analyzeKeyPages } from '../scrapers/site-analyzer.js';
import { scrapeNewsMentions } from '../scrapers/google-news.js';
import { diffTechStacks } from '../utils/tech-detect.js';
import { fetch } from '../utils/fetcher.js';
import { load } from '../utils/parser.js';
import { analyzeSentiment, categorizeMention } from '../utils/sentiment.js';

export async function runCompetitorCheck(tracker) {
  const { url } = tracker;

  const siteData = await analyzeSite(url);
  const keyPages = await analyzeKeyPages(url, ['/', '/about', '/pricing']);

  // Merge keyPages from deep analysis with the separate call
  const mergedKeyPages = { ...siteData.keyPages, ...keyPages };

  // --- Press & reputation layer ---
  const brandName = tracker.name || new URL(url).hostname.replace('www.', '').split('.')[0];
  
  let press = { articles: [], totalCount: 0 };
  let reputation = { reviews: [], avgRating: null, platforms: [] };

  try {
    // Search Google News for the brand
    const newsData = await scrapeNewsMentions(brandName, { lang: 'fr' });
    const pressArticles = (newsData.mentions || []).filter(m => 
      m.category === 'press' || m.source === 'google_news'
    );
    const forumMentions = (newsData.mentions || []).filter(m => 
      m.category === 'forum' || m.category === 'social'
    );
    
    press = {
      articles: newsData.mentions.slice(0, 15).map(m => ({
        title: m.title,
        url: m.url,
        domain: m.domain,
        sentiment: m.sentiment,
        category: m.category,
        source: m.source,
      })),
      totalCount: newsData.mentionCount,
      pressCount: pressArticles.length,
      forumCount: forumMentions.length,
      sentimentBreakdown: {
        positive: newsData.mentions.filter(m => m.sentiment === 'positive' || m.sentiment === 'slightly_positive').length,
        neutral: newsData.mentions.filter(m => m.sentiment === 'neutral').length,
        negative: newsData.mentions.filter(m => m.sentiment === 'negative' || m.sentiment === 'slightly_negative').length,
      },
    };
  } catch {}

  // Search for reviews on major platforms
  try {
    const reviewPlatforms = [
      { name: 'Trustpilot', searchUrl: `https://www.google.com/search?q=site:trustpilot.com+"${brandName}"` },
      { name: 'Google Avis', searchUrl: `https://www.google.com/search?q="${brandName}"+avis+clients` },
    ];
    
    for (const platform of reviewPlatforms) {
      try {
        await new Promise(r => setTimeout(r, 1500));
        const resp = await fetch(platform.searchUrl, { retries: 1, delay: 1000 });
        if (resp.status === 200) {
          const $ = load(resp.data);
          const text = $.text().toLowerCase();
          
          // Try to extract rating patterns
          const ratingMatch = text.match(/(\d[.,]\d)\s*(?:\/\s*5|sur\s*5|out of 5|stars?|étoiles?)/);
          const reviewCountMatch = text.match(/(\d[\d\s,.]*)\s*(?:avis|reviews?|évaluations?|notes?)/);
          
          if (ratingMatch || reviewCountMatch) {
            reputation.platforms.push({
              name: platform.name,
              rating: ratingMatch ? ratingMatch[1].replace(',', '.') : null,
              reviewCount: reviewCountMatch ? reviewCountMatch[1].replace(/\s/g, '') : null,
            });
          }

          // Extract review snippets
          $('a[href]').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (/trustpilot|avis|review/.test(href) && href.startsWith('http')) {
              const title = $(el).text().trim();
              if (title.length > 15 && reputation.reviews.length < 5) {
                const sentiment = analyzeSentiment(title);
                reputation.reviews.push({
                  title: title.substring(0, 150),
                  url: href,
                  platform: platform.name,
                  sentiment: sentiment.label,
                });
              }
            }
          });
        }
      } catch {}
    }
  } catch {}

  return {
    type: 'competitor',
    trackerId: tracker.id,
    url,
    checkedAt: new Date().toISOString(),
    status: siteData.status,
    error: siteData.error,
    meta: siteData.meta,
    techStack: siteData.techStack,
    socialLinks: siteData.socialLinks,
    links: siteData.links,
    pageCount: siteData.pageCount,
    pricing: siteData.pricing,
    jobs: siteData.jobs,
    keyPages: mergedKeyPages,
    performance: siteData.performance,
    security: siteData.security,
    seoSignals: siteData.seoSignals,
    contentStats: siteData.contentStats,
    press,
    reputation,
  };
}

export function diffCompetitorSnapshots(prev, curr) {
  const changes = [];

  if (!prev) {
    changes.push({ type: 'new', field: 'tracker', value: 'Initial snapshot created' });
    return changes;
  }

  // Page count change
  const prevCount = prev.pageCount || 0;
  const currCount = curr.pageCount || 0;
  if (currCount !== prevCount) {
    const diff = currCount - prevCount;
    changes.push({
      type: diff > 0 ? 'new' : 'removed',
      field: 'pageCount',
      value: `${prevCount} → ${currCount} (${diff > 0 ? '+' : ''}${diff} pages)`,
    });
  }

  // New/removed pages
  const prevLinks = new Set(prev.links || []);
  const currLinks = new Set(curr.links || []);
  const newPages = [...currLinks].filter(l => !prevLinks.has(l)).slice(0, 10);
  const removedPages = [...prevLinks].filter(l => !currLinks.has(l)).slice(0, 10);

  for (const page of newPages) {
    changes.push({ type: 'new', field: 'page', value: page });
  }
  for (const page of removedPages) {
    changes.push({ type: 'removed', field: 'page', value: page });
  }

  // Tech stack changes
  const techDiff = diffTechStacks(prev.techStack || [], curr.techStack || []);
  for (const tech of techDiff.added) {
    changes.push({ type: 'new', field: 'tech', value: `${tech.name} (${tech.category})` });
  }
  for (const tech of techDiff.removed) {
    changes.push({ type: 'removed', field: 'tech', value: `${tech.name} (${tech.category})` });
  }

  // Pricing changes
  if (prev.pricing && curr.pricing) {
    if (prev.pricing.hash !== curr.pricing.hash) {
      changes.push({
        type: 'changed',
        field: 'pricing',
        value: `Pricing page content changed`,
      });
    }
  } else if (!prev.pricing && curr.pricing) {
    changes.push({ type: 'new', field: 'pricing', value: 'Pricing page detected' });
  }

  // Job changes
  const prevJobs = prev.jobs?.estimatedOpenings || 0;
  const currJobs = curr.jobs?.estimatedOpenings || 0;
  if (currJobs !== prevJobs && (prevJobs > 0 || currJobs > 0)) {
    const diff = currJobs - prevJobs;
    changes.push({
      type: diff > 0 ? 'new' : 'changed',
      field: 'jobs',
      value: `Estimated openings: ${prevJobs} → ${currJobs} (${diff > 0 ? '+' : ''}${diff})`,
    });
  }

  // Meta title/description changes on key pages
  for (const [page, currPage] of Object.entries(curr.keyPages || {})) {
    const prevPage = (prev.keyPages || {})[page];
    if (!prevPage) {
      if (currPage.title) {
        changes.push({ type: 'new', field: `meta:${page}`, value: currPage.title });
      }
      continue;
    }
    if (prevPage.title !== currPage.title) {
      changes.push({
        type: 'changed',
        field: `title:${page}`,
        value: `"${prevPage.title}" → "${currPage.title}"`,
      });
    }
    if (prevPage.description !== currPage.description) {
      changes.push({
        type: 'changed',
        field: `description:${page}`,
        value: currPage.description,
      });
    }
  }

  // Social links changes
  const prevSocials = Object.keys(prev.socialLinks || {});
  const currSocials = Object.keys(curr.socialLinks || {});
  for (const platform of currSocials) {
    if (!prevSocials.includes(platform)) {
      changes.push({ type: 'new', field: 'social', value: `${platform}: ${curr.socialLinks[platform]}` });
    }
  }
  for (const platform of prevSocials) {
    if (!currSocials.includes(platform)) {
      changes.push({ type: 'removed', field: 'social', value: `${platform} removed` });
    }
  }

  // Press mention changes
  const prevPressCount = prev.press?.totalCount || 0;
  const currPressCount = curr.press?.totalCount || 0;
  if (currPressCount > 0 && currPressCount !== prevPressCount) {
    changes.push({
      type: currPressCount > prevPressCount ? 'new' : 'changed',
      field: 'press',
      value: `${prevPressCount} → ${currPressCount} mentions (${curr.press.sentimentBreakdown?.negative || 0} negative)`,
    });
  }

  // Reputation changes
  const prevRating = prev.reputation?.platforms?.[0]?.rating;
  const currRating = curr.reputation?.platforms?.[0]?.rating;
  if (currRating && currRating !== prevRating) {
    changes.push({
      type: 'changed',
      field: 'reputation',
      value: prevRating ? `Rating: ${prevRating} → ${currRating}` : `Rating: ${currRating}/5`,
    });
  }

  return changes;
}

export function computeThreatScore(tracker, recentChanges) {
  let score = 0;

  for (const change of recentChanges) {
    if (change.field === 'pageCount') score += 1;
    if (change.field === 'page') score += 0.3;
    if (change.field === 'tech') score += 2;
    if (change.field === 'pricing') score += 3;
    if (change.field === 'jobs') {
      const match = change.value.match(/\+(\d+)/);
      if (match) score += Math.min(parseInt(match[1]), 5);
    }
    if (change.field.startsWith('title:')) score += 2;
    if (change.field.startsWith('description:')) score += 1;
  }

  return Math.min(Math.round(score), 10);
}
