import { analyzeSite, analyzeKeyPages } from '../scrapers/site-analyzer.js';
import { diffTechStacks } from '../utils/tech-detect.js';

export async function runCompetitorCheck(tracker) {
  const { url } = tracker;

  const siteData = await analyzeSite(url);
  const keyPages = await analyzeKeyPages(url, ['/', '/about', '/pricing']);

  // Merge keyPages from deep analysis with the separate call
  const mergedKeyPages = { ...siteData.keyPages, ...keyPages };

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
