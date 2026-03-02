import { fetch, fetchWithDelay } from '../utils/fetcher.js';
import { load, extractLinks, extractMeta, extractSocialLinks, extractScripts, extractPricing, simpleHash } from '../utils/parser.js';
import { detectTechnologies } from '../utils/tech-detect.js';

export async function analyzeSite(url) {
  const result = {
    url,
    checkedAt: new Date().toISOString(),
    status: 'ok',
    error: null,
    meta: {},
    techStack: [],
    socialLinks: {},
    links: [],
    pageCount: 0,
    pricing: null,
    jobs: null,
  };

  try {
    const response = await fetch(url, { retries: 3, delay: 1000 });
    const html = response.data;
    const headers = response.headers || {};

    const $ = load(html);

    result.meta = extractMeta($);
    result.techStack = detectTechnologies(html, headers, url);
    result.socialLinks = extractSocialLinks($);
    result.links = extractLinks($, url);
    result.pageCount = result.links.length;

    // Check pricing page
    const pricingPaths = ['/pricing', '/plans', '/tarifs', '/prices', '/buy', '/subscribe'];
    let pricingData = null;

    for (const path of pricingPaths) {
      const pricingUrl = new URL(path, url).href;
      if (result.links.some(l => l === pricingUrl || l.includes(path))) {
        try {
          await new Promise(r => setTimeout(r, 1200));
          const pr = await fetch(pricingUrl);
          if (pr.status === 200) {
            const p$ = load(pr.data);
            pricingData = extractPricing(p$, pr.data);
            pricingData.url = pricingUrl;
            break;
          }
        } catch {}
      }
    }

    // Also check pricing on current page
    if (!pricingData) {
      const pageText = $.text();
      if (/\$\d+|€\d+|£\d+/.test(pageText) && /plan|pricing|price|tarif/.test(pageText.toLowerCase())) {
        pricingData = extractPricing($, html);
        pricingData.url = url;
      }
    }

    result.pricing = pricingData;

    // Check jobs page
    const jobPaths = ['/jobs', '/careers', '/hiring', '/work-with-us', '/join-us', '/emploi', '/recrutement'];
    let jobData = null;

    for (const path of jobPaths) {
      const jobUrl = new URL(path, url).href;
      if (result.links.some(l => l === jobUrl || l.includes(path))) {
        try {
          await new Promise(r => setTimeout(r, 1200));
          const jr = await fetch(jobUrl);
          if (jr.status === 200) {
            const j$ = load(jr.data);
            const jobKeywords = ['engineer', 'developer', 'manager', 'designer', 'analyst', 'sales', 'marketing', 'support'];
            let count = 0;
            j$('h1,h2,h3,li,article').each((_, el) => {
              const text = j$(el).text().toLowerCase();
              if (jobKeywords.some(k => text.includes(k))) count++;
            });
            jobData = { url: jobUrl, estimatedOpenings: count };
            break;
          }
        } catch {}
      }
    }
    result.jobs = jobData;

  } catch (err) {
    result.status = 'error';
    result.error = err.message;
  }

  return result;
}

export async function analyzeKeyPages(url, pages = ['/', '/about', '/pricing']) {
  const results = {};
  for (const page of pages) {
    try {
      const pageUrl = new URL(page, url).href;
      await new Promise(r => setTimeout(r, 1500));
      const response = await fetch(pageUrl);
      if (response.status === 200) {
        const $ = load(response.data);
        const meta = extractMeta($);
        results[page] = {
          title: meta.title,
          description: meta.description,
          hash: simpleHash(meta.title + meta.description),
        };
      }
    } catch {}
  }
  return results;
}
