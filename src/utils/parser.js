import * as cheerio from 'cheerio';

export function load(html) {
  return cheerio.load(html);
}

export function extractLinks($, baseUrl) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.hostname === new URL(baseUrl).hostname) {
        links.add(url.href.split('#')[0].split('?')[0]);
      }
    } catch {}
  });
  return [...links];
}

export function extractMeta($) {
  const meta = {};
  meta.title = $('title').first().text().trim();
  meta.description = $('meta[name="description"]').attr('content') || '';
  meta.keywords = $('meta[name="keywords"]').attr('content') || '';
  meta.ogTitle = $('meta[property="og:title"]').attr('content') || '';
  meta.ogDescription = $('meta[property="og:description"]').attr('content') || '';
  meta.canonical = $('link[rel="canonical"]').attr('href') || '';
  meta.generator = $('meta[name="generator"]').attr('content') || '';
  return meta;
}

export function extractSocialLinks($) {
  const socialPatterns = {
    twitter: /twitter\.com|x\.com/,
    facebook: /facebook\.com/,
    linkedin: /linkedin\.com/,
    instagram: /instagram\.com/,
    youtube: /youtube\.com/,
    github: /github\.com/,
    tiktok: /tiktok\.com/,
    pinterest: /pinterest\.com/,
  };

  const socials = {};
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    for (const [platform, pattern] of Object.entries(socialPatterns)) {
      if (pattern.test(href) && !socials[platform]) {
        socials[platform] = href;
      }
    }
  });
  return socials;
}

export function extractScripts($) {
  const scripts = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) scripts.push(src);
  });
  return scripts;
}

export function extractHtml($) {
  return $.html();
}

export function textContent($, selector) {
  return $(selector).text().trim();
}

export function extractPricing($, html) {
  const pricePatterns = [
    /\$\d+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year|user|seat))?/gi,
    /€\d+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year|user|seat))?/gi,
    /£\d+(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|yr|year|user|seat))?/gi,
    /\d+(?:\.\d{2})?\s*(?:USD|EUR|GBP)(?:\s*\/\s*(?:mo|month|yr|year))?/gi,
  ];

  const prices = new Set();
  for (const pattern of pricePatterns) {
    const matches = html.match(pattern) || [];
    for (const m of matches) prices.add(m.trim());
  }

  const planKeywords = ['starter', 'basic', 'pro', 'professional', 'business', 'enterprise', 'free', 'premium', 'plus'];
  const plans = [];
  for (const kw of planKeywords) {
    // Rechercher dans le texte propre (au lieu du code HTML raw) pour éviter de capturer du code source
    const textContent = $.text().replace(/\s+/g, ' ');
    const regex = new RegExp(`(?:^|\\s)${kw}\\s[^$€£]{0,50}?[$€£][\\d,.]+`, 'gi');
    const matches = textContent.match(regex) || [];
    plans.push(...matches.slice(0, 2).map(m => m.trim()));
  }

  return {
    prices: [...prices].slice(0, 20),
    plans: [...new Set(plans)].slice(0, 10),
    hash: simpleHash([...prices].sort().join('|')),
  };
}

export function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
