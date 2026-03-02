import { fetch } from '../utils/fetcher.js';
import { load, extractLinks, extractMeta, extractSocialLinks, extractScripts, extractPricing, simpleHash } from '../utils/parser.js';
import { detectTechnologies } from '../utils/tech-detect.js';

/**
 * Deep site analysis — captures maximum intelligence on first check.
 */
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
    keyPages: {},        // title/desc snapshots of important pages
    contentStats: null,  // blog/content activity
    seoSignals: null,    // basic SEO health indicators
    performance: null,   // response time, size
    security: null,      // basic security signals
  };

  try {
    const startTime = Date.now();
    const response = await fetch(url, { retries: 3, delay: 1000 });
    const loadTime = Date.now() - startTime;
    const html = response.data;
    const headers = response.headers || {};

    const $ = load(html);

    result.meta = extractMeta($);
    result.techStack = detectTechnologies(html, headers, url);
    result.socialLinks = extractSocialLinks($);
    result.links = extractLinks($, url);
    result.pageCount = result.links.length;

    // --- Performance snapshot ---
    result.performance = {
      responseTimeMs: loadTime,
      htmlSizeKB: Math.round(html.length / 1024),
      compressed: !!(headers['content-encoding']),
      http2: (headers[':status'] || headers['http-version'] || '').includes('2'),
    };

    // --- Security signals ---
    result.security = {
      https: url.startsWith('https'),
      hsts: !!(headers['strict-transport-security']),
      xFrameOptions: !!(headers['x-frame-options']),
      csp: !!(headers['content-security-policy']),
      xContentType: !!(headers['x-content-type-options']),
    };

    // --- SEO signals from homepage ---
    result.seoSignals = {
      hasTitle: !!result.meta.title,
      titleLength: (result.meta.title || '').length,
      hasDescription: !!result.meta.description,
      descriptionLength: (result.meta.description || '').length,
      hasCanonical: !!result.meta.canonical,
      hasOgTags: !!(result.meta.ogTitle),
      h1Count: $('h1').length,
      h2Count: $('h2').length,
      imgCount: $('img').length,
      imgWithoutAlt: $('img:not([alt]), img[alt=""]').length,
      wordCount: $.text().replace(/\s+/g, ' ').trim().split(/\s+/).length,
      generator: result.meta.generator || null,
    };

    // --- Crawl key pages for deeper intel ---
    const keyPagePaths = [
      { path: '/', label: 'homepage' },
      { path: '/pricing', label: 'pricing' },
      { path: '/tarifs', label: 'pricing' },
      { path: '/plans', label: 'pricing' },
      { path: '/about', label: 'about' },
      { path: '/a-propos', label: 'about' },
      { path: '/qui-sommes-nous', label: 'about' },
      { path: '/blog', label: 'blog' },
      { path: '/actualites', label: 'blog' },
      { path: '/news', label: 'blog' },
      { path: '/contact', label: 'contact' },
      { path: '/jobs', label: 'jobs' },
      { path: '/careers', label: 'jobs' },
      { path: '/recrutement', label: 'jobs' },
      { path: '/emploi', label: 'jobs' },
      { path: '/rejoignez-nous', label: 'jobs' },
      { path: '/produits', label: 'products' },
      { path: '/products', label: 'products' },
      { path: '/services', label: 'services' },
      { path: '/solutions', label: 'services' },
      { path: '/clients', label: 'clients' },
      { path: '/references', label: 'clients' },
      { path: '/temoignages', label: 'testimonials' },
      { path: '/testimonials', label: 'testimonials' },
    ];

    const foundPages = {};
    const jobKeywords = [
      'engineer', 'developer', 'développeur', 'manager', 'designer',
      'analyst', 'analyste', 'sales', 'commercial', 'marketing',
      'support', 'consultant', 'chef de projet', 'product', 'data',
      'devops', 'fullstack', 'frontend', 'backend', 'stage', 'alternance',
      'cdi', 'cdd', 'freelance', 'ingénieur', 'responsable', 'directeur'
    ];

    for (const { path, label } of keyPagePaths) {
      const pageUrl = new URL(path, url).href;
      // Check if this page exists in discovered links OR try it anyway for key pages
      const isLinked = result.links.some(l => l === pageUrl || l.endsWith(path));
      
      if (!isLinked && !['homepage', 'pricing', 'jobs', 'blog'].includes(label)) continue;
      if (foundPages[label] && label !== 'jobs') continue; // already found one for this category

      try {
        await new Promise(r => setTimeout(r, 800));
        const pr = await fetch(pageUrl, { retries: 1, delay: 500 });
        if (pr.status === 200 || pr.status === 301 || pr.status === 302) {
          const p$ = load(pr.data);
          const pageMeta = extractMeta(p$);
          
          foundPages[label] = {
            url: pageUrl,
            title: pageMeta.title,
            description: pageMeta.description,
            hash: simpleHash(pageMeta.title + pageMeta.description + p$.text().substring(0, 500)),
          };

          // --- Extract pricing info ---
          if (label === 'pricing') {
            result.pricing = extractPricing(p$, pr.data);
            result.pricing.url = pageUrl;
            result.pricing.pageTitle = pageMeta.title;
          }

          // --- Extract job listings ---
          if (label === 'jobs') {
            let jobCount = 0;
            const jobTitles = [];
            p$('h1,h2,h3,h4,li,article,.job,.position,.offer,.offre').each((_, el) => {
              const text = p$(el).text().toLowerCase().trim();
              if (text.length > 10 && text.length < 200 && jobKeywords.some(k => text.includes(k))) {
                jobCount++;
                if (jobTitles.length < 15) jobTitles.push(p$(el).text().trim().substring(0, 100));
              }
            });
            result.jobs = {
              url: pageUrl,
              estimatedOpenings: jobCount,
              titles: [...new Set(jobTitles)],
              pageTitle: pageMeta.title,
            };
          }

          // --- Extract blog/content activity ---
          if (label === 'blog') {
            const articles = [];
            p$('article, .post, .entry, .blog-post, .article-item').each((_, el) => {
              const title = p$(el).find('h2,h3,.title,.entry-title').first().text().trim();
              const link = p$(el).find('a').first().attr('href');
              const date = p$(el).find('time,.date,.published,.post-date').first().text().trim();
              if (title) articles.push({ title: title.substring(0, 120), link, date });
            });
            
            // Fallback: look for h2/h3 links in blog page
            if (articles.length === 0) {
              p$('h2 a, h3 a').each((_, el) => {
                const title = p$(el).text().trim();
                const link = p$(el).attr('href');
                if (title && title.length > 10) articles.push({ title: title.substring(0, 120), link });
              });
            }

            result.contentStats = {
              url: pageUrl,
              recentArticles: articles.slice(0, 10),
              articleCount: articles.length,
              pageTitle: pageMeta.title,
            };
          }
        }
      } catch {}
    }

    result.keyPages = foundPages;

    // --- If no pricing found from key pages, check homepage ---
    if (!result.pricing) {
      const pageText = $.text();
      if (/\$\d+|€\d+|£\d+/.test(pageText) && /plan|pricing|price|tarif/.test(pageText.toLowerCase())) {
        result.pricing = extractPricing($, html);
        result.pricing.url = url;
      }
    }

    // --- Discover additional pages by crawling 1 level deep ---
    // Pick up to 5 important-looking internal links to crawl
    const importantPatterns = ['/produit', '/product', '/service', '/solution', '/offre', '/promo', '/categor'];
    const extraPages = result.links
      .filter(l => importantPatterns.some(p => l.toLowerCase().includes(p)))
      .slice(0, 5);

    for (const extraUrl of extraPages) {
      try {
        await new Promise(r => setTimeout(r, 600));
        const er = await fetch(extraUrl, { retries: 1, delay: 300 });
        if (er.status === 200) {
          const e$ = load(er.data);
          const extraLinks = extractLinks(e$, url);
          for (const el of extraLinks) {
            if (!result.links.includes(el)) result.links.push(el);
          }
        }
      } catch {}
    }
    
    result.pageCount = result.links.length;

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
