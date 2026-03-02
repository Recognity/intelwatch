import { createTracker } from '../storage.js';
import { success, warn, error } from '../utils/display.js';

export async function trackPerson(name, options) {
  const org = options.org || null;

  const { tracker, created } = createTracker('person', {
    personName: name,
    name,
    org,
  });

  if (created) {
    success(`Person tracker created: ${tracker.id}`);
    console.log(`  Person: "${name}"`);
    if (org) console.log(`  Org   : "${org}"`);
    console.log(`\nRun ${chalk_cyan('intelwatch check')} to fetch the first snapshot.`);
  } else {
    warn(`Tracker already exists: ${tracker.id}`);
  }

  return tracker;
}

export async function trackCompetitor(url, options) {
  let normalizedUrl = url;
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }
  try {
    new URL(normalizedUrl);
  } catch {
    error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  const name = options.name || new URL(normalizedUrl).hostname.replace('www.', '');

  const { tracker, created } = createTracker('competitor', {
    url: normalizedUrl,
    name,
  });

  if (created) {
    success(`Competitor tracker created: ${chalk_green(tracker.id)}`);
    console.log(`  Name : ${tracker.name}`);
    console.log(`  URL  : ${tracker.url}`);
    console.log(`\nRun ${chalk_cyan('intelwatch check')} to fetch the first snapshot.`);
  } else {
    warn(`Tracker already exists: ${tracker.id}`);
  }

  return tracker;
}

export async function trackKeyword(keyword, options) {
  const engine = options.engine || 'google';

  const { tracker, created } = createTracker('keyword', {
    keyword,
    engine,
  });

  if (created) {
    success(`Keyword tracker created: ${tracker.id}`);
    console.log(`  Keyword: "${tracker.keyword}"`);
    console.log(`  Engine : ${tracker.engine}`);
    console.log(`\nRun ${chalk_cyan('intelwatch check')} to fetch the first SERP snapshot.`);
  } else {
    warn(`Tracker already exists: ${tracker.id}`);
  }

  return tracker;
}

export async function trackBrand(brandName, options) {
  const { tracker, created } = createTracker('brand', {
    brandName,
  });

  if (created) {
    success(`Brand tracker created: ${tracker.id}`);
    console.log(`  Brand: "${tracker.brandName}"`);
    console.log(`\nRun ${chalk_cyan('intelwatch check')} to fetch the first mentions snapshot.`);
  } else {
    warn(`Tracker already exists: ${tracker.id}`);
  }

  return tracker;
}

// Inline chalk helpers to avoid import cycle issues
function chalk_green(str) { return `\x1b[32m${str}\x1b[0m`; }
function chalk_cyan(str) { return `\x1b[36m${str}\x1b[0m`; }
