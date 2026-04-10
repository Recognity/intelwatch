import { scrapeSerp } from '../scrapers/google.js';
import { searchKeywordRankings } from '../scrapers/searxng-search.js';

export async function runKeywordCheck(tracker) {
  const { keyword } = tracker;

  // Try SearXNG/Serper first
  let results = [];
  let error = null;

  try {
    const braveResults = await searchKeywordRankings(keyword);
    if (braveResults.length > 0) {
      results = braveResults.map(r => ({
        ...r,
        isFeaturedSnippet: false,
      }));
    }
  } catch (e) {
    // SearXNG/Serper failed, try Google fallback
  }

  if (results.length === 0) {
    const serpData = await scrapeSerp(keyword, { num: 20 });
    results = serpData.results || [];
    error = serpData.error;
  }

  return {
    type: 'keyword',
    trackerId: tracker.id,
    keyword,
    checkedAt: new Date().toISOString(),
    results,
    resultCount: results.length,
    error,
    featuredSnippet: results.find(r => r.isFeaturedSnippet) || null,
  };
}

export function diffKeywordSnapshots(prev, curr) {
  const changes = [];

  if (!prev) {
    changes.push({ type: 'new', field: 'tracker', value: `Initial snapshot — ${curr.resultCount} results found` });
    return changes;
  }

  const prevByDomain = {};
  for (const r of (prev.results || [])) {
    prevByDomain[r.domain] = r.position;
  }

  const currByDomain = {};
  for (const r of (curr.results || [])) {
    currByDomain[r.domain] = r.position;
  }

  // Position changes
  for (const [domain, currPos] of Object.entries(currByDomain)) {
    const prevPos = prevByDomain[domain];
    if (prevPos === undefined) {
      changes.push({
        type: 'new',
        field: 'serp_entry',
        value: `${domain} entered at #${currPos}`,
        domain,
        position: currPos,
      });
    } else if (prevPos !== currPos) {
      const diff = prevPos - currPos;
      changes.push({
        type: 'changed',
        field: 'serp_position',
        value: `${domain}: #${prevPos} → #${currPos} (${diff > 0 ? '↑' : '↓'}${Math.abs(diff)})`,
        domain,
        prevPosition: prevPos,
        currPosition: currPos,
        delta: diff,
      });
    }
  }

  // Exits
  for (const [domain, prevPos] of Object.entries(prevByDomain)) {
    if (!currByDomain[domain]) {
      changes.push({
        type: 'removed',
        field: 'serp_exit',
        value: `${domain} dropped out (was #${prevPos})`,
        domain,
        prevPosition: prevPos,
      });
    }
  }

  // Featured snippet change
  const prevFeatured = prev.featuredSnippet?.domain;
  const currFeatured = curr.featuredSnippet?.domain;
  if (prevFeatured !== currFeatured) {
    if (currFeatured) {
      changes.push({
        type: 'changed',
        field: 'featured_snippet',
        value: `Featured snippet: ${prevFeatured || 'none'} → ${currFeatured}`,
      });
    }
  }

  return changes;
}

export function getRankingsTable(snapshot) {
  return (snapshot.results || []).map(r => ({
    position: r.position,
    domain: r.domain,
    title: r.title?.slice(0, 60) || '',
    snippet: r.snippet?.slice(0, 80) || '',
    isFeaturedSnippet: r.isFeaturedSnippet,
  }));
}
